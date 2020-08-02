/// <reference lib="DOM"/>

import { select } from 'd3-selection';
import { FlamegraphNode, getFlamegraphFromLogText } from '../common/flamegraph_builder';
import escape = require('lodash.escape');
import d3f = require('d3-flame-graph');

const detailsView = document.getElementById('details')!;
const tupleCountView = document.getElementById('tuple-count-view')!;
const instructionsContainer = document.getElementById('instructions-container')!;
const instructionsView = document.getElementById('instructions')!;

var chart = d3f.flamegraph().width(960);

var tip = (d3f as any).defaultFlamegraphTooltip() // missing from .d.ts file
    .html(function (d: { data: FlamegraphNode }) {
        let rawLines = d.data.rawLines;
        tupleCountView.innerText = rawLines == null ? '' : rawLines.join('\n');
        return escape(d.data.name + ': ' + d.data.value);
    });
chart.tooltip(tip as any);

function showFlamegraph(rootNode: FlamegraphNode) {
    select('#chart')
        .datum(rootNode)
        .call(chart);
}

// If data was preloaded via a script tag, load that now.
if ('codeqlFlamegraphData' in window) {
    showFlamegraph((window as any).codeqlFlamegraphData as FlamegraphNode);
} else {
    instructionsContainer.style.display = 'block';

    document.body.addEventListener('paste', event => {
        event.preventDefault();
        let paste: string = (event.clipboardData || (window as any).clipboardData).getData('text');
        instructionsView.innerText = 'Loading...';
        setTimeout(() => {
            try {
                showFlamegraph(getFlamegraphFromLogText(paste));
                instructionsContainer.style.display = 'none';
            } catch (e) {
                instructionsContainer.innerText = 'Failed';
                console.error(e);
            }
        }, 1);
    });
}
