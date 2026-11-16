import { sentenceOf } from './server-words';

/**
 * The mail server refused a flag change after the write had answered: its worker rolled the store back. Sent to the
 * mailbox's owner and delegates just before the mail.messages.changed that restores the flag. `value` is the value the
 * row was put back to, not the one asked for; `wanted` is the value asked for; `reason` is a sentence; `code` names the
 * reason, where the server sends one.
 */
export interface MailFlagRefusedEvent {
    readonly type: 'mail.flag.refused';
    readonly mailboxId: string;
    readonly messageId: string;
    readonly flag: 'seen' | 'flagged';
    /** The value the row was put back to. */
    readonly value: boolean;
    /** The value the change asked for: the event's `wanted`, else the other of `value` (a refusal is a difference). */
    readonly wanted: boolean;
    /** Not for people: an exception's own text. Never shown. */
    readonly reason: string | null;
    /** The reason, as the server's sentence to show as given; null when it gives none. */
    readonly reasonText: string | null;
    readonly code: string | null;
    /** Every row the refused change had reached (on Gmail, the message's row in each label); [messageId] if unsaid. */
    readonly ids: readonly string[];
}

/** The event, read strictly: anything not in its shape is no event. */
export function readFlagRefused(raw: unknown): MailFlagRefusedEvent | null {
    if (raw === null || typeof raw !== 'object') {
        return null;
    }
    const o = raw as Record<string, unknown>;
    if (o['type'] !== 'mail.flag.refused' || typeof o['mailboxId'] !== 'string' || typeof o['messageId'] !== 'string') {
        return null;
    }
    if ((o['flag'] !== 'seen' && o['flag'] !== 'flagged') || typeof o['value'] !== 'boolean') {
        return null;
    }
    return {
        type: 'mail.flag.refused',
        mailboxId: o['mailboxId'],
        messageId: o['messageId'],
        flag: o['flag'],
        value: o['value'],
        wanted: typeof o['wanted'] === 'boolean' ? o['wanted'] : !o['value'],
        reason: typeof o['reason'] === 'string' && o['reason'] !== '' ? o['reason'] : null,
        reasonText: sentenceOf(o['reasonText']),
        code: typeof o['code'] === 'string' && o['code'] !== '' ? o['code'] : null,
        ids: idsOf(o['ids'], o['messageId']),
    };
}

/** A list of row ids from the server, or [fallback] when it names none. */
export function idsOf(raw: unknown, fallback: string): string[] {
    const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && id !== '') : [];
    return ids.length > 0 ? [...new Set([fallback, ...ids])] : [fallback];
}

/** A flag change a person asks for. */
export type FlagChange = 'read' | 'unread' | 'star' | 'unstar';

/** The change a flag and the value asked for make. */
export function flagChangeOf(flag: 'seen' | 'flagged', value: boolean): FlagChange {
    if (flag === 'seen') {
        return value ? 'read' : 'unread';
    }
    return value ? 'star' : 'unstar';
}

const CHANGE_WORDS: Readonly<Record<FlagChange, string>> = {
    read: "Couldn't mark as read",
    unread: "Couldn't mark as unread",
    star: "Couldn't star",
    unstar: "Couldn't remove the star",
};

/**
 * The one notice for a refused read or star change, whether the write's answer refused it or the server refused it
 * after answering: "Couldn't mark as unread", then the server's sentence for why, as given, when there is one. The
 * reason's code is never turned into words here.
 */
export function flagRefusalText(change: FlagChange, sentence: string | null = null): string {
    return sentence === null ? `${CHANGE_WORDS[change]}.` : `${CHANGE_WORDS[change]}: ${sentence}`;
}
