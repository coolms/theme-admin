import { HttpErrorResponse } from '@angular/common/http';

/** What the message pane shows of a message before it has loaded: what its row already has. */
export interface OpeningHeader {
    readonly subject: string;
    readonly from: string;
    readonly sentAt: string | null;
}

/** A row, a search hit or a conversation entry: the fields the pane's header reads while the message loads. */
export interface OpeningRow {
    readonly subject?: string | null;
    readonly fromName?: string | null;
    readonly fromAddress?: string | null;
    readonly sentAt?: string | null;
}

/** The header the pane shows at once, from the row chosen. */
export function openingHeader(row: OpeningRow): OpeningHeader {
    const name = (row.fromName ?? '').trim();
    const address = (row.fromAddress ?? '').trim();

    return {
        subject: (row.subject ?? '').trim(),
        from: name !== '' && address !== '' ? `${name} · ${address}` : name !== '' ? name : address,
        sentAt: row.sentAt ?? null,
    };
}

/** Why a message could not be opened, as the pane says it; gone means its row leaves the list. */
export interface OpenFailure {
    readonly text: string;
    readonly gone: boolean;
}

/** The problem type of an error answer, or '' when it carries none. */
function problemType(error: HttpErrorResponse): string {
    let body: unknown = error.error;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            body = null;
        }
    }
    const type = typeof body === 'object' && body !== null ? (body as { type?: unknown }).type : undefined;

    return typeof type === 'string' ? type : '';
}

/**
 * The sentence for a load that failed, by the server's reason: the one 404 (gone, or never this person's to see), a
 * body the mail server did not send, no answer at all, anything else.
 */
export function openFailureOf(error: unknown): OpenFailure {
    if (!(error instanceof HttpErrorResponse)) {
        return { text: 'Couldn\'t open this message.', gone: false };
    }
    if (error.status === 404) {
        return { text: 'This message is no longer here.', gone: true };
    }
    if (error.status === 0) {
        return { text: 'Couldn\'t reach the server. Check the connection and try again.', gone: false };
    }
    if (problemType(error).endsWith('/errors/email/body-unavailable')) {
        return { text: 'The mail server could not be reached to read this message.', gone: false };
    }

    return { text: 'Couldn\'t open this message.', gone: false };
}

/** The refs of the server rows just before and after the row with this ref, in the list's order: at most two. */
export function serverNeighbours(rows: readonly { readonly fromServer?: boolean | null; readonly ref?: string | null }[], ref: string): string[] {
    const at = rows.findIndex(r => r.fromServer === true && r.ref === ref);
    if (at < 0) {
        return [];
    }
    const beside: ({ readonly fromServer?: boolean | null; readonly ref?: string | null } | undefined)[] = [rows[at - 1], rows[at + 1]];
    return beside
        .map(r => (r !== undefined && r.fromServer === true ? r.ref ?? '' : ''))
        .filter(r => r !== '');
}

/** The ids of the stored rows just above and below the row with this id, in the list's order: at most two. */
export function storedNeighbours(rows: readonly { readonly fromServer?: boolean | null; readonly id?: string }[], id: string): string[] {
    const stored = (r: { fromServer?: boolean | null; id?: string } | undefined): r is { id: string } =>
        r !== undefined && r.fromServer !== true && typeof r.id === 'string' && r.id !== '';
    const at = rows.findIndex(r => stored(r) && r.id === id);
    if (at < 0) {
        return [];
    }
    const beside: ({ readonly fromServer?: boolean | null; readonly id?: string } | undefined)[] = [rows[at - 1], rows[at + 1]];
    return beside.filter(stored).map(r => r.id);
}
