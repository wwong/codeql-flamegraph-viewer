/// <reference lib="DOM"/>

import { select } from 'd3-selection';
import type { FlamegraphNode } from '../common/flamegraph_builder';
import escape = require('lodash.escape');
import d3f = require('d3-flame-graph');

// Declare values brought in through script tags.
declare var codeqlFlamegraphData: FlamegraphNode;

const detailsView = document.getElementById('details')!;
const tupleCountView = document.getElementById('tuple-count-view')!;

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
showFlamegraph(codeqlFlamegraphData);
