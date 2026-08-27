import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * RFC 7807 payload that the backend's `TemplateNameConflictListener`
 * returns on a 409 upload collision. The `existing` member carries
 * the colliding template's identifiers so the Replace flow can be
 * launched without a second backend round-trip; `suggestedName` is
 * a pre-computed non-colliding filename the user can accept or edit.
 */
export interface TemplateNameConflictPayload {
    readonly type:          string;
    readonly title:         string;
    readonly status:        409;
    readonly detail:        string;
    readonly existing:      {
        readonly id:   string;
        readonly name: string;
        readonly slug: string;
        readonly path: string;
    };
    readonly suggestedName: string;
    readonly folderPath:    string;
}

/**
 * Data injected into TemplateConflictDialogComponent. `proposedFile`
 * is the user's original upload; the dialog hands it back unchanged
 * for the Replace path or wraps it in a renamed `File` for Save-as.
 */
export interface TemplateConflictDialogData {
    readonly existing:      TemplateNameConflictPayload['existing'];
    readonly suggestedName: string;
    readonly proposedFile:  File;
    readonly folderPath:    string;
}

/**
 * What the dialog hands back when closed. `cancel` (or backdrop /
 * ESC, which closes with `null`) leaves the original upload aborted.
 * `replace` redirects the caller to the Replace flow against the
 * existing template id. `save-as` carries the user-chosen filename
 * (which may itself collide — the caller retries and the recursion
 * terminates when the user picks a free name or cancels).
 */
export interface TemplateConflictDialogResult {
    readonly action:  'replace' | 'save-as' | 'cancel';
    readonly newName: string | null;
}

