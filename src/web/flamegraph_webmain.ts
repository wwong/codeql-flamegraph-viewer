/// <reference lib="DOM"/>

import { select } from 'd3-selection';
import { FlamegraphNode, getFlamegraphFromLogText } from '../common/flamegraph_builder';
import escape = require('lodash.escape');
import d3f = require('d3-flame-graph');

type D3Node = { data: FlamegraphNode };

const detailsView = document.getElementById('details')!;
const tupleCountView = document.getElementById('tuple-count-view')!;
const instructionsContainer = document.getElementById('instructions-container')!;
const instructionsView = document.getElementById('instructions')!;

/** The most recently clicked node in the flamegraph. */
let focusedNode: FlamegraphNode | undefined;

var chart = d3f.flamegraph()
    .width(960)
    .onClick((event: D3Node) => {
        focusedNode = event.data;
        showDetailsForNode(focusedNode);
    }
);

function insertDecimalSeparators(number: number | string) {
    let string = String(number);
    let parts = [];
    for (let i = string.length; i > 0; i -= 3) {
        parts.push(string.substring(Math.max(0, i - 3), i));
    }
    return parts.reverse().join(',');
}

var tooltip = (d3f as any).defaultFlamegraphTooltip() // missing from .d.ts file
    .html(function (d: D3Node) {
        return escape(d.data.name + ': ' + insertDecimalSeparators(d.data.value));
    });

function wrapFn<This, Args extends any[], R>(fn: (this: This, ...args: Args) => R, callback: (...args: Args) => void) {
    return function(this: This, ...args: Args) {
        let result = fn.apply(this, args);
        callback(...args);
        return result;
    }
}

// We don't have proper hooks for mouseover/mouseout events, so we hijack the tooltip's show/hide events.
tooltip.show = wrapFn(tooltip.show, (d: D3Node) => {
    showDetailsForNode(d.data);
});
tooltip.hide = wrapFn(tooltip.hide, () => {
    showDetailsForNode(focusedNode);
});
chart.tooltip(tooltip);

function deepJoin(str: string[][]) {
    return str.map(s => s.join('\n')).join('\n');
}
function showDetailsForNode(node: FlamegraphNode | undefined) {
    let iterations = node?.rawLines ?? [];
    if (iterations.length > 20) {
        let first = iterations.slice(0, 10);
        let last = iterations.slice(-10);
        let skipped = `\n\n-------- Skipped ${iterations.length - 20} iterations -----------\n\n`
        tupleCountView.innerText = deepJoin(first) + '\n' + skipped + deepJoin(last);
    } else {
        tupleCountView.innerText = deepJoin(iterations);
    }
}

function showFlamegraph(rootNode: FlamegraphNode) {
    focusedNode = rootNode;
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
