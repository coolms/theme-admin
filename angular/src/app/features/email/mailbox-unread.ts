import { type EmailFolderDto, type EmailMailboxDto } from './email.types';
import { folderUnread } from './folder-fraction.util';

/**
 * A mailbox's unread number is its inbox's alone. Folders are never summed: on Gmail one message counts in several
 * of them (the inbox, Important, All mail), so a sum reads two or three times too high.
 *
 * Where it comes from, in order: the `unread` the mailbox list serves on each row; until the server serves it, the
 * inbox's own count in the mailbox's folders; and, from a change event, its `mailboxUnseen` (the same number the list
 * serves), or from an event without one, the inbox's entry in the event's counts. New mail announced for another
 * mailbox carries no number, so the list is read again for it.
 */

/** The path a mailbox's inbox has when its folders do not say otherwise. */
export const INBOX_PATH = 'INBOX';

type FolderRow = EmailFolderDto & { readonly children?: readonly FolderRow[] };

/** The inbox among a mailbox's folders (a flat list or a tree): the folder whose role is inbox, else INBOX. */
export function inboxFolder(folders: readonly FolderRow[]): EmailFolderDto | null {
    return findFolder(folders, f => f.role === 'inbox') ?? findFolder(folders, f => f.folder === INBOX_PATH);
}

/** The inbox's unread number from its folders: the server's unseen once a sync has read it, else the platform's. */
export function inboxUnread(folders: readonly FolderRow[]): number {
    const inbox = inboxFolder(folders);
    return inbox === null ? 0 : folderUnread(inbox);
}

/** The unread number the mailbox list serves on a row, or null when the row does not carry one. */
export function servedUnread(mailbox: EmailMailboxDto): number | null {
    return typeof mailbox.unread === 'number' ? mailbox.unread : null;
}

/** A folder's counts as a change event carries them. */
export interface InboxCounts {
    readonly unseen: number;
    readonly serverUnseen?: number | null;
}

/**
 * The mailbox's unread number from a change event without `mailboxUnseen`: the inbox's entry in its counts, or null
 * when the event names no inbox entry (it touched other folders only), and the number stays as it was.
 */
export function eventInboxUnread(counts: Readonly<Record<string, InboxCounts>>, inboxPath: string): number | null {
    const entry = counts[inboxPath];
    if (entry === undefined) {
        return null;
    }
    return typeof entry.serverUnseen === 'number' ? entry.serverUnseen : entry.unseen;
}

/** True when a mailbox other than the open one has unread mail. */
export function unreadElsewhere(
    mailboxes: readonly EmailMailboxDto[],
    openId: string | null,
    unread: Readonly<Record<string, number>>,
): boolean {
    return mailboxes.some(m => m.id !== openId && (unread[m.id] ?? 0) > 0);
}

function findFolder(folders: readonly FolderRow[], match: (f: FolderRow) => boolean): FolderRow | null {
    for (const f of folders) {
        if (match(f)) {
            return f;
        }
        const inner = f.children !== undefined ? findFolder(f.children, match) : null;
        if (inner !== null) {
            return inner;
        }
    }
    return null;
}
