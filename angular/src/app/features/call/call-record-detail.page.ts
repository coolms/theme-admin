import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnDestroy,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { filter, switchMap } from 'rxjs';
import { ApiService, CallRecordDto } from '../../api/api.service';
import { ErrorHandlerService, ConfigService, type LayoutConfig } from '@coolms/core-angular';
import {
    CmsPageHeaderComponent,
    DateTimeFormatService,
    ErrorBannerComponent,
    LayoutActionsService,
    LoadingComponent,
    PageTitleService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { formatCallDuration } from './call-format';

/**
 * M9.f.2 — Call detail admin page (/admin/call/records/:id).
 *
 * Read-only view of one tracked call (M9.a.4 `GET /call/records/{id}`) with
 * an inline player for its `.wav` recording (M9.b `GET
 * /call/records/{id}/recording`). CallRecords are minted + mutated only by
 * the AMI event stream (M9.a.2), so there is nothing to edit — the page is
 * a set of read-only cards + the recording card.
 *
 * The recording is Bearer-gated, so a plain `<audio src>` can't reach it;
 * the blob is fetched through {@link ApiService.downloadCallRecording} (the
 * auth interceptor attaches the token) and turned into an object URL that
 * feeds both the &lt;audio&gt; element and the Download link. The URL is
 * revoked on destroy so the blob isn't leaked.
 */
@Component({
    selector: 'coolms-admin-call-record-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [LoadingComponent, ErrorBannerComponent, CmsPageHeaderComponent],
    template: `
        @if (loading()) {
            <app-loading label="Loading call…" />
        } @else if (error()) {
            <app-error-banner [message]="error()!" />
        } @else {
          @if (record(); as c) {
            <cms-page-header
                [title]="headerTitle()"
                icon="telephone"
                [actions]="headerActions()"
                (actionClick)="onAction($event)">
                <div header-meta class="detail-chips">
                    <span class="chip">{{ c.direction || 'unknown' }}</span>
                    <span class="chip" [class.chip--ok]="c.answered" [class.chip--off]="c.missed">
                        {{ c.state || '—' }}
                    </span>
                    @if (c.missed) {
                        <span class="chip chip--off">missed</span>
                    }
                </div>
            </cms-page-header>

            <div class="detail-page">

                <!-- Overview -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Overview</h2></header>
                    <div class="card__body">
                        <dl>
                            <dt>Direction</dt>
                            <dd>{{ c.direction || '—' }}</dd>
                            <dt>State</dt>
                            <dd>{{ c.state || '—' }}</dd>
                            <dt>Answered</dt>
                            <dd>{{ c.answered ? 'Yes' : 'No' }}</dd>
                            <dt>Duration</dt>
                            <dd>{{ formatCallDuration(c.durationSeconds) }}</dd>
                            <dt>Hangup cause</dt>
                            <dd>{{ c.hangupCause || '—' }}</dd>
                        </dl>
                    </div>
                </section>

                <!-- Parties -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Parties</h2></header>
                    <div class="card__body">
                        <dl>
                            <dt>From</dt>
                            <dd>{{ c.fromNumber || '—' }}</dd>
                            <dt>To</dt>
                            <dd>{{ c.toNumber || '—' }}</dd>
                            <dt>Caller name</dt>
                            <dd>{{ c.callerName || '—' }}</dd>
                            <dt>Channel</dt>
                            <dd class="mono">{{ c.channel || '—' }}</dd>
                            <dt>Agent</dt>
                            @if (agentLabel(); as label) {
                                <dd>{{ label }} <span class="mono">({{ c.assignedUserRef }})</span></dd>
                            } @else {
                                <dd class="mono">{{ c.assignedUserRef || '—' }}</dd>
                            }
                        </dl>
                    </div>
                </section>

                <!-- Timing -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Timing</h2></header>
                    <div class="card__body">
                        <dl>
                            <dt>Started</dt>
                            <dd>{{ formatDateTime(c.startedAt) }}</dd>
                            <dt>Answered at</dt>
                            <dd>{{ formatDateTime(c.answeredAt) }}</dd>
                            <dt>Ended</dt>
                            <dd>{{ formatDateTime(c.endedAt) }}</dd>
                            <dt>Created</dt>
                            <dd>{{ formatDateTime(c.createdAt) }}</dd>
                            <dt>Updated</dt>
                            <dd>{{ formatDateTime(c.updatedAt) }}</dd>
                        </dl>
                    </div>
                </section>

                <!-- Recording -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Recording</h2></header>
                    <div class="card__body recording">
                        @if (!c.recordingNodeRef) {
                            <p class="hint">No recording is attached to this call.</p>
                        } @else if (audioLoading()) {
                            <p class="hint">Loading recording…</p>
                        } @else if (audioError()) {
                            <p class="error">{{ audioError() }}</p>
                        } @else {
                            @if (audioUrl(); as src) {
                                <audio controls preload="metadata" [src]="src"></audio>
                                <a class="btn" [href]="src" [download]="downloadName(c)">
                                    Download .wav
                                </a>
                            }
                        }
                    </div>
                </section>

                <!-- Identity -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Identity</h2></header>
                    <div class="card__body">
                        <dl>
                            <dt>Call ID</dt>
                            <dd class="mono">{{ c.callId || '—' }}</dd>
                            <dt>Record ID</dt>
                            <dd class="mono">{{ c.id || '—' }}</dd>
                        </dl>
                    </div>
                </section>

            </div>
          }
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .detail-page { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 0 32px; }

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

        dl {
            display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px;
            font-size: .9rem; margin: 0;
        }
        dt { color: var(--cms-text-muted, #848b96); font-weight: 500; }
        dd { margin: 0; word-break: break-word; }

        .recording { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
        .recording audio { width: 100%; max-width: 480px; }

        .hint { color: var(--cms-text-muted, #848b96); font-size: .85rem; margin: 0; }
        .error { color: var(--cms-danger, #dc2626); font-size: .85rem; margin: 0; }
        .mono { font-family: var(--cms-font-mono, monospace); }

        .btn {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 6px 14px;
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-sm, 4px);
            background: transparent;
            font-size: .85rem;
            text-decoration: none;
            color: var(--cms-text, #111827);
            cursor: pointer;
        }
    `],
})
export class CallRecordDetailComponent implements OnInit, OnDestroy {
    private readonly api        = inject(ApiService);
    private readonly router     = inject(Router);
    private readonly route      = inject(ActivatedRoute);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly config     = inject(ConfigService);
    private readonly layoutActions = inject(LayoutActionsService);

