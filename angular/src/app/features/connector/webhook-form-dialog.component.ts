import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ModalComponent } from '@coolms/ui-angular';
import { WebhookService } from './webhook.service';
import { WebhookMode, WebhookTriggerDto } from './webhook.types';

export interface WebhookFormDialogData {
    /** When present the dialog edits this trigger (PATCH); otherwise it creates (POST). */
    readonly trigger?: WebhookTriggerDto;
}

/**
 * FE — create / edit modal for an inbound webhook trigger.
 *
 * Closes with the saved {@link WebhookTriggerDto} (the create response carries the
 * one-time `secret`, which the list page reveals); closes with `null` on cancel.
 * Mode-conditional fields: `start` needs a definition key; `correlate` needs a
 * message name + correlation-key path. `variableMap` is edited as `path = var`
 * lines (empty = pass the whole payload).
 */
@Component({
    selector: 'app-webhook-form-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule],
    template: `
        <app-modal [title]="isEdit ? 'Edit Webhook' : 'New Webhook'">
            <div class="fields">
                <div>
                    <label class="cms-label">Slug</label>
                    <input class="cms-input" type="text"
                           [(ngModel)]="slug"
                           [disabled]="isEdit"
                           placeholder="e.g. github-push"
                           autofocus />
                    <div class="cms-field-hint">
                        URL-safe id — the public endpoint is <code>/api/webhooks/&lt;slug&gt;</code>. Cannot change after creation.
                    </div>
                </div>

                <div>
                    <label class="cms-label">Label</label>
                    <input class="cms-input" type="text" [(ngModel)]="label" placeholder="GitHub push" />
                </div>

                <div>
                    <label class="cms-label">Mode</label>
                    <select class="cms-select" [(ngModel)]="mode">
                        <option value="start">Start a workflow</option>
                        <option value="correlate">Correlate a message</option>
                    </select>
                </div>

                @if (mode === 'start') {
                    <div>
                        <label class="cms-label">Definition key</label>
                        <input class="cms-input" type="text" [(ngModel)]="definitionKey"
                               placeholder="e.g. orders.fulfil" />
                        <div class="cms-field-hint">The deployed workflow definition to start.</div>
                    </div>
                } @else {
                    <div>
                        <label class="cms-label">Message name</label>
                        <input class="cms-input" type="text" [(ngModel)]="messageName"
                               placeholder="e.g. PaymentReceived" />
                    </div>
                    <div>
                        <label class="cms-label">Correlation key path</label>
                        <input class="cms-input" type="text" [(ngModel)]="correlationKeyPath"
                               placeholder="e.g. data.orderId" />
                        <div class="cms-field-hint">Dot-path into the payload yielding the correlation key.</div>
                    </div>
                }

                <div>
                    <label class="cms-label">Variable map</label>
                    <textarea class="cms-input" rows="3" [(ngModel)]="variableMapText"
                              placeholder="data.orderId = orderId&#10;data.amount = amount"></textarea>
                    <div class="cms-field-hint">
                        One <code>payloadPath = variableName</code> per line. Leave blank to pass the whole payload.
                    </div>
                </div>

                <label class="cms-check">
                    <input type="checkbox" [(ngModel)]="enabled" />
                    <span>Enabled</span>
                </label>

                @if (error()) {
                    <p class="error">{{ error() }}</p>
                }
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="submitting()"
                        (click)="submit()">
                    {{ submitting() ? 'Saving…' : (isEdit ? 'Save' : 'Create') }}
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .fields { display: flex; flex-direction: column; gap: 14px; }
        .error { color: var(--cms-danger-text, #991b1b); margin: 0; font-size: .8125rem; }
        .cms-check { display: flex; align-items: center; gap: 8px; font-size: .875rem; cursor: pointer; }
        textarea.cms-input { resize: vertical; font-family: var(--cms-font-mono, monospace); }
        code { word-break: break-all; }
    `],
})
export class WebhookFormDialogComponent implements OnInit {
    private readonly service    = inject(WebhookService);
    private readonly errors     = inject(ErrorHandlerService);
    readonly dialogRef          = inject<DialogRef<WebhookTriggerDto | null>>(DialogRef);
    private readonly destroyRef = inject(DestroyRef);
    private readonly data       = inject<WebhookFormDialogData | null>(DIALOG_DATA, { optional: true });

    readonly isEdit = this.data?.trigger != null;

    slug = '';
    label = '';
    mode: WebhookMode = 'start';
    definitionKey = '';
    messageName = '';
    correlationKeyPath = '';
    variableMapText = '';
    enabled = true;

    readonly submitting = signal(false);
    readonly error      = signal<string | null>(null);

    ngOnInit(): void {
        const t = this.data?.trigger;
        if (!t) {
            return;
        }
        this.slug = t.slug ?? '';
        this.label = t.label ?? '';
        this.mode = t.mode ?? 'start';
        this.definitionKey = t.definitionKey ?? '';
        this.messageName = t.messageName ?? '';
        this.correlationKeyPath = t.correlationKeyPath ?? '';
        this.variableMapText = this.serializeMap(t.variableMap ?? {});
        this.enabled = t.enabled ?? true;
    }

    cancel(): void {
        this.dialogRef.close(null);
    }

    submit(): void {
        const slug = this.slug.trim();
        const label = this.label.trim();
        if (!this.isEdit && slug === '') {
            this.error.set('Slug is required.');
            return;
        }
        if (label === '') {
            this.error.set('Label is required.');
            return;
        }
        if (this.mode === 'start' && this.definitionKey.trim() === '') {
            this.error.set('A "start" webhook needs a definition key.');
            return;
        }
        if (this.mode === 'correlate'
            && (this.messageName.trim() === '' || this.correlationKeyPath.trim() === '')) {
            this.error.set('A "correlate" webhook needs a message name and correlation-key path.');
            return;
        }

        const payload: Partial<WebhookTriggerDto> = {
            label,
            mode: this.mode,
            enabled: this.enabled,
            variableMap: this.parseMap(this.variableMapText),
            definitionKey: this.mode === 'start' ? this.definitionKey.trim() : '',
            messageName: this.mode === 'correlate' ? this.messageName.trim() : null,
            correlationKeyPath: this.mode === 'correlate' ? this.correlationKeyPath.trim() : null,
        };

        this.submitting.set(true);
        this.error.set(null);

        const request$ = this.isEdit
            ? this.service.update(this.data!.trigger!.slug!, payload)
            : this.service.create({ ...payload, slug });

        request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: saved => {
                this.submitting.set(false);
                this.dialogRef.close(saved);
            },
            error: (e: unknown) => {
                this.submitting.set(false);
                this.error.set(this.errors.humanize(e));
            },
        });
    }

    /** `{a:b, c:d}` -> "a = b\nc = d". */
    private serializeMap(map: Record<string, string>): string {
        return Object.entries(map).map(([k, v]) => `${k} = ${v}`).join('\n');
    }

    /** "a = b\nc=d" -> `{a:b, c:d}` (skips blank/malformed lines). */
    private parseMap(text: string): Record<string, string> {
        const out: Record<string, string> = {};
        for (const line of text.split('\n')) {
            const eq = line.indexOf('=');
            if (eq < 0) {
                continue;
            }
            const key = line.slice(0, eq).trim();
            const value = line.slice(eq + 1).trim();
            if (key !== '' && value !== '') {
                out[key] = value;
            }
        }
        return out;
    }
}
