/**
 * The versions a write names, read off a drawn event's `extendedProps` -- the list row it was drawn from.
 *
 * A change or a delete addresses the row the event's id names (its `originalItemId`): a one-off event, a series'
 * base (on a plain occurrence) or an exception (on an edited occurrence). The row's `version` is always the version
 * of exactly that row, so it is what such a write names -- never the series' version, which on an edited occurrence
 * is another row's.
 */
export function rowVersionOf(props: Record<string, unknown>): number | null {
    const version = props['version'];
    return typeof version === 'number' ? version : null;
}

/** The series' version, which an exception, a skip, a split and a delete of this-and-following name. */
export function seriesVersionOf(props: Record<string, unknown>): number | null {
    const version = props['seriesVersion'];
    return typeof version === 'number' ? version : null;
}

/**
 * The row a series action addresses: the series' base. On an edited occurrence the drawn id is its exception's, and
 * the base is the exception's `parentItemId`; on any other occurrence the drawn id is the base's already.
 */
export function seriesTargetOf(props: Record<string, unknown>, drawnId: string): string {
    const parent = props['parentItemId'];
    return typeof parent === 'string' && parent !== '' ? parent : drawnId;
}

/**
 * The slot of the series an occurrence stands for, which a series action names: the server's `recurrenceInstant` --
 * the rule's slot on a plain occurrence (a non-working-day shift can move the start away from it), the replaced slot
 * on an edited one. A server that answers none: a plain occurrence's start, as before; an EDITED occurrence's start is
 * no slot of the series at all, so none -- and nothing is sent (an action at it would make a second exception, skip
 * nothing, or cut the series at the moved time).
 */
export function occurrenceSlotOf(props: Record<string, unknown>, start: string | null): string | null {
    const slot = props['recurrenceInstant'];
    if (typeof slot === 'string' && slot !== '') {
        return slot;
    }
    const parent = props['parentItemId'];
    return typeof parent === 'string' && parent !== '' ? null : start;
}
