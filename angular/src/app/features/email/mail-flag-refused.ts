/**
 * The mail server refused a flag change after the write had answered: its worker rolled the store back. Sent to the
 * mailbox's owner and delegates just before the mail.messages.changed that restores the flag. `value` is the value the
 * change asked for; `reason` is a sentence; `code` names the reason, where the server sends one.
 */
export interface MailFlagRefusedEvent {
    readonly type: 'mail.flag.refused';
    readonly mailboxId: string;
    readonly messageId: string;
    readonly flag: 'seen' | 'flagged';
    readonly value: boolean;
    readonly reason: string | null;
    readonly code: string | null;
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
        reason: typeof o['reason'] === 'string' && o['reason'] !== '' ? o['reason'] : null,
        code: typeof o['code'] === 'string' && o['code'] !== '' ? o['code'] : null,
    };
}

/** What was asked, in the page's words. */
function asked(flag: 'seen' | 'flagged', value: boolean): string {
    if (flag === 'seen') {
        return value ? 'marking it read' : 'marking it unread';
    }
    return value ? 'starring it' : 'removing its star';
}

/** A reason's code in the page's words; null for a code the page does not know (the server's sentence then says it). */
function codeText(code: string | null): string | null {
    switch (code) {
        case 'folder-not-synced':
            return "Its folder has not been read from the mail server yet.";
        case 'changed-elsewhere':
            return 'It was changed elsewhere in the meantime.';
        case 'renumbered':
            return 'Its folder changed on the mail server. Try again after it refreshes.';
        case 'not-found':
            return 'The mail server no longer has this message.';
    }
    return null;
}

/**
 * The notice for a refused flag change: what was not accepted, then why -- the page's words for the reason's code when
 * it knows the code, else the server's sentence, else nothing more.
 */
export function flagRefusedText(
    flag: 'seen' | 'flagged',
    value: boolean,
    code: string | null = null,
    reason: string | null = null,
): string {
    const why = codeText(code) ?? reason;
    const head = `The mail server didn't accept ${asked(flag, value)}.`;
    return why === null ? head : `${head} ${why}`;
}
