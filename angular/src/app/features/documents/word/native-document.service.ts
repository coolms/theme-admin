import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** Response of `POST /api/v1/document/documents` (#1774). */
export interface NativeDocumentDto {
    readonly id: string;
    readonly title: string;
    readonly folderPath: string;
    /** Full VFS path — what the editor opens. */
    readonly path: string;
    /** Slug plus the extension the chosen format seeds (`.dtmpl`, `.dsheet`, …). */
    readonly name: string;
    /** Which format it was actually authored in — echoed back, so an omitted one is still knowable. */
    readonly format?: string;
}

/**
 * Creates a document to AUTHOR, as opposed to one uploaded or generated from a
 * template (#1774). The counterpart to `WordTemplateService.createNative()`.
 */
@Injectable({ providedIn: 'root' })
export class NativeDocumentService {
    private readonly http = inject(HttpClient);

    /**
     * Sends the TITLE only. The slug is derived server-side by the platform
     * slugger with national transliteration, so a document can be called
     * "Договор аренды" and still be `dogovor-arendy.dtmpl` on disk — folding it
     * here is the bug #1687 fixed, since an ASCII regex cannot transliterate
     * and can only drop the characters it does not recognise.
     */
    create(folderPath: string, title: string, format?: string): Observable<NativeDocumentDto> {
        return this.http.post<NativeDocumentDto>(
            '/api/v1/document/documents',
            // `format` is OMITTED when not given rather than sent as null or
            // '': the backend defaults an absent field to Word, which is what
            // this endpoint produced before it could produce anything else.
            undefined === format ? { folderPath, title } : { folderPath, title, format },
            { headers: { 'Content-Type': 'application/ld+json', Accept: 'application/ld+json' } },
        );
    }
}
