import { HttpErrorResponse } from '@angular/common/http';
import { refusalWords } from './server-words';

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

/**
 * Why a message could not be opened: the server's detail as given for a declared problem, the generic sentence for an
 * undeclared one or a lost connection. The one 404 is also `gone`, so its row leaves the list.
 */
export function openFailureOf(error: unknown): OpenFailure {
    return { text: refusalWords(error), gone: error instanceof HttpErrorResponse && error.status === 404 };
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
