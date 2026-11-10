/**
 * The message that opens after the open one left the list by Archive, Delete or Move, from the list as it showed: the
 * nearest row that neither left nor was acted on, the one below first at the same distance. For one message that is
 * the row that takes its place, or the one above when it was the last; for checked rows, the nearest one not checked.
 * Null when none is left, or when the open message was not in the list.
 */
export function nextOpenAfter(
    order: readonly string[],
    open: string,
    removed: ReadonlySet<string>,
    actedOn: ReadonlySet<string>,
): string | null {
    const at = order.indexOf(open);
    if (at < 0) {
        return null;
    }
    const free = (i: number): boolean => i >= 0 && i < order.length && !removed.has(order[i]) && !actedOn.has(order[i]);
    for (let d = 1; d < order.length; d++) {
        if (free(at + d)) {
            return order[at + d];
        }
        if (free(at - d)) {
            return order[at - d];
        }
    }

    return null;
}
