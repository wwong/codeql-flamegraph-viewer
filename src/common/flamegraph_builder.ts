import {getDominanceRelation} from './dominators';
import {streamBlocksAsync, streamBlocksSync} from './json_stream';
import {abbreviateStrings} from './string_set_abbreviation';
import {getStronglyConnectedComponents, Scc} from './strongly_connected_components';
import {
    EvalLogTupleCountParser,
    getDependenciesFromRA,
    isUnionOperator,
    Pipeline,
    PredicateSizeEvent,
    QueryEndedEvent,
    StageEndedEvent,
    TupleCountStream
} from './tuple_counts';
import {getInverse, withoutNulls} from './util';

export function getFlamegraphFromEvaluatorLog(stream: NodeJS.ReadableStream): Promise<FlamegraphNode> {
    return streamBlocksAsync(stream).thenNew(EvalLogTupleCountParser).thenNew(FlamegraphBuilder).get().then(x => x.finish());
}

export function getFlamegraphFromEvaluatorLogText(text: string): FlamegraphNode {
    return streamBlocksSync(text).thenNew(EvalLogTupleCountParser).thenNew(FlamegraphBuilder).get().finish();
}

export interface FlamegraphNode {
    kind?: string;
    name: string;
    value: number;
    children: FlamegraphNode[];
    rawLines?: string[][];
    ownValue?: number;
}

type SccNode = Scc<string>;

class PredicateNode {
    constructor(readonly name: string) {
    }

    tupleCount = 0;
    dependencies = new Set<string>();
    dependents = new Set<string>();
    seenEvaluation = false;

    rawLines: string[][] = [];

    scc: SccNode | undefined;
}

