import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { Dialog } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, filter, switchMap } from 'rxjs';

import {
    CmsDetailFooterComponent,
    CmsPageHeaderComponent,
    ConfirmDialogService,
    DateTimeFormatService,
    ErrorBannerComponent,
    LayoutActionsService,
    LoadingComponent,
    PageTitleService,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { ErrorHandlerService, ConfigService, LayoutConfig } from '@coolms/core-angular';
import { CockpitService } from './cockpit.service';
import { CockpitDiagramComponent } from './cockpit-diagram.component';
import {
    SetVariableDialogComponent,
    SetVariableResult,
} from './set-variable-dialog.component';
import {
    MigrateDialogComponent,
    MigrateResult,
} from './migrate-dialog.component';
import type {
    CockpitHistoryEventDto,
    CockpitInstanceDetailDto,
    CockpitInstanceDto,
    CockpitTaskDto,
    CockpitTokenDto,
} from './cockpit.types';

/**
 * Process Cockpit instance detail page (`/admin/cockpit/:id`).
 *
 * Read-only operator view of one process instance, backed by the enriched
 * item GET (`GET /api/v1/cockpit/instances/{id}`, ROLE_ADMIN) which returns
 * the list row plus the engine's per-instance `tokens` (live marker
 * positions), `history` (the audit timeline), and `variables`.
 *
 * Mirrors the schedule-detail three-state shell (loading | error-with-back |
 * detail). adds state-gated steering actions to the header:
 *   - running   -> Suspend, Set variable, Cancel
 *   - suspended -> Resume, Set variable, Cancel
 *   - failed    -> Retry
 *   - terminal (completed / cancelled) -> read-only (no actions)
 * Cancel confirms first (destructive); every successful action re-fetches the
 * detail (so the state badge + tokens + history + variables refresh) and
 * toasts. Drill-in is from the list page row / toolbar Open.
 */
@Component({
    selector: 'app-cockpit-detail-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [KeyValuePipe, CmsPageHeaderComponent, CmsDetailFooterComponent, CockpitDiagramComponent, LoadingComponent, ErrorBannerComponent],
    template: `
        @if (loading()) {
            <app-loading label="Loading process instance…" />
        } @else if (error()) {
            <app-error-banner [message]="error()!" />
        } @else if (instance()) {
            @let i = instance()!;

            <cms-page-header
                [title]="'Process instance · ' + definitionLabel(i)"
                icon="speedometer2"
                [subtitle]="i.id"
                [actions]="headerActions()"
                (actionClick)="onSteeringAction($event)" />

            <div class="detail-page">

                <!-- Summary -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Summary</h2></header>
                    <div class="card__body">
                        <dl class="kv">
                            <dt>State</dt>
                            <dd>
                                <span class="badge" [class]="stateBadgeClass(i.state)">{{ i.state }}</span>
                            </dd>
                            <dt>Definition</dt>
                            <dd>{{ i.definitionName ?? '—' }}</dd>
                            <dt>Definition key</dt>
                            <dd class="mono">{{ i.definitionKey ?? '—' }}</dd>
                            <dt>Version</dt>
                            <!-- Both null and undefined mean "no version": a bare
                                 strict null check would print "vundefined" when the
                                 field is absent from the payload, and a truthiness
                                 test would swallow a legitimate 0. -->
                            <dd>{{ i.definitionVersion === null || i.definitionVersion === undefined ? '—' : 'v' + i.definitionVersion }}</dd>
                            <dt>Business key</dt>
                            <dd>{{ i.businessKey ?? '—' }}</dd>
                            <dt>Started</dt>
                            <dd>{{ formatDate(i.startedAt) }}</dd>
                            <dt>Completed</dt>
                            <dd>{{ formatDate(i.completedAt) }}</dd>
                            <dt>Instance id</dt>
                            <dd class="mono">{{ i.id }}</dd>
                        </dl>
                    </div>
                </section>

                <!-- Process diagram with live token overlay -->
                @if (i.definitionBody) {
                    <section class="card">
                        <header class="card__head"><h2 class="card__title">Diagram</h2></header>
                        <div class="card__body">
                            <app-cockpit-diagram
                                [body]="i.definitionBody"
                                [tokens]="i.tokens"
                                [failedElementId]="failedElementId(i)" />
                        </div>
                    </section>
                }

                <!-- Token positions -->
                <section class="card">
                    <header class="card__head">
                        <h2 class="card__title">Token positions</h2>
                        <span class="count">{{ i.tokens.length }}</span>
                    </header>
                    <div class="card__body">
                        @if (i.tokens.length === 0) {
                            <p class="empty">No execution tokens.</p>
                        } @else {
                            <table class="tbl">
                                <thead>
                                    <tr>
                                        <th>Element</th>
                                        <th>State</th>
                                        <th>Waiting for</th>
                                        <th>Entered</th>
                                        <th>Left</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @for (t of i.tokens; track t.id) {
                                        <tr>
                                            <td class="mono">{{ t.currentElementId }}</td>
                                            <td>
                                                <span class="badge" [class]="tokenBadgeClass(t.state)">{{ t.state }}</span>
                                            </td>
                                            <td>{{ t.waitingFor ?? '—' }}</td>
                                            <td>{{ formatDate(t.enteredAt) }}</td>
                                            <td>{{ formatDate(t.leftAt) }}</td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        }
                    </div>
                </section>

                <!--
                  User tasks (M4) — each parked userTask:<id> token resolved to
                  the operator-relevant facts (assignee / candidate pool / state
                  / timers). Read-only; task actions live in the Inbox. Hidden
                  when the process has no user-task element (most instances).
                -->
                @if (i.tasks.length > 0) {
                    <section class="card">
                        <header class="card__head">
                            <h2 class="card__title">User tasks</h2>
                            <span class="count">{{ i.tasks.length }}</span>
                        </header>
                        <div class="card__body">
                            <table class="tbl">
                                <thead>
                                    <tr>
                                        <th>Activity</th>
                                        <th>State</th>
                                        <th>Assignee</th>
                                        <th>Candidates</th>
                                        <th>Due</th>
                                        <th>Claimed</th>
                                        <th>Completed</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @for (t of i.tasks; track t.id) {
                                        <tr>
                                            <td class="mono">{{ t.activityId }}</td>
                                            <td>
                                                <span class="badge" [class]="taskBadgeClass(t.state)">{{ t.state }}</span>
                                            </td>
                                            <td class="mono">{{ t.assigneeId ?? '—' }}</td>
                                            <td>{{ candidateSummary(t) }}</td>
                                            <td>{{ formatDate(t.dueAt) }}</td>
                                            <td>{{ formatDate(t.claimedAt) }}</td>
                                            <td>{{ formatDate(t.completedAt) }}</td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        </div>
                    </section>
                }

                <!-- History timeline -->
                <section class="card">
                    <header class="card__head">
                        <h2 class="card__title">History</h2>
                        <span class="count">{{ i.history.length }}</span>
                    </header>
                    <div class="card__body">
                        @if (i.history.length === 0) {
                            <p class="empty">No history events.</p>
                        } @else {
                            <ol class="timeline">
                                @for (h of i.history; track h.id) {
                                    <li class="timeline__item">
                                        <div class="timeline__marker" [class]="'timeline__marker--' + categoryVariant(h.category)"></div>
                                        <div class="timeline__body">
                                            <div class="timeline__head">
                                                <span class="timeline__summary">{{ eventSummary(h) }}</span>
                                                @if (h.category) {
                                                    <span class="badge" [class]="'badge--' + categoryVariant(h.category)">{{ h.category }}</span>
                                                }
                                                <span class="timeline__time">{{ formatDate(h.occurredAt) }}</span>
                                            </div>
                                            <div class="timeline__code mono">{{ h.type }}</div>
                                            @if (hasPayload(h)) {
                                                <pre class="timeline__payload mono">{{ payloadJson(h) }}</pre>
                                            }
                                        </div>
                                    </li>
                                }
                            </ol>
                        }
                    </div>
                </section>

                <!-- Variables -->
                <section class="card">
                    <header class="card__head">
                        <h2 class="card__title">Variables</h2>
                        <span class="count">{{ variableCount(i) }}</span>
                    </header>
                    <div class="card__body">
                        @if (variableCount(i) === 0) {
                            <p class="empty">No variables.</p>
                        } @else {
                            <table class="tbl">
                                <thead>
                                    <tr><th>Key</th><th>Value</th></tr>
                                </thead>
                                <tbody>
                                    @for (entry of i.variables | keyvalue; track entry.key) {
                                        <tr>
                                            <td class="mono">{{ entry.key }}</td>
                                            <td><span class="mono">{{ valueJson(entry.value) }}</span></td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        }
                    </div>
                </section>

            </div>

            <!--
              Fixed steering footer (shared cms-detail-footer). Pinned to the
              bottom while .detail-page scrolls above it; the header carries
              navigation only, the state-gated steering actions live here so the
              cramped header isn't overloaded. Renders nothing for terminal
              states (steeringActions() empty).
            -->
            <cms-detail-footer
                [actions]="steeringActions()"
                (actionClick)="onSteeringAction($event)" />
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }


        .detail-page { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 0 32px; }

        .card {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px);
            margin-bottom: 16px;
            overflow: hidden;
        }
        .card__head {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 16px; border-bottom: 1px solid var(--cms-border, #e5e7eb); background: var(--cms-surface-muted);
        }
        .card__title { margin: 0; font-size: .9rem; font-weight: 600; }
        .count {
            font-size: .7rem; padding: 1px 7px; border-radius: 999px;
            background: var(--cms-border, #e5e7eb); color: var(--cms-text-muted, #848b96);
        }
        .card__body { padding: 12px 16px; }

        .empty { color: var(--cms-text-muted, #848b96); font-size: .85rem; margin: 0; }
        .mono { font-family: var(--cms-font-mono, monospace); font-size: .82rem; }

        .kv {
            display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px;
            font-size: .9rem; margin: 0;
        }
        .kv dt { color: var(--cms-text-muted, #848b96); font-weight: 500; }
        .kv dd { margin: 0; word-break: break-all; }

        .tbl { width: 100%; border-collapse: collapse; font-size: .85rem; }
        .tbl th {
            text-align: left; font-weight: 600; color: var(--cms-text-muted, #848b96);
            padding: 6px 10px; border-bottom: 1px solid var(--cms-border, #e5e7eb);
            white-space: nowrap;
        }
        .tbl td {
            padding: 6px 10px; border-bottom: 1px solid var(--cms-border, #e5e7eb);
            vertical-align: top; word-break: break-all;
        }
        .tbl tr:last-child td { border-bottom: none; }

        .badge {
            display: inline-block; padding: 1px 8px; border-radius: 999px;
            font-size: .72rem; font-weight: 500; text-transform: capitalize;
            background: var(--cms-border-light); color: var(--cms-text-secondary);
        }
        .badge--success { background: var(--cms-success-light); color: var(--cms-success-text); }
        .badge--info    { background: var(--cms-info-light);    color: var(--cms-info-text); }
        .badge--danger  { background: var(--cms-danger-light);  color: var(--cms-danger-text); }
        .badge--muted   { background: var(--cms-border-light);  color: var(--cms-text-secondary); }
        .badge--warning { background: var(--cms-warning-light); color: var(--cms-warning-text); }

        .timeline { list-style: none; margin: 0; padding: 0 0 0 4px; }
        .timeline__item { position: relative; padding: 0 0 14px 20px; }
        .timeline__item::before {
            content: ''; position: absolute; left: 4px; top: 8px; bottom: -2px;
            width: 1px; background: var(--cms-border, #e5e7eb);
        }
        .timeline__item:last-child::before { display: none; }
        .timeline__marker {
            position: absolute; left: 0; top: 4px; width: 9px; height: 9px;
            border-radius: 50%; background: var(--cms-accent, #F5A623);
            border: 2px solid var(--cms-surface, #fff);
        }
        /* — tint the marker by the event's category bucket. */
        .timeline__marker--info    { background: var(--cms-info-text, #1e40af); }
        .timeline__marker--success { background: var(--cms-success-text, #166534); }
        .timeline__marker--warning { background: var(--cms-warning-text, #92400e); }
        .timeline__marker--danger  { background: var(--cms-danger-text, #991b1b); }
        .timeline__marker--muted   { background: var(--cms-text-secondary, #6b7280); }
        .timeline__head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        .timeline__summary { font-weight: 600; }
        /* — raw stable code, kept as a secondary debug line under the summary. */
        .timeline__code { color: var(--cms-text-muted, #848b96); font-size: .72rem; margin-top: 1px; }
        .timeline__time { color: var(--cms-text-muted, #848b96); font-size: .78rem; margin-left: auto; }
        .timeline__payload {
            margin: 4px 0 0; padding: 6px 8px; border-radius: var(--cms-radius-sm, 4px);
            background: var(--cms-surface-muted); border: 1px solid var(--cms-border, #e5e7eb);
            white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto;
        }
    `],
})
export class CockpitDetailPageComponent implements OnInit {
    private readonly layoutActions = inject(LayoutActionsService);
    private readonly cockpit    = inject(CockpitService);
    private readonly route      = inject(ActivatedRoute);
    private readonly router     = inject(Router);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly toast      = inject(ToastService);
    private readonly confirm    = inject(ConfirmDialogService);
    private readonly dialog     = inject(Dialog);
    private readonly destroyRef = inject(DestroyRef);
    private readonly config     = inject(ConfigService);
    private readonly dtf        = inject(DateTimeFormatService);

