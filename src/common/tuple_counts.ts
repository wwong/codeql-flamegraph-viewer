import { EventStream } from './event_stream';
import { LineStream } from './line_stream';

export interface TupleCountStream {
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
}

export interface StageEndedEvent {
    queryPredicates: string[];
    queryName: string;
}

export class TupleCountParser implements TupleCountStream {
    public readonly onPipeline = new EventStream<Pipeline>();
    public readonly onPredicateSize = new EventStream<PredicateSizeEvent>();
    public readonly onStageEnded = new EventStream<StageEndedEvent>();
    public readonly end: EventStream<void>;

    /**
     * Set to true if the evaluation of a predicate was seen in the
     * parsed log.
     *
     * Can be used to diagnose cases where no tuple counts were found,
     * indicating if this was a log without tuple counts, or not a log
     * file at all.
     */
    public seenPredicateEvaluation = false;

    constructor(public readonly input: LineStream) {
        this.end = input.end;

        let seenCsvImbQueriesHeader = false;
        input.on(/CSV_IMB_QUERIES:\s*(.*)/, ([whole, row]) => {
            if (!seenCsvImbQueriesHeader) {
                seenCsvImbQueriesHeader = true;
                return;
            }
            let [queryType, queryPredicateStr, queryName, stage, success, time, numResult, cumulativeTime] = row.split(',');
            let queryPredicates = queryPredicateStr.split(' ');
            this.onStageEnded.fire({
                queryPredicates,
                queryName,
            });
        });

        let currentPredicateName: string | null = null;
        let currentPipelineSteps: PipelineStep[] = [];
        let currentPredicateLine: number = 0;
        let currentRawLines: string[] = [];

        input.on(/Starting to evaluate predicate (.*)\/.*/, match => {
            let [, name] = match;
            this.seenPredicateEvaluation = true;
            currentPredicateName = name;
            currentPredicateLine = input.lineNumber;
            currentRawLines.push(match.input!);
        });

        input.on(/Tuple counts for (.*):/, match => {
            let [, name] = match;
            this.seenPredicateEvaluation = true;
            currentPredicateName = name;
            currentPredicateLine = input.lineNumber;
            currentRawLines.push(match.input!);
        });

        const parseRelationSize = ([, name, rows]: string[]) => {
            this.onPredicateSize.fire({
                predicate: name,
                size: Number(rows),
            });
        };
        input.on(/>>> Relation ([\w#:]+): (\d+) rows/, parseRelationSize);
        input.on(/>>> Wrote relation ([\w#:]+) with (\d+) rows/, parseRelationSize);
        input.on(/- ([\w#:]+) has (\d+) rows/, parseRelationSize);
        input.on(/Found relation ([\w#:]+)\b.*\bRelation has (\d+) rows/, parseRelationSize);

        input.on(/.*(\d+)\s+(?:~(\d+)%)?\s+[{](\d+)[}]\s+r(\d+)\s+=\s+(.*)/, match => {
            let [, tupleCountStr, duplicationStr, arityStr, resultVariable, raText] = match;
            let tupleCount = Number(tupleCountStr);
            let duplication = Number(duplicationStr);
            let arity = Number(arityStr);
            currentPipelineSteps.push({
                tupleCount,
                duplication,
                arity,
                raText,
            });
            currentRawLines.push(match.input!);
        }, () => { // Called if there was no match
            if (currentPipelineSteps.length > 0 && currentPredicateName != null) {
                this.onPipeline.fire({
                    predicate: currentPredicateName,
                    steps: currentPipelineSteps,
                    startLine: currentPredicateLine,
                    endLine: input.lineNumber,
                    rawLines: currentRawLines,
                });
                currentPipelineSteps = [];
                currentRawLines = [];
                currentPredicateName = null;
            }
        }
        );
    }
}

export function streamTupleCounts(input: LineStream) {
    return new TupleCountParser(input);
}

function allMatches(regexp: RegExp, input: string): RegExpMatchArray[] {
    if (!regexp.flags.includes('g')) { throw new Error('allMatches requires a RegExp with /g flag'); }
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
        if (/^([A-Z]+|true|false)$/.test(ref)) { continue; } // Probably an RA keyword
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
