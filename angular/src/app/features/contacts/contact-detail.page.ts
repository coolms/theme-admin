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
import { type ContactDto, ContactsService } from './contacts.service';
import { type LeadChannel, type LeadDto, type LeadStatus, LeadsService } from '../leads/leads.service';

/** Channel value -> human label (mirrors the backend `LeadChannel::label()`). */
const CHANNEL_LABELS: Record<LeadChannel, string> = {
    web_form:     'Web form',
    dynamic_chat: 'Chat',
    email:        'Email',
    phone:        'Phone',
};

/**
 * Contacts — Contact DETAIL page / Person hub (/admin/contacts/:id).
 *
 * The Contacts module (C.1–7) makes a `Contact` the cross-channel Person: a
 * lead de-duplicates INTO one (C.5), a platform user LINKS to one (C.6), a CDP
 * subject cross-links off it (C.7). This is where all of that converges into a
 * single view — the person's identity + contact channels + linked user + CDP
 * subject, PLUS their **leads across every channel** (web form / chat / email /
 * phone), each a click-through to the lead detail. It's the omnichannel
 * convergence centrepiece: one Person, every touch-point.
 *
 * Reads `GET /contacts/{id}` (existing) for the person and `GET
 * /leads?contactId={id}` for the leads. The leads read is best-effort —
 * a failure just hides the section rather than erroring the whole page.
 */
