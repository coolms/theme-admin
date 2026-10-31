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

/** A run of text that stayed, was taken out or was put in: read top to bottom, the runs give both texts. */
export interface TextRunDto {
    readonly op: 'equal' | 'insert' | 'delete';
    readonly text: string;
}

/** One field that changed: a text by words, a list by position, anything else as old -> new. */
export interface FieldChangeDto {
    readonly name: string;
    readonly kind: 'text' | 'value' | 'items';
    readonly old: unknown;
    readonly new: unknown;
    readonly words?: readonly TextRunDto[];
    readonly items?: readonly {
        readonly index: number;
        readonly status: 'added' | 'removed' | 'changed';
        readonly fields: readonly { readonly name: string; readonly old: unknown; readonly new: unknown }[];
    }[];
}

/** One section, compared with the version before: where it was (`from`) and is (`to`), and what changed in it. */
export interface RecordChangeDto {
    readonly status: 'added' | 'removed' | 'changed' | 'unchanged';
    readonly moved: boolean;
    readonly id: string | null;
    readonly type: string | null;
    readonly from: number | null;
    readonly to: number | null;
    readonly fields: readonly FieldChangeDto[];
}

/** A page's sections compared: by id, or by position and type for a version from before sections had ids. */
export interface RecordListChangesDto {
    readonly matchedBy: 'id' | 'position';
    readonly records: readonly RecordChangeDto[];
    readonly counts: { readonly added: number; readonly removed: number; readonly moved: number; readonly changed: number };
}

/** What changed in one version since the one before it, as `GET /web/page-version-diff` answers it. */
export interface PageVersionDiffDto {
    readonly path: string;
    readonly version: PageVersionDto;
    readonly previous: number | null;
    /** Null when a version could not be read: nothing is guessed. */
    readonly changes: {
        readonly created: boolean;
        readonly fields: readonly FieldChangeDto[];
        readonly records: Readonly<Record<string, RecordListChangesDto>>;
        readonly languages: readonly {
            readonly locale: string;
            readonly status: 'added' | 'removed' | 'changed';
            readonly body: { readonly old: string | null; readonly new: string | null } | null;
            readonly meta: readonly FieldChangeDto[];
        }[];
        readonly frame: { readonly old: unknown; readonly new: unknown } | null;
        readonly properties: readonly {
            readonly scope: string;
            readonly property: string;
            readonly old: unknown;
            readonly new: unknown;
        }[];
        readonly other: readonly string[];
    } | null;
    /** Each changed language body, line by line; `lines` is null when a body could not be read. */
    readonly bodies: readonly { readonly locale: string; readonly lines: readonly TextRunDto[] | null }[];
}

/** Who last changed each section and each of its fields, as `GET /web/page-blame` answers it. */
export interface PageBlameDto {
    readonly path: string;
    /** False when a field last changed before the versions read; that field's `seq` is null. */
    readonly complete: boolean;
    readonly blocks: readonly {
        readonly id: string | null;
        readonly type: string | null;
        readonly index: number;
        readonly seq: number | null;
        readonly fields: Readonly<Record<string, number | null>>;
    }[];
    /** Who and when, by `seq`. */
    readonly versions: Readonly<Record<string, {
        readonly recordedAt: string;
        readonly author: PageVersionDto['author'];
    }>>;
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
