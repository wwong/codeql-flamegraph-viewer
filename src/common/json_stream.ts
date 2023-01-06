import {AsyncStreamBuilder, EventStream, Listener, SyncStreamBuilder} from './event_stream';
import {LogEvent} from './eval_log_events';

interface Matcher {
    type: string;
    callback: Listener<LogEvent>;
}

function isLogEvent(object: any): object is LogEvent {
    return 'type' in object;
}

export class JsonStream {
    public readonly end = new EventStream<void>();

    matchers: { [type: string]: Array<Matcher> } = {}

    public blockNumber = 0
    public lineCount = 0
    public blockTypeCounts: { [type: string]: number } = {}

    private blockBuffer = Array<string>();

    flushBuffer() {
        const block = JSON.parse(this.blockBuffer.join(''));
        this.blockBuffer = [];

        if (!isLogEvent(block)) {
            return;
        }

        if (block.type in this.blockTypeCounts) {
            this.blockTypeCounts[block.type]++;
        } else {
            this.blockTypeCounts[block.type] = 1;
        }

        if (block.type in this.matchers) {
            for (let matcher of this.matchers[block.type]) {
                matcher.callback(block);
            }
        }
        ++this.blockNumber;
    }

    addEof() {
        this.flushBuffer();
        this.end.fire();
    }

    addLine(line: string) {
        this.blockBuffer.push(line);
        ++this.lineCount;

        // Blocks are separated by two newlines
        if (line === '\n' || line === '') {
            this.flushBuffer();
        }
    }

    on(type: string, callback: Listener<LogEvent>) {
        if (!(type in this.matchers)) {
            this.matchers[type] = [{type, callback}];
        } else {
            this.matchers[type].push({type, callback});
        }
        return this;
    }
}

export function streamBlocksAsync(stream: NodeJS.ReadableStream) {
    let parser = new JsonStream();

    let readline = require('readline') as typeof import('readline');
    let reader = readline.createInterface(stream);

    reader.on('line', line => {
        parser.addLine(line);
    });

    reader.on('close', () => {
        parser.addEof();
    });

    return new AsyncStreamBuilder(parser.end, parser);
}

export function streamBlocksSync(text: string) {
    let parser = new JsonStream();
    return new SyncStreamBuilder(() => text.split('\n').forEach(line => parser.addLine(line)), parser);
}