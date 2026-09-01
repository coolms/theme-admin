import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';

import { CronFormComponent, ModalComponent } from '@coolms/ui-angular';
import { TriggerKindCode } from '../../api/api.service';
import { RecurrenceFormComponent } from '../calendars/recurrence-form/recurrence-form.component';

export interface TriggerSpecDialogData {
    /** Which form to render. */
    kind:    TriggerKindCode;
    /** Initial spec string (cron expression or RFC 5545 spec). */
    value:   string;
    /** Recurrence form needs a DTSTART anchor for preview math. Ignored for cron. */
    dtstart?: string;
    /** Recurrence form's named timezone for preview emission. Ignored for cron. */
    tz?:      string | null;
}

export type TriggerSpecDialogResult = string | undefined;

/**
 * Sub-dialog wrapping &lt;app-cron-form&gt; or &lt;app-recurrence-form&gt;
 * depending on the schedule's trigger kind. Opened from
 * `ScheduleFormDialogComponent`'s "Configure…" button so the New Schedule
 * modal can stay a compact single-column field stack instead of trying
 * to inline the rich structured form.
 *
 * Same shape pattern as `RecurrenceDialogComponent` (which handles the
 * Calendar event editor's preset -> Custom… flow). One dialog, two
 * possible inner forms, picked by `data.kind`.
 */
@Component({
    selector: 'app-trigger-spec-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, CronFormComponent, RecurrenceFormComponent],
    template: `
        <app-modal [title]="title()">
            @if (data.kind === 'cron') {
                <app-cron-form
                    [value]="draft()"
                    (valueChange)="draft.set($event)" />
            } @else {
                <app-recurrence-form
                    [value]="draft() || null"
                    [dtstart]="data.dtstart ?? defaultAnchor"
                    [tz]="data.tz ?? null"
                    [allowNone]="false"
                    (valueChange)="draft.set($event ?? '')" />
            }

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="onCancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        (click)="onSave()">Done</button>
            </ng-container>
        </app-modal>
    `,
})
export class TriggerSpecDialogComponent {
    readonly data = inject<TriggerSpecDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<TriggerSpecDialogResult>>(DialogRef);

    /** Working draft. Mutated by the form's (valueChange); committed by Done. */
    readonly draft = signal<string>(this.data.value);

    readonly title = computed(() =>
        this.data.kind === 'cron' ? 'Edit cron expression' : 'Edit recurrence'
    );

    /**
     * Fallback DTSTART when the caller didn't pass one (Schedule has no
     * DTSTART of its own). The recurrence form uses this only for
     * preview labels — not for any persisted value.
     */
    readonly defaultAnchor = (() => {
        const d = new Date();
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
    })();

    onCancel(): void {
        this.dialogRef.close(undefined);
    }

    onSave(): void {
        this.dialogRef.close(this.draft());
    }
}