@Component({
    selector: 'coolms-admin-contact-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, LoadingComponent, ErrorBannerComponent, CmsPageHeaderComponent],
    template: `
        @if (loading()) {
            <app-loading label="Loading contact…" />
        } @else if (error()) {
            <app-error-banner [message]="error()!" />
        } @else {
          @if (contact(); as c) {
            <cms-page-header
                [title]="headerTitle()"
                icon="person-lines-fill"
                [actions]="headerActions()"
                (actionClick)="onAction($event)">
                <div header-meta class="detail-chips">
                    <span class="chip" [class.chip--shared]="c.visibility === 'shared'">
                        {{ c.visibility === 'shared' ? 'Shared' : 'Personal' }}
                    </span>
                    @if (c.userDisplayName) {
                        <span class="chip chip--user">User: {{ c.userDisplayName }}</span>
                    }
                </div>
            </cms-page-header>

            <div class="detail-page">

                <!-- Identity -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Identity</h2></header>
                    <div class="card__body">
                        <dl>
                            <dt>Name</dt>
                            <dd>{{ c.displayName || '—' }}</dd>
                            <dt>Organization</dt>
                            <dd>{{ c.organization || '—' }}</dd>
                            <dt>Job title</dt>
                            <dd>{{ c.jobTitle || '—' }}</dd>
                            <dt>Visibility</dt>
                            <dd>{{ c.visibility === 'shared' ? 'Shared directory' : 'Personal' }}</dd>
                            <dt>Platform user</dt>
                            @if (c.userId) {
                                <dd>{{ c.userDisplayName || '—' }} <span class="mono muted">({{ c.userId }})</span></dd>
                            } @else {
                                <dd>Not linked</dd>
                            }
                        </dl>
                    </div>
                </section>

                <!-- Channels -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Contact channels</h2></header>
                    <div class="card__body">
                        <dl>
                            <dt>Emails</dt>
                            @if (c.emails?.length) {
                                <dd>
                                    @for (e of c.emails; track e.value) {
                                        <div class="line">
                                            <a [href]="'mailto:' + e.value">{{ e.value }}</a>
                                            @if (e.label) { <span class="muted"> · {{ e.label }}</span> }
                                            @if (e.primary) { <span class="tag">primary</span> }
                                        </div>
                                    }
                                </dd>
                            } @else {
                                <dd>—</dd>
                            }
                            <dt>Phones</dt>
                            @if (c.phones?.length) {
                                <dd>
                                    @for (p of c.phones; track p.value) {
                                        <div class="line">
                                            <a [href]="'tel:' + p.value">{{ p.value }}</a>
                                            @if (p.label) { <span class="muted"> · {{ p.label }}</span> }
                                            @if (p.primary) { <span class="tag">primary</span> }
                                        </div>
                                    }
                                </dd>
                            } @else {
                                <dd>—</dd>
                            }
                        </dl>
                    </div>
                </section>

                <!-- Leads across channels -->
                <section class="card">
                    <header class="card__head">
                        <h2 class="card__title">Leads</h2>
                        <span class="card__count">{{ leads().length }}</span>
                    </header>
                    <div class="card__body">
                        @if (leads().length === 0) {
                            <p class="hint">No leads linked to this contact.</p>
                        } @else {
                            <ul class="leads">
                                @for (l of leads(); track l.id) {
                                    <li class="lead" (click)="openLead(l)" tabindex="0"
                                        (keydown.enter)="openLead(l)">
                                        <span class="chip chip--channel">{{ channelLabel(l.channel) }}</span>
                                        <span class="lead__name">{{ l.name || l.email || l.id }}</span>
                                        <span class="chip"
                                              [class.chip--ok]="l.status === 'handled'"
                                              [class.chip--off]="l.status === 'spam'"
                                              [class.chip--new]="l.status === 'new'">
                                            {{ statusLabel(l.status) }}
                                        </span>
                                        <span class="lead__date muted">{{ formatDateTime(l.createdAt) }}</span>
                                        <i class="bi bi-chevron-right lead__chevron"></i>
                                    </li>
                                }
                            </ul>
                        }
                    </div>
                </section>

                <!-- CDP subject (E-track cross-link) -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">CDP profile</h2></header>
                    <div class="card__body">
                        @if (c.subjectKey) {
                            <dl>
                                <dt>Subject</dt>
                                <dd><a class="mono" [routerLink]="['/cdp/subjects', c.subjectKey]">{{ c.subjectKey }}</a></dd>
                                <dt>Events</dt>
                                <dd>{{ c.subjectEventCount ?? 0 }}</dd>
                                <dt>Segments</dt>
                                @if (c.subjectSegments?.length) {
                                    <dd>
                                        @for (s of c.subjectSegments; track s) {
                                            <span class="tag">{{ s }}</span>
                                        }
                                    </dd>
                                } @else {
                                    <dd>—</dd>
                                }
                            </dl>
                        } @else {
                            <p class="hint">No CDP profile linked (the contact has no platform user, or no analytics subject exists yet).</p>
                        }
                    </div>
                </section>

                <!-- Identity refs -->
                <section class="card">
                    <header class="card__head"><h2 class="card__title">Reference</h2></header>
                    <div class="card__body">
                        <dl>
                            <dt>Contact ID</dt>
                            <dd class="mono">{{ c.id || '—' }}</dd>
                            <dt>Created</dt>
                            <dd>{{ formatDateTime(c.createdAt) }}</dd>
                            <dt>Updated</dt>
                            <dd>{{ formatDateTime(c.updatedAt) }}</dd>
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
            display: inline-block; padding: 1px 6px; border-radius: var(--cms-radius-sm, 4px);
            font-size: .7rem; background: var(--cms-meta-subtle); color: var(--cms-meta-text);
        }
        .chip--shared  { background: var(--cms-meta-subtle); color: var(--cms-meta); }
        .chip--user    { background: var(--cms-info-subtle); color: var(--cms-info-text); }
        .chip--channel { background: var(--cms-surface-muted); color: var(--cms-text-body); }
        .chip--new { background: var(--cms-info-subtle); color: var(--cms-info-text); }
        .chip--ok  { background: var(--cms-success-subtle); color: var(--cms-success-text); }
        .chip--off { background: var(--cms-danger-subtle); color: var(--cms-danger-text); }

        .card {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px); margin-bottom: 16px; overflow: hidden;
        }
        .card__head {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 16px; border-bottom: 1px solid var(--cms-border, #e5e7eb); background: var(--cms-surface-muted);
        }
        .card__title { margin: 0; font-size: .9rem; font-weight: 600; }
        .card__count {
            font-size: .72rem; background: var(--cms-surface-muted); color: var(--cms-text-body);
            border-radius: var(--cms-radius-lg, 10px); padding: 1px 8px;
        }
        .card__body { padding: 12px 16px; }

        dl { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; font-size: .9rem; margin: 0; }
        dt { color: var(--cms-text-muted, #848b96); font-weight: 500; }
        dd { margin: 0; word-break: break-word; }

        .line { padding: 1px 0; }
        .tag {
            display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: var(--cms-radius-sm, 4px);
            font-size: .68rem; background: var(--cms-surface-muted); color: var(--cms-text-body);
        }

        .leads { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
        .lead {
            display: flex; align-items: center; gap: 10px;
            padding: 8px 10px; border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius, 6px);
            cursor: pointer; font-size: .88rem;
        }
        .lead:hover { background: var(--cms-canvas, #f3f4f6); }
        .lead__name { flex: 1 1 auto; font-weight: 500; word-break: break-word; }
        .lead__date { flex: 0 0 auto; font-size: .8rem; }
        .lead__chevron { color: var(--cms-text-muted, #848b96); font-size: .8rem; }

        .hint { color: var(--cms-text-muted, #848b96); font-size: .85rem; margin: 0; }
        .mono { font-family: var(--cms-font-mono, monospace); }
        .muted { color: var(--cms-text-muted, #848b96); }
    `],
})
export class ContactDetailComponent implements OnInit {
    private readonly api        = inject(ContactsService);
    private readonly leadsApi   = inject(LeadsService);
    private readonly router     = inject(Router);
    private readonly route      = inject(ActivatedRoute);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly config     = inject(ConfigService);
    private readonly layoutActions = inject(LayoutActionsService);