@Component({
    selector: 'cms-template-conflict-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog cms-template-conflict-dialog">
            <header class="cms-template-conflict-dialog__header">
                <i class="bi bi-exclamation-triangle-fill cms-template-conflict-dialog__icon"></i>
                <h3 class="cms-template-conflict-dialog__title">Template name already exists</h3>
            </header>

            <div class="cms-template-conflict-dialog__body">
                <p class="cms-template-conflict-dialog__intro">
                    A template named <strong>{{ data.existing.name }}</strong> already exists in
                    <code>{{ data.folderPath }}</code>. Choose how you'd like to proceed:
                </p>

                <ol class="cms-template-conflict-dialog__options">
                    <li>
                        <button type="button"
                                class="cms-template-conflict-dialog__option"
                                [class.cms-template-conflict-dialog__option--active]="action() === 'replace'"
                                (click)="setAction('replace')">
                            <i class="bi bi-arrow-repeat"></i>
                            <span>
                                <strong>Replace existing template</strong>
                                <small>Keep the template's id, slug, and instance history; update the source file with your upload.</small>
                            </span>
                        </button>
                    </li>
                    <li>
                        <button type="button"
                                class="cms-template-conflict-dialog__option"
                                [class.cms-template-conflict-dialog__option--active]="action() === 'save-as'"
                                (click)="setAction('save-as')">
                            <i class="bi bi-pencil-square"></i>
                            <span>
                                <strong>Save with a new name</strong>
                                <small>Create a separate template alongside the existing one.</small>
                            </span>
                        </button>
                        @if (action() === 'save-as') {
                            <label class="cms-template-conflict-dialog__name-field">
                                <span>New filename</span>
                                <input #nameInput
                                       type="text"
                                       [(ngModel)]="newName"
                                       (ngModelChange)="newNameTouched.set(true)"
                                       autocomplete="off"
                                       spellcheck="false" />
                            </label>
                            @if (nameError(); as err) {
                                <p class="cms-template-conflict-dialog__error">{{ err }}</p>
                            }
                        }
                    </li>
                </ol>
            </div>

            <footer class="cms-template-conflict-dialog__footer">
                <button type="button" class="cms-btn" (click)="onCancel()">
                    Cancel
                </button>
                <button type="button"
                        class="cms-btn cms-btn-primary"
                        [disabled]="!canConfirm()"
                        (click)="onConfirm()">
                    {{ confirmLabel() }}
                </button>
            </footer>
        </div>
    `,
    styles: [`
        :host { display: contents; }

        .cms-template-conflict-dialog {
            background: var(--cms-bg-surface, #ffffff);
            border-radius: var(--cms-radius, 8px);
            box-shadow: var(--cms-shadow-modal, 0 12px 32px rgba(0, 0, 0, 0.18));
            display: flex;
            flex-direction: column;
            min-width: min(540px, 95vw);
            max-width: min(640px, 95vw);
        }

        .cms-template-conflict-dialog__header {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 14px 18px;
            border-bottom: 1px solid var(--cms-border-light, #e5e7eb);
        }
        .cms-template-conflict-dialog__icon { color: #f59e0b; font-size: 1.25rem; }
        .cms-template-conflict-dialog__title { margin: 0; font-size: 1rem; font-weight: 600; color: var(--cms-text, #111827); }

        .cms-template-conflict-dialog__body { padding: 18px; display: flex; flex-direction: column; gap: 14px; }

        .cms-template-conflict-dialog__intro {
            margin: 0;
            font-size: 0.875rem;
            line-height: 1.5;
            color: var(--cms-text, #111827);
        }
        .cms-template-conflict-dialog__intro code {
            background: var(--cms-bg-muted, #f3f4f6);
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 0.825em;
        }

        .cms-template-conflict-dialog__options {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .cms-template-conflict-dialog__option {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            width: 100%;
            text-align: left;
            padding: 10px 12px;
            border-radius: var(--cms-radius-sm, 6px);
            border: 1.5px solid var(--cms-border, #e5e7eb);
            background: transparent;
            cursor: pointer;
            transition: border-color .12s, background .12s;
        }
        .cms-template-conflict-dialog__option:hover {
            border-color: var(--cms-border-strong, #d1d5db);
        }
        .cms-template-conflict-dialog__option--active {
            border-color: var(--cms-accent, #3b82f6);
            background: var(--cms-accent-light, #eff6ff);
        }
        .cms-template-conflict-dialog__option i { font-size: 1rem; color: var(--cms-text-secondary); padding-top: 2px; }
        .cms-template-conflict-dialog__option--active i { color: var(--cms-accent, #3b82f6); }
        .cms-template-conflict-dialog__option strong {
            display: block;
            font-size: 0.875rem;
            color: var(--cms-text, #111827);
            margin-bottom: 2px;
        }
        .cms-template-conflict-dialog__option small {
            display: block;
            font-size: 0.75rem;
            color: var(--cms-text-muted, #6b7280);
            line-height: 1.4;
        }

        .cms-template-conflict-dialog__name-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 8px 12px 0 36px;
        }
        .cms-template-conflict-dialog__name-field span {
            font-size: 0.75rem;
            color: var(--cms-text-muted, #6b7280);
            font-weight: 500;
        }
        .cms-template-conflict-dialog__name-field input {
            padding: 6px 10px;
            border: 1px solid var(--cms-border, #d1d5db);
            border-radius: var(--cms-radius-sm, 6px);
            font: inherit;
            font-size: 0.875rem;
        }
        .cms-template-conflict-dialog__name-field input:focus {
            border-color: var(--cms-accent, #3b82f6);
            outline: 2px solid var(--cms-accent-light, #dbeafe);
            outline-offset: -1px;
        }

        .cms-template-conflict-dialog__error {
            margin: 4px 0 0 36px;
            font-size: 0.75rem;
            color: var(--cms-danger, #dc2626);
        }

        .cms-template-conflict-dialog__footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 12px 18px;
            border-top: 1px solid var(--cms-border-light, #e5e7eb);
        }
    `],
})
export class TemplateConflictDialogComponent {
    private readonly dialogRef = inject<DialogRef<TemplateConflictDialogResult | null>>(DialogRef);
    protected  readonly data = inject<TemplateConflictDialogData>(DIALOG_DATA);

    protected readonly action = signal<'replace' | 'save-as'>('save-as');
    protected newName = this.data.suggestedName;
    protected readonly newNameTouched = signal(false);

    protected readonly nameError = computed<string | null>(() => {
        if (this.action() !== 'save-as') return null;
        if (!this.newNameTouched()) return null;
        const trimmed = this.newName.trim();
        if (trimmed.length === 0) return 'Filename is required.';
        if (trimmed === this.data.existing.name) {
            return 'New name must differ from the existing template.';
        }
        return null;
    });

    protected readonly canConfirm = computed<boolean>(() => {
        if (this.action() === 'replace') return true;
        const trimmed = this.newName.trim();
        return trimmed.length > 0 && trimmed !== this.data.existing.name;
    });

    protected readonly confirmLabel = computed<string>(() =>
        this.action() === 'replace' ? 'Replace template' : 'Save with new name',
    );

    protected setAction(action: 'replace' | 'save-as'): void {
        this.action.set(action);
    }

    protected onCancel(): void {
        this.dialogRef.close({ action: 'cancel', newName: null });
    }

    protected onConfirm(): void {
        if (!this.canConfirm()) return;
        if (this.action() === 'replace') {
            this.dialogRef.close({ action: 'replace', newName: null });
            return;
        }
        this.dialogRef.close({ action: 'save-as', newName: this.newName.trim() });
    }
}
