import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    OnInit,
    ViewChild,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import {
    ApiService,
    CalendarDto,
} from '../../api/api.service';
import { AuthState, ErrorHandlerService, ConfigService, LayoutConfig } from '@coolms/core-angular';
import {
    CmsDetailFooterComponent,
    CmsPageHeaderComponent,
    ConfirmDialogService,
    LayoutActionsService,
    PageTitleService,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { CalendarEventsCardComponent } from './calendar-events-card.component';
import { CalendarSettingsSidePanelComponent } from './calendar-settings-side-panel.component';
import { MiniCalendarComponent } from './mini-calendar.component';

type FcViewName = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';

/**
 * M1.2.f.1 — Calendar Detail admin page, redesigned (/admin/calendars/:slug).
 *
 * Layout (top-down):
 *  - cms-page-header: icon · title · slug chip (projected into the
 *    `header-meta` slot — see [#441 follow-up]) · gear ⚙ · delete
 *  - Two-column body:
 *      LEFT  (240px): mini month calendar + (future) calendar list
 *      RIGHT (flex):  FC toolbar row + main grid (full height)
 *  - Settings, working hours, holiday rules, shares are accessed via
 *    the global right drawer (slide-over) — gear button opens it.
 *
 * This replaces the #423 four-card grid (events / settings / hours /
 * holiday rules / preview), which crammed too much onto a single page
 * and made the events grid feel like an afterthought.
 *
 * Honored constraints:
 *  - **No backend API changes** — color and holidayCalendarId fields
 *    deferred to a follow-up backend ship; the settings tab only
 *    exposes what the current `Calendar` resource supports.
 *  - **No DateTime preferences here** — also deferred (user profile).
 *  - **Single-calendar view** — multi-cal overlay still queued.
 */
@Component({
    selector: 'app-calendar-detail-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        RouterLink,
        CalendarEventsCardComponent,
        CalendarSettingsSidePanelComponent,
        CmsPageHeaderComponent,
        CmsDetailFooterComponent,
        MiniCalendarComponent,
    ],
    template: `
        @if (loading()) {
            <div class="detail-status">Loading calendar…</div>
        } @else if (error()) {
            <div class="detail-status detail-status--error">
                <p>{{ error() }}</p>
                <a routerLink="/calendars" class="back-link">
                    <i class="bi bi-arrow-left"></i> Back to Calendars
                </a>
            </div>
        } @else if (calendar()) {
            @let cal = calendar()!;
            <div class="page">

                <!-- Standard admin page header. The slug chip projects
                     into the new header-meta slot so it sits next to the
                     title (replaces the standalone sub-head row that used
                     to live below the header). Back-to-Calendars is
                     already in the topbar breadcrumb so we drop it here.
                     Timezone is already surfaced in the "About this
                     calendar" sidebar block so it's dropped here too. -->
                <cms-page-header
                    [title]="cal.label || cal.slug || 'Calendar'"
                    icon="calendar3">
                    @if (cal.slug && cal.slug !== cal.label) {
                        <span header-meta class="chip chip--slug">{{ cal.slug }}</span>
                    }
                </cms-page-header>

                <!-- Two-column body. The .page__body container is
                     position:relative so the in-page settings panel
                     overlay scopes to this area. -->
                <div class="page__body">

                    <!-- LEFT: sidebar -->
                    <aside class="sidebar">
                        <app-mini-calendar
                                [selectedDate]="activeDate()"
                                (dateSelect)="onMiniDateSelect($event)"
                                (monthChange)="onMiniMonthChange($event)" />

                        <section class="side-card">
                            <h3 class="side-card__title">
                                <i class="bi bi-info-circle"></i>
                                About this calendar
                            </h3>
                            <dl class="meta">
                                <dt>Timezone</dt><dd>{{ cal.tz ?? 'UTC' }}</dd>
                                @if (cal.parentId) {
                                    <dt>Inherits</dt>
                                    <dd>{{ shortenId(cal.parentId) }}</dd>
                                }
                                <dt>Owner</dt>
                                <dd [title]="cal.ownerId ?? ''">
                                    @if (cal.ownerId) {
                                        {{ ownerLabel() || shortenId(cal.ownerId) }}
                                    } @else {
                                        —
                                    }
                                </dd>
                            </dl>
                            <button type="button" class="side-card__btn"
                                    (click)="openSettings('shares')">
                                <i class="bi bi-share"></i> Manage shares
                            </button>
                            <button type="button" class="side-card__btn"
                                    (click)="openSettings('rules')">
                                <i class="bi bi-calendar-event"></i> Holiday rules
                            </button>
                        </section>
                    </aside>

                    <!-- RIGHT: toolbar + grid -->
                    <main class="main">
                        <!-- Task #462 — view-switcher moved to the right
                             alongside "New event". When it sat between
                             the title and the actions, every prev/next
                             tick jittered the switcher left and right
                             because long month names like "September"
                             changed the title's width. The right
                             cluster is stable so the switcher is now
                             rock-still. -->
                        <div class="toolbar">
                            <div class="toolbar__nav">
                                <button type="button" class="cms-btn cms-btn-ghost"
                                        (click)="navPrev()" title="Previous">
                                    <i class="bi bi-chevron-left"></i>
                                </button>
                                <button type="button" class="cms-btn cms-btn-ghost"
                                        (click)="navToday()" title="Jump to today">
                                    Today
                                </button>
                                <button type="button" class="cms-btn cms-btn-ghost"
                                        (click)="navNext()" title="Next">
                                    <i class="bi bi-chevron-right"></i>
                                </button>
                                <h2 class="toolbar__title">{{ activeMonthLabel() }}</h2>
                            </div>
                            <div class="toolbar__actions">
                                <div class="toolbar__views">
                                    @for (v of viewOptions; track v.value) {
                                        <button type="button" class="cms-btn cms-btn-ghost"
                                                [class.btn-ghost--active]="currentView() === v.value"
                                                (click)="setView(v.value)">
                                            {{ v.label }}
                                        </button>
                                    }
                                </div>
                                <button type="button" class="cms-btn cms-btn-primary cms-btn-sm"
                                        [disabled]="!canEdit()"
                                        (click)="openNewEvent()">
                                    <i class="bi bi-plus-lg"></i> New event
                                </button>
                            </div>
                        </div>

                        <app-calendar-events-card
                                #eventsCard
                                [calendar]="cal"
                                [canEdit]="canEdit()"
                                [initialView]="currentView()"
                                (viewRangeChanged)="onViewRangeChanged($event)"
                                (eventsChanged)="onEventsChanged()" />
                    </main>

                    <!-- In-page slide-over settings panel. Positioned
                         absolutely inside the page body so the backdrop
                         only dims the calendar grid, not the page header
                         or topbar. -->
                    <app-calendar-settings-side-panel
                        [open]="isSettingsPanelOpen()"
                        [calendar]="cal"
                        [allCalendars]="allCalendars()"
                        [canEdit]="canEdit()"
                        [canManageShares]="canManageShares()"
                        [initialTab]="settingsTab()"
                        [onCalendarChanged]="onCalendarChangedFromPanel"
                        [onRulesChanged]="onRulesChangedFromPanel"
                        (close)="closeSettings()" />
                </div>

                <!--
                  Fixed action footer (shared cms-detail-footer). The header
                  keeps title + slug; Settings + Delete move here so they read
                  as page actions rather than crowding the header.
                -->
                <cms-detail-footer
                    [actions]="footerActions()"
                    (actionClick)="onFooterAction($event)" />

                <!-- M1.2.h.1b — hidden input backing the footer's "Import .ics"
                     action; the footer button calls icsInput.click(). -->
                <input #icsInput type="file" accept=".ics,text/calendar" hidden
                       (change)="onIcsFileChosen($event)" />
            </div>
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .detail-status {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            padding: 48px 24px;
            color: var(--cms-text-muted, #848b96);
        }
        .detail-status--error { color: var(--cms-danger, #dc2626); }

        .page {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            background: var(--cms-bg, #f8f9fa);
        }

        /* .chip styles stay — the slug chip now projects into the
           cms-page-header's header-meta slot (next to the title) so we
           still need its visual treatment. .sub-head, .sep, and
           .chip--tz were dropped along with the sub-head row:
           back-to-Calendars lives in the topbar breadcrumb, timezone
           lives in the About-this-calendar sidebar block. .back-link
           is kept solely for the error-state fallback below the
           "Loading failed" message. */
        .back-link {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: var(--cms-text-muted, #848b96);
            text-decoration: none;
            font-size: .8rem;
        }
        .back-link:hover { color: var(--cms-accent, #F5A623); }
        .chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: var(--cms-radius-lg, 10px);
            font-size: .7rem;
            font-weight: 500;
            background: var(--cms-surface-muted);
            color: var(--cms-text-body);
            line-height: 1;
        }
        .chip--slug { background: var(--cms-surface-muted); font-family: var(--cms-font-mono, monospace); }

        .page__body {
            display: flex;
            flex: 1;
            min-height: 0;
            gap: 16px;
            /* Vertical inset only, and SYMMETRIC. The bottom used to be
               bare on the assumption that the shell's own bottom padding
               would carry it; measured, it does not — the grid's last row
               landed 1px above the action footer while the top had 12px.
               L/R is purely the shell's --cms-content-padding (20px). */
            padding: 12px 0;
            position: relative; /* scope the in-page settings overlay here */
        }
        .sidebar {
            width: 240px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            gap: 12px;
            overflow-y: auto;
        }
        .main {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px);
            overflow: hidden;
        }

        .toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
            background: var(--cms-surface-muted);
            flex-wrap: wrap;
        }
        .toolbar__nav { display: flex; align-items: center; gap: 4px; }
        .toolbar__title { margin: 0 0 0 8px; font-size: .95rem; font-weight: 600; color: var(--cms-text); }
        .toolbar__views { display: flex; gap: 2px; background: var(--cms-surface); border-radius: var(--cms-radius, 6px); padding: 2px; border: 1px solid var(--cms-border, #e5e7eb); }
        .toolbar__actions { display: flex; gap: 6px; align-items: center; }

        .side-card {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px);
            padding: 10px 12px;
            font-size: .8rem;
        }
        .side-card__title {
            margin: 0 0 8px;
            font-size: .75rem;
            font-weight: 600;
            color: var(--cms-text-muted, #848b96);
            text-transform: uppercase;
            letter-spacing: .03em;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .meta {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: 4px 8px;
            margin: 0 0 8px;
            font-size: .8rem;
        }
        .meta dt { color: var(--cms-text-muted, #848b96); }
        .meta dd { margin: 0; color: var(--cms-text); }
        .side-card__btn {
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
            padding: 6px 8px;
            margin-top: 4px;
            background: transparent;
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-sm, 4px);
            font-size: .75rem;
            color: var(--cms-text);
            cursor: pointer;
            text-align: left;
        }
        .side-card__btn:hover { background: var(--cms-surface-muted); }


        @media (max-width: 800px) {
            .page__body { flex-direction: column; padding: 8px; }
            .sidebar { width: 100%; flex-direction: row; flex-wrap: wrap; }
            .sidebar > * { flex: 1; min-width: 220px; }
        }
    `],
})
export class CalendarDetailPageComponent implements OnInit {
    private readonly layoutActions = inject(LayoutActionsService);
    private readonly route       = inject(ActivatedRoute);
    private readonly router      = inject(Router);
    private readonly api         = inject(ApiService);
    private readonly toast       = inject(ToastService);
    private readonly errors      = inject(ErrorHandlerService);
    private readonly titleSvc    = inject(PageTitleService);
    private readonly confirmSvc  = inject(ConfirmDialogService);
    private readonly destroyRef  = inject(DestroyRef);
    private readonly store       = inject(Store);
    private readonly config      = inject(ConfigService);

