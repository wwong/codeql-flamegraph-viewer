import * as cli from '@asgerf/strongcli';
import * as fs from 'fs';
import * as pathlib from 'path';
import { getFlamegraphFromLogText } from '../common/flamegraph_builder';
import escapeHtml = require('lodash.escape');

interface Options {
    outputFile: string;
    open: boolean;
}
let program = cli.program({
    helpIfEmpty: true,
    positionalArgHint: '<logfile or database>',
    description: `
  Parses tuple counts from the given log file and generates a flamegraph of
  evaluated predicates weighted by tuple counts.

  If given a database, the most recent log file from that database is used.
`
});
let { options, args } = program.main<Options>({
    outputFile: {
        name: ['-o', '--output'],
        value: String,
        valueHint: 'file',
        default: 'flamegraph.html',
        description: `
Where to write the output. A file with the suffix '.data.js' will be created as well.
Defaults to 'flamegraph.html'.
`,
    },
    open: {
        description: 'Open the generated HTML file in a browser.'
    }
});

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

let input = args[0];
if (!fs.existsSync(input)) {
    fail('File not found: ' + input);
}
if (fs.statSync(input).isDirectory()) {
    let logDir = pathlib.join(input, 'log');
    if (!fs.existsSync(logDir) || !fs.statSync(logDir).isDirectory()) {
        fail('Not a snapshot or log file: ' + input);
    }
    let logFiles = fs.readdirSync(logDir).filter(f => /^execute-queries-[\d.]+\.log$/.test(f)).sort();
    if (logFiles.length === 0) {
        fail('No logs in snapshot: ' + input);
    }
    input = logFiles[logFiles.length - 1];
}

let { outputFile } = options;
let outputDir = pathlib.dirname(outputFile);

function mkdirp(path: string) {
    if (!fs.existsSync(path)) {
        let parent = pathlib.dirname(path);
        if (parent.length < path.length) {
            mkdirp(pathlib.dirname(path));
        }
        fs.mkdirSync(path);
    }
}
mkdirp(outputDir);
let outputDataFile = outputFile + '.data.js';

let flamegraph = getFlamegraphFromLogText(fs.readFileSync(input, 'utf8'));

let dirname = pathlib.dirname(fs.realpathSync(process.argv[1]));
let htmlTemplateFile = pathlib.join(dirname, 'flamegraph.html');
let htmlTemplateText = fs.readFileSync(htmlTemplateFile, 'utf8');

let htmlText = htmlTemplateText
    .replace(/(flamegraph_webmain\.js|d3-flamegraph\.css)/g, m => pathlib.join(dirname, m))
    .replace('<!--%DATA%-->', `<script src="${escapeHtml(pathlib.resolve(outputDataFile))}"></script>`);

fs.writeFileSync(outputFile, htmlText, { encoding: 'utf8' });

let dataJs = 'window.codeqlFlamegraphData = ' + JSON.stringify(flamegraph);
fs.writeFileSync(outputFile + '.data.js', dataJs, { encoding: 'utf8' });

if (options.open) {
    require('open')(outputFile);
}
