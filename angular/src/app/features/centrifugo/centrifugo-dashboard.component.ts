import { CommonModule, DecimalPipe } from '@angular/common';
import { Dialog } from '@angular/cdk/dialog';
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
import { RouterLink } from '@angular/router';
import { Store } from '@ngxs/store';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { AppConfigState, ConfigService, type LayoutConfig } from '@coolms/core-angular';
import {
    CentrifugoAdminService,
    CmsPageHeaderComponent,
    DataGridComponent,
    LayoutActionsService,
    type CentrifugoChannelsListDto,
    type CentrifugoNamespacesListDto,
    type CentrifugoNodeInfoDto,
    type DataGridData,
    type ToolbarAction,
} from '@coolms/ui-angular';
import { SendNotificationDialogComponent } from '../notification/send-notification-dialog.component';
import { CentrifugoPublishDialogComponent } from './centrifugo-publish-dialog.component';

/**
 * ADR-099 Phase 1.5 sub-phase 1.5b -- the dashboard at
 * `/centrifugo` (rendered under the SPA's `/admin/` base-href).
 * Three independent panels: node info,
 * backend-declared namespaces, currently active channels (with
 * pattern filter). Each panel has its own loading / error /
 * empty state so a flaky upstream on one read doesn't block the
 * other two.
 *
 * Auto-refresh is intentionally not wired -- the spec mandates a
 * pragmatic functional UI and admin viewers refresh manually via
 * the per-panel button. A live ticker can land in a follow-up if
 * usage demands it.
 */
