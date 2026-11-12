import { type StoredComposeAttachment } from './compose-attachments';
import { type EmailComposeMode, type EmailDraftDto } from './email.types';

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
