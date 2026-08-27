import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Renders the editor's CURRENT (unsaved) content to a PDF that shows how the
 * .docx will actually look (#1773).
 *
 * The `<cms-context-frame>` preview answers "how will this look on the site";
 * this answers "how will this look on paper", and only the real engines can:
 * PHPWord decides the sections, LibreOffice (via Gotenberg) decides where lines
 * and pages fall. CSS can approximate the first question and cannot touch the
 * second.
 *
 * Nothing is persisted server-side — no instance, no artifact. The response is
 * the bytes.
 */
@Injectable({ providedIn: 'root' })
export class DocumentPreviewService {
    private readonly http = inject(HttpClient);

    /**
     * @param templateId VFS Node id of the template; also where the page size
     *                   and orientation come from, so the preview is on the
     *                   same paper the generated file will be.
     * @param html       editor content, as HTML (pre-dtmpl-storage form)
     */
    render(templateId: string, html: string): Observable<Blob> {
        return this.http.post(
            `/api/v1/document/templates/${encodeURIComponent(templateId)}/preview`,
            { html },
            { responseType: 'blob' },
        );
    }

    /**
     * The same render, delivered as a file (#1774).
     *
     * An authored document has no Generate step, so this is how it leaves the
     * system. It shares the preview's composer deliberately: what the author
     * saw is byte-for-byte what downloads, because it is the same call with a
     * different `Content-Disposition`.
     */
    download(templateId: string, html: string, format: 'docx' | 'pdf'): Observable<Blob> {
        return this.http.post(
            `/api/v1/document/templates/${encodeURIComponent(templateId)}/download?format=${format}`,
            { html },
            { responseType: 'blob' },
        );
    }
}