@Component({
    selector: 'app-centrifugo-dashboard',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        FormsModule,
        RouterLink,
        DecimalPipe,
        CmsPageHeaderComponent,
        DataGridComponent,
    ],
    template: `
        <cms-page-header
            title="Centrifugo"
            icon="broadcast"
            [actions]="headerActions()"
            (actionClick)="onHeaderAction($event)"
        />

        <div class="cms-centrifugo">
            <!-- Node info -->
            <section class="cms-centrifugo__card">
                <header class="cms-centrifugo__card-head">
                    <h2>Node info</h2>
                    <button type="button" class="cms-btn" (click)="loadInfo()" [disabled]="infoLoading()">
                        <i class="bi bi-arrow-clockwise"></i> Refresh
                    </button>
                </header>
                @if (infoLoading() && !info()) {
                    <div class="cms-centrifugo__placeholder">Loading…</div>
                } @else if (infoError()) {
                    <div class="cms-centrifugo__error" role="alert">
                        {{ infoError() }}
                    </div>
                } @else {
                    @if (info(); as i) {
                        <dl class="cms-centrifugo__stats">
                            <div><dt>Version</dt><dd>{{ i.version }}</dd></div>
                            <div><dt>Node</dt><dd><code>{{ i.name }}</code></dd></div>
                            <div><dt>Clients</dt><dd>{{ i.numClients | number }}</dd></div>
                            <div><dt>Users</dt><dd>{{ i.numUsers | number }}</dd></div>
                            <div><dt>Channels</dt><dd>{{ i.numChannels | number }}</dd></div>
                            <div><dt>Uptime</dt><dd>{{ formatUptime(i.uptime) }}</dd></div>
                        </dl>
                    }
                }
            </section>

            <!-- Namespaces -->
            <section class="cms-centrifugo__card">
                <header class="cms-centrifugo__card-head">
                    <h2>Namespaces</h2>
                    <span class="cms-centrifugo__hint">
                        Declared by backend modules via <code>Extension::prepend</code>.
                    </span>
                </header>
                @if (namespacesLoading() && !namespaces()) {
                    <div class="cms-centrifugo__placeholder">Loading…</div>
                } @else if (namespacesError()) {
                    <div class="cms-centrifugo__error" role="alert">{{ namespacesError() }}</div>
                } @else {
                    @if (namespaces(); as ns) {
                        @if (ns.count === 0) {
                            <div class="cms-centrifugo__empty">No namespaces declared.</div>
                        } @else {
                            <coolms-datagrid
                                gridId="centrifugo:namespaces"
                                [configBaseUrl]="configBaseUrl()"
                                [externalData]="namespaceGridData()">
                            </coolms-datagrid>
                        }
                    }
                }
            </section>

            <!-- Channels -->
            <section class="cms-centrifugo__card">
                <header class="cms-centrifugo__card-head">
                    <h2>Active channels</h2>
                    <button type="button" class="cms-btn" (click)="reloadChannels()" [disabled]="channelsLoading()">
                        <i class="bi bi-arrow-clockwise"></i> Refresh
                    </button>
                </header>

                <div class="cms-centrifugo__filter">
                    <label for="pattern" class="cms-centrifugo__filter-label">Pattern</label>
                    <input
                        id="pattern"
                        type="text"
                        class="cms-centrifugo__filter-input"
                        placeholder="e.g., document.* (empty = all)"
                        [ngModel]="pattern()"
                        (ngModelChange)="onPatternChange($event)"
                    />
                </div>

                @if (channelsLoading() && !channels()) {
                    <div class="cms-centrifugo__placeholder">Loading…</div>
                } @else if (channelsError()) {
                    <div class="cms-centrifugo__error" role="alert">{{ channelsError() }}</div>
                } @else {
                    @if (channels(); as ch) {
                        @if (ch.count === 0) {
                            <div class="cms-centrifugo__empty">
                                No channels match
                                @if (ch.pattern) { <code>{{ ch.pattern }}</code> } @else { the empty pattern }.
                            </div>
                        } @else {
                            <ul class="cms-centrifugo__channels">
                                @for (name of ch.channels; track name) {
                                    <li>
                                        <a [routerLink]="['/centrifugo/channel', name]">
                                            <code>{{ name }}</code>
                                        </a>
                                    </li>
                                }
                            </ul>
                            <div class="cms-centrifugo__count">
                                {{ ch.count | number }} channel(s){{ ch.pattern ? ' matching ' + ch.pattern : '' }}.
                            </div>
                        }
                    }
                }
            </section>
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .cms-centrifugo {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            padding-top: 1rem;
            min-height: 0;
            flex: 1;
            overflow: auto;
            background: var(--cms-bg);
        }
        .cms-centrifugo__card {
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: .75rem;
        }
        .cms-centrifugo__card-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
        }
        .cms-centrifugo__card-head h2 {
            margin: 0;
            font-size: 1rem;
            color: var(--cms-text);
        }
        .cms-centrifugo__hint {
            font-size: .8rem;
            color: var(--cms-text-secondary);
        }
        .cms-centrifugo__placeholder, .cms-centrifugo__empty {
            color: var(--cms-text-secondary);
            text-align: center;
            padding: 1rem;
        }
        .cms-centrifugo__error {
            color: var(--cms-danger-text);
            padding: .75rem;
            background: var(--cms-danger-light, #fef2f2);
            border-radius: var(--cms-radius-sm);
        }
        .cms-centrifugo__stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: .5rem 1rem;
            margin: 0;
        }
        .cms-centrifugo__stats > div {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .cms-centrifugo__stats dt {
            color: var(--cms-text-secondary);
            font-size: .75rem;
            text-transform: uppercase;
            letter-spacing: .04em;
        }
        .cms-centrifugo__stats dd {
            margin: 0;
            color: var(--cms-text);
            font-size: 1rem;
            font-weight: 600;
        }
        .cms-centrifugo__filter {
            display: flex;
            align-items: center;
            gap: .5rem;
        }
        .cms-centrifugo__filter-label {
            color: var(--cms-text-secondary);
            font-size: .8rem;
        }
        .cms-centrifugo__filter-input {
            flex: 1;
            background: var(--cms-bg);
            color: var(--cms-text);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            padding: .35rem .6rem;
            font-family: var(--cms-font-mono, monospace);
            font-size: .85rem;
        }
        .cms-centrifugo__channels {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .cms-centrifugo__channels a {
            display: block;
            padding: .35rem .5rem;
            border-radius: var(--cms-radius-sm);
            text-decoration: none;
            color: var(--cms-text);
        }
        .cms-centrifugo__channels a:hover { background: var(--cms-border-light); }
        .cms-centrifugo__count {
            color: var(--cms-text-secondary);
            font-size: .8rem;
        }
        /* .cms-btn and .cms-btn-primary were re-declared here, shadowing the
           kit inside this component (#2030). The primary copy was also DEAD —
           no markup used it — and it painted --cms-primary (blue) where the kit
           paints --cms-accent (amber), so it would have rendered the one blue
           primary button in the admin had anything reached it. */
    `],
})
export class CentrifugoDashboardComponent implements OnInit {
    private readonly admin = inject(CentrifugoAdminService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly config     = inject(ConfigService);
    private readonly layoutActions = inject(LayoutActionsService);

    /** Backend-defined page chrome (`centrifugo:dashboard` layout config). */
    readonly layout = signal<LayoutConfig | null>(null);
    private readonly dialog = inject(Dialog);
    private readonly store = inject(Store);

    /**
     * Header action set surfaced through `cms-page-header` -- matches
     * the existing admin pages' affordance (action button(s) in the
     * page header, primary action styled with `cms-btn-primary`).
     *
     * `test-notification` (Sub-phase L) dispatches a self-targeted
     * notification through the full pipeline so the operator can
     * verify save -> Centrifugo push -> bell badge -> drawer render
     * in one click without triggering a real Document generation.
     */
    /** Declared in the `centrifugo:dashboard` layout (ADR-127), not here. */
    protected readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    protected readonly info = signal<CentrifugoNodeInfoDto | null>(null);
    protected readonly infoLoading = signal<boolean>(false);
    protected readonly infoError = signal<string | null>(null);

    protected readonly namespaces = signal<CentrifugoNamespacesListDto | null>(null);
    protected readonly namespacesLoading = signal<boolean>(false);
    protected readonly namespacesError = signal<string | null>(null);

    protected readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /**
     * Namespaces panel payload for `<coolms-datagrid gridId="centrifugo:namespaces">`.
     *
     * `id` is the namespace NAME — datagrid selection is keyed on `row['id']`,
     * and namespace names are unique by construction (they are the config keys
     * modules declare via `Extension::prepend`).
     *
     * `historyTtl` is em-dashed when blank: an unset TTL is the normal state
     * for a history-less namespace, not missing data. `historySize` keeps its
     * literal 0 — that is a real value ("history disabled"), and blanking it
     * would make "off" indistinguishable from "unknown".
     */
    protected readonly namespaceGridData = computed((): DataGridData => {
        const rows = (this.namespaces()?.namespaces ?? []).map(n => ({
            id:          n.name,
            name:        n.name,
            private:     n.private,
            historySize: n.historySize,
            historyTtl:  n.historyTtl || '—',
            presence:    n.presence,
        }));

        return {
            items:      rows,
            totalItems: rows.length,
            page:       1,
            limit:      rows.length,
            totalPages: 1,
            hasMore:    false,
        };
    });

    protected readonly channels = signal<CentrifugoChannelsListDto | null>(null);
    protected readonly channelsLoading = signal<boolean>(false);
    protected readonly channelsError = signal<string | null>(null);
    protected readonly pattern = signal<string>('');

    private readonly patternChange$ = new Subject<string>();

    ngOnInit(): void {
        // Page chrome is backend-defined; one cached fetch, degrading to no
        // actions rather than breaking the page.
        this.config.layout('centrifugo:dashboard').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });
        this.loadInfo();
        this.loadNamespaces();
        this.fetchChannels('');

