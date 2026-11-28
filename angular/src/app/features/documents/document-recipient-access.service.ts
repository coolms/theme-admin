import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Store } from '@ngxs/store';
import { AuthState, ElevationService } from '@coolms/core-angular';
import { DocumentsApiService } from './documents-api.service';

/** Whether the signed-in person may choose who a document goes to: unknown until the server has answered. */
export type RecipientChoice = 'unknown' | 'others' | 'self';

/**
 * Whether the signed-in person may choose a document's recipients, as the server answers it: the recipients search is
 * for document operators (an elevated administrator included); anyone else generates only for themselves. Asked by a
 * search for one person; a refusal (403) means "for yourself only". Any other failure leaves the choice to the server,
 * which refuses what it must when the document is made.
 *
 * The answer belongs to one person in one elevation: it is asked again when the signed-in person changes or their
 * session is elevated or no longer is, and an answer to an earlier question is dropped.
 */
@Injectable({ providedIn: 'root' })
export class DocumentRecipientAccess {
    private readonly documents = inject(DocumentsApiService);
    private readonly elevation = inject(ElevationService);
    private readonly store = inject(Store);
    private readonly answer = signal<RecipientChoice>('unknown');
    /** Whom the answer is for: the person and their elevation when it was asked; null before any form asked. */
    private askedFor: string | null = null;
    readonly choice = this.answer.asReadonly();

    constructor() {
        // A change of elevation while a form is open asks again (a change of person is seen when a form asks); before any
        // form asked, nothing.
        effect(() => {
            const key = this.keyNow();
            untracked(() => {
                if (this.askedFor !== null && this.askedFor !== key) this.ask(key);
            });
        });
    }

    /** Asks the server, unless it has answered for this person in this elevation already. */
    load(): void {
        const key = this.keyNow();
        if (this.askedFor !== key) this.ask(key);
    }

    private keyNow(): string {
        const me = this.store.selectSnapshot(AuthState.currentUser);
        return `${me?.id ?? ''}|${this.elevation.elevated() ? 'elevated' : 'plain'}`;
    }

    private ask(key: string): void {
        this.askedFor = key;
        this.answer.set('unknown');
        this.documents.searchDocumentRecipients('', 1).subscribe({
            next: () => { if (this.askedFor === key) this.answer.set('others'); },
            error: (e: unknown) => {
                if (this.askedFor === key) this.answer.set(e instanceof HttpErrorResponse && e.status === 403 ? 'self' : 'others');
            },
        });
    }
}
