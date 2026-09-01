import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
/**
 * Data layer for the Markdown import/export round-trip.
 *
 *  - `toHtml`        -> `POST /content/markdown/to-html` — converts pasted/imported
 *                      Markdown to editor HTML through the SAME server-side
 *                      hardened converter the create-from-Markdown path uses
 *                      (raw HTML + unsafe links stripped at the source). The FE
 *                      deliberately runs no client-side Markdown parser, so the
 *                      one security boundary lives on the server.
 *  - `exportPage`    -> `GET /content/pages/export` — reads a page variant's HTML
 *                      body and returns it as Markdown plus a suggested filename.
 *  - `downloadMarkdown` -> client-side Blob download (the admin is a Bearer SPA,
 *                      so the auth'd JSON is fetched first, then turned into a
 *                      file here rather than via a plain `<a download>`).
 */
@Injectable({ providedIn: 'root' })
export class MarkdownService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /** Convert Markdown -> safe editor HTML. Empty in -> empty out. */
    toHtml(markdown: string): Observable<string> {
        return this.http.post<{ html?: string }>(
            `${this.apiBase}/content/markdown/to-html`,
            { markdown },
            { headers: { 'Content-Type': 'application/ld+json' } },
        ).pipe(map(r => r.html ?? ''));
    }

    /**
     * Export a page variant body as Markdown. `locale` omitted -> the backend
     * exports the first authored variant. Returns the Markdown plus a suggested
     * `.md` filename.
     */
    exportPage(path: string, locale?: string): Observable<{ filename: string; markdown: string; locale: string }> {
        let params = new HttpParams().set('path', path).set('format', 'md');
        if (locale) params = params.set('locale', locale);
        return this.http.get<{ filename: string; markdown: string; locale: string }>(
            `${this.apiBase}/content/pages/export`,
            { params },
        );
    }

    /** Trigger a browser download of a Markdown string as `filename`. */
    downloadMarkdown(filename: string, markdown: string): void {
        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'page.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
