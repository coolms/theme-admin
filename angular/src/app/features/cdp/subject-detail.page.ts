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
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
    CmsPageHeaderComponent,
    LayoutActionsService,
    PageTitleService,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { ConfigService, type LayoutConfig } from '@coolms/core-angular';
import { CdpService } from './cdp.service';
import { SubjectDto } from './cdp.types';
import { ContactsService, ContactDto } from '../contacts/contacts.service';

interface EventBreakdownRow {
    readonly type:  string;
    readonly count: number;
}

/**
 *Phase 3 (CDP core, ) — Subject profile detail
 * (`/admin/cdp/subjects/:key`).
 *
 * Read-only view of one CDP subject: identity (kind + stitched userRef),
 * first/last-seen span, and the counts-only activity profile — a per-type event
 * breakdown (proportional bars, mirroring the analytics dashboard) plus the
 * segments the subject currently matches.
 */
@Component({
    selector: 'coolms-cdp-subject-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsPageHeaderComponent, RouterLink, DatePipe],
    template: `
        <cms-page-header
            icon="person-bounding-box"
            [title]="'Subject profile'"
            [subtitle]="key()"
            [actions]="headerActions()"
            (actionClick)="onHeaderAction($event)">
        </cms-page-header>

        <div class="cms-subj">
            <a class="cms-subj__back" routerLink="/cdp/subjects"><i class="bi bi-arrow-left"></i> Back to subjects</a>

            @if (loading()) {
                <p class="cms-subj__hint">Loading profile…</p>
            } @else if (error()) {
                <p class="cms-subj__error"><i class="bi bi-exclamation-circle"></i> Couldn't load this subject.</p>
            } @else {
                @if (subject(); as s) {
                <section class="cms-subj__card">
                    <h2 class="cms-subj__title"><i class="bi bi-fingerprint"></i> Identity</h2>
                    <dl class="cms-subj__grid">
                        <dt>Key</dt><dd><code class="cms-subj__code">{{ s.key }}</code></dd>
                        <dt>Kind</dt>
                        <dd>
                            <span class="cms-subj__badge"
                                  [class.cms-subj__badge--known]="s.kind === 'known'"
                                  [class.cms-subj__badge--anon]="s.kind === 'anonymous'">{{ s.kind }}</span>
                        </dd>
                        @if (s.userRef) {
                            <dt>User ref</dt><dd><code class="cms-subj__code">{{ s.userRef }}</code></dd>
                        }
                        @if (contact(); as ct) {
                            <dt>Contact</dt>
                            <dd><a class="cms-subj__link" [routerLink]="['/contacts', ct.id]"><i class="bi bi-person-lines-fill"></i> {{ ct.displayName || ct.id }}</a></dd>
                        }
                        <dt>First seen</dt><dd>{{ s.firstSeen | date:'medium' }}</dd>
                        <dt>Last seen</dt><dd>{{ s.lastSeen | date:'medium' }}</dd>
                        <dt>Total events</dt><dd class="cms-subj__num">{{ s.totalEvents || s.eventCount }}</dd>
                    </dl>
                </section>

                <section class="cms-subj__card">
                    <h2 class="cms-subj__title"><i class="bi bi-activity"></i> Activity — by event type</h2>
                    @if (breakdown().length === 0) {
                        <p class="cms-subj__hint">No per-type counts recorded.</p>
                    } @else {
                        <ol class="cms-subj__list">
                            @for (row of breakdown(); track row.type) {
                                <li class="cms-subj__row">
                                    <span class="cms-subj__label" [title]="row.type">{{ row.type }}</span>
                                    <span class="cms-subj__bar-wrap">
                                        <span class="cms-subj__bar" [style.width.%]="barWidth(row.count)"></span>
                                    </span>
                                    <span class="cms-subj__count">{{ row.count }}</span>
                                </li>
                            }
                        </ol>
                    }
                </section>

                <section class="cms-subj__card">
                    <h2 class="cms-subj__title"><i class="bi bi-diagram-3"></i> Segments</h2>
                    @if (s.segments.length === 0) {
                        <p class="cms-subj__hint">This subject matches no segments.</p>
                    } @else {
                        <div class="cms-subj__chips">
                            @for (seg of s.segments; track seg) {
                                <a class="cms-subj__chip" [routerLink]="['/cdp/segments', seg]">{{ seg }}</a>
                            }
                        </div>
                    }
                </section>
                }
            }
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .cms-subj { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; overflow-y: auto; }
        .cms-subj__back { color: var(--cms-primary, #2563eb); text-decoration: none; font-size: 0.85rem; }
        .cms-subj__hint { color: var(--cms-text-muted, #848b96); }
        .cms-subj__error { color: var(--cms-danger, #dc2626); font-size: 0.88rem; }
        .cms-subj__card {
            border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius, 6px);
            background: var(--cms-surface, #fff); padding: 0.875rem 1rem; max-width: 46rem;
        }
        .cms-subj__title {
            display: inline-flex; align-items: center; gap: 0.45rem;
            margin: 0 0 0.75rem; font-size: 1rem; color: var(--cms-text, #111827);
        }
        .cms-subj__grid {
            display: grid; grid-template-columns: 8rem 1fr; gap: 0.4rem 0.75rem; margin: 0; font-size: 0.9rem;
        }
        .cms-subj__grid dt { color: var(--cms-text-muted, #848b96); }
        .cms-subj__grid dd { margin: 0; color: var(--cms-text, #111827); }
        .cms-subj__num { font-variant-numeric: tabular-nums; font-weight: 600; }
        .cms-subj__code {
            font-family: var(--cms-font-mono, ui-monospace, monospace); font-size: 0.8rem;
            color: var(--cms-text, #111827); word-break: break-all;
        }
        .cms-subj__link { color: var(--cms-primary, #2563eb); text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem; }
        .cms-subj__link:hover { text-decoration: underline; }
        .cms-subj__badge { font-size: 0.72rem; font-weight: 600; padding: 0.1rem 0.5rem; border-radius: 999px; text-transform: capitalize; }
        .cms-subj__badge--known { background: var(--cms-info-light, #eff6ff); color: var(--cms-primary, #2563eb); }
        .cms-subj__badge--anon  { background: var(--cms-surface-muted, #f3f4f6); color: var(--cms-text-muted, #848b96); }
        .cms-subj__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
        .cms-subj__row { display: grid; grid-template-columns: minmax(0, 14rem) 1fr auto; align-items: center; gap: 0.75rem; }
        .cms-subj__label {
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            color: var(--cms-text, #111827); font-size: 0.9rem;
        }
        .cms-subj__bar-wrap { height: 0.6rem; border-radius: 999px; background: var(--cms-surface-muted, #f3f4f6); overflow: hidden; }
        .cms-subj__bar { display: block; height: 100%; min-width: 2px; border-radius: 999px; background: var(--cms-primary, #2563eb); }
        .cms-subj__count { font-variant-numeric: tabular-nums; font-weight: 600; min-width: 2.5rem; text-align: right; }
        .cms-subj__chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .cms-subj__chip {
            font-size: 0.78rem; padding: 0.15rem 0.6rem; border-radius: 999px;
            background: var(--cms-info-light, #eff6ff); color: var(--cms-primary, #2563eb); text-decoration: none;
        }
    `],
})
export class SubjectDetailPageComponent implements OnInit {
    private readonly api        = inject(CdpService);
    private readonly contacts   = inject(ContactsService);
    private readonly toast      = inject(ToastService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly route      = inject(ActivatedRoute);
    private readonly router     = inject(Router);
    private readonly destroyRef = inject(DestroyRef);
    private readonly config     = inject(ConfigService);
    private readonly layoutActions = inject(LayoutActionsService);

    /** Backend-defined page chrome (`analytics:subject-detail` layout config). */
    readonly layout = signal<LayoutConfig | null>(null);

    readonly key     = signal('');
    readonly subject = signal<SubjectDto | null>(null);
    /** C.7 reverse cross-link — the Person (Contact) behind a known subject's userRef, or null. */
    readonly contact = signal<ContactDto | null>(null);
    readonly loading = signal(true);
    readonly error   = signal(false);

    /** Per-type counts as a busiest-first array for the bar list. */
    readonly breakdown = computed<EventBreakdownRow[]>(() => {
        const counts = this.subject()?.eventCounts ?? {};
        return Object.entries(counts)
            .map(([type, count]) => ({ type, count: Number(count) }))
            .sort((a, b) => b.count - a.count);
    });

    private readonly maxCount = computed(() =>
        this.breakdown().reduce((max, r) => Math.max(max, r.count), 0));

    /** Declared in the `analytics:subject-detail` layout, not here. */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    ngOnInit(): void {
        // Page chrome is backend-defined; one cached fetch, degrading to no
        // actions rather than breaking the page.
        this.config.layout('analytics:subject-detail').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: cfg => this.layout.set(cfg),
            error: () => { /* chrome degrades to no actions; page still renders */ },
        });
        const key = this.route.snapshot.paramMap.get('key') ?? '';
        this.key.set(key);
        this.titleSvc.set('Subject profile');
        this.load(key);
    }

    onHeaderAction(id: string): void {
        if (id === 'refresh') this.load(this.key());
    }

    barWidth(count: number): number {
        const max = this.maxCount();
        return max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
    }

    private load(key: string): void {
        if (!key) {
            void this.router.navigate(['/cdp/subjects']);
            return;
        }
        this.loading.set(true);
        this.error.set(false);
        this.contact.set(null);
        this.api.getSubject(key).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: s => {
                this.subject.set(s);
                this.loading.set(false);
                if (s.userRef) this.loadContact(s.userRef);
            },
            error: () => { this.error.set(true); this.loading.set(false); },
        });
    }

    /**
     * Resolve the Person behind a known subject's userRef (C.7 reverse link).
     * Best-effort — a failure or no linked contact simply hides the row; it must
     * never surface an error over the profile the page already loaded.
     */
    private loadContact(userRef: string): void {
        this.contacts.byUser(userRef).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: c => this.contact.set(c),
            error: () => this.contact.set(null),
        });
    }
}
