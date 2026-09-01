import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { filter, switchMap } from 'rxjs';
import {
    ApiService,
    CalendarDto,
    ScheduleDto,
    TriggerKindCode,
} from '../../api/api.service';
import { ErrorHandlerService, ConfigService, LayoutConfig } from '@coolms/core-angular';
import {
    CmsDetailFooterComponent,
    CmsPageHeaderComponent,
    ConfirmDialogService,
    CronFormComponent,
    DateTimeFormatService,
    ErrorBannerComponent,
    LayoutActionsService,
    LazySelectComponent,
    LoadingComponent,
    PageTitleService,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { RecurrenceFormComponent } from '../calendars/recurrence-form/recurrence-form.component';

/**
 * — Schedule Detail admin page (/admin/schedules/:slug).
 *
 * Cards: Settings, Trigger, Calendar, Handler/Payload, History.
 * Header actions: Trigger Now, Delete.
 */
@Component({
    selector: 'app-schedule-detail-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, LazySelectComponent, CronFormComponent, RecurrenceFormComponent, LoadingComponent, ErrorBannerComponent, CmsPageHeaderComponent, CmsDetailFooterComponent],
    template: `
        @if (loading()) {
            <app-loading label="Loading schedule…" />
        } @else if (error()) {
            <app-error-banner [message]="error()!" />
        } @else if (schedule()) {
            @let s = schedule()!;

                <!--
                  Standard page chrome. The back action is declared in the
                  backend layout config (scheduler:schedule-detail) and rendered
                  in cms-page-header (ADR-127); status chips project into the
                  header-meta slot. Trigger Now / Delete live in the fixed footer.
                -->
                <cms-page-header
                    [title]="s.name || s.slug || 'Schedule'"
                    [icon]="layout()?.icon || 'alarm'"
                    [actions]="headerActions()"
                    (actionClick)="onAction($event)">
                    <div header-meta class="detail-chips">
                        <span class="chip mono">{{ s.slug }}</span>
                        @if (s.enabled) {
                            <span class="chip chip--ok">enabled</span>
                        } @else {
                            <span class="chip chip--off">disabled</span>
                        }
                        <span class="chip">{{ s.triggerKind }}</span>
                    </div>
                </cms-page-header>

                <div class="detail-page">

                <!-- Settings -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Settings</h2></header>
                    <div class="card__body">
                        <div class="form-row">
                            <label>Name
                                <input type="text" [(ngModel)]="formName" />
                            </label>
                            <label>Timezone
                                <!-- OptionSource ship — grouped picker fed by
                                     /api/v1/options/calendar.timezones. Wire
                                     value is the IANA id; the scheduler uses
                                     it to evaluate cron / RRule firings. -->
                                <app-lazy-select
                                        [apiUrl]="'/api/v1/options/calendar.timezones'"
                                        [value]="formTz"
                                        [valueKey]="'value'"
                                        [groupKey]="'group'"
                                        [labelKeys]="tzLabelKeys"
                                        [pageSize]="600"
                                        [entityLabel]="'timezone'"
                                        [placeholder]="'UTC'"
                                        (valueChange)="formTz = $event || 'UTC'" />
                            </label>
                            <label class="check">
                                <input type="checkbox" [(ngModel)]="formEnabled" />
                                Enabled
                            </label>
                        </div>
                        <div class="form-actions">
                            <button type="button" class="cms-btn cms-btn-primary"
                                    [disabled]="savingSettings()"
                                    (click)="onSaveSettings()">
                                {{ savingSettings() ? 'Saving…' : 'Save settings' }}
                            </button>
                        </div>
                    </div>
                </section>

                <!-- Trigger -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Trigger</h2></header>
                    <div class="card__body">
                        <div class="form-row">
                            <label>Kind
                                <select [(ngModel)]="formKind">
                                    <option value="cron">Cron</option>
                                    <option value="rrule">RRule</option>
                                </select>
                            </label>
                        </div>
                        @if (formKind === 'cron') {
                            <div class="block">
                                <span class="block__label">Cron expression</span>
                                <app-cron-form [value]="formSpec"
                                               (valueChange)="formSpec = $event" />
                            </div>
                        } @else {
                            <div class="block">
                                <span class="block__label">RRULE spec</span>
                                <app-recurrence-form [value]="formSpec || null"
                                                     [dtstart]="triggerAnchorIso"
                                                     [tz]="formTz || 'UTC'"
                                                     [allowNone]="false"
                                                     (valueChange)="formSpec = $event ?? ''" />
                            </div>
                        }
                        <div class="form-actions">
                            <button type="button" class="cms-btn cms-btn-primary"
                                    [disabled]="savingTrigger()"
                                    (click)="onSaveTrigger()">
                                {{ savingTrigger() ? 'Saving…' : 'Save trigger' }}
                            </button>
                        </div>
                    </div>
                </section>

                <!-- Calendar -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Business calendar</h2></header>
                    <div class="card__body">
                        <p class="hint">
                            When set, computed next-run is snapped forward to the next
                            working day in the selected calendar (preserves time-of-day).
                        </p>
                        <div class="form-row">
                            <label class="span-2">Calendar
                                <select [(ngModel)]="formCalendarId">
                                    <option [ngValue]="null">(none)</option>
                                    @for (cal of calendars(); track cal.id) {
                                        <option [ngValue]="cal.id">
                                            {{ cal.label }} ({{ cal.slug }})
                                        </option>
                                    }
                                </select>
                            </label>
                        </div>
                        <div class="form-actions">
                            <button type="button" class="cms-btn cms-btn-primary"
                                    [disabled]="savingCalendar()"
                                    (click)="onSaveCalendar()">
                                {{ savingCalendar() ? 'Saving…' : 'Save calendar' }}
                            </button>
                        </div>
                    </div>
                </section>

                <!-- Handler / Payload -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Handler / Payload</h2></header>
                    <div class="card__body">
                        <label class="block">Handler FQCN
                            <input type="text" [(ngModel)]="formHandler" />
                        </label>
                        <label class="block">Payload (JSON)
                            <textarea rows="4" class="mono" [(ngModel)]="formPayloadJson"
                                      placeholder='{"key": "value"}'></textarea>
                            @if (payloadError()) {
                                <p class="error">{{ payloadError() }}</p>
                            }
                        </label>
                        <div class="form-actions">
                            <button type="button" class="cms-btn cms-btn-primary"
                                    [disabled]="savingHandler()"
                                    (click)="onSaveHandler()">
                                {{ savingHandler() ? 'Saving…' : 'Save handler & payload' }}
                            </button>
                        </div>
                    </div>
                </section>

                <!-- History -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">History</h2></header>
                    <div class="card__body history">
                        <dl>
                            <dt>Last run at</dt>
                            <dd>{{ formatDateTime(s.lastRunAt) }}</dd>
                            <dt>Next run at</dt>
                            <dd>{{ formatDateTime(s.nextRunAt) }}</dd>
                            <dt>Created</dt>
                            <dd>{{ formatDateTime(s.createdAt) }}</dd>
                            <dt>Updated</dt>
                            <dd>{{ formatDateTime(s.updatedAt) }}</dd>
                        </dl>
                    </div>
                </section>

            </div>

            <!--
              Fixed action footer (shared cms-detail-footer). Breadcrumb +
              title stay in the pinned header; the primary Trigger Now +
              destructive Delete move here so the header row isn't overloaded.
            -->
            <cms-detail-footer
                [actions]="footerActions()"
                (actionClick)="onFooterAction($event)" />
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .detail-page { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 0 32px; }

        /* Status chips projected into the cms-page-header header-meta slot. */
        .detail-chips { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
        .chip {
            display: inline-block;
            padding: 1px 6px;
            border-radius: var(--cms-radius-sm, 4px);
            font-size: .7rem;
            background: var(--cms-meta-subtle); color: var(--cms-meta-text);
        }
        .chip--ok { background: var(--cms-success-subtle); color: var(--cms-success-text); }
        .chip--off { background: var(--cms-danger-subtle); color: var(--cms-danger-text); }

        .card {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px);
            margin-bottom: 16px;
            overflow: hidden;
        }
        .card__head { padding: 10px 16px; border-bottom: 1px solid var(--cms-border, #e5e7eb); background: var(--cms-surface-muted); }
        .card__title { margin: 0; font-size: .9rem; font-weight: 600; }
        .card__body { padding: 12px 16px; }

        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 12px;
            margin-bottom: 12px;
        }
        .form-row label { display: flex; flex-direction: column; gap: 4px; font-size: .85rem; }
        .form-row label.check { flex-direction: row; align-items: center; gap: 8px; }
        .form-row label.span-2 { grid-column: span 2; }

        .block { display: flex; flex-direction: column; gap: 4px; font-size: .85rem; margin-bottom: 12px; }
        .block__label { font-size: .85rem; color: var(--cms-text, #111827); }
        .block textarea { font-family: var(--cms-font-mono, monospace); font-size: .8rem; }

        input, select, textarea {
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-sm, 4px);
            padding: 6px 8px;
            font-size: .9rem;
            width: 100%;
            box-sizing: border-box;
        }
        textarea { resize: vertical; }

        .form-actions { display: flex; gap: 8px; }

        .hint { color: var(--cms-text-muted, #848b96); font-size: .8rem; margin: 4px 0 0; }
        .error { color: var(--cms-danger, #dc2626); font-size: .8rem; margin: 4px 0 0; }
        .mono { font-family: var(--cms-font-mono, monospace); }

        .history dl {
            display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px;
            font-size: .9rem; margin: 0;
        }
        .history dt { color: var(--cms-text-muted, #848b96); font-weight: 500; }

    `],
})
export class ScheduleDetailPageComponent implements OnInit {
    private readonly layoutActions = inject(LayoutActionsService);
    private readonly api        = inject(ApiService);
    private readonly router     = inject(Router);
    private readonly route      = inject(ActivatedRoute);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly confirm    = inject(ConfirmDialogService);
    private readonly config     = inject(ConfigService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dtf        = inject(DateTimeFormatService);

    /** Backend-defined page chrome (`scheduler:schedule-detail` layout config). */
    readonly layout    = signal<LayoutConfig | null>(null);

    readonly schedule  = signal<ScheduleDto | null>(null);
    readonly calendars = signal<CalendarDto[]>([]);
    readonly loading   = signal(true);
    readonly error     = signal<string | null>(null);

    readonly savingSettings = signal(false);
    readonly savingTrigger  = signal(false);
    readonly savingCalendar = signal(false);
    readonly savingHandler  = signal(false);
    readonly triggering     = signal(false);
    readonly payloadError   = signal<string | null>(null);

    // Form fields. ngModel-bound; reset from the loaded entity.
    formName            = '';
    formTz              = 'UTC';

    /**
     * OptionResource label fallback chain for the timezone picker.
     * Backend exposes `label` (leaf city, e.g. "Berlin"); fall through
     * to `value` so unknown rows still render.
     */
    readonly tzLabelKeys = ['label', 'value'];
    formEnabled         = true;
    formKind: TriggerKindCode = 'cron';
    formSpec            = '';
    formCalendarId: string | null = null;
    formHandler         = '';
    formPayloadJson     = '{}';

    /**
     * Anchor instant fed to &lt;app-recurrence-form&gt; for its DTSTART /
     * preview math when the trigger is RRule. Schedules don't carry a
     * DTSTART — the form just needs a stable reference for preview
     * labels, so today at 09:00 is sufficient.
     */
    readonly triggerAnchorIso = (() => {
        const d = new Date();
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
    })();

    /**
     * Navigation actions for the cms-page-header bar — declared in the
     * `scheduler:schedule-detail` layout config, not hardcoded.
     */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    /**
     * Fixed-footer actions — declared in the same layout config. The static
     * descriptors (Trigger Now / Delete) come from config; the `trigger`
     * action's busy label + disabled flag are applied here from runtime state
     * (the config-declares / FE-evaluates split, per web:section-detail).
     */
    readonly footerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.footerActions, this.actionContext()),
    );

    /** What the layout's conditions are evaluated against. */
    private readonly actionContext = computed((): Record<string, unknown> => ({
        _triggering: this.triggering(),
    }));

    /** cms-page-header dispatcher (navigation). `back` -> schedules list. */
    onAction(actionId: string): void {
        if (actionId === 'back') {
            void this.router.navigate(['/schedules']);
        }
    }

    /** cms-detail-footer dispatcher. */
    onFooterAction(actionId: string): void {
        switch (actionId) {
            case 'trigger': this.onTriggerNow(); break;
            case 'delete':  this.onDelete();     break;
        }
    }

    ngOnInit(): void {
        // Page chrome (actions + their conditions) is backend-defined. Nothing
        // fetched it, so every action this layout declares has been missing
        // from the page: the header's Back and the footer's Trigger / Delete.
        this.config.layout('scheduler:schedule-detail').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });

        this.route.paramMap.pipe(
            filter(pm => !!pm.get('slug')),
            switchMap(pm => {
                const slug = pm.get('slug')!;
                this.titleSvc.set('Schedule: ' + slug);
                this.loading.set(true);
                this.error.set(null);
                return this.api.getSchedule(slug);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: s => { this.populate(s); this.loadCalendars(); this.loading.set(false); },
            error: (err: unknown) => {
                this.error.set(this.errors.humanize(err));
                this.loading.set(false);
            },
        });
    }

    private populate(s: ScheduleDto): void {
        this.schedule.set(s);
        this.formName        = s.name ?? '';
        this.formTz          = s.tz ?? 'UTC';
        this.formEnabled     = s.enabled ?? true;
        this.formKind        = s.triggerKind ?? 'cron';
        this.formSpec        = s.triggerSpec ?? '';
        this.formCalendarId  = s.calendarId ?? null;
        this.formHandler     = s.handler ?? '';
        this.formPayloadJson = JSON.stringify(s.payload ?? {}, null, 2);
    }

    private loadCalendars(): void {
        this.api.listCalendars().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => this.calendars.set(rows),
            error: () => { /* silently ignore -- calendar attach is optional */ },
        });
    }

    onSaveSettings(): void {
        const s = this.schedule();
        if (!s?.slug) return;
        this.savingSettings.set(true);
        this.api.updateSchedule(s.slug, {
            name:    this.formName,
            tz:      this.formTz,
            enabled: this.formEnabled,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: updated => {
                this.populate(updated);
                this.savingSettings.set(false);
                this.toast.success('Settings saved');
            },
            error: (err: unknown) => {
                this.savingSettings.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    onSaveTrigger(): void {
        const s = this.schedule();
        if (!s?.slug) return;
        this.savingTrigger.set(true);
        this.api.updateSchedule(s.slug, {
            triggerKind: this.formKind,
            triggerSpec: this.formSpec,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: updated => {
                this.populate(updated);
                this.savingTrigger.set(false);
                this.toast.success('Trigger saved');
            },
            error: (err: unknown) => {
                this.savingTrigger.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    onSaveCalendar(): void {
        const s = this.schedule();
        if (!s?.slug) return;
        this.savingCalendar.set(true);
        this.api.updateSchedule(s.slug, {
            calendarId: this.formCalendarId,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: updated => {
                this.populate(updated);
                this.savingCalendar.set(false);
                this.toast.success('Calendar saved');
            },
            error: (err: unknown) => {
                this.savingCalendar.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    onSaveHandler(): void {
        const s = this.schedule();
        if (!s?.slug) return;

        let payload: Record<string, unknown>;
        try {
            const parsed = JSON.parse(this.formPayloadJson || '{}');
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                throw new Error('Payload must be a JSON object.');
            }
            payload = parsed as Record<string, unknown>;
            this.payloadError.set(null);
        } catch (e) {
            this.payloadError.set(e instanceof Error ? e.message : 'Invalid JSON.');
            return;
        }

        this.savingHandler.set(true);
        this.api.updateSchedule(s.slug, {
            handler: this.formHandler,
            payload,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: updated => {
                this.populate(updated);
                this.savingHandler.set(false);
                this.toast.success('Handler & payload saved');
            },
            error: (err: unknown) => {
                this.savingHandler.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    onTriggerNow(): void {
        const s = this.schedule();
        if (!s?.slug) return;
        this.triggering.set(true);
        this.api.triggerScheduleNow(s.slug).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => {
                this.toast.success(
                    'Dispatched at ' + this.formatDateTime(result.firedAt)
                    + (result.nextRunAt ? ' • next run ' + this.formatDateTime(result.nextRunAt) : ''),
                );
                // Refresh schedule so history reflects the new lastRunAt.
                this.api.getSchedule(s.slug!).pipe(
                    takeUntilDestroyed(this.destroyRef),
                ).subscribe(updated => this.populate(updated));
                this.triggering.set(false);
            },
            error: (err: unknown) => {
                this.triggering.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    onDelete(): void {
        const s = this.schedule();
        if (!s?.slug) return;
        this.confirm.open({
            title:   'Delete schedule?',
            message: `Delete schedule "${s.name}"? This cannot be undone.`,
            confirmLabel: 'Delete',
            danger: true,
        }).pipe(
            filter(ok => ok),
            switchMap(() => this.api.deleteSchedule(s.slug!)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success(`Schedule "${s.name}" deleted`);
                void this.router.navigate(['/schedules']);
            },
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    formatDateTime(iso: string | null | undefined): string {
        if (!iso) return '—';
        try {
            return this.dtf.dateTime(iso);
        } catch {
            return iso;
        }
    }
}