    /** Backend-defined page chrome (`cockpit:instance-detail` layout config). */
    readonly layout   = signal<LayoutConfig | null>(null);

    readonly instance = signal<CockpitInstanceDetailDto | null>(null);
    readonly loading  = signal(true);
    readonly error    = signal<string | null>(null);

    /**
     * In-flight guard for steering actions: disables the header buttons
     * (and short-circuits re-entry) while a mutation + its detail re-fetch
     * are running, so a double-click can't double-fire.
     */
    readonly busy = signal(false);

    /**
     * Header actions = navigation only (back to the cockpit list) — declared in
     * the `cockpit:instance-detail` layout config, not hardcoded.
     */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    /**
     * State-gated steering actions, declared in the same layout config and
     * rendered in the fixed footer.
     *
     * Which action applies in which state IS the steering policy, and it used
     * to be a `requires: state:*` vocabulary this component decoded through a
     * six-case switch -- a token per state, and a branch here for every token.
     * The layout states the conditions directly now (`showWhen` on `_state` and
     * `_hasOtherVersions`, `disabledWhen` on `_busy`), so a terminal instance
     * still yields no qualifying actions and an empty footer, without this file
     * knowing what "suspended-multiversion" was supposed to mean.
     *
     * The YAML's footer order produces the correct per-state order once
     * filtered: running -> Suspend/Set-var/Cancel, suspended ->
     * Resume/[Migrate]/Set-var/Cancel, failed -> Retry.
     */
    protected readonly steeringActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.footerActions, this.actionContext()),
    );

    /**
     * What the layout's conditions are evaluated against.
     *
     * `_hasOtherVersions` is a BOOLEAN, not the version list: the config asks
     * whether migrating anywhere is possible, and does not need to learn what a
     * deployed version looks like to ask it.
     */
    private readonly actionContext = computed((): Record<string, unknown> => {
        const inst = this.instance();

        return {
            _state: inst?.state ?? '',
            _hasOtherVersions: (inst?.availableVersions ?? []).some(v => !v.isCurrent),
            _busy: this.busy(),
        };
    });

    ngOnInit(): void {
        // Page chrome (actions + their conditions) is backend-defined. Nothing
        // fetched it, so every action this layout declares has been missing
        // from the page: the header's Back and the whole steering footer.
        this.config.layout('cockpit:instance-detail').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });

        this.route.paramMap.pipe(
            filter(pm => !!pm.get('id')),
            switchMap(pm => {
                const id = pm.get('id')!;
                this.titleSvc.set('Process instance');
                this.loading.set(true);
                this.error.set(null);
                return this.cockpit.getInstance(id);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: inst => {
                this.instance.set(inst);
                this.titleSvc.set('Process instance · ' + this.definitionLabel(inst));
                this.loading.set(false);
            },
            error: (err: unknown) => {
                this.error.set(this.errors.humanize(err));
                this.loading.set(false);
            },
        });
    }

    /** Header action dispatch — routes the emitted action id. */
    onSteeringAction(actionId: string): void {
        if (actionId === 'back') { void this.router.navigate(['/cockpit']); return; }
        const inst = this.instance();
        if (!inst || this.busy()) return;

        switch (actionId) {
            case 'suspend':
                this.run(this.cockpit.suspend(inst.id), 'Process suspended');
                break;
            case 'resume':
                this.run(this.cockpit.resume(inst.id), 'Process resumed');
                break;
            case 'retry':
                this.run(this.cockpit.retry(inst.id), 'Process retried');
                break;
            case 'cancel':
                this.confirm.open({
                    title:        'Cancel process instance?',
                    message:      "Cancel this process instance? Running tokens will be killed. This can't be undone.",
                    confirmLabel: 'Cancel instance',
                    cancelLabel:  'Keep running',
                    danger:       true,
                }).pipe(
                    filter(ok => ok),
                    takeUntilDestroyed(this.destroyRef),
                ).subscribe(() => this.run(this.cockpit.cancel(inst.id), 'Process cancelled'));
                break;
            case 'set-variable':
                this.dialog.open<SetVariableResult | null>(SetVariableDialogComponent, {
                    backdropClass: 'cdk-overlay-dark-backdrop',
                }).closed.pipe(
                    filter((r): r is SetVariableResult => !!r),
                    takeUntilDestroyed(this.destroyRef),
                ).subscribe(r => this.run(
                    this.cockpit.setVariable(inst.id, r.name, r.value),
                    `Variable "${r.name}" set`,
                ));
                break;
            case 'migrate':
                this.dialog.open<MigrateResult | null>(MigrateDialogComponent, {
                    backdropClass: 'cdk-overlay-dark-backdrop',
                    data: {
                        versions: inst.availableVersions ?? [],
                        currentVersion: inst.definitionVersion ?? null,
                    },
                }).closed.pipe(
                    filter((r): r is MigrateResult => !!r),
                    takeUntilDestroyed(this.destroyRef),
                ).subscribe(r => this.run(
                    this.cockpit.migrate(inst.id, r.targetVersionId),
                    `Migrated to version ${r.targetVersion}`,
                ));
                break;
        }
    }

    /**
     * Runs a steering mutation under the {@link busy} guard, then re-fetches
     * the detail (so the state badge + tokens + history + variables all
     * refresh) and toasts. The mutation's own returned row is ignored — the
     * re-fetch is the authoritative refresh.
     */
    private run(action$: Observable<CockpitInstanceDto>, successMsg: string): void {
        const id = this.instance()?.id;
        if (!id) return;
        this.busy.set(true);
        action$.pipe(
            switchMap(() => this.cockpit.getInstance(id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: inst => {
                this.instance.set(inst);
                this.busy.set(false);
                this.toast.success(successMsg);
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    /** Human label for the header / title: name -> key -> short id. */
    definitionLabel(i: CockpitInstanceDetailDto): string {
        return i.definitionName ?? i.definitionKey ?? i.id.slice(0, 8);
    }

    /**
     * The element id that the engine recorded as failed (so the diagram
     * paints it red). Scans the history for the most recent
     * `workflow.process.failed` event (failure capture) and returns its
     * `elementId` payload; null when the instance never failed.
     */
    failedElementId(i: CockpitInstanceDetailDto): string | null {
        for (let n = i.history.length - 1; n >= 0; n--) {
            const h = i.history[n];
            if (h.type === 'workflow.process.failed') {
                const id = h.payload?.['elementId'];
                return typeof id === 'string' ? id : null;
            }
        }
        return null;
    }

    stateBadgeClass(state: string): string {
        switch (state) {
            case 'running':   return 'badge--success';
            case 'completed': return 'badge--info';
            case 'failed':    return 'badge--danger';
            case 'cancelled': return 'badge--muted';
            case 'suspended': return 'badge--warning';
            default:          return '';
        }
    }

    tokenBadgeClass(state: string): string {
        switch (state) {
            case 'active':    return 'badge--success';
            case 'waiting':   return 'badge--warning';
            case 'completed': return 'badge--info';
            case 'dead':      return 'badge--muted';
            default:          return '';
        }
    }

    /** Colour variant for a user-task state badge (M4). */
    taskBadgeClass(state: string): string {
        switch (state) {
            case 'pending':   return 'badge--warning';
            case 'assigned':  return 'badge--info';
            case 'completed': return 'badge--success';
            case 'cancelled': return 'badge--muted';
            default:          return '';
        }
    }

    /**
     * Compact candidate-pool hint for the user-tasks table ("2 users · 1
     * group", raw counts — no name resolution). "—" when the task carries no
     * candidate pool (e.g. a directly-assigned task).
     */
    candidateSummary(t: CockpitTaskDto): string {
        const users = t.candidateUserIds?.length ?? 0;
        const groups = t.candidateGroupIds?.length ?? 0;
        if (users === 0 && groups === 0) return '—';
        const parts: string[] = [];
        if (users > 0) parts.push(`${users} ${users === 1 ? 'user' : 'users'}`);
        if (groups > 0) parts.push(`${groups} ${groups === 1 ? 'group' : 'groups'}`);
        return parts.join(' · ');
    }

    /**
     * — the timeline's primary line: the server-derived human `summary`
     * (from `HistoryEventDescriber`), falling back to the raw stable `type`
     * code when an older payload or a serialization quirk omits it.
     */
    eventSummary(h: CockpitHistoryEventDto): string {
        return h.summary && h.summary.length > 0 ? h.summary : h.type;
    }

    /**
     * / — maps the server `category` bucket onto a badge/marker
     * colour variant. The four buckets each take a colour distinct from
     * the others so a task/timer/message/external-task event is recognisable at
     * a glance:
     *   - `process`, `task`           -> info    (blue)   lifecycle / work
     *   - `token`, `message`          -> success (green)  flow / messaging
     *   - `compensation`, `timer`     -> warning (amber)  rollback / time-based
     *   - `external-task`             -> danger  (red)    parked external work
     * Anything unknown falls through to muted. Drives both the category badge
     * (`badge--*`) and the marker tint (`timeline__marker--*`) — one mapping for
     * both.
     */
    categoryVariant(category: string | undefined): string {
        switch (category) {
            case 'process':
            case 'task':
                return 'info';
            case 'token':
            case 'message':
                return 'success';
            case 'compensation':
            case 'timer':
                return 'warning';
            case 'external-task':
                return 'danger';
            default:
                return 'muted';
        }
    }

    formatDate(iso: string | null | undefined): string {
        if (!iso) return '—';
        try {
            return this.dtf.dateTime(iso);
        } catch {
            return iso;
        }
    }

    hasPayload(h: CockpitHistoryEventDto): boolean {
        return !!h.payload && Object.keys(h.payload).length > 0;
    }

    payloadJson(h: CockpitHistoryEventDto): string {
        try {
            return JSON.stringify(h.payload, null, 2);
        } catch {
            return '';
        }
    }

    variableCount(i: CockpitInstanceDetailDto): number {
        return Object.keys(i.variables ?? {}).length;
    }

    valueJson(value: unknown): string {
        if (value === null) return 'null';
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
}