    /** Backend-defined page chrome (`calendar:detail` layout config). */
    readonly layout    = signal<LayoutConfig | null>(null);

    /** Current user UUID — used for owner/edit gating. */
    readonly currentUserId = computed<string | null>(() => {
        const u = this.store.selectSnapshot(AuthState.currentUser);
        return u?.id ?? null;
    });

    readonly isAdmin = computed<boolean>(() => {
        const u = this.store.selectSnapshot(AuthState.currentUser);
        return (u?.roles ?? []).includes('ROLE_ADMIN');
    });

    readonly isOwner = computed<boolean>(() => {
        const cal = this.calendar();
        return cal !== null && cal.ownerId !== null && cal.ownerId === this.currentUserId();
    });

    readonly canEdit = computed<boolean>(() => this.isOwner() || this.isAdmin());
    readonly canManageShares = computed<boolean>(() => this.isOwner() || this.isAdmin());

    /** Task #434 item 3 — true when this calendar is a user's seeded
     *  default personal calendar. The delete button is disabled with
     *  an explanatory tooltip in that case (backend also enforces). */
    readonly isDefaultPersonal = computed<boolean>(() =>
        this.calendar()?.isDefaultPersonal === true);

    /** Composed disabled state for the delete action. */
    readonly canDelete = computed<boolean>(() =>
        this.canEdit() && !this.isDefaultPersonal());

