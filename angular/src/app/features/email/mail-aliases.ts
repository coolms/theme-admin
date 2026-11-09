import { HttpErrorResponse } from '@angular/common/http';

/** Where an address typed for a mailbox stands: waiting for its owner's answer, answered, or neither any more. */
export type MailAliasStatus = 'pending' | 'confirmed' | 'expired' | 'declined';

/** One address typed for a mailbox to send as (`GET /email/mailboxes/{id}/aliases`). */
export interface MailAlias {
    readonly id: string;
    readonly address: string;
    readonly status: MailAliasStatus;
    readonly requestedAt: string;
    readonly confirmedAt?: string | null;
    readonly expiresAt?: string | null;
    /** A declined address: when its owner declined it, and when it may be asked for again (absent when not served). */
    readonly declinedAt?: string | null;
    readonly askAgainAt?: string | null;
}

/** The list, and whether the caller may ask for an address and withdraw one. */
export interface MailAliasesDto {
    readonly canManage: boolean;
    readonly aliases: readonly MailAlias[];
}

/** The 202 answer to an ask: the address, pending, and when the link mailed stops working. */
export interface MailAliasAsked {
    readonly id: string;
    readonly address: string;
    readonly status: 'pending';
    readonly expiresAt: string;
}

/** The addresses a message sent as the mailbox may come from, own first (`GET /email/mailboxes/{id}/send-as`). */
export interface MailboxSendAsDto {
    readonly id: string;
    readonly addresses: readonly string[];
    /** Why the provider's list could not be read; then only the own address is offered. */
    readonly unreadable?: string | null;
}

/** The addresses a mailbox sends as changed (confirmed, declined, withdrawn): the event names the mailbox only. */
export interface MailAliasesChangedEvent {
    readonly type: 'mail.aliases.changed';
    readonly mailboxId: string;
}

/** The event, read strictly: anything else is no event. */
export function readAliasesChanged(raw: unknown): MailAliasesChangedEvent | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return null;
    }
    const obj = raw as Record<string, unknown>;

    return obj['type'] === 'mail.aliases.changed' && typeof obj['mailboxId'] === 'string'
        ? { type: 'mail.aliases.changed', mailboxId: obj['mailboxId'] }
        : null;
}

/** A row of the list: an address the mailbox sends from that cannot be withdrawn here, or a typed alias. */
export type SendFromRow =
    | { readonly kind: 'own'; readonly address: string }
    | { readonly kind: 'provider'; readonly address: string }
    | { readonly kind: 'alias'; readonly address: string; readonly alias: MailAlias };

const lower = (address: string): string => address.trim().toLowerCase();

/**
 * The rows, in the order send-as offers them: the mailbox's own address, the provider's verified ones, then each typed
 * alias. Send-as lists confirmed aliases too; those are shown once, as aliases.
 */
export function sendFromRows(own: string | null, sendAs: readonly string[], aliases: readonly MailAlias[]): SendFromRow[] {
    const typed = new Set(aliases.map(a => lower(a.address)));
    const seen = new Set<string>();
    const rows: SendFromRow[] = [];
    if (own !== null && own !== '') {
        rows.push({ kind: 'own', address: own });
        seen.add(lower(own));
    }
    for (const address of sendAs) {
        const key = lower(address);
        if (seen.has(key) || typed.has(key)) {
            continue;
        }
        seen.add(key);
        rows.push({ kind: 'provider', address });
    }
    for (const alias of aliases) {
        rows.push({ kind: 'alias', address: alias.address, alias });
    }

    return rows;
}

/** A wait in words, from Retry-After's seconds: minutes under two hours, hours under two days, days past that. */
export function waitInWords(seconds: number): string {
    const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;
    if (seconds < 60) {
        return plural(Math.max(1, Math.ceil(seconds)), 'second');
    }
    if (seconds < 2 * 3600) {
        return plural(Math.ceil(seconds / 60), 'minute');
    }
    if (seconds < 2 * 86400) {
        return plural(Math.ceil(seconds / 3600), 'hour');
    }

    return plural(Math.ceil(seconds / 86400), 'day');
}

/** Each refusal of an ask, in its own words, by the last segment of its problem type. */
const REFUSALS: Readonly<Record<string, string>> = {
    'own-address': 'That is this mailbox\'s own address: it already sends from it.',
    'already-listed': 'This mailbox already sends from that address.',
    malformed: 'That is not an email address.',
    'too-many-pending': 'Ten addresses are already waiting for confirmation. Withdraw one, or wait until its link is '
        + 'answered or expires.',
};

/**
 * A withdraw refused because the address's owner declined it lately (409 `/errors/email/alias/declined-recently`): the
 * decline is kept, so the address cannot be mailed again before its time. Answers when it may be asked for again, from
 * Retry-After, or null when the answer does not say; undefined when the error is not this refusal.
 */
export function declinedRecently(err: unknown, now: number = Date.now()): string | null | undefined {
    if (!(err instanceof HttpErrorResponse) || err.status !== 409) {
        return undefined;
    }
    const type = typeof err.error === 'object' && err.error !== null ? (err.error as Record<string, unknown>)['type'] : null;
    if (type !== '/errors/email/alias/declined-recently') {
        return undefined;
    }
    const after = Number(err.headers?.get('Retry-After'));

    return Number.isFinite(after) && after > 0 ? new Date(now + after * 1000).toISOString() : null;
}

/**
 * An ask's refusal in words, or null when it is not one of the contract's (the caller words it as any other error).
 * A 429 says how long to wait, from Retry-After; it is also the answer for an address whose owner declined it lately.
 */
export function refusalInWords(err: unknown): string | null {
    if (!(err instanceof HttpErrorResponse)) {
        return null;
    }
    const type = typeof err.error === 'object' && err.error !== null ? (err.error as Record<string, unknown>)['type'] : null;
    const reason = typeof type === 'string' && type.startsWith('/errors/email/alias/')
        ? type.slice('/errors/email/alias/'.length)
        : null;
    if (err.status === 429) {
        const after = Number(err.headers?.get('Retry-After'));
        const when = Number.isFinite(after) && after > 0 ? `in ${waitInWords(after)}` : 'later';

        return 'Too many links were asked for this address or this mailbox, or the address\'s owner declined it '
            + `lately. You can ask again ${when}.`;
    }
    if (err.status === 422 && reason !== null && reason in REFUSALS) {
        return REFUSALS[reason];
    }

    return null;
}
