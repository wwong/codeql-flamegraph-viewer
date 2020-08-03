const CopyWebpackPlugin = require('copy-webpack-plugin');
const IgnorePlugin = require('webpack').IgnorePlugin;

const common = {
    resolve: {
        extensions: ['.ts', '.tsx', '.js']
    },
    mode: 'development',
    module: {
        rules: [
            { test: /\.tsx?$/, loader: 'ts-loader' }
        ]
    },
};

const cli = {
    ...common,
    target: 'node',
    entry: './src/bin/flamegraph.ts',
    output: {
        filename: 'flamegraph.js'
    }
};

const web = {
    ...common,
    target: 'web',
    entry: './src/web/flamegraph_webmain.ts',
    output: {
        filename: 'flamegraph_webmain.js'
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'node_modules/d3-flame-graph/dist/d3-flamegraph.css',
                    to: 'd3-flamegraph.css'
                },
                {
                    from: './src/web/flamegraph.html',
                    to: 'flamegraph.html'
                }
            ]
        }),
        new IgnorePlugin({
            // Ignore NodeJS module imports when building for web
            resourceRegExp: /^readline$/
        }),
    ]
};

module.exports = [cli, web];
