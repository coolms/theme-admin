import { type EmailFolderDto } from './email.types';

/**
 * A folder's rail count used to be one number: how many messages had been
 * IMPORTED. That read as the size of the folder, which it is not -- the first
 * sync copies a recent window and a backfill walks the rest, so for a large
 * mailbox the imported count can be a quarter of what the server holds.
 *
 * The server now reports both, so the rail can say "1,314 / 5,512" and mean it.
 * These are pure functions over the DTO so the wording and the progress bar are
 * decided in one place and cannot drift apart.
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

/** `1,314 / 5,512` while a folder is part-imported, otherwise just the count. */
export function folderCount(f: EmailFolderDto): string {
    const imported = f.total.toLocaleString();
    if (importedFraction(f) === null) {
        return imported;
    }

    return `${imported} / ${(f.serverTotal as number).toLocaleString()}`;
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
    const imported = f.total.toLocaleString();
    const unread = unreadClause(f);

    if (percent === null) {
        return typeof f.serverTotal === 'number'
            ? `${imported} messages, all of them imported.${unread} Counts messages, not conversations.`
            : `${imported} messages imported (the server's own count is not known yet).${unread}`;
    }

    return `${imported} of ${(f.serverTotal as number).toLocaleString()} messages imported (${percent}%) -- the rest is still being copied.${unread} Counts messages, not conversations: a mail app that groups by conversation will show fewer.`;
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
