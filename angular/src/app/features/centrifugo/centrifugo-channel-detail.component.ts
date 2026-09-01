import { CommonModule, DecimalPipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
    CentrifugoAdminService,
    CmsPageHeaderComponent,
    ConfirmDialogService,
    ToastService,
    type CentrifugoChannelHistoryDto,
    type CentrifugoChannelPresenceDto,
} from '@coolms/ui-angular';

/**
 * Phase 1.5 sub-phase 1.5b -- per-channel admin view at
 * `/centrifugo/channel/:name` (rendered under the SPA's `/admin/`
 * base-href). Two panels share the channel
 * name from the URL:
 *
 *   - **Presence**: who's subscribed right now. Disconnect-user
 *     button per row (with confirm dialog). The 1.5a deviation #6
 *     means namespace-mismatched channels (anything dotted in this
 *     project's defaults) return Centrifugo's "not available" 108
 *     which the backend surfaces as 503 -- shown here as an
 *     informative empty state, not a panic banner.
 *   - **History**: recent publications, newest-first by default.
 *     Limit and reverse are tweakable controls.
 *
 * Manual refresh per panel only; the spec defers live updates until
 * usage feedback suggests it.
 */
@Component({
    selector: 'app-centrifugo-channel-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        FormsModule,
        RouterLink,
        DecimalPipe,
        CmsPageHeaderComponent,
    ],
    template: `
        <cms-page-header
            title="Centrifugo channel"
            icon="broadcast"
        />

        <div class="cms-centrifugo-channel">
            <nav class="cms-centrifugo-channel__crumbs" aria-label="Breadcrumb">
                <a routerLink="/centrifugo" class="crumb">Centrifugo</a>
                <span class="crumb-sep">›</span>
                <span class="crumb crumb--active"><code>{{ channel() }}</code></span>
            </nav>

            <!-- Presence -->
            <section class="cms-centrifugo-channel__card">
                <header class="cms-centrifugo-channel__card-head">
                    <h2>Presence</h2>
                    <button type="button" class="cms-btn" (click)="loadPresence()" [disabled]="presenceLoading()">
                        <i class="bi bi-arrow-clockwise"></i> Refresh
                    </button>
                </header>

                @if (presenceLoading() && !presence()) {
                    <div class="cms-centrifugo-channel__placeholder">Loading…</div>
                } @else if (presenceError()) {
                    <div class="cms-centrifugo-channel__empty">
                        Presence is unavailable for this channel.
                        <p class="cms-centrifugo-channel__hint">
                            Centrifugo only tracks presence when the channel's namespace has
                            <code>presence: true</code>. If this channel is not under a registered
                            namespace, this panel will stay empty.
                        </p>
                    </div>
                } @else {
                    @if (presence(); as p) {
                        @if (p.count === 0) {
                            <div class="cms-centrifugo-channel__empty">No subscribers right now.</div>
                        } @else {
                            <table class="cms-centrifugo-channel__table">
                                <thead>
                                    <tr>
                                        <th>Client</th>
                                        <th>User</th>
                                        <th class="text-end">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @for (row of presenceRows(p); track row.client) {
                                        <tr>
                                            <td><code>{{ row.client }}</code></td>
                                            <td><code>{{ row.user || '—' }}</code></td>
                                            <td class="text-end">
                                                <button
                                                    type="button"
                                                    class="cms-btn cms-btn-danger"
                                                    (click)="onDisconnect(row.user, row.client)"
                                                    [disabled]="disconnectingFor() === row.client"
                                                >
                                                    <i class="bi bi-power"></i>
                                                    {{ disconnectingFor() === row.client ? 'Disconnecting…' : 'Disconnect' }}
                                                </button>
                                            </td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        }
                    }
                }
            </section>

            <!-- History -->
            <section class="cms-centrifugo-channel__card">
                <header class="cms-centrifugo-channel__card-head">
                    <h2>History</h2>
                    <div class="cms-centrifugo-channel__controls">
                        <label>
                            Limit
                            <select [ngModel]="limit()" (ngModelChange)="onLimitChange($event)">
                                <option [ngValue]="10">10</option>
                                <option [ngValue]="50">50</option>
                                <option [ngValue]="100">100</option>
                                <option [ngValue]="200">200</option>
                            </select>
                        </label>
                        <label class="cms-centrifugo-channel__toggle">
                            <input type="checkbox" [ngModel]="reverse()" (ngModelChange)="onReverseChange($event)" />
                            Newest first
                        </label>
                        <button type="button" class="cms-btn" (click)="loadHistory()" [disabled]="historyLoading()">
                            <i class="bi bi-arrow-clockwise"></i> Refresh
                        </button>
                    </div>
                </header>

                @if (historyLoading() && !history()) {
                    <div class="cms-centrifugo-channel__placeholder">Loading…</div>
                } @else if (historyError()) {
                    <div class="cms-centrifugo-channel__empty">
                        History is unavailable for this channel.
                        <p class="cms-centrifugo-channel__hint">
                            Centrifugo only stores history when the channel's namespace has
                            <code>history_size</code> and <code>history_ttl</code> set. If this
                            channel is not under a registered namespace, this panel will stay empty.
                        </p>
                    </div>
                } @else {
                    @if (history(); as h) {
                        @if (h.count === 0) {
                            <div class="cms-centrifugo-channel__empty">No publications in the history window.</div>
                        } @else {
                            <ul class="cms-centrifugo-channel__history">
                                @for (pub of h.publications; track $index) {
                                    <li>
                                        <header>
                                            <span>#{{ $index + 1 }}</span>
                                            @if (pub.offset !== undefined) {
                                                <span class="cms-centrifugo-channel__offset">offset {{ pub.offset | number }}</span>
                                            }
                                        </header>
                                        <pre>{{ stringify(pub.data) }}</pre>
                                    </li>
                                }
                            </ul>
                            <div class="cms-centrifugo-channel__count">
                                {{ h.count | number }} publication(s); limit {{ h.limit }}; {{ h.reverse ? 'newest first' : 'chronological' }}.
                            </div>
                        }
                    }
                }
            </section>
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .cms-centrifugo-channel {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            padding-top: 1rem;
            min-height: 0;
            flex: 1;
            overflow: auto;
            background: var(--cms-bg);
        }
        .cms-centrifugo-channel__crumbs {
            display: flex; align-items: center; gap: 4px;
            font-size: .85rem; color: var(--cms-text-secondary);
        }
        .crumb { color: var(--cms-text-secondary); text-decoration: none; }
        .crumb:hover { color: var(--cms-text); }
        .crumb--active { color: var(--cms-text); font-weight: 600; }
        .crumb-sep { color: var(--cms-text-muted); }

        .cms-centrifugo-channel__card {
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: .75rem;
        }
        .cms-centrifugo-channel__card-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
            flex-wrap: wrap;
        }
        .cms-centrifugo-channel__card-head h2 {
            margin: 0;
            font-size: 1rem;
            color: var(--cms-text);
        }
        .cms-centrifugo-channel__controls {
            display: flex;
            gap: .75rem;
            align-items: center;
            font-size: .85rem;
            color: var(--cms-text-secondary);
        }
        .cms-centrifugo-channel__controls select {
            background: var(--cms-bg);
            color: var(--cms-text);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            padding: .2rem .4rem;
            margin-left: .3rem;
        }
        .cms-centrifugo-channel__toggle { display: inline-flex; align-items: center; gap: .3rem; }
        .cms-centrifugo-channel__placeholder, .cms-centrifugo-channel__empty {
            color: var(--cms-text-secondary);
            text-align: center;
            padding: 1rem;
        }
        .cms-centrifugo-channel__hint {
            margin: .5rem 0 0;
            font-size: .8rem;
            color: var(--cms-text-muted);
        }
        .cms-centrifugo-channel__table {
            width: 100%; border-collapse: collapse; font-size: .85rem;
        }
        .cms-centrifugo-channel__table th, .cms-centrifugo-channel__table td {
            padding: .5rem .75rem;
            border-bottom: 1px solid var(--cms-border-light);
            text-align: left;
        }
        .cms-centrifugo-channel__table th {
            color: var(--cms-text-secondary);
            font-weight: 600;
        }
        .cms-centrifugo-channel__table .text-end { text-align: right; }
        .cms-centrifugo-channel__history {
            list-style: none; padding: 0; margin: 0;
            display: flex; flex-direction: column; gap: .5rem;
        }
        .cms-centrifugo-channel__history li {
            border: 1px solid var(--cms-border-light);
            border-radius: var(--cms-radius-sm);
            padding: .5rem .75rem;
        }
        .cms-centrifugo-channel__history li header {
            display: flex; justify-content: space-between;
            font-size: .75rem; color: var(--cms-text-muted);
            margin-bottom: .25rem;
        }
        .cms-centrifugo-channel__history pre {
            margin: 0; font-size: .8rem; overflow-x: auto;
            background: var(--cms-bg); padding: .35rem .5rem;
            border-radius: var(--cms-radius-sm);
        }
        .cms-centrifugo-channel__offset { font-family: var(--cms-font-mono, monospace); }
        .cms-centrifugo-channel__count {
            color: var(--cms-text-secondary);
            font-size: .8rem;
        }
        /* Kit shadows removed. The local .cms-btn-danger was a SOLID
           red fill; the kit's is an outline — red text on a red border — which
           is what every other destructive button in the admin looks like. This
           one now matches them, so the change is visible and deliberate. */
    `],
})
export class CentrifugoChannelDetailComponent implements OnInit {
    private readonly route = inject(ActivatedRoute);
    private readonly admin = inject(CentrifugoAdminService);
    private readonly toast = inject(ToastService);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);

    protected readonly channel = signal<string>('');

    protected readonly presence = signal<CentrifugoChannelPresenceDto | null>(null);
    protected readonly presenceLoading = signal<boolean>(false);
    protected readonly presenceError = signal<string | null>(null);

    protected readonly history = signal<CentrifugoChannelHistoryDto | null>(null);
    protected readonly historyLoading = signal<boolean>(false);
    protected readonly historyError = signal<string | null>(null);
    protected readonly limit = signal<number>(50);
    protected readonly reverse = signal<boolean>(true);

    protected readonly disconnectingFor = signal<string | null>(null);

    ngOnInit(): void {
        const name = this.route.snapshot.paramMap.get('name') ?? '';
        this.channel.set(name);
        if (name !== '') {
            this.loadPresence();
            this.loadHistory();
        }
    }

    loadPresence(): void {
        const channel = this.channel();
        if (channel === '') { return; }
        this.presenceLoading.set(true);
        this.presenceError.set(null);
        this.admin.getChannelPresence(channel)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: p => { this.presence.set(p); this.presenceLoading.set(false); },
                error: (err: Error) => {
                    this.presenceError.set(err.message ?? 'Failed to fetch presence.');
                    this.presenceLoading.set(false);
                },
            });
    }

    loadHistory(): void {
        const channel = this.channel();
        if (channel === '') { return; }
        this.historyLoading.set(true);
        this.historyError.set(null);
        this.admin.getChannelHistory(channel, this.limit(), this.reverse())
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: h => { this.history.set(h); this.historyLoading.set(false); },
                error: (err: Error) => {
                    this.historyError.set(err.message ?? 'Failed to fetch history.');
                    this.historyLoading.set(false);
                },
            });
    }

    onLimitChange(value: number): void {
        this.limit.set(value);
        this.loadHistory();
    }

    onReverseChange(value: boolean): void {
        this.reverse.set(value);
        this.loadHistory();
    }

    async onDisconnect(userId: string | undefined, clientId: string): Promise<void> {
        if (userId === undefined || userId === '') {
            this.toast.error('Cannot disconnect -- presence row has no user id.');
            return;
        }
        const confirmed = await firstValueFrom(
            this.confirm.confirm(
                'Disconnect user?',
                'This will close the WebSocket connection for client ' + clientId + ' (user ' + userId + '). The user will be kicked offline until they re-establish a connection.',
            ),
        );
        if (!confirmed) {
            return;
        }
        this.disconnectingFor.set(clientId);
        this.admin.disconnect({ userId, clientId })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.disconnectingFor.set(null);
                    this.toast.success('Client disconnected.');
                    this.loadPresence();
                },
                error: (err: Error) => {
                    this.disconnectingFor.set(null);
                    this.toast.error(err.message ?? 'Failed to disconnect.');
                },
            });
    }

    protected presenceRows(p: CentrifugoChannelPresenceDto): Array<{ client: string; user: string }> {
        const out: Array<{ client: string; user: string }> = [];
        for (const clientId of Object.keys(p.presence)) {
            const entry = p.presence[clientId];
            out.push({
                client: clientId,
                user: typeof entry.user === 'string' ? entry.user : '',
            });
        }
        return out;
    }

    protected stringify(data: unknown): string {
        if (data === null || data === undefined) {
            return '(empty)';
        }
        try {
            return JSON.stringify(data, null, 2);
        } catch {
            return String(data);
        }
    }
}