    /** Backend-defined page chrome (`call:record-detail` layout config). */
    readonly layout = signal<LayoutConfig | null>(null);
    private readonly dtf        = inject(DateTimeFormatService);

    readonly record  = signal<CallRecordDto | null>(null);
    readonly loading = signal(true);
    readonly error   = signal<string | null>(null);

    readonly audioUrl     = signal<string | null>(null);
    readonly audioLoading = signal(false);
    readonly audioError   = signal<string | null>(null);

    /** Server-resolved display name for the routed agent (from `assignedUserName`); null when unassigned/unknown. */
    readonly agentLabel   = signal<string | null>(null);

    /** Single hardcoded back action; the page is read-only (no edit / delete). */
    /** Declared in the `call:record-detail` layout (ADR-127), not here. */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    readonly headerTitle = computed(() => {
        const c = this.record();
        if (!c) return 'Call';
        const who = c.callerName || c.fromNumber || c.toNumber || c.callId;
        return who ? `Call — ${who}` : 'Call';
    });

    ngOnInit(): void {
        // Page chrome is backend-defined; one cached fetch, degrading to no
        // actions rather than breaking the page.
        this.config.layout('call:record-detail').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });
        this.route.paramMap.pipe(
            filter(pm => !!pm.get('id')),
            switchMap(pm => {
                const id = pm.get('id')!;
                this.titleSvc.set('Call');
                this.loading.set(true);
                this.error.set(null);
                this.revokeAudio();
                this.audioUrl.set(null);
                this.audioError.set(null);
                this.agentLabel.set(null);
                return this.api.getCallRecord(id);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: c => {
                this.record.set(c);
                this.loading.set(false);
                if (c.recordingNodeRef && c.id) this.loadRecording(c.id);
                // The agent name is resolved server-side (M9) — no extra round-trip.
                this.agentLabel.set(c.assignedUserName ?? null);
            },
            error: (err: unknown) => {
                this.error.set(this.errors.humanize(err));
                this.loading.set(false);
            },
        });
    }

    ngOnDestroy(): void {
        this.revokeAudio();
    }

    /** cms-page-header dispatcher. `back` → the call-history list. */
    onAction(actionId: string): void {
        if (actionId === 'back') void this.router.navigate(['/call/records']);
    }

    private loadRecording(id: string): void {
        this.audioLoading.set(true);
        this.audioError.set(null);
        this.api.downloadCallRecording(id).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: blob => {
                this.revokeAudio();
                this.audioUrl.set(URL.createObjectURL(blob));
                this.audioLoading.set(false);
            },
            error: (err: unknown) => {
                this.audioLoading.set(false);
                this.audioError.set(this.errors.humanize(err));
            },
        });
    }

    private revokeAudio(): void {
        const url = this.audioUrl();
        if (url) URL.revokeObjectURL(url);
    }

    downloadName(c: CallRecordDto): string {
        return `call-${c.callId || c.id || 'recording'}.wav`;
    }

    formatDateTime(iso: string | null | undefined): string {
        if (!iso) return '—';
        try {
            return this.dtf.dateTime(iso);
        } catch {
            return iso;
        }
    }

    protected readonly formatCallDuration = formatCallDuration;
}
