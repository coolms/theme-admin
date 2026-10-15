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
