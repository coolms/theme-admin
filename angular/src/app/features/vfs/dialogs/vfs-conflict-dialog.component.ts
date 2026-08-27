import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ModalComponent, TokenDef, TokenInputComponent } from '@coolms/ui-angular';

export type ConflictAction = 'overwrite' | 'skip' | 'rename';

export interface ConflictResult {
    action:     ConflictAction;
    pattern:    string | null; // only set for 'rename' action
    applyToAll: boolean;
}

/** Data passed in by the opener via CDK `Dialog.open(..., { data })`. */
export interface ConflictDialogData {
    sourcePath: string;
}

/**
 * A3 dialog convergence: VFS "File already exists" (paste/move conflict)
 * dialog now renders the platform `<app-modal>` chrome instead of a bespoke
 * native `<dialog>`. Opened via CDK `Dialog.open()` (data in via DIALOG_DATA,
 * result out via DialogRef). Unlike the 2-button dialogs this one offers 3
 * actions (overwrite / skip / rename-with-pattern) + an "apply to all" toggle;
 * the footer keeps the Cancel/Apply pair while the actions live as selectable
 * cards in the body. Closing via Apply returns the `ConflictResult`; Cancel /
 * X / backdrop / Esc return null (the opener treats null as "skip").
 */
@Component({
    selector: 'app-vfs-conflict-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, TokenInputComponent, ModalComponent],
    template: `
        <app-modal title="File already exists" [width]="520">
            <p style="margin:0 0 12px">
                <strong>{{ filename() }}</strong> already exists at the target location.
                What would you like to do?
            </p>

            <!-- Action selection -->
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
                <label class="conflict-card" [class.conflict-card--active]="action === 'overwrite'">
                    <input type="radio" [(ngModel)]="action" value="overwrite" style="display:none" />
                    <i class="bi bi-arrow-repeat conflict-card-icon"></i>
                    <div>
                        <div class="conflict-card-title">Overwrite</div>
                        <div class="conflict-card-desc">Replace the existing file</div>
                    </div>
                </label>

                <label class="conflict-card" [class.conflict-card--active]="action === 'skip'">
                    <input type="radio" [(ngModel)]="action" value="skip" style="display:none" />
                    <i class="bi bi-skip-forward conflict-card-icon"></i>
                    <div>
                        <div class="conflict-card-title">Skip</div>
                        <div class="conflict-card-desc">Keep the existing file, do not copy</div>
                    </div>
                </label>

                <label class="conflict-card" [class.conflict-card--active]="action === 'rename'">
                    <input type="radio" [(ngModel)]="action" value="rename" style="display:none" />
                    <i class="bi bi-pencil conflict-card-icon"></i>
                    <div>
                        <div class="conflict-card-title">Rename</div>
                        <div class="conflict-card-desc">Save with a different name using a pattern</div>
                    </div>
                </label>
            </div>

            <!-- Token pattern input (visible when rename is selected) -->
            @if (action === 'rename') {
                <div class="rename-panel">
                    <div class="rename-panel-label">Name pattern:</div>
                    <app-token-input
                        [(ngModel)]="renamePattern"
                        [tokens]="tokens"
                        [separators]="['-', '_', '.', '(', ')']"
                        placeholder="e.g. {const:basename}_{const:counter}" />
                </div>
            }

            <!-- Apply to all remaining conflicts -->
            <label class="chk-row" style="margin-top:12px"
                   (click)="applyToAll = !applyToAll">
                <span class="cms-checkbox"
                      [class.cms-checkbox--checked]="applyToAll">
                    <i class="bi bi-check"></i>
                </span>
                Apply this action to all remaining conflicts
            </label>

            <div footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary" (click)="confirm()">Apply</button>
            </div>
        </app-modal>
    `,
    styles: [`
        .conflict-card {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            border-radius: 6px;
            border: 1.5px solid var(--cms-border, #e5e7eb);
            cursor: pointer;
            transition: border-color .12s, background .12s;
        }
        .conflict-card--active {
            border-color: var(--cms-accent, #3b82f6);
            background: var(--cms-accent-light, #eff6ff);
        }
        .conflict-card-icon { font-size: 1rem; color: var(--cms-text-secondary, #6b7280); flex-shrink: 0; width: 20px; text-align: center; }
        .conflict-card--active .conflict-card-icon { color: var(--cms-accent, #3b82f6); }
        .conflict-card-title { font-size: .875rem; font-weight: 600; color: var(--cms-text, #111827); }
        .conflict-card-desc  { font-size: .75rem; color: var(--cms-text-secondary, #6b7280); }

        .rename-panel       { padding: 10px 12px; border-radius: 6px; background: var(--cms-bg-subtle, #f8f9fa); margin-bottom: 4px; border: 1px solid var(--cms-border, #e5e7eb); }
        .rename-panel-label { font-size: .8rem; font-weight: 600; margin-bottom: 6px; color: var(--cms-text, #374151); }
        .chk-row            { display: flex; align-items: center; gap: 8px; font-size: .875rem; color: var(--cms-text, #374151); cursor: pointer; user-select: none; }
    `],
})
export class VfsConflictDialogComponent {
    private readonly dialogRef = inject<DialogRef<ConflictResult | null>>(DialogRef);
    readonly data = inject<ConflictDialogData>(DIALOG_DATA);

    filename = computed(() => this.data.sourcePath.split('/').at(-1) ?? '');

    action        = 'skip' as ConflictAction;
    renamePattern = this.defaultRenamePattern();
    applyToAll    = false;

    readonly tokens: TokenDef[] = [
        { id: 'basename', label: 'Name',    example: 'report' },
        { id: 'counter',  label: 'Counter', example: '1' },
        { id: 'date',     label: 'Date',    example: '2026-03-16' },
        { id: 'random',   label: 'Random',  example: 'a3f9' },
    ];

    private defaultRenamePattern(): string {
        const name = this.data.sourcePath.split('/').at(-1) ?? '';
        const ext  = name.includes('.') ? '.' + name.split('.').at(-1) : '';
        return `{const:basename}_{const:counter}${ext}`;
    }

    confirm(): void {
        this.dialogRef.close({
            action:     this.action,
            pattern:    this.action === 'rename' ? this.renamePattern : null,
            applyToAll: this.applyToAll,
        });
    }

    cancel(): void {
        this.dialogRef.close(null);
    }
}
