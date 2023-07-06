# CodeQL Flamegraph Viewer

The **CodeQL Flamegraph Viewer** visualizes predicate evaluation cost using [d3-flame-graph](https://github.com/spiermar/d3-flame-graph).

![Flamegraph](./media/flamegraph.png)

### Try it
- Use the [online viewer](https://wwong.github.io/codeql-flamegraph-viewer/) and upload your own data.
- Try the [example viewer](https://wwong.github.io/codeql-flamegraph-viewer/example.html) with preloaded data.


### How to read the flamegraph:
- The width of a box is its "total cost", including both its "own cost" and the cost of everything on top.
- Costs are just raw tuple counts at the moment.
    - In the future we'll want to support wall clock as well.
- The bottom layer ("root") represents the entire run.
- The next layer represents all the queries.
- The next layer represents all the query stages.
- The higher layers represent predicates.
- Stacking of predicates represents the dominance in the dependency graph.
    - If a predicate P can be entirely blamed for forcing evaluation of Q, then Q will be stacked on top of P.
    - In other words, if you eliminated P somehow, everything on top would be eliminated as well*.
    - If two predicates both depend on a common helper predicate, the helper predicate will sink down next to the predicates that use it.
    - *Caveat: The dependency graph does not cross query stages. A predicate that was reused in a later stage (cache hit) will be blamed on the stage that actually evaluated it and the later stage gets it "for free". This is _probably_ fine. For example, you won't see taint-tracking being blamed for SSA construction.

### How to interact with the flamegraph:
- Click on a box to focus on that node and its children.
- Hover over a box to see its full name and tuple counts.
- Hover away from the flamegraph to see the details of the focused node again (i.e. the last node you clicked on).
- Click on the root node to zoom out again.

### Generating input data:
- Run CodeQL with the following options added to your query command (e.g. `codeql database analyze`, `codeql execute queries, etc`):
```
     --evaluator-log=codeql-eval-log.json \
     --tuple-counting
```

A full command might look like:

```
codeql database analyze \
    --output codeql-results.sarif \
    --format sarif-latest \
    --tuple-counting \
    --evaluator-log codeql-eval-log.json \
    --rerun \
    codeqldb
```

- Do NOT run this CLI against minimized eval logs. Minimization strips type information from log events, which would require some lookback to determine what type of `CompletionEvent` we're looking at.

### Test rendering the flamegraph via CLI:

```
ts-node src/bin/flamegraph.ts codeql-eval-log.json -o codeql-eval-log-graph.html --relative

```