    readonly calendar = signal<CalendarDto | null>(null);
    readonly loading  = signal(true);
    readonly error    = signal<string | null>(null);
    readonly allCalendars = signal<CalendarDto[]>([]);

    /**
     * Human-readable owner label (fullName falling back to identifier),
     * resolved via a side fetch when calendar.ownerId is set. Empty
     * string while pending or unresolvable so the sidebar template can
     * gracefully fall back to the shortened UUID. Cleared on every
     * calendar reload so a re-route to a different calendar doesn't
     * carry the previous owner across.
     */
    readonly ownerLabel = signal<string>('');

    /**
     * First day of FullCalendar's displayed period (== `view.currentStart`).
     *
     * Used to drive the toolbar title + mini-cal "selected day" sync.
     * **NOT** `view.activeStart` — that's the first cell of the rendered
     * grid (often a previous-month tail date), which made every label
     * read one month behind the displayed grid. See task #454.
     */
    readonly activeDate     = signal<Date | null>(null);
    readonly activeMonthLabel = signal<string>('');
    readonly currentView    = signal<FcViewName>('dayGridMonth');

    readonly viewOptions: ReadonlyArray<{ value: FcViewName; label: string }> = [
        { value: 'dayGridMonth', label: 'Month' },
        { value: 'timeGridWeek', label: 'Week'  },
        { value: 'timeGridDay',  label: 'Day'   },
    ];

