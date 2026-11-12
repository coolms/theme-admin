import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

/** The image to show: an object URL of the downloaded bytes, the file name and the kind detected. */
export interface AttachmentImagePreviewData {
    readonly url: string;
    readonly filename: string;
    readonly kind: string;
}

/**
 * A message's image attachment in a preview over the page: one `<img>` from an object URL, nothing else rendered.
 * The header names the file and the kind detected. A CDK dialog: focus stays inside while it is open, Escape closes
 * it, and focus goes back to the View button. The opener revokes the URL when it closes.
 */
@Component({
    selector: 'app-attachment-image-preview',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="aip">
            <div class="aip__head">
                <h2 class="aip__title" [title]="data.filename">
                    <span class="aip__name">{{ data.filename }}</span>
                    <span class="aip__kind" data-test="image-preview-kind">{{ data.kind }}</span>
                </h2>
                <button type="button" class="cms-dialog-close" data-test="image-preview-close" aria-label="Close" (click)="close()">
                    <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
            </div>
            <div class="aip__body">
                <img class="aip__img" data-test="image-preview-img" [src]="data.url" [alt]="data.filename" />
            </div>
        </div>
    `,
    styles: [`
        :host { display: flex; min-width: 0; min-height: 0; }
        .aip {
            display: flex; flex-direction: column; min-width: 0; min-height: 0;
            width: min(95vw, 1400px); max-height: 92vh;
            background: var(--cms-surface); color: var(--cms-text);
            border-radius: var(--cms-radius); overflow: hidden;
        }
        .aip__head {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 16px; border-bottom: 1px solid var(--cms-border);
        }
        .aip__title {
            display: flex; align-items: baseline; gap: 8px;
            flex: 1 1 auto; min-width: 0; margin: 0; font-size: 1rem; font-weight: 600;
        }
        .aip__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .aip__kind { flex: 0 0 auto; font-size: .8125rem; font-weight: 400; color: var(--cms-text-muted); }
        .aip__body {
            flex: 1; min-height: 0; overflow: auto; padding: 16px;
            display: flex; align-items: center; justify-content: center;
        }
        .aip__img { display: block; max-width: 100%; max-height: calc(92vh - 96px); object-fit: contain; }
    `],
})
export class AttachmentImagePreviewComponent {
    protected readonly data = inject<AttachmentImagePreviewData>(DIALOG_DATA);
    private readonly ref = inject<DialogRef<void>>(DialogRef);

    close(): void {
        this.ref.close();
    }
}