        this.patternChange$
            .pipe(
                debounceTime(300),
                distinctUntilChanged(),
                switchMap(p => {
                    this.channelsLoading.set(true);
                    this.channelsError.set(null);
                    return this.admin.getChannels(p === '' ? null : p).pipe(
                        catchError((err: Error) => {
                            this.channelsError.set(err.message ?? 'Failed to fetch channels.');
                            this.channelsLoading.set(false);
                            return of(null);
                        }),
                    );
                }),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(res => {
                if (res !== null) {
                    this.channels.set(res);
                    this.channelsLoading.set(false);
                }
            });
    }

    onHeaderAction(actionId: string): void {
        if (actionId === 'publish') {
            this.openPublishDialog();
            return;
        }
        if (actionId === 'test-notification') {
            this.sendTestNotification();
        }
    }

    private openPublishDialog(): void {
        this.dialog.open<boolean, void, CentrifugoPublishDialogComponent>(
            CentrifugoPublishDialogComponent,
        );
    }

    private sendTestNotification(): void {
        this.dialog.open<boolean, void, SendNotificationDialogComponent>(
            SendNotificationDialogComponent,
        );
    }

    onPatternChange(value: string): void {
        this.pattern.set(value);
        this.patternChange$.next(value);
    }

    loadInfo(): void {
        this.infoLoading.set(true);
        this.infoError.set(null);
        this.admin.getNodeInfo()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: i => {
                    this.info.set(i);
                    this.infoLoading.set(false);
                },
                error: (err: Error) => {
                    this.infoError.set(err.message ?? 'Failed to fetch node info.');
                    this.infoLoading.set(false);
                },
            });
    }

    loadNamespaces(): void {
        this.namespacesLoading.set(true);
        this.namespacesError.set(null);
        this.admin.getNamespaces()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: n => {
                    this.namespaces.set(n);
                    this.namespacesLoading.set(false);
                },
                error: (err: Error) => {
                    this.namespacesError.set(err.message ?? 'Failed to fetch namespaces.');
                    this.namespacesLoading.set(false);
                },
            });
    }

    reloadChannels(): void {
        this.fetchChannels(this.pattern());
    }

    private fetchChannels(pattern: string): void {
        this.channelsLoading.set(true);
        this.channelsError.set(null);
        this.admin.getChannels(pattern === '' ? null : pattern)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: ch => {
                    this.channels.set(ch);
                    this.channelsLoading.set(false);
                },
                error: (err: Error) => {
                    this.channelsError.set(err.message ?? 'Failed to fetch channels.');
                    this.channelsLoading.set(false);
                },
            });
    }

    protected formatUptime(seconds: number): string {
        if (seconds < 60) {
            return seconds + 's';
        }
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        if (m < 60) {
            return m + 'm ' + s + 's';
        }
        const h = Math.floor(m / 60);
        const mm = m % 60;
        if (h < 24) {
            return h + 'h ' + mm + 'm';
        }
        const d = Math.floor(h / 24);
        const hh = h % 24;
        return d + 'd ' + hh + 'h';
    }
}
