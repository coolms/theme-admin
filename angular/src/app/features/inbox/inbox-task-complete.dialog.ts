import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';

import { DynamicFormComponent, ModalComponent } from '@coolms/ui-angular';
import { InboxTaskDto } from './inbox.types';

/** Data passed in by the consumer page. */
export interface CompleteDialogData {
    readonly task: InboxTaskDto;
}

/** Returned via DialogRef.close() on submit; null on cancel. */
export interface CompleteDialogResult {
    readonly formData: Record<string, unknown>;
}

/**
 * M2.m FE — Complete dialog with form-bound rendering.
 *
 * Renders `<app-dynamic-form>` against the task's `formKey` (resolved
 * server-side from the per-instance pinned AST, M2.m Phase 1). The
 * dynamic-form component fetches the form definition from
 * `GET /api/v1/forms/{formKey}/render`, builds a reactive
 * FormGroup from the schema, and emits the submitted value through
 * `(submitted)` on validation pass.
 *
 * **Fallback**: when `formKey` is null (AST unavailable -- missing
 * instance, pinned Node gone, or activity no longer a UserTask), the
 * dialog drops to a raw-JSON `formData` textarea. The body is parsed
 * client-side before posting so the backend always sees a parsed
 * object, never a string. Keeps the inbox usable even if a process
 * gets into a half-broken state.
 */
@Component({
    selector: 'coolms-inbox-task-complete-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, DynamicFormComponent, FormsModule],
    styles: [`
        .inbox-ctx { margin: 0 0 14px; padding: 10px 12px; border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-md, 8px); background: var(--cms-canvas, #f3f4f6); }
        .inbox-ctx__title { font-size: .72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--cms-text-muted, #848b96); margin-bottom: 6px; }
        .inbox-ctx__row { display: flex; gap: 10px; padding: 2px 0; font-size: .85rem; }
        .inbox-ctx__label { flex: 0 0 84px; color: var(--cms-text-muted, #848b96); }
        .inbox-ctx__value { flex: 1 1 auto; color: var(--cms-text, #111827); word-break: break-word; }
    `],
    template: `
        <app-modal [title]="modalTitle()" [width]="520">
            <!--
                Omnichannel convergence: a read-only "context card" projected from
                the owning process's variables (name / email / phone / channel …),
                so the agent sees WHO this task is about while dispositioning it.
            -->
            @if (task.context?.length) {
                <div class="inbox-ctx">
                    <div class="inbox-ctx__title">Contact</div>
                    @for (f of task.context; track f.label) {
                        <div class="inbox-ctx__row">
                            <span class="inbox-ctx__label">{{ f.label }}</span>
                            <span class="inbox-ctx__value">{{ f.value }}</span>
                        </div>
                    }
                </div>
            }
            @if (task.formKey) {
                <p style="margin: 0 0 12px 0; color: var(--cms-text-muted, #848b96);">
                    Form: <code>{{ task.formKey }}</code>
                </p>
                <app-dynamic-form
                    [formId]="task.formKey"
                    [context]="'edit'"
                    submitLabel="Complete"
                    (submitted)="onFormSubmit($event)"
                    (cancelled)="cancel()" />
            } @else {
                <p style="margin: 0 0 12px 0; color: var(--cms-text-muted, #848b96);">
                    No form binding for this task. Provide <code>formData</code> as JSON.
                </p>
                <textarea
                    rows="8"
                    style="width: 100%; font-family: var(--cms-font-mono, monospace); font-size: 12px;"
                    [(ngModel)]="rawJson"
                    [class.is-invalid]="rawError() !== null"
                    placeholder='{}'></textarea>
                @if (rawError(); as err) {
                    <div style="color: var(--cms-danger); margin-top: 4px;">{{ err }}</div>
                }
            }

            <!--
                Footer lives OUTSIDE the @else as its own single-root-node
                control-flow block. Angular only projects a control-flow block
                into a NAMED ng-content slot ([footer]) when the block has a
                SINGLE projectable root; the previous shape (footer as a second
                root inside @else, alongside the body) tripped NG8011 and
                silently dropped Cancel/Complete into the modal BODY instead of
                the footer bar. A lone-root @if projects correctly.
            -->
            @if (!task.formKey) {
                <ng-container footer>
                    <button type="button"
                            class="cms-btn"
                            (click)="cancel()">
                        Cancel
                    </button>
                    <button type="button"
                            class="cms-btn cms-btn-primary"
                            (click)="submitRaw()">
                        Complete
                    </button>
                </ng-container>
            }
        </app-modal>
    `,
})
export class InboxTaskCompleteDialogComponent {
    readonly data = inject<CompleteDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<CompleteDialogResult | null>>(DialogRef);

    get task(): InboxTaskDto { return this.data.task; }

    readonly modalTitle = computed(() => `Complete task — ${this.task.activityId}`);

    /** Raw-JSON fallback path. */
    rawJson = '{}';
    readonly rawError = signal<string | null>(null);

    onFormSubmit(value: Record<string, unknown>): void {
        this.dialogRef.close({ formData: value });
    }

    submitRaw(): void {
        const trimmed = (this.rawJson ?? '').trim();
        if (trimmed === '') {
            this.dialogRef.close({ formData: {} });
            return;
        }
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                this.rawError.set('formData must be a JSON object.');
                return;
            }
            this.rawError.set(null);
            this.dialogRef.close({ formData: parsed as Record<string, unknown> });
        } catch (e) {
            this.rawError.set('Invalid JSON: ' + (e instanceof Error ? e.message : String(e)));
        }
    }

    cancel(): void {
        this.dialogRef.close(null);
    }
}
