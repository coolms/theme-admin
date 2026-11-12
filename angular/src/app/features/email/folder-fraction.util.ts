import { type EmailFolderDto } from './email.types';

/**
 * A folder's rail count used to be one number: how many messages had been
 * IMPORTED. That read as the size of the folder, which it is not -- the first
 * sync copies a recent window and a backfill walks the rest, so for a large
 * mailbox the imported count can be a quarter of what the server holds.
 *
 * The server now reports both. The row shows one total, the server's once a sync
 * has read it, and how much is stored ("1,314 of 5,512 stored") goes in the
 * tooltip. These are pure functions over the DTO so the wording and the progress
 * bar are decided in one place and cannot drift apart.
 */

/**
 * How much of the folder is here, as a whole percentage, or null when the
 * question does not arise: no sync has recorded the server's own count, or
 * everything it holds is already imported.
 */
export function importedFraction(f: EmailFolderDto): number | null {
    const server = f.serverTotal;
    if (typeof server !== 'number' || server <= 0 || f.total >= server) {
        return null;
    }

    return Math.round((f.total / server) * 100);
}

/**
 * The folder's one total: the server's count once a sync has read it, otherwise the
 * platform's own count -- chosen as the unread badge chooses its number.
 */
export function folderTotal(f: EmailFolderDto): number {
    return typeof f.serverTotal === 'number' ? f.serverTotal : f.total;
}

/** The row's total, formatted: one number, never a "stored / total" pair. */
export function folderCount(f: EmailFolderDto): string {
    return folderTotal(f).toLocaleString();
}

/**
 * `1,314 of 5,512 stored` while the platform has stored part of a folder whose
 * server count is known; null when both are not known or nothing is missing.
 */
export function folderStored(f: EmailFolderDto): string | null {
    if (importedFraction(f) === null) {
        return null;
    }

    return `${f.total.toLocaleString()} of ${(f.serverTotal as number).toLocaleString()} stored`;
}

/**
 * The unread badge. The server's figure when we have it, because the local one
 * counts only the unread messages we have IMPORTED -- 1,507 against 2,549 actually
 * unread on a real part-imported INBOX. Falls back to the local count, which is
 * exact once a folder is fully imported.
 */
export function folderUnread(f: EmailFolderDto): number {
    return typeof f.serverUnseen === 'number' ? f.serverUnseen : f.unseen;
}

/**
 * The rail is tight, so the sentence the fraction stands for lives in the tooltip --
 * including the UNIT, because a webmail that groups by conversation shows a smaller
 * number for the same folder and an operator comparing the two should not read that
 * as a defect.
 */
export function folderCountTitle(f: EmailFolderDto): string {
    const percent = importedFraction(f);
    const stored = folderStored(f);
    const total = folderCount(f);
    const unread = unreadClause(f);

    if (stored === null) {
        return typeof f.serverTotal === 'number'
            ? `${total} messages.${unread} Counts messages, not conversations.`
            : `${total} messages stored (the server's own count is not known yet).${unread}`;
    }

    return `${total} messages; ${stored} (${percent}%) -- the rest is still being copied.${unread} Counts messages, not conversations: a mail app that groups by conversation will show fewer.`;
}

/**
 * Apply an optimistic unread change to a folder after messages are marked read or
 * unread locally.
 *
 * It moves BOTH counts. Marking a message read sets the flag on the server too, so
 * the server's unread figure really does drop by one -- and if only the local count
 * moved, the badge (which prefers the server's) would sit still while the reader
 * watched their unread messages disappear.
 */
export function applyUnreadDelta(f: EmailFolderDto, delta: number): EmailFolderDto {
    return {
        ...f,
        unseen: Math.max(0, f.unseen + delta),
        serverUnseen: typeof f.serverUnseen === 'number'
            ? Math.max(0, f.serverUnseen + delta)
            : f.serverUnseen,
    };
}

/** " 2,549 unread on the server." -- omitted when the server did not say. */
function unreadClause(f: EmailFolderDto): string {
    if (typeof f.serverUnseen !== 'number') {
        return '';
    }

    return ` ${f.serverUnseen.toLocaleString()} unread on the server.`;
}
