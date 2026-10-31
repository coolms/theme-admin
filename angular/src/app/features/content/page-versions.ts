/** One version of a page or a directory, as `GET /web/page-versions` answers it. */
export interface PageVersionDto {
    readonly id: string;
    /** The store's order of versions: what `before` names for the next page. */
    readonly seq: number;
    readonly recordedAt: string;
    readonly author: { readonly id: string; readonly name: string | null } | null;
    readonly message: string | null;
    /** What changed since the version before, in short labels ("blocks", "en body", "og (de)"); "created" first. */
    readonly changes: readonly string[];
}

export interface PageVersionsDto {
    readonly path: string;
    readonly versions: readonly PageVersionDto[];
    readonly hasMore: boolean;
}

/**
 * Consecutive saves by one person, shown as one row: each version is a version of its own (they are never merged),
 * and the list groups them so an editor that saves often does not fill it.
 */
export interface VersionGroup {
    readonly author: PageVersionDto['author'];
    /** Newest first, as the list is. */
    readonly versions: readonly PageVersionDto[];
    readonly newest: string;
    readonly oldest: string;
    /** Every label of the group's versions, once each, in the order first met (newest first). */
    readonly changes: readonly string[];
}

/** How far apart two saves by one person may be and still be one group. */
export const GROUP_GAP_MINUTES = 10;

/**
 * Groups a newest-first list: a version joins the group above it when it has the same author (or both have none)
 * and was recorded no more than {@link GROUP_GAP_MINUTES} before the version above it. Anyone else, or a longer gap,
 * starts a new group. Each version is in exactly one group, and the groups keep the list's order.
 */
export function groupVersions(versions: readonly PageVersionDto[], gapMinutes = GROUP_GAP_MINUTES): VersionGroup[] {
    const groups: { author: PageVersionDto['author']; versions: PageVersionDto[] }[] = [];
    let last: PageVersionDto | null = null;
    for (const version of versions) {
        const current = groups.at(-1);
        const joins = current !== undefined && last !== null
            && (current.author?.id ?? null) === (version.author?.id ?? null)
            && minutesBetween(version.recordedAt, last.recordedAt) <= gapMinutes;
        if (joins) {
            current.versions.push(version);
        } else {
            groups.push({ author: version.author, versions: [version] });
        }
        last = version;
    }

    return groups.map(group => ({
        author: group.author,
        versions: group.versions,
        newest: group.versions[0].recordedAt,
        oldest: group.versions[group.versions.length - 1].recordedAt,
        changes: [...new Set(group.versions.flatMap(v => v.changes))],
    }));
}

function minutesBetween(older: string, newer: string): number {
    return (Date.parse(newer) - Date.parse(older)) / 60_000;
}
