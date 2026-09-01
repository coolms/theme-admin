import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService, ScheduleDto, ScheduledHandlerDto, TriggerKindCode } from '../../api/api.service';
import { ErrorHandlerService } from '@coolms/core-angular';
import {
    LazySelectComponent,
    LazySelectOption,
    ModalComponent,
    summariseCron,
} from '@coolms/ui-angular';
import {
    TriggerSpecDialogComponent,
    type TriggerSpecDialogData,
    type TriggerSpecDialogResult,
} from './trigger-spec-dialog.component';

/**
 * — Create-schedule modal dialog (replaces the inline create panel).
 *
 * Opened from SchedulesListComponent's `create` toolbar action.
 */
@Component({
    selector: 'app-schedule-form-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule, LazySelectComponent],
    template: `
        <app-modal title="New Schedule">
            <div class="fields">
                <div>
                    <label class="cms-label">Slug</label>
                    <input class="cms-input" type="text"
                           [(ngModel)]="slug"
                           placeholder="e.g. daily-report"
                           autofocus />
                    <div class="cms-field-hint">URL-safe identifier. Cannot change after creation.</div>
                </div>

                <div>
                    <label class="cms-label">Name</label>
                    <input class="cms-input" type="text"
                           [(ngModel)]="name"
                           placeholder="Daily Report" />
                </div>

                <div>
                    <label class="cms-label">Timezone</label>
                    <!-- Grouped picker fed by /api/v1/options/calendar.timezones,
                         same widget the Calendar dialogs use. Wire value is the
                         IANA id ("Europe/Berlin"); scheduler stores it verbatim
                         and resolves firings against it on the next tick. -->
                    <app-lazy-select
                            [apiUrl]="'/api/v1/options/calendar.timezones'"
                            [value]="tz"
                            [valueKey]="'value'"
                            [groupKey]="'group'"
                            [labelKeys]="tzLabelKeys"
                            [pageSize]="600"
                            [entityLabel]="'timezone'"
                            [placeholder]="'UTC'"
                            (valueChange)="tz = $event || 'UTC'" />
                </div>

                <div>
                    <label class="cms-label">Trigger kind</label>
                    <select class="cms-select" [(ngModel)]="kind">
                        <option value="cron">Cron</option>
                        <option value="rrule">RRule</option>
                    </select>
                </div>

                <div>
                    <label class="cms-label">Trigger spec</label>
                    <div class="spec-row">
                        <input class="cms-input" type="text"
                               [(ngModel)]="spec"
                               [placeholder]="kind === 'cron' ? '0 9 * * 1-5' : 'RRULE:FREQ=DAILY'" />
                        <button type="button" class="cms-btn spec-row__configure"
                                (click)="openTriggerDialog()">
                            <i class="bi bi-sliders"></i> Configure…
                        </button>
                    </div>
                    @if (specSummary()) {
                        <div class="cms-field-hint">{{ specSummary() }}</div>
                    }
                </div>

                <div>
                    <label class="cms-label">Handler</label>
                    <app-lazy-select
                            [options]="handlerOptions()"
                            [value]="handler"
                            [allowClear]="false"
                            [entityLabel]="'handler'"
                            [placeholder]="loadingHandlers() ? 'Loading handlers…' : '— Pick a handler —'"
                            (valueChange)="handler = $event" />
                    @if (handlerHint()) {
                        <div class="cms-field-hint">{{ handlerHint() }}</div>
                    }
                </div>

                @if (error()) {
                    <p class="error">{{ error() }}</p>
                }
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="submitting()"
                        (click)="submit()">
                    {{ submitting() ? 'Creating…' : 'Create' }}
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .fields {
            display: flex; flex-direction: column;
            gap: 14px;
        }
        .error {
            color: var(--cms-danger, #dc2626);
            margin: 0;
            font-size: .8125rem;
        }
        /* Trigger spec row: text input flexes, Configure button stays fixed. */
        .spec-row {
            display: flex; gap: 8px; align-items: stretch;
        }
        .spec-row > input { flex: 1 1 auto; min-width: 0; }
        .spec-row__configure { flex: 0 0 auto; white-space: nowrap; }
    `],
})
export class ScheduleFormDialogComponent implements OnInit {
    private readonly api        = inject(ApiService);
    private readonly errors     = inject(ErrorHandlerService);
    readonly dialogRef          = inject<DialogRef<ScheduleDto | null>>(DialogRef);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dialog     = inject(Dialog);