function rewritePredicateName(name: string) {
    return name.replace(/(#(cur_delta|prev_delta|prev)|@staged_ext|_delta)$|@i\d+\b/g, '');
}

function simplifyQueryName(name: string) {
    return name.split('/').reverse()[0];
}

export class FlamegraphBuilder {
    predicateNodes = new Map<string, PredicateNode>();
    stagePredicates = new Map<number, Set<string>>();
    stageNodes = new Map<number, FlamegraphNode>();
    queryNodes = new Map<string, FlamegraphNode>();
    queryEventQueue = new Array<QueryEndedEvent>();
    stageEventQueue = new Array<StageEndedEvent>();

    constructor(input: TupleCountStream) {
        input.onPipeline.listen(this.onPipeline.bind(this));
        input.onStageEnded.listen(this.onStageEnded.bind(this));
        input.onQueryEnded.listen(this.onQueryEnded.bind(this));
        input.onPredicateSize.listen(this.onPredicateSize.bind(this));
    }

    private getPredicateNode(name: string) {
        let result = this.predicateNodes.get(name);
        if (result == null) {
            result = new PredicateNode(name);
            this.predicateNodes.set(name, result);
        }
        return result;
    }

    private onPredicateSize(event: PredicateSizeEvent) {
        for (let stageId of event.stages) {
            let stagePredicateMapping = this.stagePredicates.get(stageId);
            if (stagePredicateMapping === undefined) {
                this.stagePredicates.set(stageId, new Set<string>([event.predicate]));
            } else {
                stagePredicateMapping.add(event.predicate);
            }
        }
    }

    private onQueryEnded(event: QueryEndedEvent) {
        this.queryEventQueue.push(event);
    }

    private onStageEnded(event: StageEndedEvent) {
        this.stageEventQueue.push(event);
    }

    private processStageEnded() {
        this.stageEventQueue.forEach(event => {
            this.stageNodes.set(event.id, this.getFlamegraphNodeFromStage(event));
        });
    }

    private processQueryEnded(event: QueryEndedEvent): FlamegraphNode {
        let childStages: FlamegraphNode[] = [];
        for (let stageId of event.stages) {
            let stageNode = this.stageNodes.get(stageId);
            childStages.push(stageNode!);
        }
        return {
            name: simplifyQueryName(event.queryName),
            kind: 'Query',
            children: childStages,
            value: totalValue(childStages),
        };
    }

    private onPipeline(pipeline: Pipeline) {
        let name = rewritePredicateName(pipeline.predicate);
        let node = this.getPredicateNode(name);
        node.seenEvaluation = true;
        for (let step of pipeline.steps) {
            if (!isUnionOperator(step.raText)) {
                node.tupleCount += step.tupleCount;
            }
            for (let otherRelation of getDependenciesFromRA(step.raText).inputRelations) {
                otherRelation = rewritePredicateName(otherRelation);
                node.dependencies.add(otherRelation);
                this.getPredicateNode(otherRelation).dependents.add(name);
            }
        }
        node.rawLines.push(pipeline.rawLines);
    }

    private getRoots(id?: number) {
        if (id !== undefined) {
            let allNodes = this.stagePredicates.get(id);
            if (allNodes !== undefined) {
                return Array.from(allNodes.values())
                    .map(predicateName => this.predicateNodes.get(predicateName))
                    .filter(node => node !== undefined && node.dependents.size === 0)
                    .map(node => node!.name);
            }
        }
        let roots: string[] = [];
        this.predicateNodes.forEach((data, name) => {
            if (data.dependents.size === 0) {
                roots.push(name);
            }
        });
        return roots;
    }

    private getFlamegraphNodeFromPredicate(predicate: string, dominated: Map<SccNode | null, SccNode[]>, successors: SccNode[]): FlamegraphNode | undefined {
        let node = this.getPredicateNode(predicate);
        if (!node.seenEvaluation) {
            return undefined;
        }
        let children: FlamegraphNode[] = [];
        for (let successor of successors) {
            let child = this.getFlamegraphNodeFromScc(successor, dominated);
            if (child != null) {
                children.push(child);
            }
        }
        let value = node.tupleCount + totalValue(children);
        return {
            name: node.name,
            value,
            ownValue: node.tupleCount,
            children,
            rawLines: node.rawLines,
        };
    }

    private getFlamegraphNodeFromScc(scc: SccNode, dominated: Map<SccNode | null, SccNode[]>): FlamegraphNode | undefined {
        let {members} = scc;
        if (members.length === 1) {
            return this.getFlamegraphNodeFromPredicate(members[0], dominated, dominated.get(scc) ?? []);
        }
        let name = abbreviateStrings(members);
        let children: FlamegraphNode[] = [];
        for (let member of members) {
            let child = this.getFlamegraphNodeFromPredicate(member, dominated, []);
            if (child != null) {
                children.push(child);
            }
        }
        let successors = dominated.get(scc) ?? [];
        successors.forEach(otherScc => {
            let child = this.getFlamegraphNodeFromScc(otherScc, dominated);
            if (child != null) {
                children.push(child);
            }
        });
        return {
            name,
            value: totalValue(children),
            children,
        };
    }

    private getFlamegraphNodeFromStage(stage: StageEndedEvent): FlamegraphNode {
        let roots = this.getRoots(stage.id);
        let predicates: Array<string> = [];
        if (stage.id === undefined) {
            console.log('Missing stage id in end event');
            predicates = Array.from(this.predicateNodes.keys());
        } else {
            let currentStagePredicates = this.stagePredicates.get(stage.id);
            if (currentStagePredicates === null || currentStagePredicates === undefined) {
                return {
                    'kind': 'empty',
                    'name': 'placeholder',
                    'value': -1,
                    'children': [],
                };
            } else {
                predicates = Array.from(currentStagePredicates.values());
            }
        }
        let sccMap = getStronglyConnectedComponents(predicates, pred => this.getPredicateNode(pred).dependencies);
        sccMap.nodes.forEach((scc, predicate) => {
            this.getPredicateNode(predicate).scc = scc;
        });
        let rootSccs = roots.map(r => sccMap.nodes.get(r)!);
        let sccDominators = getDominanceRelation(rootSccs, scc => scc.successors);
        let sccDominated = getInverse(sccDominators);
        let levelOneNodes = withoutNulls(rootSccs.map(n => this.getFlamegraphNodeFromScc(n, sccDominated)));

        // These lists could be hundreds long, which is counterproductive for naming the stage.
        // Instead, we take the last predicate seen to name the stage because it's most likely to have run after any,
        // dependents (IE be the head of the dependency tree). That might not be accurate, but the boxes stacked on
        // top of the stage in the resulting flamegraph should also be descriptive enough that the user can get the gist.
        let lastPredicate = '';
        if (stage.queryPredicates.length > 0) {
            lastPredicate = stage.queryPredicates[stage.queryPredicates.length - 1];
        }

        return {
            kind: 'Stage',
            name: `${stage.id} - ${lastPredicate}`,
            value: totalValue(levelOneNodes),
            children: levelOneNodes,
        };
    }

    finish(): FlamegraphNode {
        this.processStageEnded();
        const children = Array.from(
            this.queryEventQueue
                .map(event => this.processQueryEnded(event))
                .values());

        return {
            name: 'root',
            value: totalValue(children),
            children: children,
        };
    }
}

function totalValue(children: FlamegraphNode[]) {
    return children.reduce((x, y) => x + y.value, 0);
}