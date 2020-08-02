import { Collection } from './util';

/**
 * Returns a string whose brace expansion would result in the given set of strings.
 *
 * Braces are only inserted following a `::` token.
 *
 * For example, the strings `foo::bar` and `foo:baz` would abbreviate to `foo::{bar, baz}`, and not `foo::ba{r,z}`.
 */
export function abbreviateStrings(strings: Collection<string>): string {
    type TrieNode = Map<string, TrieNode>;

    let trie = new Map<string, TrieNode>();

    strings.forEach((str: string) => {
        let parts = str.split('::');
        let currentNode = trie;
        for (let part of parts) {
            let value = currentNode.get(part);
            if (value == null) {
                let map = new Map<string, TrieNode>();
                currentNode.set(part, map);
                currentNode = map;
            } else {
                currentNode = value;
            }
        }
    });

    function stringifyNode(node: TrieNode): string {
        let parts: string[] = [];
        node.forEach((value, key) => {
            parts.push(key + stringifyNodeSuffix(value));
        });
        return parts.join(', ');
    }

    function stringifyNodeSuffix(node: TrieNode): string {
        if (node.size === 0) {
            return '';
        } else if (node.size > 1) {
            return '::{' + stringifyNode(node) + '}';
        } else {
            return '::' + stringifyNode(node);
        }
    }

    return stringifyNode(trie);
}
