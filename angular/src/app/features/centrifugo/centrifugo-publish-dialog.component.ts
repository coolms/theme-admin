import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';

import { CentrifugoAdminService, ModalComponent, ToastService } from '@coolms/ui-angular';

const CHANNEL_REGEX = /^[a-zA-Z0-9._:\-]+$/;

const CHANNEL_MAX_LENGTH = 200;

/**
 * Sub-phase M -- modal-shell version of the debug publish form.
 * Replaces the dedicated `/centrifugo/publish` page with a CDK
 * Dialog opened from the Centrifugo dashboard's existing "Debug
 * publish" header action. Operator context (the dashboard's
 * channels listing, namespaces, node info) stays visible behind
 * the modal instead of being replaced by a route navigation.
 *
 * Channel and payload validation are kept identical to the route
 * version so the form behavior is bit-for-bit equivalent: client-
 * side regex `[a-zA-Z0-9._:-]+` and 200-char cap mirror the
 * backend `ChannelNameValidator`; payload must parse as a JSON
 * object (`{}`-shaped, not arrays or scalars). The backend
 * remains the source of truth and still 400s on its own when
 * client-side checks are bypassed.
 *
 * Standard CDK Dialog semantics: backdrop click, Escape, and the
 * `app-modal` close button all dispose the dialog with a `null`
 * result. Successful submit closes with `true` so a future caller
 * could chain (e.g., open the channel detail page on success).
 */
@Component({
    selector: 'app-centrifugo-publish-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ModalComponent],
    template: `
        <app-modal title="Centrifugo -- Debug publish" style="width:600px; max-width:90vw">
            <div class="cms-cent-publish-dialog">
                <p class="cms-cent-publish-dialog__hint">
                    Send an arbitrary JSON payload onto a Centrifugo channel as the admin
                    user. The publication is synchronous -- a 2xx response means Centrifugo
                    accepted it.
                </p>

                <div class="cms-cent-publish-dialog__field">
                    <label for="cent-publish-channel">Channel</label>
                    <input
                        id="cent-publish-channel"
                        type="text"
                        placeholder="e.g., document.test.smoke"
                        [ngModel]="channel()"
                        (ngModelChange)="channel.set($event)"
                        autocomplete="off"
                    />
                    @if (channelError()) {
                        <small class="cms-cent-publish-dialog__field-error">{{ channelError() }}</small>
                    }
                </div>

                <div class="cms-cent-publish-dialog__field">
                    <label for="cent-publish-payload">Payload (JSON)</label>
                    <textarea
                        id="cent-publish-payload"
                        rows="8"
                        [ngModel]="payload()"
                        (ngModelChange)="payload.set($event)"
                        spellcheck="false"
                    ></textarea>
                    @if (payloadError()) {
                        <small class="cms-cent-publish-dialog__field-error">{{ payloadError() }}</small>
                    }
                </div>

                <div class="cms-cent-publish-dialog__actions">
                    <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                    <button
                        type="button"
                        class="cms-btn cms-btn-primary"
                        (click)="submit()"
                        [disabled]="!canSubmit() || sending()"
                    >
                        <i class="bi bi-send"></i>
                        {{ sending() ? 'Sending…' : 'Send' }}
                    </button>
                </div>
            </div>
        </app-modal>
    `,
    styles: [`
        .cms-cent-publish-dialog {
            display: flex;
            flex-direction: column;
            gap: .75rem;
        }
        .cms-cent-publish-dialog__hint {
            margin: 0;
            color: var(--cms-text-secondary);
            font-size: .85rem;
        }
        .cms-cent-publish-dialog__field { display: flex; flex-direction: column; gap: .25rem; }
        .cms-cent-publish-dialog__field label {
            font-size: .8rem;
            color: var(--cms-text-secondary);
            font-weight: 600;
        }
        .cms-cent-publish-dialog__field input,
        .cms-cent-publish-dialog__field textarea {
            background: var(--cms-bg);
            color: var(--cms-text);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            padding: .4rem .6rem;
            font-family: var(--cms-font-mono, monospace);
            font-size: .85rem;
        }
        .cms-cent-publish-dialog__field textarea { resize: vertical; min-height: 120px; }
        .cms-cent-publish-dialog__field-error {
            color: var(--cms-danger-text);
            font-size: .75rem;
        }
        .cms-cent-publish-dialog__actions {
            display: flex;
            gap: .5rem;
            justify-content: flex-end;
            margin-top: .25rem;
        }
        /* Kit shadows removed (#2030) — this copy re-stated the kit almost
           verbatim, except color: #1a1a1a where the kit reads
           --cms-accent-fg (the same value, but a token that can move). */
    `],
})
export class CentrifugoPublishDialogComponent {
    private readonly admin = inject(CentrifugoAdminService);
    private readonly toast = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);

    protected readonly channel = signal<string>('');
    protected readonly payload = signal<string>('{\n  "hello": "world"\n}');
    protected readonly sending = signal<boolean>(false);

    protected readonly channelError = computed(() => {
        const ch = this.channel().trim();
        if (ch === '') {
            return null;
        }
        if (ch.length > CHANNEL_MAX_LENGTH) {
            return 'Channel name exceeds ' + CHANNEL_MAX_LENGTH + ' characters.';
        }
        if (!CHANNEL_REGEX.test(ch)) {
            return 'Channel name must match [a-zA-Z0-9._:-]+';
        }
        return null;
    });

    protected readonly payloadError = computed(() => {
        const raw = this.payload().trim();
        if (raw === '') {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return 'Payload must be a JSON object (e.g., {"key": "value"}).';
            }
        } catch {
            return 'Payload is not valid JSON.';
        }
        return null;
    });

    protected readonly canSubmit = computed(() => {
        return this.channel().trim() !== ''
            && this.channelError() === null
            && this.payloadError() === null;
    });

    submit(): void {
        if (!this.canSubmit() || this.sending()) {
            return;
        }
        const channel = this.channel().trim();
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(this.payload().trim() || '{}') as Record<string, unknown>;
        } catch {
            this.toast.error('Payload is not valid JSON.');
            return;
        }
        this.sending.set(true);
        this.admin.publish({ channel, payload: parsed })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.sending.set(false);
                    this.toast.success('Publication accepted by Centrifugo.');
                    this.dialogRef.close(true);
                },
                error: (err: Error) => {
                    this.sending.set(false);
                    this.toast.error(err.message ?? 'Failed to publish.');
                },
            });
    }

    cancel(): void {
        this.dialogRef.close(false);
    }
}
