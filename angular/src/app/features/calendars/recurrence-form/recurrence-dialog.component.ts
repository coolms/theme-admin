import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';

import { ModalComponent } from '@coolms/ui-angular';
import { RecurrenceFormComponent } from './recurrence-form.component';

export interface RecurrenceDialogData {
    /** Initial RFC 5545 spec. `null` opens the form in "Doesn't repeat" mode. */
    value:   string | null;
    /** Anchor instant. ISO 8601 with offset. Required by the form for preview + defaults. */
    dtstart: string;
    /** Optional named TZ for preview emission. */
    tz:      string | null;
    /** Read-only mode. */
    disabled?: boolean;
}

/**
 * `RecurrenceDialogResult`:
 * - `string` -> the new spec was saved.
 * - `null`   -> the user explicitly set "Doesn't repeat" and saved.
 * - `undefined` -> the user cancelled (no change).
 *
 * The undefined / null distinction matters: the editor's `recurrenceSpec`
 * signal already holds a value; only an explicit save should overwrite it.
 */
export type RecurrenceDialogResult = string | null | undefined;

/**
 * Sub-dialog hosting the full `<app-recurrence-form>`. Opened from the
 * event editor when the user picks "Custom…" in the Repeats dropdown
 * (or "Edit recurrence" on a non-preset spec). Keeps the main editor
 * compact while giving the structured form the breathing room it needs.
 *
 * The form's working draft is held in a local signal so cancelling the
 * dialog discards changes without rippling into the main editor.
 */
@Component({
    selector: 'app-recurrence-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, RecurrenceFormComponent],
    template: `
        <app-modal title="Edit recurrence">
            <app-recurrence-form
                [value]="draft()"
                [dtstart]="data.dtstart"
                [tz]="data.tz"
                [disabled]="!!data.disabled"
                [allowNone]="false"
                (valueChange)="draft.set($event)" />

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="onCancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="data.disabled"
                        (click)="onSave()">Done</button>
            </ng-container>
        </app-modal>
    `,
})
export class RecurrenceDialogComponent {
    readonly data = inject<RecurrenceDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<RecurrenceDialogResult>>(DialogRef);

    /** Working draft. Mutated by the form's (valueChange); committed by Done. */
    readonly draft = signal<string | null>(this.data.value);

    onCancel(): void {
        // Close with undefined so the caller knows not to apply.
        this.dialogRef.close(undefined);
    }

    onSave(): void {
        this.dialogRef.close(this.draft());
    }
}