    /**
     * Manually-bound signal mirror of `spec` so a computed can summarise
     * it without forcing the consumer onto reactive forms. Two-way
     * binding via `[(ngModel)]` keeps the field-and-signal pair in sync.
     */
    readonly specSignal = signal<string>('');
    set spec(v: string) { this._spec = v; this.specSignal.set(v); }
    get spec(): string { return this._spec; }
    private _spec = '';

    /** Humanised cron summary shown under the input when in cron mode. */
    readonly specSummary = computed(() =>
        this.kind === 'cron' && this.specSignal()
            ? summariseCron(this.specSignal())
            : ''
    );

    slug    = '';
    name    = '';
    tz      = 'UTC';

    /**
     * OptionResource label fallback chain for the timezone picker. The
     * backend exposes `label` (leaf city, e.g. "Berlin"); fall through
     * to `value` (the full IANA id) so unknown rows still render.
     */
    readonly tzLabelKeys = ['label', 'value'];
    kind: TriggerKindCode = 'cron';
    handler = '';

    /**
     * Anchor instant fed to &lt;app-recurrence-form&gt; for its DTSTART /
     * preview math. Schedules don't carry a DTSTART (they're "fire next
     * time the rule matches relative to now"); the form just needs a
     * fixed reference point for preview labels, so today at 09:00 in
     * the user's TZ is sufficient.
     */
    readonly anchorIso = (() => {
        const d = new Date();
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
    })();

    readonly submitting       = signal(false);
    readonly error            = signal<string | null>(null);
    readonly loadingHandlers  = signal(true);
    private readonly handlers = signal<ReadonlyArray<ScheduledHandlerDto>>([]);

    /** Projects the catalog into `<app-lazy-select>`-shaped options. */
    readonly handlerOptions = computed<ReadonlyArray<LazySelectOption>>(() =>
        this.handlers().map(h => ({
            id:    h.key,
            label: h.label,
            extras: { description: h.description ?? '', fqcn: h.fqcn ?? '' },
        })),
    );

    /** Shows the description of the picked handler under the dropdown. */
    readonly handlerHint = computed(() => {
        const picked = this.handlers().find(h => h.key === this.handler);
        return picked?.description ?? '';
    });

    ngOnInit(): void {
        this.api.listScheduledHandlers().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => {
                this.handlers.set(rows);
                this.loadingHandlers.set(false);
            },
            error: () => {
                this.loadingHandlers.set(false);
                this.error.set('Failed to load handler catalog.');
            },
        });
    }

    /**
     * Open the structured trigger-spec sub-dialog. Lets the user pick a
     * cron preset (every minute / hourly / daily at HH:MM / …) or an
     * RRule preset (Weekly on Mo,Tu,… / Monthly on the Nth / …) without
     * cluttering the main New Schedule modal with a form-inside-a-form.
     */
    openTriggerDialog(): void {
        const data: TriggerSpecDialogData = {
            kind:    this.kind,
            value:   this.spec,
            dtstart: this.anchorIso,
            tz:      this.tz,
        };
        const ref = this.dialog.open<TriggerSpecDialogResult, TriggerSpecDialogData>(
            TriggerSpecDialogComponent,
            { data },
        );
        ref.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
            if (result === undefined) return; // cancelled
            this.spec = result;
        });
    }

    cancel(): void {
        this.dialogRef.close(null);
    }

    submit(): void {
        if (this.slug.trim() === '' || this.name.trim() === ''
            || this.spec.trim() === '' || this.handler.trim() === '') {
            this.error.set('Slug, name, trigger spec and handler are required.');
            return;
        }
        this.submitting.set(true);
        this.error.set(null);
        this.api.createSchedule({
            slug:        this.slug.trim(),
            name:        this.name.trim(),
            tz:          this.tz.trim() || 'UTC',
            triggerKind: this.kind,
            triggerSpec: this.spec.trim(),
            handler:     this.handler.trim(),
            payload:     {},
            enabled:     true,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: s => {
                this.submitting.set(false);
                this.dialogRef.close(s);
            },
            error: (e: unknown) => {
                this.submitting.set(false);
                this.error.set(this.errors.humanize(e));
            },
        });
    }
}
