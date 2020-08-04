/// <reference lib="DOM"/>

import { select } from 'd3-selection';
import { FlamegraphNode, getFlamegraphFromLogText } from '../common/flamegraph_builder';
import escape = require('lodash.escape');
import d3f = require('d3-flame-graph');

type D3Node = { data: FlamegraphNode };

const tupleCountView = document.getElementById('tuple-count-view')!;
const instructionsContainer = document.getElementById('instructions-container')!;
const instructionsView = document.getElementById('instructions')!;
const fileUploadInput = document.getElementById('file-upload')! as HTMLInputElement;

/** The most recently clicked node in the flamegraph. */
let focusedNode: FlamegraphNode | undefined;

var chart = d3f.flamegraph()
    .width(document.body.clientWidth - 400)
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
        return escape(insertDecimalSeparators(d.data.value)) + ' tuples dominated by:<br><br>' + escape(d.data.name);
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
    if (rootNode.children.length === 0) {
        instructionsView.innerText = 'It seems there were no tuple counts in that file.'
        instructionsView.style.display = 'visible';
        return;
    } else {
        instructionsView.style.display = 'none';
    }
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

    const tryLoad = (getText: () => Promise<string>) => {
        instructionsView.innerText = 'Loading...';
        setTimeout(async () => {
            try {
                let text = await getText();
                showFlamegraph(getFlamegraphFromLogText(text));
            } catch (e) {
                instructionsContainer.innerText = 'Failed';
                console.error(e);
            }
        }, 1);
    }

    document.body.addEventListener('paste', event => {
        event.preventDefault();
        // Note: we have to request the text immediately; it can't be deferred.
        let text: string = (event.clipboardData || (window as any).clipboardData).getData('text');
        tryLoad(async () => text);
    });

    fileUploadInput.addEventListener('change', async e => {
        let files = fileUploadInput.files;
        if (files == null || files.length < 1) return;
        let file = files[0];
        tryLoad(() => file.text());
    });
}
