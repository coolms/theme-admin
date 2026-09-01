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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { filter, switchMap } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsPageHeaderComponent,
    ConfirmDialogService,
    DateTimeFormatService,
    ErrorBannerComponent,
    LoadingComponent,
    PageTitleService,
    PageToolbarComponent,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { LeadChannel, LeadDto, LeadsService } from './leads.service';

/** Channel value → human label (mirrors the backend `LeadChannel::label()`). */
const CHANNEL_LABELS: Record<LeadChannel, string> = {
    web_form:     'Web form',
    dynamic_chat: 'Chat',
    email:        'Email',
    phone:        'Phone',
};

/**
 * Omnichannel convergence — Lead detail admin page (/admin/leads/:id).
 *
 * The list ({@link LeadsListComponent}) triages many leads at a glance; this is
 * where an agent lands to inspect ONE: the full (untruncated) message, all
 * captured contact fields, the derived inbound channel, attribution + timeline,
 * plus the same Handle / Spam / Reopen triage actions the list offers (so a
 * lead can be worked without bouncing back to the queue).
 *
 * Reads `GET /leads/{id}` (#1337); a 404 (unknown id / deleted) surfaces as an
 * error banner rather than an empty shell. Triage actions call the existing
 * transition endpoints then re-fetch, so the header chips + gated actions stay
 * in sync with the new status. All fields are plain text — Angular
 * interpolation auto-escapes, so there is no XSS sink.
 */
