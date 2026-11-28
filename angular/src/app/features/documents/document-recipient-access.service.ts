import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { DocumentsApiService } from './documents-api.service';

/** Whether the signed-in person may choose who a document goes to: unknown until the server has answered. */
export type RecipientChoice = 'unknown' | 'others' | 'self';

/**
 * Whether the signed-in person may choose a document's recipients, as the server answers it: the recipients search is
 * for document operators (an elevated administrator included); anyone else generates only for themselves. Asked once,
 * by a search for one person; a refusal (403) means "for yourself only". Any other failure leaves the choice to the
 * server, which refuses what it must when the document is made.
 */
@Injectable({ providedIn: 'root' })
export class DocumentRecipientAccess {
    private readonly documents = inject(DocumentsApiService);
    private readonly answer = signal<RecipientChoice>('unknown');
    private asked = false;
    readonly choice = this.answer.asReadonly();

    /** Asks the server, once. */
    load(): void {
        if (this.asked) return;
        this.asked = true;
        this.documents.searchDocumentRecipients('', 1).subscribe({
            next: () => this.answer.set('others'),
            error: (e: unknown) => this.answer.set(e instanceof HttpErrorResponse && e.status === 403 ? 'self' : 'others'),
        });
    }
}
