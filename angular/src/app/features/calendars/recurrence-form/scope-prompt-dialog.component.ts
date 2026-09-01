import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ModalComponent } from '@coolms/ui-angular';

/**
 * Phase 2 — scope choice when editing / deleting / dragging an
 * occurrence of a recurring CalendarItem.
 *
 * Three options, matching Google Calendar's wording:
 *  - **only this event** -> backend `POST /exception` (reschedule)
 *    or `POST /skip` (delete)
 *  - **this and following events** -> Phase 3; disabled here with a
 *    "(coming soon)" hint
 *  - **all events** -> backend PATCH or DELETE on the canonical base
 *    row (existing single-row write paths)
 *
 * The dialog returns the chosen scope ('this' | 'following' | 'all')
 * or `undefined` when the user cancels — callers MUST treat undefined
 * as "abort, revert the optimistic UI change".
 */
export type ScopePromptResult = 'this' | 'following' | 'all' | undefined;

export interface ScopePromptDialogData {
    /**
     * Distinguishes save vs delete copy. The dialog labels and the
     * primary action button swap to match. Defaults to 'edit'.
     */
    intent?:    'edit' | 'delete';
    /**
     * Optional title of the event being edited — shown in the prompt
     * body to give the user something concrete to anchor on.
     */
    itemTitle?: string;
}

@Component({
    selector: 'app-scope-prompt-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule],
    template: `
        <app-modal [title]="title()" [width]="420">
            @if (data.itemTitle) {
                <p class="lead">
                    "{{ data.itemTitle }}" is part of a recurring series.
                    Which occurrences should this {{ verb() }} affect?
                </p>
            } @else {
                <p class="lead">
                    This event is part of a recurring series. Which
                    occurrences should this {{ verb() }} affect?
                </p>
            }

            <div class="choices">
                <label class="choice">
                    <input type="radio" name="scope" value="this"
                           [checked]="choice() === 'this'"
                           (change)="choice.set('this')" />
                    <span>
                        <strong>Only this event</strong>
                        <small>Just the {{ instantDay() }} occurrence.</small>
                    </span>
                </label>

                <label class="choice">
                    <input type="radio" name="scope" value="following"
                           [checked]="choice() === 'following'"
                           (change)="choice.set('following')" />
                    <span>
                        <strong>This and following events</strong>
                        <small>Splits the series at this occurrence.</small>
                    </span>
                </label>

                <label class="choice">
                    <input type="radio" name="scope" value="all"
                           [checked]="choice() === 'all'"
                           (change)="choice.set('all')" />
                    <span>
                        <strong>All events</strong>
                        <small>The whole recurring series.</small>
                    </span>
                </label>
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="onCancel()">Cancel</button>
                <button type="button"
                        [class]="primaryClass()"
                        (click)="onConfirm()">{{ primaryLabel() }}</button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .lead {
            margin: 0 0 12px;
            font-size: .875rem;
            color: var(--cms-text, #111827);
        }
        .choices {
            display: flex; flex-direction: column;
            gap: 6px;
        }
        .choice {
            display: flex; align-items: flex-start; gap: 10px;
            padding: 10px 12px;
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius, 6px);
            cursor: pointer;
            transition: background .1s, border-color .1s;
        }
        .choice:hover:not(.choice--disabled) {
            background: var(--cms-btn-hover-bg, #f3f4f6);
            border-color: var(--cms-btn-hover-border, #9ca3af);
        }
        .choice input { margin-top: 2px; }
        .choice span { display: flex; flex-direction: column; gap: 2px; }
        .choice strong { font-size: .8125rem; font-weight: 500; }
        .choice small {
            font-size: .75rem;
            color: var(--cms-text-muted, #848b96);
        }
        .choice--disabled {
            opacity: .55;
            cursor: not-allowed;
        }
    `],
})
export class ScopePromptDialogComponent {
    readonly data = inject<ScopePromptDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<ScopePromptResult>>(DialogRef);

    /**
     * Selected scope. Defaults to 'this' — the least destructive
     * choice (one occurrence only), so a confused user who hits Enter
     * doesn't accidentally edit/delete the entire series.
     */
    readonly choice = signal<'this' | 'following' | 'all'>('this');

    readonly title = computed(() =>
        'delete' === this.data.intent ? 'Delete recurring event' : 'Edit recurring event'
    );

    readonly verb = computed(() =>
        'delete' === this.data.intent ? 'deletion' : 'change'
    );

    readonly primaryLabel = computed(() =>
        'delete' === this.data.intent ? 'Delete' : 'OK'
    );

    readonly primaryClass = computed(() =>
        'delete' === this.data.intent
            ? 'cms-btn cms-btn-danger'
            : 'cms-btn cms-btn-primary'
    );

    /**
     * Human-readable "(Mon, Jun 15)" hint for the "Only this event"
     * label. We don't have the instant here so we just show "selected"
     * — the parent context (the modal title + the lead paragraph) is
     * enough.
     */
    readonly instantDay = computed(() => 'selected');

    onCancel(): void {
        this.dialogRef.close(undefined);
    }

    onConfirm(): void {
        this.dialogRef.close(this.choice());
    }
}
