import { type EmailComposeMode, type EmailDraftAnswers } from './email.types';

/**
 * One of the person's drafts was made, saved, attached to or removed, told on their own channel: `version` is the
 * draft's version now, or null when it is gone (discarded, or sent). A place holding the draft reads it again by id
 * when the version is newer than its own, and closes or clears it when it is gone.
 */
export interface MailDraftsChangedEvent {
    readonly type: 'mail.drafts.changed';
    readonly mailboxId: string;
    readonly draftId: string;
    readonly version: number | null;
    readonly answers: EmailDraftAnswers | null;
}

const MODES: readonly EmailComposeMode[] = ['reply', 'reply_all', 'forward'];

/** The event, or null when it is not one this page can act on. */
export function readDraftsChanged(raw: unknown): MailDraftsChangedEvent | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return null;
    }
    const o = raw as Record<string, unknown>;
    const version = o['version'];
    if (o['type'] !== 'mail.drafts.changed' || typeof o['mailboxId'] !== 'string' || typeof o['draftId'] !== 'string'
        || !(version === null || (typeof version === 'number' && Number.isInteger(version)))) {
        return null;
    }

    return {
        type: 'mail.drafts.changed',
        mailboxId: o['mailboxId'],
        draftId: o['draftId'],
        version,
        answers: readAnswers(o['answers']),
    };
}

function readAnswers(raw: unknown): EmailDraftAnswers | null {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const a = raw as Record<string, unknown>;
    const mode = MODES.find(m => m === a['mode']);

    return typeof a['messageId'] === 'string' && mode !== undefined ? { messageId: a['messageId'], mode } : null;
}
