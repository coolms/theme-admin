import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { DEFAULT_FORMAT_COLOR, DEFAULT_FORMAT_ICON, FALLBACK_FORMAT_LABELS } from '../shared/format-icons.constants';
import { type FormatDisplayInfo, type FormatInfoResponse } from '../shared/format-info.types';
import { extensionForMimeIn } from './template-source.helpers';

/**
 * F.14c-1 — wraps `GET /api/v1/document/format-info` (F.14b backend).
 * The Document Library page calls `loadFormatInfo()` once on mount
 * and slot components read the cached signal synchronously to drive
 * format icons / colours / labels and the upload dialog's `accept`
 * string.
 *
 * The lookup helpers fall through to the `format-icons.constants`
 * defaults when the payload hasn't arrived yet — the very first
 * paint of the grid renders sensible iconography even before the
 * HTTP round-trip completes.
 */
@Injectable({ providedIn: 'root' })
export class FormatInfoService {
    private readonly http = inject(HttpClient);

    readonly formatInfo = signal<FormatInfoResponse | null>(null);
    readonly loading = signal(false);

    /**
     * `filterFormat` narrows the response to one format (`?format=word`) —
     * what the Replace dialog asks for, since it already knows the format of
     * the template being replaced.
     *
     * A filtered response is RETURNED to its caller but never cached. The
     * cached payload is the whole registry or nothing: the document grid
     * behind the dialog reads `iconClass()` / `label()` for EVERY row off this
     * one signal, and `extensionForMime()` names every source download from
     * it. Caching a one-format answer there would blank the icons of every
     * other format on the page and mis-name their downloads until the next
     * full load — a narrowing that outlives the dialog that asked for it.
     */
    loadFormatInfo(filterFormat?: string): Observable<FormatInfoResponse> {
        this.loading.set(true);

        let params = new HttpParams();
        if (filterFormat) {
            params = params.set('format', filterFormat);
        }

        return this.http
            .get<FormatInfoResponse>('/api/v1/document/format-info', { params })
            .pipe(
                tap({
                    next: (info) => {
                        if (!filterFormat) {
                            this.formatInfo.set(info);
                        }
                        this.loading.set(false);
                    },
                    error: () => {
                        this.loading.set(false);
                    },
                }),
            );
    }

    /**
     * Synchronous lookup — returns the cached format payload or
     * `undefined` if the format hasn't been advertised by the
     * backend yet (or the payload hasn't arrived).
     */
    getFormatByName(format: string): FormatDisplayInfo | undefined {
        return this.formatInfo()?.formats.find((f) => f.format === format);
    }

    getAllFormats(): FormatDisplayInfo[] {
        return this.formatInfo()?.formats ?? [];
    }

    /**
     * The formats a template can be AUTHORED in, as opposed to imported —
     * the ones whose provider names a native source mime, which is the
     * same thing as "there is an editor behind this".
     *
     * Filtered here rather than at the call site so the New Template
     * affordance never has to know which formats those are: a module that
     * gains native authoring appears on its own, and one that loses it
     * disappears, with no frontend edit either way.
     */
    nativeAuthoringFormats(): FormatDisplayInfo[] {
        return this.getAllFormats().filter((f) => true === f.supportsNativeAuthoring);
    }

    /**
     * File extension (leading dot) for a SOURCE mime, read off the payload
     * rather than a map here.
     *
     * Each format publishes `mimeTypes` and `extensions` in the same order —
     * `extensions[i]` names `mimeTypes[i]` — so this pairs them by index.
     * That pairing is the contract `DocumentFormatProviderInterface` states
     * for `getAcceptedMimeTypes()` / `getAcceptedExtensions()`.
     *
     * Asking the backend is what keeps the native sources honest:
     * `text/x-dtmpl` and `application/x-coolms-sheet+json` are spelled by the
     * format modules that own them, and a format that ships a new source type
     * names its own extension with no edit on this side. A frontend map would
     * have to be revisited every time — which is exactly how a `.dtmpl` and a
     * `.dsheet` both came to download named `.docx`.
     *
     * `null` when the payload hasn't arrived or the mime isn't advertised;
     * callers fall back to their own defaults.
     */
    extensionForMime(mime: string): string | null {
        return extensionForMimeIn(this.getAllFormats(), mime);
    }

    iconClass(format: string): string {
        return this.getFormatByName(format)?.icon ?? DEFAULT_FORMAT_ICON;
    }

    iconColor(format: string): string {
        return this.getFormatByName(format)?.color ?? DEFAULT_FORMAT_COLOR;
    }

    label(format: string): string {
        const info = this.getFormatByName(format);
        if (info) {
            return info.label;
        }
        return FALLBACK_FORMAT_LABELS[format] ?? format.toUpperCase();
    }

    /**
     * `accept` attribute string for HTML file inputs. Returns an
     * empty string before the payload loads so the picker accepts
     * everything as a soft fallback (the unified upload endpoint
     * MIME-routes server-side and rejects unsupported types with a
     * 415).
     */
    acceptString(): string {
        return this.formatInfo()?.acceptString ?? '';
    }
}
