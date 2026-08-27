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

import {
    CmsTreePickerComponent,
    ModalComponent,
    NaviGraphTreeSource,
    ToastService,
    type CmsTreePickerSelection,
} from '@coolms/ui-angular';
import {
    NotificationApiService,
    type NotificationBodyFormat,
    type NotificationLink,
    type NotificationType,
    type SendTestRequest,
} from './notification-api.service';

const TITLE_MAX_LENGTH = 200;

const BODY_MAX_LENGTH = 2000;

/**
 * Ship B.6 -- modal form for composing a self-targeted notification.
 * Replaces the synchronous hardcoded-body POST that the Centrifugo
 * dashboard's "Send test notification to me" header action used to
 * fire directly. Recipient is always the authenticated user; the
 * backend dispatcher's `dispatchToUser` enforces that on the
 * server side.
 *
 * Fields: type (preset enum dropdown via `listTypes()`), title
 * (required, max 200), body (optional, max 2000), link (optional
 * `NotificationLink`, sourced from `navi.admin` via the generic
 * `cms-tree-picker` + `NaviGraphTreeSource` adapter from B.X.2).
 *
 * Standard CDK Dialog semantics: backdrop click, Escape, and the
 * `app-modal` close button all dispose the dialog with a null
 * result. Successful submit closes with `true` so callers can
 * chain on success.
 */
@Component({
    selector: 'app-send-notification-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ModalComponent, CmsTreePickerComponent],
    providers: [NaviGraphTreeSource],
    template: `
        <app-modal title="Send notification to me" style="width:560px; max-width:90vw">
            <form class="cms-send-dialog" (submit)="$event.preventDefault(); submit()">
                <div class="cms-send-dialog__field">
                    <label for="cms-send-type">Type</label>
                    <select
                        id="cms-send-type"
                        name="type"
                        [ngModel]="type()"
                        (ngModelChange)="type.set($event)"
                    >
                        @for (t of types(); track t.value) {
                            <option [value]="t.value">{{ t.label }}</option>
                        }
                    </select>
                </div>

                <div class="cms-send-dialog__field">
                    <label for="cms-send-title">
                        Title <span class="cms-send-dialog__required">*</span>
                    </label>
                    <input
                        id="cms-send-title"
                        type="text"
                        name="title"
                        autocomplete="off"
                        [attr.maxlength]="titleMaxLength"
                        [ngModel]="title()"
                        (ngModelChange)="title.set($event)"
                    />
                    @if (titleError()) {
                        <small class="cms-send-dialog__error">{{ titleError() }}</small>
                    }
                </div>

                <div class="cms-send-dialog__field">
                    <label for="cms-send-body">Body</label>
                    <textarea
                        id="cms-send-body"
                        name="body"
                        rows="4"
                        [attr.maxlength]="bodyMaxLength"
                        [ngModel]="body()"
                        (ngModelChange)="body.set($event)"
                    ></textarea>
                </div>

                @if (hasBody()) {
                    <div class="cms-send-dialog__field">
                        <label for="cms-send-body-format">Format</label>
                        <select
                            id="cms-send-body-format"
                            name="bodyFormat"
                            [ngModel]="bodyFormat()"
                            (ngModelChange)="bodyFormat.set($event)"
                        >
                            @for (f of bodyFormats(); track f.value) {
                                <option [value]="f.value">{{ f.label }}</option>
                            }
                        </select>
                    </div>
                }

                <div class="cms-send-dialog__field">
                    <label>Link</label>
                    <cms-tree-picker
                        [source]="naviSource"
                        placeholder="No route selected"
                        (valueChange)="onLinkPicked($event)"
                    />
                </div>

                <div class="cms-send-dialog__actions">
                    <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                    <button
                        type="submit"
                        class="cms-btn cms-btn-primary"
                        [disabled]="!canSubmit() || sending()"
                    >
                        <i class="bi bi-send"></i>
                        {{ sending() ? 'Sending…' : 'Send to me' }}
                    </button>
                </div>
            </form>
        </app-modal>
    `,
    styles: [`
        .cms-send-dialog {
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        .cms-send-dialog__field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .cms-send-dialog__field label {
            font-size: .8125rem;
            font-weight: 500;
            color: var(--cms-text);
        }
        .cms-send-dialog__required { color: var(--cms-danger, #b91c1c); }
        .cms-send-dialog__field input,
        .cms-send-dialog__field select,
        .cms-send-dialog__field textarea {
            padding: 6px 10px;
            font-size: .875rem;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            background: var(--cms-input-bg, #fff);
            color: var(--cms-text);
            font-family: inherit;
        }
        .cms-send-dialog__field textarea { resize: vertical; min-height: 80px; }
        .cms-send-dialog__error {
            color: var(--cms-danger, #b91c1c);
            font-size: .75rem;
        }
        .cms-send-dialog__actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 4px;
        }
        /* Kit shadows removed (#2030) — a token-for-token restatement of the
           kit's own button, down to the same --cms-btn-* variables. */
    `],
})
export class SendNotificationDialogComponent {
    protected readonly titleMaxLength = TITLE_MAX_LENGTH;
    protected readonly bodyMaxLength = BODY_MAX_LENGTH;

