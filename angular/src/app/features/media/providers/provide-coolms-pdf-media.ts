import { HttpClient } from '@angular/common/http';
import { Injectable, inject, type Provider } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { CMS_PDF_IMAGE_PICKER, type CmsPdfImagePicker } from '@coolms/pdf-angular';
import {
    MediaPickerHostComponent, MediaPickerHostData, MediaPickerHostResult,
} from '../media-picker-host.component';
import { MediaService } from '../media.service';

/**
 * Fills `CMS_PDF_IMAGE_PICKER` (#2438) so the PDF viewer's image tool opens the Media
 * Library instead of the browser's file dialog. Same dialog the editor's
 * "Insert media" action uses, so the two flows look and behave alike.
 *
 * Only the single-asset result stamps. A gallery pick has no meaning on a PDF
 * page and a plain-HTML pick is not an image, so both read as a cancel.
 */
@Injectable()
export class MediaPdfImagePicker implements CmsPdfImagePicker {
    private readonly dialog = inject(Dialog);
    private readonly media  = inject(MediaService);
    private readonly http   = inject(HttpClient);

    async pickImage(): Promise<string | null> {
        const data: MediaPickerHostData = {
            options: {
                bindValue:    'uuid',
                bindTarget:   'asset',
                display:      'preset:large',
                accept:       'image/*',
                recentlyUsed: true,
                hoverPreview: true,
            },
            initialMode: 'single',
            // Placement, caption and Insert-as belong to the editor's flow;
            // stamping onto a PDF page uses none of them.
            purpose: 'image',
        };

        const ref = this.dialog.open<MediaPickerHostResult | null>(MediaPickerHostComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        const result = await firstValueFrom(ref.closed);
        if (!result || 'widget' !== result.type) {
            return null;
        }

        const url = result.previewUrl ?? await this.resolveUrl(result.uuid);

        return url ? await this.asDataUrl(url) : null;
    }

    /** The picked asset's best stamping URL when the dialog did not carry one. */
    private async resolveUrl(uuid: string): Promise<string | null> {
        try {
            const asset = await firstValueFrom(this.media.get(uuid));

            return asset.presetUrls?.['large'] ?? asset.originalUrl ?? asset.thumbnailUrl;
        } catch {
            return null;
        }
    }

    /*
     * pdf.js fetches a plain URL with a bare `fetch()`, outside HttpClient, so
     * an asset behind the JWT would come back 401 and the stamp would silently
     * be empty -- the same trap the viewer already documents for the PDF bytes
     * themselves. Reading it here through HttpClient runs `authInterceptor`
     * and hands pdf.js a data URL that needs no credentials at all.
     *
     * ⚠️ Same-origin only. `authInterceptor` attaches the Bearer token to
     * EVERY url it is handed (it exempts only /auth/login and /auth/refresh),
     * so routing a foreign host through HttpClient would post our access token
     * to it. A remote image stays a plain URL for pdf.js to fetch anonymously.
     */
    private async asDataUrl(url: string): Promise<string> {
        if (url.startsWith('data:') || !this.isSameOrigin(url)) {
            return url;
        }

        const blob = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));

        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error(`Cannot read ${url}`));
            reader.readAsDataURL(blob);
        });
    }

    private isSameOrigin(url: string): boolean {
        try {
            return new URL(url, window.location.href).origin === window.location.origin;
        } catch {
            return false;
        }
    }
}

/**
 * Spread into `ApplicationConfig.providers` after `provideCoolmsPdf()`. With
 * this absent the viewer keeps pdf.js's own file dialog, which is what a
 * consumer without a media library wants.
 */
export function provideCoolmsPdfMedia(): Provider[] {
    return [
        MediaPdfImagePicker,
        { provide: CMS_PDF_IMAGE_PICKER, useExisting: MediaPdfImagePicker },
    ];
}
