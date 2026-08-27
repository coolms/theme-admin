import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    signal,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService, CalendarDto } from '../../api/api.service';
import { ErrorHandlerService } from '@coolms/core-angular';
import { LazySelectComponent, ModalComponent } from '@coolms/ui-angular';

/**
 * #465 — Create-calendar modal dialog (replaces the inline create panel).
 *
 * Opened from CalendarsListComponent's `create` toolbar action. Slug + label
 * are required, timezone defaults to UTC. On success the dialog closes with
 * the new CalendarDto so the parent can navigate to its detail page.
 */
@Component({
    selector: 'app-calendar-form-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule, LazySelectComponent],
    template: `
        <app-modal title="New Calendar">
            <div class="form-row">
                <label>Slug
                    <input #slugInput type="text"
                           [(ngModel)]="slug"
                           placeholder="e.g. de-berlin"
                           autofocus />
                </label>
                <label>Label
                    <input type="text"
                           [(ngModel)]="label"
                           placeholder="Germany - Berlin" />
                </label>
            </div>
            <div class="form-row">
                <label class="span-2">Timezone
                    <!-- OptionSource ship — timezone catalogue loads lazily from
                         /api/v1/options/calendar.timezones; the picker renders
                         a grouped (Region) dropdown with type-search. The wire
                         token is the IANA id (e.g. 'Europe/Berlin'). -->
                    <app-lazy-select
                            [apiUrl]="'/api/v1/options/calendar.timezones'"
                            [value]="tz"
                            [valueKey]="'value'"
                            [groupKey]="'group'"
                            [labelKeys]="labelKeys"
                            [pageSize]="600"
                            [entityLabel]="'timezone'"
                            [placeholder]="'UTC'"
                            (valueChange)="tz = $event || 'UTC'" />
                </label>
            </div>
            @if (error()) {
                <p class="error">{{ error() }}</p>
            }
            <div class="form-actions">
                <button type="button" class="cms-btn cms-btn-link" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="submitting()"
                        (click)="submit()">
                    {{ submitting() ? 'Creating…' : 'Create' }}
                </button>
            </div>
        </app-modal>
    `,
    styles: [`
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 12px;
        }
        .form-row label { display: flex; flex-direction: column; gap: 4px; font-size: .85rem; }
        .form-row label.span-2 { grid-column: span 2; }
        .form-row input {
            border: 1px solid var(--cms-border, #d1d5db);
            border-radius: 4px;
            padding: 6px 8px;
            font-size: .9rem;
        }
        .form-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--cms-border, #e5e7eb);
        }
        .error { color: var(--cms-danger, #b91c1c); margin: 8px 0; font-size: .85rem; }
    `],
})
export class CalendarFormDialogComponent {
    private readonly api        = inject(ApiService);
    private readonly errors     = inject(ErrorHandlerService);
    readonly dialogRef          = inject<DialogRef<CalendarDto | null>>(DialogRef);
    private readonly destroyRef = inject(DestroyRef);

    slug  = '';
    label = '';
    tz    = 'UTC';

    /**
     * Label fallback chain for the lazy-select. The OptionResource
     * rows expose `label` first (e.g. "Berlin") then `value` as the
     * IANA id ("Europe/Berlin"); falling through to `value` gives a
     * sensible display even if the backend ever drops the leaf-name
     * derivation.
     */
    readonly labelKeys = ['label', 'value'];

    readonly submitting = signal(false);
    readonly error      = signal<string | null>(null);

    cancel(): void {
        this.dialogRef.close(null);
    }

    submit(): void {
        if (this.slug.trim() === '' || this.label.trim() === '') {
            this.error.set('Slug and label are required.');
            return;
        }
        this.submitting.set(true);
        this.error.set(null);
        this.api.createCalendar({
            slug:  this.slug.trim(),
            label: this.label.trim(),
            tz:    this.tz.trim() || 'UTC',
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: cal => {
                this.submitting.set(false);
                this.dialogRef.close(cal);
            },
            error: (e: unknown) => {
                this.submitting.set(false);
                this.error.set(this.errors.humanize(e));
            },
        });
    }
}
