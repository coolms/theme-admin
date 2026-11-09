import { type EmailFolderDto, type EmailMessageDto } from './email.types';

/** One message's state after a change: its flags, in the folder it is in now. */
export interface MailMessageFlags {
    readonly id: string;
    readonly threadId: string | null;
    readonly folder: string;
    readonly seen: boolean;
    readonly flagged: boolean;
}

/** A message moved to another folder of the same mailbox, keeping its id; a delete is a move to Trash. */
export interface MailMessageMoved extends MailMessageFlags {
    readonly movedTo: string;
}

/** A message no longer in the mailbox: purged from Trash, or retired by a sync because the server no longer lists it. */
export interface MailMessageGone {
    readonly id: string;
    readonly folder: string;
    readonly gone: true;
}

export type MailMessageChange = MailMessageFlags | MailMessageMoved | MailMessageGone;

/** A folder's counts after a change, with the same four fields the folder list answers. */
export interface MailFolderCounts {
    readonly total: number;
    readonly unseen: number;
    readonly serverTotal: number | null;
    readonly serverUnseen: number | null;
}

/**
 * The per-person mail event: what changed in a mailbox, from a person's own action or a sync, as the state after it.
 * Ordered by `seq`, per mailbox: a change older than the last one applied to a row, or counts older than the last ones
 * applied to a folder, are ignored. Ids, folder names, flags and counts only: no content.
 */
export interface MailMessagesChangedEvent {
    readonly type: 'mail.messages.changed';
    readonly mailboxId: string;
    readonly origin: 'action' | 'sync';
    readonly seq: number;
    readonly changes: readonly MailMessageChange[];
    readonly counts: Readonly<Record<string, MailFolderCounts>>;
    readonly mailboxUnseen: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isOptionalCount = (v: unknown): boolean => v === null || v === undefined || isCount(v);

function readChange(raw: unknown): MailMessageChange | null {
    if (!isObject(raw) || typeof raw['id'] !== 'string' || typeof raw['folder'] !== 'string') {
        return null;
    }
    if (raw['gone'] === true) {
        return { id: raw['id'], folder: raw['folder'], gone: true };
    }
    if (typeof raw['seen'] !== 'boolean' || typeof raw['flagged'] !== 'boolean') {
        return null;
    }
    const threadId = typeof raw['threadId'] === 'string' ? raw['threadId'] : null;
    const flags: MailMessageFlags = { id: raw['id'], threadId, folder: raw['folder'], seen: raw['seen'], flagged: raw['flagged'] };
    if ('movedTo' in raw) {
        return typeof raw['movedTo'] === 'string' ? { ...flags, movedTo: raw['movedTo'] } : null;
    }

    return flags;
}

/**
 * The event, read strictly: anything not in the shape the contract states is no event at all, so a partial roll-out
 * or a malformed publication changes nothing on screen.
 */
export function readMessagesChanged(raw: unknown): MailMessagesChangedEvent | null {
    if (!isObject(raw) || raw['type'] !== 'mail.messages.changed' || typeof raw['mailboxId'] !== 'string') {
        return null;
    }
    const origin = raw['origin'];
    if ((origin !== 'action' && origin !== 'sync') || !isCount(raw['seq']) || !isCount(raw['mailboxUnseen'])) {
        return null;
    }
    if (!Array.isArray(raw['changes']) || !isObject(raw['counts'])) {
        return null;
    }
    const changes: MailMessageChange[] = [];
    for (const one of raw['changes']) {
        const change = readChange(one);
        if (change === null) {
            return null;
        }
        changes.push(change);
    }
    const counts: Record<string, MailFolderCounts> = {};
    for (const [folder, value] of Object.entries(raw['counts'])) {
        if (!isObject(value) || !isCount(value['total']) || !isCount(value['unseen'])
            || !isOptionalCount(value['serverTotal']) || !isOptionalCount(value['serverUnseen'])) {
            return null;
        }
        counts[folder] = {
            total: value['total'],
            unseen: value['unseen'],
            serverTotal: isCount(value['serverTotal']) ? value['serverTotal'] : null,
            serverUnseen: isCount(value['serverUnseen']) ? value['serverUnseen'] : null,
        };
    }

    return { type: 'mail.messages.changed', mailboxId: raw['mailboxId'], origin, seq: raw['seq'], changes, counts, mailboxUnseen: raw['mailboxUnseen'] };
}

/**
 * The view after an event, and whether a message arrived in the folder shown that its list does not hold: the event
 * carries no subject, sender or date, so the list is read again rather than the row placed by guess.
 */
export type MailApplied<D extends EmailMessageDto = EmailMessageDto> = MailView<D> & { readonly arrived: boolean };

/** What a page shows that the event can change: the open mailbox and folder, its list, its folders, the badges. */
export interface MailView<D extends EmailMessageDto = EmailMessageDto> {
    readonly mailboxId: string | null;
    readonly folder: string;
    readonly messages: readonly EmailMessageDto[];
    readonly thread: readonly EmailMessageDto[];
    readonly openMessage: D | null;
    readonly folders: readonly EmailFolderDto[];
    readonly mailboxUnread: Readonly<Record<string, number>>;
}

/**
 * The last seq applied, per mailbox: to each row, to each folder's counts, and to the mailbox's badge. One per page:
 * it is what makes an event that arrives late, or twice, change nothing.
 */
export class MailSeqMarks {
    private readonly rows = new Map<string, number>();
    private readonly folders = new Map<string, number>();
    private readonly badges = new Map<string, number>();

