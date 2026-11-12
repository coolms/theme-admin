import {
    type EmailFolderDto,
    type EmailFolderTreeNodeDto,
    type EmailMessageDto,
    type EmailMessageList,
    type ServerMessageOpenedDto,
    type ServerSearchHitDto,
} from './email.types';

/**
 * A folder the platform has not fully synced is listed from the mail server: its list holds rows nothing here stores
 * (`fromServer: true`, a `ref`, no `id`) beside its stored rows, in the server's order, newest first. These helpers
 * key, open and replace such rows; the order is never changed here.
 */

/** A row the mail server lists and nothing here stores: no id, opened by its ref only. */
export function isServerRow(m: EmailMessageDto): boolean {
    return m.fromServer === true || typeof (m as { id?: unknown }).id !== 'string';
}

/** What a row is keyed by: a server row by its ref, a stored row by its id. */
export function rowKey(m: EmailMessageDto): string {
    return isServerRow(m) ? `ref:${m.ref ?? ''}` : `id:${m.id}`;
}

/** The stored rows' ids, in the list's order: the rows a checkbox, the row menu and the checked-rows bar act on. */
export function storedIds(rows: readonly EmailMessageDto[]): string[] {
    return rows.filter(m => !isServerRow(m)).map(m => m.id);
}

/**
 * Whether an answer is a folder listed from the mail server, guessed off the answer itself: a server row or a
 * server-pages word. A next cursor says nothing: every folder's page with more after it carries one. Only for a folder
 * whose tree node and list entry do not say (see folderListedFromServer).
 */
export function listedFromServer(page: EmailMessageList): boolean {
    return page.some(isServerRow) || (page.serverPages ?? null) !== null;
}

/** A folder's node in the tree, searched through every level. */
function treeNode(nodes: readonly EmailFolderTreeNodeDto[], folder: string): EmailFolderTreeNodeDto | null {
    for (const node of nodes) {
        if (node.folder === folder) {
            return node;
        }
        const below = treeNode(node.children ?? [], folder);
        if (below !== null) {
            return below;
        }
    }
    return null;
}

/**
 * Whether the server says a folder is listed from the mail server: its tree node's `listedFromServer`, else its folder
 * list entry's; null when neither carries the field.
 */
export function folderListedFromServer(
    folder: string,
    tree: readonly EmailFolderTreeNodeDto[] | null,
    list: readonly EmailFolderDto[],
): boolean | null {
    const node = treeNode(tree ?? [], folder);
    if (typeof node?.listedFromServer === 'boolean') {
        return node.listedFromServer;
    }
    const entry = list.find(f => f.folder === folder);
    return typeof entry?.listedFromServer === 'boolean' ? entry.listedFromServer : null;
}

/** A server row in the shape the server-message opener takes. */
export function serverRowHit(m: EmailMessageDto): ServerSearchHitDto {
    return {
        ref: m.ref ?? '',
        folder: m.folder ?? '',
        uid: m.uid ?? 0,
        from: { name: m.fromName ?? null, address: m.fromAddress ?? null },
        ...(typeof m.subject === 'string' ? { subject: m.subject } : {}),
        date: m.sentAt ?? null,
        sizeBytes: m.sizeBytes ?? null,
        seen: m.seen ?? true,
        flagged: m.flagged ?? false,
        local: false,
    };
}

/** The list with the server row `ref` replaced, in its place, by the stored message the opener answered. */
export function withOpenedRow(rows: readonly EmailMessageDto[], ref: string, stored: ServerMessageOpenedDto): EmailMessageDto[] {
    return rows.map(m => (isServerRow(m) && m.ref === ref
        ? { ...m, id: stored.id, folder: stored.folder, fromServer: false, ref: null }
        : m));
}

/** The list without the server row `ref`. */
export function withoutServerRow(rows: readonly EmailMessageDto[], ref: string): EmailMessageDto[] {
    return rows.filter(m => !(isServerRow(m) && m.ref === ref));
}

/**
 * The first page read again in place of the rows it showed before (`firstKeys`), the rows of later pages kept as they
 * are after it; a later row the new first page now lists is not shown twice.
 */
export function withFirstPageAgain(
    rows: readonly EmailMessageDto[],
    firstKeys: ReadonlySet<string>,
    first: readonly EmailMessageDto[],
): EmailMessageDto[] {
    const fresh = new Set(first.map(rowKey));

    return [...first, ...rows.filter(m => !firstKeys.has(rowKey(m)) && !fresh.has(rowKey(m)))];
}

/** What the list's end says beyond its rows: the server could not be read, or asked to wait `seconds`. */
export type ServerListEnd = { kind: 'unavailable' } | { kind: 'rate-limited'; seconds: number };
