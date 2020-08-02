import { Pipeline, TupleCountExtractor, getDependenciesFromRA, EndStageEvent as StageEndedEvent } from './tuple_count_extractor';
import { getDominanceRelation } from './dominators';
import { getStronglyConnectedComponents, Scc } from './strongly_connected_components';
import { getInverse, withoutNulls } from './util';
import { abbreviateStrings } from './string_set_abbreviation';

export interface FlamegraphNode {
    name: string;
    value: number;
    children: FlamegraphNode[];
    rawLines?: string[];
    tupleCountEvents?: Pipeline[];
}

export function getFramegraphFromPipelines(pipelines: Pipeline[]) {
    let builder = new FlamegraphBuilder();
    for (let pipeline of pipelines) {
        builder.addPipeline(pipeline);
    }
    return builder.finish();
}

export function getFlamegraphFromLogText(text: string) {
    let parser = new TupleCountExtractor();
    let builder = new FlamegraphBuilder(parser);
    parser.input.addText(text);
    return builder.finish();
}

type SccNode = Scc<string>;

class PredicateNode {
    constructor(readonly name: string) {}
    tupleCount = 0;
    dependencies = new Set<string>();
    dependents = new Set<string>();
    seenEvaluation = false;

    tupleCountEvents: Pipeline[] = [];

    rawLines: string[] = [];

    scc: SccNode | undefined;
}

function rewritePredicateName(name: string) {
    return name.replace(/#(cur_delta|prev_delta|prev)/, '');
}

export class FlamegraphBuilder {
    predicateNodes = new Map<string, PredicateNode>();
    stageNodes: FlamegraphNode[] = [];

    constructor(parser?: TupleCountExtractor) {
        if (parser != null) {
            this.listen(parser);
        }
    }

    listen(parser: TupleCountExtractor) {
        parser.onPipeline.listen(this.addPipeline.bind(this));
        parser.onStageEnded.listen(this.handleStageEnded.bind(this));
    }

    getPredicateNode(name: string) {
        let result = this.predicateNodes.get(name);
        if (result == null) {
            result = new PredicateNode(name);
            this.predicateNodes.set(name, result);
        }
        return result;
    }

    handleStageEnded(event: StageEndedEvent) {
        this.stageNodes.push(this.getFlamegraphNodeFromStage(event));
        this.predicateNodes.clear();
    }

    addPipeline(pipeline: Pipeline) {
        let name = rewritePredicateName(pipeline.predicate);
        let node = this.getPredicateNode(name);
        node.seenEvaluation = true;
        for (let step of pipeline.steps) {
            node.tupleCount += step.tupleCount;
            for (let otherRelation of getDependenciesFromRA(step.raText).inputRelations) {
                otherRelation = rewritePredicateName(otherRelation);
                node.dependencies.add(otherRelation);
                this.getPredicateNode(otherRelation).dependents.add(name);
            }
        }
        node.rawLines.push(...pipeline.rawLines);
        node.tupleCountEvents.push(pipeline);
    }

    getRoots() {
        let roots: string[] = [];
        this.predicateNodes.forEach((data, name) => {
            if (data.dependents.size === 0) {
                roots.push(name);
            }
        });
        return roots;
    }

    getFlamegraphNodeFromPredicate(predicate: string, dominated: Map<SccNode | null, SccNode[]>, successors: SccNode[]): FlamegraphNode | undefined {
        let node = this.getPredicateNode(predicate);
        if (!node.seenEvaluation) { return undefined; }
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
            children,
            rawLines: node.rawLines,
            tupleCountEvents: node.tupleCountEvents,
        };
    }

    getFlamegraphNodeFromScc(scc: SccNode, dominated: Map<SccNode | null, SccNode[]>): FlamegraphNode | undefined {
        let { members } = scc;
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
        let roots = this.getRoots();
        let predicates = Array.from(this.predicateNodes.keys());
        let sccMap = getStronglyConnectedComponents(predicates, pred => this.getPredicateNode(pred).dependencies);
        sccMap.nodes.forEach((scc, predicate) => {
            this.getPredicateNode(predicate).scc = scc;
        });
        let rootSccs = roots.map(r => sccMap.nodes.get(r)!);
        let sccDominators = getDominanceRelation(rootSccs, scc => scc.successors);
        let sccDominated = getInverse(sccDominators);

        let levelOneNodes = withoutNulls(rootSccs.map(n => this.getFlamegraphNodeFromScc(n, sccDominated)));
        return {
            name: abbreviateStrings(stage.queryPredicates),
            value: totalValue(levelOneNodes),
            children: levelOneNodes,
        };
    }

    finish(): FlamegraphNode {
        let children = this.stageNodes;
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