    /** True, and recorded, when `seq` is newer than the last applied under this key. */
    private advance(map: Map<string, number>, key: string, seq: number): boolean {
        const last = map.get(key);
        if (last !== undefined && seq <= last) {
            return false;
        }
        map.set(key, seq);

        return true;
    }

    row(mailboxId: string, id: string, seq: number): boolean {
        return this.advance(this.rows, `${mailboxId} ${id}`, seq);
    }

    folder(mailboxId: string, folder: string, seq: number): boolean {
        return this.advance(this.folders, `${mailboxId} ${folder}`, seq);
    }

    badge(mailboxId: string, seq: number): boolean {
        return this.advance(this.badges, mailboxId, seq);
    }
}

function withFlags<T extends EmailMessageDto>(m: T, c: MailMessageFlags): T {
    return { ...m, seen: c.seen, flagged: c.flagged, folder: 'movedTo' in c ? (c as MailMessageMoved).movedTo : c.folder };
}

/**
 * The view after the event, in place: a row shown in the open folder takes its new flags, leaves the list when it
 * moved to another folder or is gone; the open message and its thread take their flags; the counts replace the folders'
 * own; the mailbox's badge takes the event's number. A row that moved INTO the open folder is not added: the event
 * carries no subject, sender or date, so it appears at the list's next read rather than in a guessed place.
 * Nothing is applied that is not newer, by seq, than what was applied before.
 */
export function applyMessagesChanged<D extends EmailMessageDto>(
    view: MailView<D>,
    event: MailMessagesChangedEvent,
    marks: MailSeqMarks,
): MailApplied<D> {
    const mailbox = event.mailboxId;
    const open = view.mailboxId === mailbox;
    let messages = view.messages;
    let thread = view.thread;
    let openMessage = view.openMessage;
    let arrived = false;
    for (const change of event.changes) {
        if (!marks.row(mailbox, change.id, event.seq) || !open) {
            continue;
        }
        if ('gone' in change) {
            messages = messages.filter(m => m.id !== change.id);
            thread = thread.filter(m => m.id !== change.id);
            continue;
        }
        const leaves = 'movedTo' in change && change.movedTo !== view.folder;
        // Moved into the folder shown, and not in its list: a restore, an undo, a move from another tab or device.
        if ('movedTo' in change && change.movedTo === view.folder && !messages.some(m => m.id === change.id)) {
            arrived = true;
        }
        messages = leaves
            ? messages.filter(m => m.id !== change.id)
            : messages.map(m => m.id === change.id ? withFlags(m, change) : m);
        thread = thread.map(m => m.id === change.id ? withFlags(m, change) : m);
        if (openMessage !== null && openMessage.id === change.id) {
            openMessage = withFlags(openMessage, change);
        }
    }
    let folders = view.folders;
    if (open) {
        const newer = Object.keys(event.counts).filter(folder => marks.folder(mailbox, folder, event.seq));
        if (newer.length > 0) {
            folders = folders.map(f => newer.includes(f.folder) ? { ...f, ...event.counts[f.folder] } : f);
        }
    }
    let mailboxUnread = view.mailboxUnread;
    if (marks.badge(mailbox, event.seq)) {
        mailboxUnread = { ...mailboxUnread, [mailbox]: event.mailboxUnseen };
    }

    return { ...view, messages, thread, openMessage, folders, mailboxUnread, arrived };
}

/**
 * One page's follower of the event: it applies each event by seq, and when messages arrive in the folder shown, it
 * asks for that folder's list once, after the burst settles, so a bulk restore makes one read, not one per message.
 */
export class MailLiveFollower {
    readonly marks = new MailSeqMarks();
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly reread: () => void, private readonly settleMs = 300) {
    }

    apply<D extends EmailMessageDto>(view: MailView<D>, event: MailMessagesChangedEvent): MailView<D> {
        const { arrived, ...after } = applyMessagesChanged(view, event, this.marks);
        if (arrived) {
            if (this.timer !== null) {
                clearTimeout(this.timer);
            }
            this.timer = setTimeout(() => {
                this.timer = null;
                this.reread();
            }, this.settleMs);
        }

        return after;
    }

    /** The page is gone: a read still waiting is not made. */
    stop(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