@Component({
    selector: 'coolms-admin-lead-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [LoadingComponent, ErrorBannerComponent, CmsPageHeaderComponent, PageToolbarComponent, RouterLink],
    template: `
        @if (loading()) {
            <app-loading label="Loading lead…" />
        } @else if (error()) {
            <app-error-banner [message]="error()!" />
        } @else {
          @if (lead(); as l) {
            <cms-page-header
                [title]="headerTitle()"
                icon="inbox"
                [actions]="headerActions()"
                (actionClick)="onAction($event)">
                <div header-meta class="detail-chips">
                    <span class="chip chip--channel">{{ channelLabel(l.channel) }}</span>
                    <span class="chip"
                          [class.chip--ok]="l.status === 'handled'"
                          [class.chip--off]="l.status === 'spam'"
                          [class.chip--new]="l.status === 'new'">
                        {{ statusLabel(l.status) }}
                    </span>
                </div>
            </cms-page-header>

            <!-- Declares nothing itself: the tree says which triage buttons
                 exist and its conditions decide which of them this lead's state
                 allows. The bar renders nothing, every node being position
                 header. -->
            <app-page-toolbar
                [treeSlug]="toolbarTree"
                [context]="toolbarContext()"
                (headerActionsChanged)="headerActions.set($event)"
                (actionClick)="onAction($event)" />

            <div class="detail-page">

                <!-- Contact -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Contact</h2></header>
                    <div class="card__body">
                        <dl>
                            <dt>Name</dt>
                            <dd>{{ l.name || '—' }}</dd>
                            <dt>Email</dt>
                            @if (l.email) {
                                <dd><a [href]="'mailto:' + l.email">{{ l.email }}</a></dd>
                            } @else {
                                <dd>—</dd>
                            }
                            <dt>Phone</dt>
                            @if (phone()) {
                                <dd>
                                    <a [href]="'tel:' + phone()!.e164">{{ phone()!.display }}</a>
                                    <span class="mono muted"> ({{ phone()!.e164 }})</span>
                                </dd>
                            } @else {
                                <dd>—</dd>
                            }
                            <dt>Channel</dt>
                            <dd>{{ channelLabel(l.channel) }}</dd>
                        </dl>
                    </div>
                </section>

                <!-- Message -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Message</h2></header>
                    <div class="card__body">
                        <p class="message">{{ l.message || '—' }}</p>
                    </div>
                </section>

                <!-- Attribution -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Attribution</h2></header>
                    <div class="card__body">
                        <dl>
                            <dt>Form</dt>
                            <dd class="mono">{{ l.formId || '—' }}</dd>
                            <dt>Source</dt>
                            @if (l.source) {
                                <dd><a [href]="l.source" target="_blank" rel="noopener noreferrer">{{ l.source }}</a></dd>
                            } @else {
                                <dd>—</dd>
                            }
                            <dt>Received</dt>
                            <dd>{{ formatDateTime(l.createdAt) }}</dd>
                            <dt>Handled</dt>
                            <dd>{{ formatDateTime(l.handledAt) }}</dd>
                        </dl>
                    </div>
                </section>

                <!-- Identity -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Identity</h2></header>
                    <div class="card__body">
                        <dl>
                            <dt>Lead ID</dt>
                            <dd class="mono">{{ l.id || '—' }}</dd>
                            <dt>Contact</dt>
                            @if (contactId(); as cid) {
                                <dd><a class="mono" [routerLink]="['/contacts', cid]">{{ cid }}</a></dd>
                            } @else {
                                <dd>—</dd>
                            }
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
        .chip--channel { background: var(--cms-surface-muted); color: var(--cms-text-body); }
        .chip--new { background: var(--cms-info-subtle); color: var(--cms-info-text); }
        .chip--ok  { background: var(--cms-success-subtle); color: var(--cms-success-text); }
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

        .message { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: .9rem; }
        .mono { font-family: var(--cms-font-mono, monospace); }
        .muted { color: var(--cms-text-muted, #848b96); }
    `],
})
export class LeadDetailComponent implements OnInit {
    private readonly api        = inject(LeadsService);
    private readonly router     = inject(Router);
    private readonly route      = inject(ActivatedRoute);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly toast      = inject(ToastService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dtf        = inject(DateTimeFormatService);

    readonly lead    = signal<LeadDto | null>(null);
    readonly loading = signal(true);
    readonly error   = signal<string | null>(null);
    /** Blocks double-submit while a transition is in flight. */
    private readonly busy = signal(false);

    readonly headerTitle = computed(() => {
        const l = this.lead();
        return l ? `Lead — ${l.name || l.email || l.id}` : 'Lead';
    });

    /** E.164 + human display, or null when the lead has no phone. */
    readonly phone = computed((): { e164: string; display: string } | null => {
        const l = this.lead();
        if (!l?.phone) return null;
        return { e164: l.phone, display: l.phoneDisplay || l.phone };
    });

    readonly contactId = computed(() => this.lead()?.contactId ?? null);

    /** @see LeadDetailToolbarContributor — the server owns which buttons exist. */
    readonly toolbarTree = 'navi.toolbar.lead.detail';

    /** Filled from the toolbar tree, not built here. */
    readonly headerActions = signal<ToolbarAction[]>([]);

    /**
     * What the tree's conditions are evaluated against.
     *
     * The page reports the lead's state; the tree decides which triage buttons
     * that state allows. When Handle applies and when Reopen replaces it is
     * policy, and it used to be an `if` compiled into the bundle.
     */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const l = this.lead();

        return {
            _status: l?.status ?? '',
            // Only a DynamicChat lead whose conversation is still open has one.
            _hasConversation: null !== (l?.conversationId ?? null),
        };
    });

    ngOnInit(): void {
        this.route.paramMap.pipe(
            filter(pm => !!pm.get('id')),
            switchMap(pm => {
                const id = pm.get('id')!;
                this.titleSvc.set('Lead');
                this.loading.set(true);
                this.error.set(null);
                return this.api.get(id);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: l => { this.lead.set(l); this.loading.set(false); },
            error: (err: unknown) => {
                this.error.set(this.errors.humanize(err));
                this.loading.set(false);
            },
        });
    }

    onAction(actionId: string): void {
        if (actionId === 'back')      { void this.router.navigate(['/leads']); return; }
        if (actionId === 'open-chat') { this.openChat(); return; }
        if (actionId === 'handle')    { this.act('handle'); return; }
        if (actionId === 'reopen')    { this.act('reopen'); return; }
        if (actionId === 'spam')      { this.confirmSpam(); return; }
    }

    /** Deep-link into the agent chat queue with this lead's conversation pre-selected. */
    private openChat(): void {
        const conversationId = this.lead()?.conversationId;
        if (!conversationId) return;
        void this.router.navigate(['/dynamic-chat'], { queryParams: { c: conversationId } });
    }

    channelLabel(channel: LeadChannel): string {
        return CHANNEL_LABELS[channel] ?? channel;
    }

    statusLabel(status: LeadDto['status']): string {
        switch (status) {
            case 'handled': return 'Handled';
            case 'spam':    return 'Spam';
            default:        return 'New';
        }
    }

    formatDateTime(iso: string | null | undefined): string {
        if (!iso) return '—';
        try {
            return this.dtf.dateTime(iso);
        } catch {
            return iso;
        }
    }

    private confirmSpam(): void {
        const l = this.lead();
        if (!l) return;
        this.confirmSvc.open({
            title:        'Mark as spam',
            message:      `Move the lead from "${l.name}" to the spam queue?`,
            confirmLabel: 'Mark spam',
        }).pipe(
            filter(Boolean),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => this.act('spam'));
    }

    /** Run a transition, then re-fetch so the header + gated actions reflect the new status. */
    private act(kind: 'handle' | 'spam' | 'reopen'): void {
        const l = this.lead();
        if (!l?.id || this.busy()) return;
        this.busy.set(true);
        const call =
            kind === 'handle' ? this.api.handle(l.id) :
            kind === 'spam'   ? this.api.spam(l.id)   :
                                this.api.reopen(l.id);
        call.pipe(
            switchMap(() => this.api.get(l.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: fresh => {
                this.lead.set(fresh);
                this.busy.set(false);
                this.toast.success(this.successMessage(kind));
            },
            error: () => {
                this.busy.set(false);
                this.toast.error('Action failed — please retry');
            },
        });
    }

    private successMessage(kind: 'handle' | 'spam' | 'reopen'): string {
        switch (kind) {
            case 'handle': return 'Lead marked handled';
            case 'spam':   return 'Lead marked as spam';
            default:       return 'Lead reopened';
        }
    }
}
