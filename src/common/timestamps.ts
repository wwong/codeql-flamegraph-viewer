/**
 * Returns the first log timestamp to be found in the given log file text, or
 * `undefined` if none was found.
 *
 * For example, the return value could be `2021-03-18 11:15:39`.
 */
export function getFirstTimestampFromLogText(text: string): string | undefined {
    let match = /^\[([\d: ZAMP-]+)\]/.exec(text);
    return match != null ? match[1] : undefined;
}
