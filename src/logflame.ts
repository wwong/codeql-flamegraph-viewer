import * as cli from '@asgerf/strongcli';
import * as fs from 'fs';
import * as pathlib from 'path';
import { getFlamegraphFromLogText } from './flamegraph_builder';

interface Options {}
let { options, args } = cli.program({ helpIfEmpty: true }).main({});

let filename = args[0];

let flamegraph = getFlamegraphFromLogText(fs.readFileSync(filename, 'utf8'));

let ownDir = pathlib.dirname(process.argv[1]);
let htmlTemplateFile = pathlib.join(ownDir, '../web/index.html');
let htmlTemplateText = fs.readFileSync(htmlTemplateFile, 'utf8');

let htmlText = htmlTemplateText
    .replace(/\.\.\/(node_modules|build)\//g, m => pathlib.join(ownDir, m));

fs.writeFileSync('logflame.html', htmlText, { encoding: 'utf8' });

let dataJs = 'window.codeqlFlamegraphData = ' + JSON.stringify(flamegraph);
fs.writeFileSync('logflame.html.data.js', dataJs, { encoding: 'utf8' });
