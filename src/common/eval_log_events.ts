import * as assert from 'assert';
import * as semver from 'semver';

export enum EventType {
    CACHE_LOOKUP = 'CACHE_LOOKUP',
    LOG_FOOTER = 'LOG_FOOTER',
    LOG_HEADER = 'LOG_HEADER',
    SENTINEL_EMPTY = 'SENTINEL_EMPTY',
    PIPELINE_COMPLETED = 'PIPELINE_COMPLETED',
    PIPELINE_STARTED = 'PIPELINE_STARTED',
    PREDICATE_COMPLETED = 'PREDICATE_COMPLETED',
    PREDICATE_STARTED = 'PREDICATE_STARTED',
    QUERY_COMPLETED = 'QUERY_COMPLETED',
    QUERY_STARTED = 'QUERY_STARTED',
}

export interface LogEvent {
    time: string,
    type: EventType,
    eventId: number,
}

export function isLogEvent(object: any): object is LogEvent {
    return 'eventId' in object;
}

export interface PredicateEvent extends LogEvent {
    raHash: string;
    predicateName: string;
    appearsAs: { [name: string]: number[] }
}

export function isPredicateEvent(object: any): object is PredicateEvent {
    return 'predicateName' in object;
}

export enum PredicateType {
    SIMPLE_INTENSIONAL = 'SIMPLE_INTENSIONAL',
    RECURSIVE_INTENSIONAL = 'RECURSIVE_INTENSIONAL',
    EXTENSIONAL = 'EXTENSIONAL',
    EXTERNAL_PREDICATE = 'EXTERNAL_PREDICATE',
    STAGE_RESULT = 'STAGE_RESULT',
    EXTENSIBLE_PREDICATE = 'EXTENSIBLE_PREDICATE',
    NAMED_LOCAL = 'NAMED_LOCAL',
}

export class PredicateStartedEvent implements PredicateEvent {
    predicateType: PredicateType;
    position: Position | undefined | null;
    ra: { [raRef: string]: string[] };
    dependencies: Map<string, string>;
    queryCausingWork: number;

    // Inherited from PredicateEvent
    appearsAs: { [name: string]: number[] };
    eventId: number;
    predicateName: string;
    raHash: string;
    time: string;
    type = EventType.PREDICATE_STARTED;
    layerId: number | undefined;


    constructor(
        time: string,
        raHash: string,
        eventId: number,
        predicateName: string,
        appearsAs: { [name: string]: number[] },
        predicateType: PredicateType,
        ra: { [raRef: string]: string[] },
        dependencies: Map<string, string>,
        queryCausingWork: number,
        position?: Position,
        layerId?: number) {
        this.appearsAs = appearsAs;
        this.eventId = eventId;
        this.predicateName = predicateName;
        this.raHash = raHash;
        this.time = time;
        this.type = EventType.PREDICATE_STARTED;
        this.predicateType = predicateType;
        this.position = Position.isSource(position) ? position : null;
        this.ra = ra || {};
        this.dependencies = dependencies;
        this.queryCausingWork = queryCausingWork;
        this.layerId = layerId;
    }
}

export function isPredicateStartedEvent(object: any): object is PredicateStartedEvent {
    return 'predicateType' in object;
}

export interface PredicateCompleted extends LogEvent {
    startEvent: number
    resultSize: number
}

export function isPredicateCompletedEvent(object: any): object is PredicateCompleted {
    return 'startEvent' in object && 'resultSize' in object;
}

enum CacheLookupResult {
    RELATION_CACHE_HIT = 'RELATION_CACHE_HIT',
    CACHACA_HIT = 'CACHACA_HIT',
    PARTIAL_CACHACA = 'PARTIAL_CACHACA',
    RETRACTED_CACHE_HIT = 'RETRACTED_CACHE_HIT',
}

export interface CacheLookup extends PredicateEvent {
    cacheLookupResult: CacheLookupResult,
    resultSize: number
}

export function isCacheLookupEvent(object: any): object is CacheLookup {
    return 'cacheLookupResult' in object;
}

export class LogHeader implements LogEvent {
    eventId: number;
    time: string;
    type = EventType.LOG_HEADER;
    codeQlVersion: semver.SemVer;
    logVersion: semver.SemVer;

    constructor(type: EventType, time: string, eventId: number, codeQlVersion: string, logVersion: string) {
        assert(type === EventType.LOG_HEADER);
        this.time = time;
        this.eventId = eventId;
        this.codeQlVersion = new semver.SemVer(codeQlVersion);
        this.logVersion = new semver.SemVer(logVersion);
    }
}

export function isLogHeader(object: any): object is LogHeader {
    return 'codeQlVersion' in object;
}

class Position {
    static COMPILER_GENERATED = new Position('Compiler Generated', -1, -1, -1, -1, true)
    file: string | undefined;
    line: number = 1;
    column: number = 1;
    endLine: number = 1;
    endColumn: number = 1;

    static isSource(pos: Position | undefined) {
        if (pos === undefined) {
            return false;
        }
        return !(pos.line < 0);
    }

    constructor(file?: string,
        line: number = 1,
        column: number = 1,
        endLine: number = 1,
        endColumn: number = 1,
        isCompilerGenerated: boolean = false) {

        if (file === undefined) {
            return Position.COMPILER_GENERATED;
        }
        this.file = file;
        this.line = line;
        this.column = column;
        this.endLine = endLine;
        this.endColumn = endColumn;
        if (line > endLine || (line === endLine && column > endColumn)) {
            throw new Error('Tried to create negative length position');
        }
        if ((line < 0 || column < 0 || endLine < 0 || endColumn < 0) && !isCompilerGenerated) {
            throw new Error('Tried to create position with negative line/column');
        }
    }
}

export interface PipelineStartedEvent extends LogEvent {
    predicateStartEvent: number
    raReference: string
}

export function isPipelineStartedEvent(object: any): object is PipelineStartedEvent {
    return 'predicateStartEvent' in object;
}

export interface PipelineCompletedEvent extends LogEvent {
    startEvent: number
    resultSize: number
    counts: number[]
    duplicationPercentages: number[]
}

export function isPipelineCompletedEvent(object: any): object is PipelineCompletedEvent {
    return 'startEvent' in object && 'resultSize' in object;
}

export interface QueryStartedEvent extends LogEvent {
    queryName: string
    stages: number[]

}

export function isQueryStartedEvent(object: any): object is QueryStartedEvent {
    return 'queryName' in object && 'stages' in object;
}

export interface QueryCompletedEvent extends LogEvent {
    startEvent: number
}

export function isQueryCompletedEvent(object: any): object is QueryCompletedEvent {
    return 'startEvent' in object;
}
