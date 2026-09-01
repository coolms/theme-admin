import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ModalComponent } from '@coolms/ui-angular';

export interface WebhookSecretDialogData {
    readonly slug: string;
    readonly secret: string;
    /** Public receiver URL, shown alongside the secret for convenience. */
    readonly webhookUrl?: string | null;
}

/**
 * M5.d.3 FE — one-time secret reveal. Shown after create + rotate-secret; the
 * secret is never retrievable again from a read endpoint, so the admin must
 * copy it now into the external system that will sign its webhook calls.
 */
@Component({
    selector: 'app-webhook-secret-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent],
    template: `
        <app-modal title="Webhook secret">
            <div class="reveal">
                <p class="reveal__warn">
                    <i class="bi bi-exclamation-triangle"></i>
                    Copy this secret now — it is shown <strong>once</strong> and cannot be retrieved later.
                </p>

                @if (data.webhookUrl) {
                    <div>
                        <label class="cms-label">Endpoint</label>
                        <code class="reveal__code">{{ data.webhookUrl }}</code>
                    </div>
                }

                <div>
                    <label class="cms-label">Shared secret ({{ data.slug }})</label>
                    <code class="reveal__code reveal__code--secret">{{ data.secret }}</code>
                </div>

                <p class="reveal__hint">
                    Sign each request: <code>X-Coolms-Signature: sha256=HMAC-SHA256(body, secret)</code>.
                </p>
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="copy()">
                    <i class="bi" [class.bi-clipboard]="!copied()" [class.bi-clipboard-check]="copied()"></i>
                    {{ copied() ? 'Copied' : 'Copy secret' }}
                </button>
                <button type="button" class="cms-btn cms-btn-primary" (click)="close()">Done</button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .reveal { display: flex; flex-direction: column; gap: 14px; }
        .reveal__warn {
            margin: 0;
            display: flex; align-items: flex-start; gap: 8px;
            color: var(--cms-warning-text, #92400e);
            background: var(--cms-warning-light, #fffbeb);
            border-radius: var(--cms-radius, 6px);
            padding: 10px 12px;
            font-size: .8125rem;
        }
        .reveal__code {
            display: block;
            background: var(--cms-border-light, #f0f2f5);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius, 6px);
            padding: 8px 10px;
            font-size: .8125rem;
            word-break: break-all;
            color: var(--cms-text, #111827);
        }
        .reveal__code--secret { font-weight: 600; }
        .reveal__hint { margin: 0; font-size: .75rem; color: var(--cms-text-secondary, #6b7280); }
        .reveal__hint code { word-break: break-all; }
    `],
})
export class WebhookSecretDialogComponent {
    readonly data = inject<WebhookSecretDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject(DialogRef<void>);

    readonly copied = signal(false);

    copy(): void {
        void navigator.clipboard?.writeText(this.data.secret).then(() => this.copied.set(true));
    }

    close(): void {
        this.dialogRef.close();
    }
}
