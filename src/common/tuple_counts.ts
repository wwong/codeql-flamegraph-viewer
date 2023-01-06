import {EventStream} from './event_stream';
import {JsonStream} from './json_stream';
import {
    EventType,
    isPipelineCompletedEvent,
    isPipelineStartedEvent,
    isPredicateCompletedEvent,
    isPredicateStartedEvent,
    isQueryCompletedEvent,
    isQueryStartedEvent,
    LogEvent,
    PipelineStartedEvent,
    PredicateStartedEvent,
    QueryStartedEvent
} from './eval_log_events';
import _ = require('lodash');

export interface TupleCountStream {
    onQueryEnded: EventStream<QueryEndedEvent>;
    onPipeline: EventStream<Pipeline>;
    onPredicateSize: EventStream<PredicateSizeEvent>;
    onStageEnded: EventStream<StageEndedEvent>;
    end: EventStream<void>;
}

/**
 * An RA pipeline with tuple counts.
 */
export interface Pipeline {
    predicate: string;
    steps: PipelineStep[];
    startLine: number;
    endLine: number;
    rawLines: string[];
}

export interface PipelineStep {
    tupleCount: number;
    arity: number;
    duplication: number;
    raText: string;
}

export interface PredicateSizeEvent {
    predicate: string;
    size: number;
    stages: number[];
}

export interface StageEndedEvent {
    queryPredicates: string[];
    queryName: string;
    id: number
}

export interface QueryEndedEvent {
    queryName: string,
    stages: number[],
}

export class EvalLogTupleCountParser implements TupleCountStream {
    public readonly onPipeline = new EventStream<Pipeline>();
    public readonly onPredicateSize = new EventStream<PredicateSizeEvent>();
    public readonly onStageEnded = new EventStream<StageEndedEvent>();
    public readonly onQueryEnded = new EventStream<QueryEndedEvent>();
    public readonly end: EventStream<void>;

    public seenPredicateEvaluation = false;

    // Log events are mostly paired up as start/end events where most information is in the start
    // event, but tuple counts are in the end event
    public openPredicates: { [eventId: number]: PredicateStartedEvent } = {};
    public openPipelines: { [eventId: number]: PipelineStartedEvent } = {};
    private openQueries: { [eventId: number]: QueryStartedEvent } = {};
    // The logs also don't tell us what all the predicates run inside a stage are, so we create our own running tally
    private stagePredicates: { [stage: number]: string[] } = {};

    constructor(public readonly input: JsonStream) {
        this.end = input.end;

        input.on(EventType.PREDICATE_STARTED, (predicateStartedEvent: LogEvent) => {
            if (!isPredicateStartedEvent(predicateStartedEvent)) {
                return;
            }

            this.seenPredicateEvaluation = true;
            this.openPredicates[predicateStartedEvent.eventId] = predicateStartedEvent;
            for (let predicateName in predicateStartedEvent.appearsAs) {
                for (let stageId of predicateStartedEvent.appearsAs[predicateName]) {
                    if (stageId in this.stagePredicates) {
                        this.stagePredicates[stageId].push(predicateName);
                    } else {
                        this.stagePredicates[stageId] = [predicateName];
                    }
                }
            }
        });

        input.on(EventType.PREDICATE_COMPLETED, (predicateCompletedEvent: LogEvent) => {
            if (!isPredicateCompletedEvent(predicateCompletedEvent)) {
                return;
            }

            let predicate = this.openPredicates[predicateCompletedEvent.startEvent];
            this.onPredicateSize.fire({
                predicate: predicate.predicateName,
                size: predicateCompletedEvent.resultSize,
                stages: _.uniq(_.flatten(Object.values(predicate.appearsAs)))
            });
            delete this.openPredicates[predicateCompletedEvent.startEvent];
        });

        input.on(EventType.PIPELINE_STARTED, pipelineStartedEvent => {
            if (!isPipelineStartedEvent(pipelineStartedEvent)) {
                return;
            }
            this.openPipelines[pipelineStartedEvent.eventId] = pipelineStartedEvent;
        });

        input.on(EventType.PIPELINE_COMPLETED, pipelineCompletedEvent => {
            if (!isPipelineCompletedEvent(pipelineCompletedEvent)) {
                return;
            }
            const pipeline: PipelineStartedEvent = this.openPipelines[pipelineCompletedEvent.startEvent];
            const parentPredicate: PredicateStartedEvent = this.openPredicates[pipeline.predicateStartEvent];
            const pipelineRa = parentPredicate.ra[pipeline.raReference];

            if (pipelineRa === undefined) {
                //throw an error?
                return;
            }

            let stepsMetadata: PipelineStep[] = [];
            for (let i = 0; i < pipelineRa.length; i++) {
                const raText = pipelineRa[i];
                if (/^\s+return\s/.test(raText)) {
                    continue;
                }

                const arityMatch = /^\s*[{](\d+)[}]/.exec(raText);

                stepsMetadata.push({
                    arity: Number(arityMatch) || 0,
                    duplication: pipelineCompletedEvent.duplicationPercentages[i],
                    raText: raText,
                    tupleCount: pipelineCompletedEvent.counts[i],
                });
            }

            this.onPipeline.fire({
                endLine: parentPredicate.position?.endLine || 0,
                predicate: parentPredicate.predicateName,
                rawLines: pipelineRa || [],
                startLine: parentPredicate.position?.line || 0,
                steps: stepsMetadata,
            });
            delete this.openPipelines[pipelineCompletedEvent.startEvent];
        });

        input.on(EventType.QUERY_STARTED, queryStartedEvent => {
            if (!isQueryStartedEvent(queryStartedEvent)) {
                return;
            }
            this.openQueries[queryStartedEvent.eventId] = queryStartedEvent;
        });

        input.on(EventType.QUERY_COMPLETED, queryCompletedEvent => {
            if (!isQueryCompletedEvent(queryCompletedEvent)) {
                return;
            }
            const query = this.openQueries[queryCompletedEvent.startEvent];
            for (let stageId of query.stages) {
                this.onStageEnded.fire({
                    id: stageId,
                    queryName: query.queryName,
                    queryPredicates: this.stagePredicates[stageId],
                });
            }

            this.onQueryEnded.fire({
                queryName: query.queryName,
                stages: query.stages
            }
            );

        });
    }

}

function allMatches(regexp: RegExp, input: string): RegExpMatchArray[] {
    if (!regexp.flags.includes('g')) {
        throw new Error('allMatches requires a RegExp with /g flag');
    }
    let match: RegExpMatchArray | null;
    let result = [];
    while ((match = regexp.exec(input)) != null) {
        result.push(match);
    }
    return result;
}

export interface RADependencies {
    inputVariables: number[];
    inputRelations: string[];
}

export function getDependenciesFromRA(racode: string): RADependencies {
    let inputVariables = new Set<number>();
    let inputRelations = new Set<string>();
    let stripped = racode.replace(/"[^"]+"/g, '""');
    for (let [ref] of allMatches(/(?<!HIGHER-ORDER RELATION |PRIMITIVE |[$@#])\b[a-zA-Z#][\w:#_]+\b(?!\()/g, stripped)) {
        if (/^([A-Z]+|true|false)$/.test(ref)) {
            continue;
        } // Probably an RA keyword
        if (/^r\d+$/.test(ref)) {
            inputVariables.add(Number(ref.substring(1)));
        } else {
            inputRelations.add(ref);
        }
    }
    return {
        inputVariables: Array.from(inputVariables),
        inputRelations: Array.from(inputRelations)
    };
}

export function isUnionOperator(raText: string) {
    return raText.includes('\\/');
}