    /** Backend-defined page chrome (`contact:detail` layout config). */
    readonly layout = signal<LayoutConfig | null>(null);
    private readonly dtf        = inject(DateTimeFormatService);

    readonly contact = signal<ContactDto | null>(null);
    readonly leads   = signal<LeadDto[]>([]);
    readonly loading = signal(true);
    readonly error   = signal<string | null>(null);

    readonly headerTitle = computed(() => {
        const c = this.contact();
        return c ? `Contact — ${c.displayName || c.primaryEmail || c.id}` : 'Contact';
    });

    /** Read-only page — Back only (edit/link live on the list's modal + toolbar). */
    /** Declared in the `contact:detail` layout, not here. */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    ngOnInit(): void {
        // Page chrome is backend-defined; one cached fetch, degrading to no
        // actions rather than breaking the page.
        this.config.layout('contact:detail').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });
        this.route.paramMap.pipe(
            filter(pm => !!pm.get('id')),
            switchMap(pm => {
                const id = pm.get('id')!;
                this.titleSvc.set('Contact');
                this.loading.set(true);
                this.error.set(null);
                this.leads.set([]);
                return this.api.get(id);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: c => {
                this.contact.set(c);
                this.loading.set(false);
                if (c.id) this.loadLeads(c.id);
            },
            error: (err: unknown) => {
                this.error.set(this.errors.humanize(err));
                this.loading.set(false);
            },
        });
    }

    onAction(actionId: string): void {
        if (actionId === 'back') void this.router.navigate(['/contacts']);
    }

    openLead(l: LeadDto): void {
        if (l.id) void this.router.navigate(['/leads', l.id]);
    }

    channelLabel(channel: LeadChannel): string {
        return CHANNEL_LABELS[channel] ?? channel;
    }

    statusLabel(status: LeadStatus): string {
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

    /** Best-effort: a leads-read failure just leaves the section empty, never errors the page. */
    private loadLeads(contactId: string): void {
        this.leadsApi.byContact(contactId).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  rows => this.leads.set(rows),
            error: () => { /* leave empty */ },
        });
    }
}
