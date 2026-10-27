import type { EmailMailboxDto, SystemMailChoice, SystemMailDto } from './email.types';

/**
 * The System mail page's rules, as pure functions, so the page decides nothing about them on its own.
 *
 * **Only a shared, enabled mailbox can be chosen.** The server refuses a personal one (`mailbox-not-shared`) and a
 * disabled one (`mailbox-disabled`); the select offers neither, so a refusal there means the mailbox changed since
 * the list was read, and the server's words say which.
 */
export function systemMailCandidates(mailboxes: readonly EmailMailboxDto[]): EmailMailboxDto[] {
    return mailboxes.filter(m => 'shared' === m.kind && false !== m.enabled);
}

/**
 * The body of `PUT /email/system-mail`: the mailbox, the From as chosen, and the display name -- trimmed, and null
 * when blank, which keeps the configured From's name rather than sending an empty one.
 */
export function systemMailChoice(mailboxId: string, fromAddress: string, fromName: string): SystemMailChoice {
    const name = fromName.trim();

    return { mailboxId, fromAddress, fromName: '' === name ? null : name };
}

/** The From select: what it offers, which is chosen, and the stored From the mailbox no longer offers, if any. */
export interface SystemMailFromOptions {
    options: string[];
    selected: string;
    notOffered: string | null;
}

/**
 * The From select for a mailbox's send-as addresses. The stored From stays chosen when the list offers it; when the
 * list does not (its send-as could not be read, or an alias is no longer accepted), it is still offered, first and
 * named as not offered now, and still chosen: a save keeps it rather than quietly changing it, and the server says if
 * it is not allowed. With no stored From, the mailbox's own address (the list's first) is chosen.
 */
export function systemMailFromOptions(addresses: readonly string[], storedFrom: string | null): SystemMailFromOptions {
    if (null === storedFrom || '' === storedFrom) {
        return { options: [...addresses], selected: addresses[0] ?? '', notOffered: null };
    }
    if (addresses.includes(storedFrom)) {
        return { options: [...addresses], selected: storedFrom, notOffered: null };
    }

    return { options: [storedFrom, ...addresses], selected: storedFrom, notOffered: storedFrom };
}

/** The state line, in words: what carries system mail now, and why it stopped when it did. */
export function systemMailStateText(view: SystemMailDto): string {
    switch (view.state) {
        case 'sending': return 'Sending through the chosen mailbox.';
        case 'stopped': return `Stopped: ${stopReasonText(view.stopReason)}`;
        default: return 'Nothing chosen: the configured transport carries system mail.';
    }
}

function stopReasonText(reason: string | null): string {
    switch (reason) {
        case 'mailbox-gone': return 'the mailbox no longer exists.';
        case 'mailbox-disabled': return 'the mailbox is disabled.';
        case 'mailbox-needs-reconnect': return 'the mailbox needs to be connected again.';
        default: return reason ?? 'no reason was given.';
    }
}