    @ViewChild('eventsCard')
    private eventsCard?: CalendarEventsCardComponent;

    /** M1.2.h.1b — hidden file input backing the "Import .ics" footer action. */
    @ViewChild('icsInput')
    private icsInput?: ElementRef<HTMLInputElement>;

    @ViewChild(MiniCalendarComponent)
    private miniCal?: MiniCalendarComponent;

    private currentSlug: string | null = null;

    /** In-page settings panel state (M1.2.f.4) — not a global drawer. */
    readonly isSettingsPanelOpen = signal<boolean>(false);
    readonly settingsTab = signal<'settings' | 'hours' | 'rules' | 'shares'>('settings');

    /**
     * Fixed-footer actions — declared in the `calendar:detail` layout config
     * (ADR-127), not hardcoded. The static descriptors (Settings / Delete)
     * come from config; the `delete` action's disabled flag + tooltip are
     * applied here from runtime state (default-personal calendars can't be
     * removed) — the config-declares / FE-evaluates split, per web:section-detail.
     */
    readonly footerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.footerActions, this.actionContext()).map(action => {
            // The disabled state is declared (`_canDelete`); only the REASON
            // stays here, because delete is refused for two different reasons
            // and the tooltip names one of them.
            if (action.id === 'delete' && this.isDefaultPersonal()) {
                action.title = "Default personal calendar can't be removed.";
            }
            return action;
        }),
    );

    /** What the layout's conditions are evaluated against. */
    private readonly actionContext = computed((): Record<string, unknown> => ({
        _canDelete: this.canDelete(),
    }));

    ngOnInit(): void {
        // Page chrome (footer actions) is backend-defined; fetch once (cached).
        this.config.layout('calendar:detail').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });

        this.route.paramMap.pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(params => {
            const slug = params.get('slug');
            if (!slug) {
                this.error.set('No calendar slug in URL');
                this.loading.set(false);
                return;
            }
            this.currentSlug = slug;
            this.loadCalendar(slug);
            this.loadAll();
        });
    }

    private loadCalendar(slug: string): void {
        this.loading.set(true);
        this.error.set(null);
        this.ownerLabel.set('');
        this.api.getCalendar(slug).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cal => {
                this.calendar.set(cal);
                this.loading.set(false);
                this.titleSvc.set(cal.label ?? `Calendar ${slug}`);
                this.resolveOwnerLabel(cal.ownerId);
            },
            error: (err: unknown) => {
                this.loading.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }

    /**
     * Side fetch to swap the owner UUID for a human-readable label in
     * the "About this calendar" sidebar block. Best-effort: if the user
     * can't be fetched (permissions, deleted, etc) we silently fall back
     * to the shortened UUID display the template already renders. The
     * full UUID is preserved in the [title] tooltip on the <dd> so the
     * id is still discoverable for support / debugging.
     */
    private resolveOwnerLabel(ownerId: string | null | undefined): void {
        if (!ownerId) {
            this.ownerLabel.set('');
            return;
        }
        this.api.getUser(ownerId).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: user => this.ownerLabel.set(user.fullName || user.identifier || ''),
            error: () => this.ownerLabel.set(''),
        });
    }

    private loadAll(): void {
        this.api.listCalendars().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => this.allCalendars.set(rows),
        });
    }

    /** Open the in-page settings side panel on a specific tab. */
    openSettings(tab: 'settings' | 'hours' | 'rules' | 'shares' = 'settings'): void {
        if (!this.calendar()) return;
        this.settingsTab.set(tab);
        this.isSettingsPanelOpen.set(true);
    }

    closeSettings(): void {
        this.isSettingsPanelOpen.set(false);
    }

    /** cms-detail-footer action dispatcher. */
    onFooterAction(actionId: string): void {
        switch (actionId) {
            case 'settings': this.openSettings('settings'); break;
            case 'export':   this.onExportIcs();            break;
            case 'import':   this.icsInput?.nativeElement.click(); break;
            case 'delete':   this.onDeleteCalendar();       break;
        }
    }

    /**
     * M1.2.h.1b — download this calendar as `.ics`. Fetched through
     * HttpClient (Bearer-authenticated) into a Blob, then handed to the
     * browser as a `{slug}.ics` download via a transient object URL.
     */
    onExportIcs(): void {
        const cal = this.calendar();
        if (!cal?.slug) return;
        this.api.exportCalendarIcs(cal.slug).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${cal.slug}.ics`;
                a.click();
                URL.revokeObjectURL(url);
            },
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    /**
     * M1.2.h.1b — read the chosen `.ics` file and POST it to the import
     * endpoint, then surface the summary + refresh the events grid. The
     * input is reset so re-selecting the same file fires `change` again.
     */
    onIcsFileChosen(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        const cal = this.calendar();
        if (!file || !cal?.slug) return;

        const slug = cal.slug;
        file.text().then(ics => {
            this.api.importCalendarIcs(slug, ics).pipe(
                takeUntilDestroyed(this.destroyRef),
            ).subscribe({
                next: result => {
                    const skipped = result.skipped > 0 ? `, ${result.skipped} skipped` : '';
                    this.toast.success(`Imported ${result.imported} event(s)${skipped}`);
                    this.eventsCard?.refresh();
                },
                error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
            });
        }).catch(() => this.toast.error('Could not read the selected file.'));
    }

    /** Wired into the in-page settings side panel — bridges back so
     *  the events grid + local calendar state refresh on mutation. */
    readonly onCalendarChangedFromPanel = (updated: CalendarDto): void => {
        this.calendar.set(updated);
        this.eventsCard?.refresh();
    };
    readonly onRulesChangedFromPanel = (): void => {
        this.eventsCard?.refresh();
    };

    onDeleteCalendar(): void {
        const cal = this.calendar();
        if (!cal || !cal.slug) return;
        if (this.isDefaultPersonal()) {
            this.toast.error("Default personal calendar can't be removed.");
            return;
        }
        this.confirmSvc.confirmDelete(cal.label ?? cal.slug).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteCalendar(cal.slug!)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success(`Calendar "${cal.label ?? cal.slug}" deleted`);
                this.router.navigate(['/calendars']);
            },
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    // ── Toolbar nav ──────────────────────────────────────────────────────────
    navPrev():  void { this.eventsCard?.prev(); }
    navNext():  void { this.eventsCard?.next(); }
    navToday(): void { this.eventsCard?.today(); }
    setView(v: FcViewName): void {
        this.currentView.set(v);
        this.eventsCard?.changeView(v);
    }
    openNewEvent(): void { this.eventsCard?.openNewEventModal(); }

    // ── Mini-cal interactions ────────────────────────────────────────────────
    onMiniDateSelect(d: Date): void {
        this.eventsCard?.gotoDate(d);
    }

    onMiniMonthChange(_: { year: number; month: number }): void {
        // No-op: when the user navigates the mini-cal but doesn't click a
        // date, we don't move the main grid. The main grid only moves on
        // an explicit dateSelect (which forwards through onMiniDateSelect).
    }

    onViewRangeChanged(range: {
        start:        Date;
        end:          Date;
        currentStart: Date;
        currentEnd:   Date;
        viewType:     FcViewName;
    }): void {
        // Task #454 — use `currentStart` (first day of the displayed
        // period), NOT `activeStart` (first cell of the rendered grid,
        // which is often the previous month's tail). See the JSDoc on
        // `viewRangeChanged` in calendar-events-card.component.ts.
        const cs = range.currentStart;

        // Task #456 — sync the Month/Week/Day toggle whenever FC's view
        // changes internally (e.g. clicking a weekday header in Week
        // view jumps to Day view via navLinks). Without this, the pill
        // stayed stuck on whatever the user previously chose, even
        // though the grid had moved on.
        this.currentView.set(range.viewType);

        // Task #456 — title format adapts to the displayed view:
        //  - Month view → "May 2026"
        //  - Week view  → "May 25 – 31, 2026" (or month-crossing range)
        //  - Day view   → "Saturday, May 30, 2026"
        // Without this, every view showed just the month + year, which
        // was useless context in Day view (the user couldn't tell
        // which day they were looking at).
        this.activeMonthLabel.set(this.formatTitle(range.viewType, cs, range.currentEnd));

        // Sync the mini-cal's displayed month directly via setMonth() so
        // it always tracks the main grid. For Month view we deliberately
        // pass `null` as `activeDate` (== mini-cal's selectedDate) so the
        // mini-cal's "today" border is the only highlight — having a
        // "selected" fill on the 1st of the month would be visually
        // misleading. For Week/Day views the focused day is meaningful
        // so we surface it.
        this.miniCal?.setMonth(cs.getFullYear(), cs.getMonth());
        this.activeDate.set(
            range.viewType === 'dayGridMonth' ? null : cs,
        );
    }

    /**
     * Compose the toolbar title for the displayed view.
     * `currentEnd` is FullCalendar's exclusive end (e.g. for the week
     * Mon May 25 – Sun May 31 it points at Mon Jun 1), so we always
     * subtract one day for the visible "to" date.
     */
    private formatTitle(view: FcViewName, start: Date, end: Date): string {
        if (view === 'timeGridDay') {
            return start.toLocaleString(undefined, {
                weekday: 'long',
                month:   'long',
                day:     'numeric',
                year:    'numeric',
            });
        }
        if (view === 'timeGridWeek') {
            // FC's currentEnd is exclusive — drop one day to get the
            // visible last day of the week.
            const lastVisible = new Date(end.getTime() - 24 * 60 * 60 * 1000);
            const sameMonth = start.getMonth() === lastVisible.getMonth()
                && start.getFullYear() === lastVisible.getFullYear();
            if (sameMonth) {
                // "May 25 – 31, 2026"
                const month = start.toLocaleString(undefined, { month: 'long' });
                return `${month} ${start.getDate()} – ${lastVisible.getDate()}, ${start.getFullYear()}`;
            }
            // Month-crossing or year-crossing — show both ends explicitly.
            const fmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
            return `${start.toLocaleString(undefined, fmt)} – ${lastVisible.toLocaleString(undefined, fmt)}`;
        }
        // dayGridMonth — "May 2026"
        return start.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    }

    onEventsChanged(): void {
        // Reserved: future "next event" badge refresh.
    }

    shortenId(id: string | null | undefined): string {
        if (!id) return '—';
        return id.length > 8 ? id.slice(0, 8) + '…' : id;
    }
}
