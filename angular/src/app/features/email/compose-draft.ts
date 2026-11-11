import { type StoredComposeAttachment } from './compose-attachments';

/**
 * A composer's draft as the draft store keeps it. A reply has one draft, under one key, whether it is written in the
 * quick reply or in the compose window: `place` says which of the two holds it now.
 */
export interface ComposeDraft {
    /** Recipient chips. Older drafts stored `to` as a comma-string: coerced on load. */
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    text: string;
    html: string;
    rich: boolean;
    /** The files attached, by their server ids; absent from older drafts. */
    attachments?: StoredComposeAttachment[];
    /**
     * An answer or a forward: whether the person kept the quote. Absent from a reply draft written before the quote
     * was the server's: that draft's body already holds the quote it was given, so it is restored without another.
     */
    quote?: boolean;
    /** A forward: the parts of the original the person removed from its files; absent from older drafts. */
    removedParts?: number[];
    /** Where the draft is written: the quick reply's box, or the compose window (also when absent). */
    place?: 'quick' | 'window';
}

/** The draft store's key for a mailbox's new message, or for an answer or a forward of one of its messages. */
export function composeDraftKey(mailboxId: string, mode: string, messageId: string | null): string | null {
    if (mode === 'compose') {
        return `email.${mailboxId}.compose`;
    }

    return messageId !== null ? `email.${mailboxId}.${mode}.${messageId}` : null;
}

/** The key of the one reply draft of a message: the quick reply's and the compose window's. */
export function replyDraftKey(mailboxId: string, messageId: string): string {
    return `email.${mailboxId}.reply.${messageId}`;
}