    protected readonly type = signal<string>('manual');
    protected readonly title = signal<string>('');
    protected readonly body = signal<string>('');
    protected readonly bodyFormat = signal<string>('plain');
    protected readonly link = signal<NotificationLink | null>(null);
    protected readonly sending = signal<boolean>(false);
    protected readonly types = signal<NotificationType[]>([
        { value: 'manual', label: 'Manual' },
    ]);
    protected readonly bodyFormats = signal<NotificationBodyFormat[]>([
        { value: 'plain', label: 'Plain text' },
        { value: 'markdown', label: 'Markdown' },
        { value: 'dtmpl', label: 'DTMPL' },
    ]);

    protected readonly hasBody = computed<boolean>(() => this.body().trim().length > 0);

    protected readonly titleError = computed<string | null>(() => {
        const t = this.title().trim();
        if (t.length === 0) {
            return 'Title is required';
        }
        if (t.length > TITLE_MAX_LENGTH) {
            return `Title exceeds ${TITLE_MAX_LENGTH} characters`;
        }
        return null;
    });

    protected readonly canSubmit = computed<boolean>(() => this.titleError() === null);

    private readonly api = inject(NotificationApiService);
    private readonly toast = inject(ToastService);
    private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * Provider-scoped NaviGraph adapter for the route picker.
     * Bound to `navi.admin` in the constructor; the picker calls
     * `loadAll` lazily on first open.
     */
    protected readonly naviSource = inject(NaviGraphTreeSource);

    constructor() {
        this.naviSource.treeSlug = 'navi.admin';

        this.api.listTypes()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (types) => {
                    if (types.length > 0) {
                        this.types.set(types);
                    }
                },
                error: () => {
                    // Fallback already set in the signal initializer keeps
                    // the dropdown functional when the lookup endpoint is
                    // unreachable.
                },
            });

        this.api.listBodyFormats()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (formats) => {
                    if (formats.length > 0) {
                        this.bodyFormats.set(formats);
                    }
                },
                error: () => {
                    // Fallback already in the signal initializer.
                },
            });
    }

    protected submit(): void {
        if (!this.canSubmit() || this.sending()) {
            return;
        }
        this.sending.set(true);

        const payload: SendTestRequest = {
            type: this.type(),
            title: this.title().trim(),
        };
        const bodyValue = this.body().trim();
        if (bodyValue.length > 0) {
            payload.body = bodyValue;
            const fmt = this.bodyFormat();
            // Storage optimization: only send `bodyFormat` when
            // non-default. The backend's absence-implies-plain rule
            // keeps every default row's extras compact.
            if (fmt !== 'plain') {
                payload.bodyFormat = fmt;
            }
        }
        const linkValue = this.link();
        if (linkValue !== null) {
            payload.link = linkValue;
        }

        this.api.sendTest(payload)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.toast.success('Notification sent.');
                    this.dialogRef.close(true);
                },
                error: (err: Error) => {
                    this.sending.set(false);
                    this.toast.error(err.message || 'Failed to send notification.');
                },
            });
    }

    protected cancel(): void {
        this.dialogRef.close(false);
    }

    /**
     * Map the picker's `CmsTreePickerSelection` into the
     * `NotificationLink` shape the backend expects. Null clears the
     * link. The adapter populates `node.data.href` only on
     * selectable leaves, so absence narrows to a clear-equivalent.
     */
    protected onLinkPicked(selection: CmsTreePickerSelection<{ href: string }> | null): void {
        if (selection === null || !selection.node.data) {
            this.link.set(null);
            return;
        }
        this.link.set({
            kind: 'route',
            href: selection.node.data.href,
            target: null,
        });
    }
}
