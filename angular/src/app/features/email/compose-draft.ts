import { type StoredComposeAttachment } from './compose-attachments';
import { type EmailComposeMode, type EmailDraftDto, type EmailDraftWrite } from './email.types';

/** Plain text as formatted paragraphs: a blank line starts a paragraph, a line break stays one; nothing is markup. */
export function paragraphsOf(text: string): string {
    const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(b => b.trim()).filter(b => b !== '');

    return blocks.map(b => `<p>${b.split('\n').map(escape).join('<br>')}</p>`).join('');
}

/** What switching back from Plain text asks once the plain text was edited. */
export const PLAIN_TEXT_BACK = {
    title: 'Switch back to formatting?',
    message: 'The text you edited becomes the formatted message as paragraphs, and its earlier formatting is lost.',
    confirmLabel: 'Switch to formatting',
    cancelLabel: 'Keep plain text',
} as const;

/** How many words of a draft its line shows. */
export const DRAFT_LINE_WORDS = 12;

/** A draft as a save writes it again: what Undo of a Discard makes it from. */
export function draftWriteOf(draft: EmailDraftDto): EmailDraftWrite {
    return {
        to: [...draft.to],
        cc: [...draft.cc],
        bcc: [...draft.bcc],
        subject: draft.subject,
        text: draft.text,
        html: draft.html,
        attachments: [...draft.attachments],
        from: draft.from,
        quote: draft.quote !== false,
        messageParts: [...draft.messageParts],
    };
}

/** The start of a draft's text as its line shows it: its first words, and an ellipsis when there is more. */
export function draftLine(text: string): string {
    const words = text.trim().split(/\s+/).filter(w => w !== '');
    if (words.length === 0) {
        return 'Draft (no text yet)';
    }
    const start = words.slice(0, DRAFT_LINE_WORDS).join(' ');

    return words.length > DRAFT_LINE_WORDS ? `Draft: “${start}…”` : `Draft: “${start}”`;
}

/** Reply and reply all: the two modes that share a message's one reply draft. */
export function isReplyMode(mode: EmailComposeMode | 'compose' | null | undefined): mode is 'reply' | 'reply_all' {
    return mode === 'reply' || mode === 'reply_all';
}

/** The reply draft among a message's drafts (the lookup lists it first), or null. */
export function replyDraftOf(list: readonly EmailDraftDto[]): EmailDraftDto | null {
    return list.find(d => isReplyMode(d.answers?.mode)) ?? null;
}

/** A draft's files as the compose attachments restore them. */
export function draftFiles(draft: EmailDraftDto): StoredComposeAttachment[] {
    const files = Array.isArray(draft.attachmentFiles) ? draft.attachmentFiles : [];

    return files.map(f => ({
        id: f.id,
        filename: f.filename,
        sizeBytes: f.sizeBytes,
        encodedBytes: f.encodedBytes ?? null,
        mimeType: f.mimeType ?? null,
        source: 'upload' as const,
    }));
}

/**
 * A reply draft the quick reply cannot show as it is (formatted, without the quote, with Cc or Bcc, or to all): it is
 * written in the compose window, and the box says so.
 */
export function writtenInWindow(draft: EmailDraftDto): boolean {
    return draft.html !== null || draft.quote === false || draft.cc.length > 0 || draft.bcc.length > 0
        || draft.answers?.mode === 'reply_all';
}
