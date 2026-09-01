import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Dialog } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import {
    CmsListPageComponent,
    LayoutActionsService,
    PageTitleService,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { ConfigService, type LayoutConfig, ErrorHandlerService } from '@coolms/core-angular';
import { SyncEdgeDto, SyncFleetService } from './sync-fleet.service';
import { EdgeRegisterDialogComponent } from './edge-register-dialog.component';

/**
 * Sync fleet admin page (/admin/sync-fleet, ADR-150 B.3.2).
 *
 * The operator view over the controller→edge mesh: every registered edge with
 * its health, feed cursor, principal binding, and selective-sync scope, plus
 * register/edit (modal), remove, and a fleet-wide "Nudge" trigger. The whole
 * surface is gated server-side by the NESTED `root:sync_fleet 0o770` VFS node —
 * a different group from the machine-facing `sync` node, so an edge's own
 * credential can never reach this page's API.
 */
@Component({
    selector: 'coolms-admin-sync-fleet',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DatePipe],
    template: `
        <cms-list-page
            title="Sync Fleet"
            icon="diagram-3"
            subtitle="Edge nodes replicating from this controller — health, cursor, principal, scope"
            [actions]="headerActions()"
            [footerCount]="footerLabel()"
            (actionClick)="onHeaderAction($event)">
            <div class="cms-sf">
            @if (loading()) {
                <p class="cms-sf__hint">Loading fleet…</p>
            } @else if (edges().length === 0) {
                <div class="cms-sf__empty">
                    <i class="bi bi-diagram-3"></i>
                    <p>No edge nodes registered.</p>
                    <button type="button" class="cms-btn cms-btn-primary" (click)="openRegister()">
                        <i class="bi bi-plus-lg"></i> Register edge
                    </button>
                </div>
            } @else {
                <table class="cms-sf__table">
                    <thead>
                        <tr>
                            <th>Edge</th>
                            <th>Base URL</th>
                            <th>Status</th>
                            <th>Principal</th>
                            <th>Scope</th>
                            <th class="num">Cursor</th>
                            <th>Last seen</th>
                            <th class="act"></th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (e of edges(); track e.slug) {
                            <tr [class.disabled]="!e.enabled">
                                <td>
                                    <div class="mono">{{ e.slug }}</div>
                                    <div class="sub">{{ e.name }}</div>
                                </td>
                                <td class="mono">{{ e.baseUrl }}</td>
                                <td>
                                    <span class="cms-sf__badge" [class]="'cms-sf__badge--' + e.status">
                                        {{ e.enabled ? e.status : 'paused' }}
                                    </span>
                                    @if (e.lastError) {
                                        <div class="sub err" [title]="e.lastError">{{ e.lastError }}</div>
                                    }
                                </td>
                                <td>
                                    @if (e.principalRef) {
                                        <span class="cms-sf__badge cms-sf__badge--bound" title="{{ e.principalRef }}">bound</span>
                                    } @else {
                                        <span class="cms-sf__badge cms-sf__badge--unbound"
                                              title="No inbound principal — this edge cannot acknowledge feed progress">unbound</span>
                                    }
                                </td>
                                <td>
                                    @if (e.scope?.tiers; as tiers) {
                                        @if (tiers.length === 0) {
                                            <span class="cms-sf__badge cms-sf__badge--none">nothing</span>
                                        } @else {
                                            @for (t of tiers; track t) {
                                                <span class="cms-sf__tier">{{ t }}</span>
                                            }
                                        }
                                    } @else {
                                        <span class="sub">all tiers</span>
                                    }
                                </td>
                                <td class="num mono">{{ e.cursor }}</td>
                                <td>{{ e.lastSeenAt ? (e.lastSeenAt | date: 'short') : '—' }}</td>
                                <td class="act">
                                    <button type="button" class="cms-btn cms-btn-sm" title="Edit this edge"
                                            (click)="openEdit(e)">
                                        <i class="bi bi-pencil"></i>
                                    </button>
                                    <button type="button" class="cms-btn cms-btn-sm cms-btn-danger" title="Remove this edge"
                                            (click)="remove(e)">
                                        <i class="bi bi-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        }
                    </tbody>
                </table>
            }
            </div>
        </cms-list-page>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .cms-sf { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 1rem; overflow-y: auto; }
        .cms-sf__hint { color: var(--cms-text-muted, #848b96); }
        .cms-sf__empty {
            display: flex; flex-direction: column; align-items: center; gap: 0.6rem;
            padding: 3rem 1rem; text-align: center; color: var(--cms-text-muted, #848b96);
        }
        .cms-sf__empty .bi { font-size: 2rem; }
        .cms-sf__table { width: 100%; border-collapse: collapse; font-size: 0.88rem; background: var(--cms-surface, #fff); }
        .cms-sf__table th, .cms-sf__table td {
            text-align: left; padding: 0.5rem 0.75rem;
            border-bottom: 1px solid var(--cms-border, #e5e7eb); vertical-align: middle;
        }
        .cms-sf__table th {
            font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.03em;
            color: var(--cms-text-muted, #848b96); border-bottom-width: 2px;
        }
        .cms-sf__table tr.disabled td { opacity: 0.55; }
        .cms-sf__table td.num, .cms-sf__table th.num { text-align: right; font-variant-numeric: tabular-nums; }
        .cms-sf__table td.act, .cms-sf__table th.act { text-align: right; white-space: nowrap; }
        .mono { font-family: var(--cms-font-mono, ui-monospace, monospace); font-size: 0.82rem; }
        .sub { font-size: 0.75rem; color: var(--cms-text-muted, #848b96); }
        .sub.err { color: var(--cms-danger, #dc2626); max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cms-sf__badge {
            display: inline-block; font-size: 0.72rem; padding: 0.05rem 0.45rem; border-radius: 999px;
            background: var(--cms-surface-muted, #f3f4f6); color: var(--cms-text-muted, #848b96);
        }
        .cms-sf__badge--healthy { background: var(--cms-success-subtle); color: var(--cms-success-text); }
        .cms-sf__badge--unreachable, .cms-sf__badge--none { background: var(--cms-danger-subtle); color: var(--cms-danger-text); }
        .cms-sf__badge--bound { background: var(--cms-info-subtle); color: var(--cms-primary-hover); }
        .cms-sf__tier {
            display: inline-block; font-size: 0.72rem; padding: 0.05rem 0.45rem; margin-right: 0.25rem;
            border-radius: 999px; background: var(--cms-surface-muted, #f3f4f6); color: var(--cms-text-muted, #848b96);
        }
    `],
})
export class SyncFleetListPageComponent implements OnInit {
    private readonly config     = inject(ConfigService);
    private readonly layoutActions = inject(LayoutActionsService);

    /** Backend-defined page chrome (`sync:fleet-list` layout config). */
    readonly layout = signal<LayoutConfig | null>(null);
    private readonly api = inject(SyncFleetService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly titleSvc = inject(PageTitleService);
    private readonly dialog = inject(Dialog);
    private readonly destroyRef = inject(DestroyRef);

    readonly edges = signal<SyncEdgeDto[]>([]);
    readonly loading = signal(true);

    readonly footerLabel = computed(() => {
        if (this.loading()) return '';
        const n = this.edges().length;
        return n === 0 ? '' : `${n} edge${n === 1 ? '' : 's'}`;
    });

    /** Declared in the `sync:fleet-list` layout (ADR-127), not here. */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    ngOnInit(): void {
        // Page chrome is backend-defined; one cached fetch, degrading to no
        // actions rather than breaking the page.
        this.config.layout('sync:fleet-list').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });
        this.titleSvc.set('Sync Fleet');
        this.load();
    }

    onHeaderAction(id: string): void {
        if (id === 'register') this.openRegister();
        if (id === 'nudge') this.nudge();
        if (id === 'refresh') this.load();
    }

    openRegister(): void {
        this.openDialog(undefined);
    }

    openEdit(edge: SyncEdgeDto): void {
        this.openDialog(edge);
    }

    remove(edge: SyncEdgeDto): void {
        // Removal releases the edge's cursor from the change-feed's prune floor:
        // unlike "disabled" (paused, still pinning retention), a removed edge's
        // undelivered changes become prunable — hence the explicit warning.
        const sure = window.confirm(
            `Remove edge "${edge.slug}"?\n\nThis releases its position in the change feed — `
            + 'if the edge comes back later it must re-bootstrap from a full snapshot. '
            + 'Use Edit → disable instead to pause it.',
        );
        if (!sure) return;
        this.api.removeEdge(edge.slug).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => { this.toast.success(`Edge "${edge.slug}" removed`); this.load(); },
            error: e => this.toast.error(this.errors.humanize(e)),
        });
    }

    nudge(): void {
        this.api.nudgeAll().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => this.toast.success('Nudge queued — enabled edges will pull shortly'),
            error: e => this.toast.error(this.errors.humanize(e)),
        });
    }

    private openDialog(edge: SyncEdgeDto | undefined): void {
        this.dialog.open<SyncEdgeDto>(EdgeRegisterDialogComponent, {
            data: { edge },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((r): r is SyncEdgeDto => r != null),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(saved => {
            this.toast.success(`Edge "${saved.slug}" saved`);
            this.load();
        });
    }

    private load(): void {
        this.loading.set(true);
        this.api.listEdges().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => { this.edges.set(rows); this.loading.set(false); },
            error: e => { this.loading.set(false); this.toast.error(this.errors.humanize(e)); },
        });
    }
}
