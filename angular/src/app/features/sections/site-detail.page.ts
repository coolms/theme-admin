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
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import {
    ApiService,
    SiteDto,
    SiteMemberDto,
    SiteSectionDto,
} from '../../api/api.service';
import { ErrorHandlerService, ConfigService, LayoutConfig } from '@coolms/core-angular';
import {
    CmsDetailFooterComponent,
    CmsPageHeaderComponent,
    ConfirmDialogService,
    ErrorBannerComponent,
    LayoutActionsService,
    LoadingComponent,
    PageTitleService,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { SectionFormComponent } from './section-form.component';
import { LoadSections } from './section.actions';

/**
 * Phase I Layer 3d.1 — Site Detail admin page (ADR-117).
 *
 * Routed at `/admin/sections/:slug`. Read-mostly composition view that
 * surfaces the four pieces a SiteSection ties together (Settings,
 * NaviTrees, Content Root, Members) on a single page. Mutation actions
 * (`Edit Settings`, `Delete Site`) are gated on
 * `currentUserMembership.isAdministrator` for FE clarity; the backend
 * is the actual gate.
 *
 * Data:
 *   - `GET /api/v1/web/sites/{slug}` -> SiteDto (with embedded
 *     `currentUserMembership`)
 *   - `GET /api/v1/web/sites/{slug}/members` -> top-of-page members
 *     preview (and full list inside the "View all" modal)
 *
 * Membership *changes* (add/remove editor, transfer ownership) live
 * on the dedicated Members management page at
 * `/admin/sections/:slug/members` (Layer 3d.3). The Members card here
 * is a read-only preview that deep-links to that page.
 */
@Component({
    selector: 'app-site-detail-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, LoadingComponent, ErrorBannerComponent, CmsPageHeaderComponent, CmsDetailFooterComponent],
    template: `
        @if (loading()) {
            <app-loading label="Loading site…" />
        } @else if (error()) {
            <app-error-banner [message]="error()!" />
        } @else if (site()) {
            @let s = site()!;

                <!--
                  Standard page chrome. Actions are declared in the backend
                  layout config (web:section-detail): navigation in the
                  cms-page-header bar, primary/destructive in the fixed footer
                  (ADR-127). Status / role chips project into the header-meta
                  slot on the title baseline.
                -->
                <cms-page-header
                    [title]="s.label || s.slug || 'Site'"
                    [icon]="layout()?.icon || 'collection'"
                    [actions]="headerActions()"
                    (actionClick)="onAction($event)">
                    <div header-meta class="detail-chips">
                        <span class="chip chip--slug">{{ s.slug }}</span>
                        @if (s.isActive) {
                            <span class="chip chip--active">active</span>
                        } @else {
                            <span class="chip chip--inactive">inactive</span>
                        }
                        @if (s.host) {
                            <span class="chip chip--host" title="Host matcher">
                                <i class="bi bi-globe"></i> {{ s.host }}
                            </span>
                        }
                        @for (role of membershipRoles(); track role) {
                            <span class="chip chip--role">{{ role }}</span>
                        }
                    </div>
                </cms-page-header>

                <!-- Cards grid (scroll region) -->
                <div class="detail-page">
                <div class="detail-cards">

                    <!-- Settings -->
                    <section class="card">
                        <header class="card__head">
                            <h2 class="card__title">
                                <i class="bi bi-sliders"></i> Settings
                            </h2>
                        </header>
                        <div class="card__body">
                            <dl class="kv">
                                <dt>Host</dt>
                                <dd>{{ s.host ?? noneText }}</dd>
                                <dt>Path prefix</dt>
                                <dd>{{ s.pathPrefix ?? noneText }}</dd>
                                <dt>Priority</dt>
                                <dd>{{ s.priority ?? noneText }}</dd>
                                <dt>Theme</dt>
                                <dd>{{ s.themeSlug ?? noneText }}</dd>
                                <dt>Default locale</dt>
                                <dd>{{ s.defaultLocale ?? noneText }}</dd>
                                <dt>FE stack</dt>
                                <dd>{{ s.feStack ?? noneText }}</dd>
                            </dl>
                            <!--
                                Layer 3d.2 deep-link into the Routing Inspector
                                with this site's host pre-filled (or 'localhost'
                                when the section is a catch-all). Path defaults
                                to '/' -- admins can adjust on the Inspector page.
                            -->
                            <a [routerLink]="['/routing-inspector']"
                               [queryParams]="{ host: routingInspectorHost(), path: '/' }"
                               class="cms-btn cms-btn-link cms-btn-sm">
                                Test routing for this site
                                <i class="bi bi-box-arrow-up-right"></i>
                            </a>
                        </div>
                    </section>

                    <!-- NaviTrees -->
                    <section class="card">
                        <header class="card__head">
                            <h2 class="card__title">
                                <i class="bi bi-diagram-3"></i> Navigation Trees
                            </h2>
                            <span class="card__count">{{ s.naviTrees.length }}</span>
                        </header>
                        <div class="card__body">
                            @if (s.naviTrees.length === 0) {
                                <p class="empty">
                                    No navigation trees for this site.
                                </p>
                                <a routerLink="/navi" class="cms-btn cms-btn-link cms-btn-sm">
                                    <i class="bi bi-plus-lg"></i> Manage navigation
                                </a>
                            } @else {
                                <ul class="list">
                                    @for (t of s.naviTrees; track t.treeId) {
                                        <li class="list__row">
                                            <div class="list__main">
                                                <span class="mono">{{ t.slug }}</span>
                                                <span class="muted">{{ t.label }}</span>
                                            </div>
                                            <a [routerLink]="['/navi', t.slug, 'nodes']"
                                               class="cms-btn cms-btn-link cms-btn-sm">
                                                Open <i class="bi bi-box-arrow-up-right"></i>
                                            </a>
                                        </li>
                                    }
                                </ul>
                            }
                        </div>
                    </section>

                    <!-- Content Root -->
                    <section class="card">
                        <header class="card__head">
                            <h2 class="card__title">
                                <i class="bi bi-folder"></i> Content Root
                            </h2>
                        </header>
                        <div class="card__body">
                            @if (s.contentRoot; as cr) {
                                <dl class="kv">
                                    <dt>Path</dt>
                                    <dd>
                                        <span class="mono">{{ cr.path }}</span>
                                    </dd>
                                    <dt>Owner</dt>
                                    <dd>
                                        <span class="mono mono--muted"
                                              [title]="cr.ownerId ?? noneText">
                                            {{ shortenId(cr.ownerId) }}
                                        </span>
                                    </dd>
                                    <dt>Editor group</dt>
                                    <dd>
                                        <span class="mono mono--muted"
                                              [title]="cr.editorGroupId ?? noneText">
                                            {{ shortenId(cr.editorGroupId) }}
                                        </span>
                                    </dd>
                                    <dt>Mode</dt>
                                    <dd>
                                        <span class="mono">{{ formatMode(cr.modeInt) }}</span>
                                    </dd>
                                </dl>
                                <a [routerLink]="['/vfs']"
                                   [queryParams]="{ path: cr.path }"
                                   class="cms-btn cms-btn-link cms-btn-sm">
                                    Browse files <i class="bi bi-box-arrow-up-right"></i>
                                </a>
                            } @else {
                                <p class="empty">
                                    Content root not minted yet.
                                </p>
                            }
                        </div>
                    </section>

                    <!-- Members -->
                    <section class="card">
                        <header class="card__head">
                            <h2 class="card__title">
                                <i class="bi bi-people"></i> Members
                            </h2>
                            <span class="card__count">{{ members().length }}</span>
                        </header>
                        <div class="card__body">
                            @if (membersLoading()) {
                                <p class="empty">Loading members...</p>
                            } @else if (membersError()) {
                                <p class="empty empty--error">
                                    {{ membersError() }}
                                </p>
                            } @else if (members().length === 0) {
                                <p class="empty">
                                    No members resolved for this site.
                                </p>
                            } @else {
                                <ul class="list">
                                    @for (m of membersPreview(); track m.userId) {
                                        <li class="list__row">
                                            <div class="list__main">
                                                <span>{{ m.username }}</span>
                                                @if (m.email && m.email !== m.username) {
                                                    <span class="muted">{{ m.email }}</span>
                                                }
                                            </div>
                                            <div class="badge-row">
                                                @if (m.isOwner) {
                                                    <span class="badge badge--owner">owner</span>
                                                }
                                                @if (m.isEditor) {
                                                    <span class="badge badge--editor">editor</span>
                                                }
                                            </div>
                                        </li>
                                    }
                                </ul>
                            }
                            @if (s.slug) {
                                <a [routerLink]="['/sections', s.slug, 'members']"
                                   class="cms-btn cms-btn-link cms-btn-sm">
                                    @if (canAdminister()) {
                                        <i class="bi bi-people-fill"></i>
                                        Manage members
                                    } @else {
                                        View all members ({{ members().length }})
                                    }
                                    <i class="bi bi-box-arrow-up-right"></i>
                                </a>
                            }
                        </div>
                    </section>

                </div>
            </div>

            <!--
              Fixed action footer (shared cms-detail-footer). Edit Settings +
              Delete Site live here (declared in the web:section-detail
              layout config, gated by 'requires'), keeping the header to
              navigation + identity only.
            -->
            <cms-detail-footer
                [actions]="footerActions()"
                (actionClick)="onAction($event)" />
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        .detail-page { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 0 32px; }

        /* Status / role chips projected into the cms-page-header header-meta slot. */
        .detail-chips {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            align-items: center;
        }

        .chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: .75rem;
            font-weight: 500;
            background: var(--cms-surface-muted);
            color: var(--cms-text-body);
        }
        .chip--slug { background: var(--cms-surface-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .chip--active { background: var(--cms-success-subtle); color: var(--cms-success-text); }
        .chip--inactive { background: var(--cms-danger-subtle); color: var(--cms-danger-text); }
        .chip--host { background: var(--cms-info-subtle); color: var(--cms-info-text); }
        .chip--role {
            background: var(--cms-meta-subtle);
            color: var(--cms-meta-text);
            text-transform: capitalize;
        }

        .detail-cards {
            display: grid;
            gap: 16px;
            grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
        }

        .card {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .card__head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 12px 16px;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
            background: var(--cms-surface-muted);
        }
        .card__title {
            margin: 0;
            font-size: .9rem;
            font-weight: 600;
            color: var(--cms-text, #111);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .card__count {
            font-size: .8rem;
            color: var(--cms-text-muted, #6b7280);
            background: var(--cms-surface-muted);
            border-radius: 10px;
            padding: 1px 8px;
        }
        .card__body { padding: 12px 16px; }

        .kv {
            margin: 0;
            display: grid;
            grid-template-columns: minmax(120px, max-content) 1fr;
            gap: 6px 16px;
        }
        .kv dt {
            color: var(--cms-text-muted, #6b7280);
            font-size: .8rem;
            align-self: center;
        }
        .kv dd { margin: 0; color: var(--cms-text, #111); word-break: break-word; }

        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .mono--muted { color: var(--cms-text-muted, #6b7280); }
        .muted { color: var(--cms-text-muted, #6b7280); font-size: .8rem; }

        .list { list-style: none; margin: 0; padding: 0; }
        .list__row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 0;
            border-bottom: 1px solid var(--cms-border, #f3f4f6);
        }
        .list__row:last-child { border-bottom: 0; }
        .list__main { display: flex; flex-direction: column; min-width: 0; }

        .badge-row { display: flex; gap: 6px; flex-shrink: 0; }
        .badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: .7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .03em;
        }
        .badge--owner  { background: var(--cms-warning-subtle); color: var(--cms-warning-text); }
        .badge--editor { background: var(--cms-info-subtle); color: var(--cms-info-text); }

        .empty { color: var(--cms-text-muted, #6b7280); margin: 0 0 8px 0; }
        .empty--error { color: var(--cms-danger, #b91c1c); }

    `],
})
export class SiteDetailPageComponent implements OnInit {
    private static readonly DEFAULT_SLUG  = 'default';
    /** Maximum members shown in the on-page preview; rest hidden behind "View all". */
    readonly previewLimit = 5;
    readonly noneText     = '—';

    private readonly layoutActions = inject(LayoutActionsService);

    private readonly route       = inject(ActivatedRoute);
    private readonly router      = inject(Router);
    private readonly api         = inject(ApiService);
    private readonly store       = inject(Store);
    private readonly dialog      = inject(Dialog);
    private readonly confirmSvc  = inject(ConfirmDialogService);
    private readonly toast       = inject(ToastService);
    private readonly errors      = inject(ErrorHandlerService);
    private readonly titleSvc    = inject(PageTitleService);
    private readonly config      = inject(ConfigService);
    private readonly destroyRef  = inject(DestroyRef);

    /** Backend-defined page chrome (`web:section-detail` layout config). */
    readonly layout         = signal<LayoutConfig | null>(null);

    readonly site           = signal<SiteDto | null>(null);
    readonly loading        = signal(true);
    readonly error          = signal<string | null>(null);

    readonly members        = signal<SiteMemberDto[]>([]);
    readonly membersLoading = signal(false);
    readonly membersError   = signal<string | null>(null);

    /** Up to `previewLimit` members shown inline on the Members card. */
    readonly membersPreview = computed(() => this.members().slice(0, this.previewLimit));

    /** Roles from the embedded membership (for header role chips). */
    readonly membershipRoles = computed(() => {
        const m = this.site()?.currentUserMembership;
        return m ? [...m.roles] : [];
    });

    /**
     * Host pre-filled in the "Test routing for this site" deep-link
     * (Layer 3d.2). When the SiteSection has no `matchHost` (catch-all
     * default), fall back to `localhost` so the Inspector at least
     * resolves the default section instead of starting with an empty
     * host field.
     */
    readonly routingInspectorHost = computed(() => this.site()?.host ?? 'localhost');

    /** Gates the "Edit Settings" + nav-tree manage actions. */
    readonly canAdminister = computed(() => {
        const m = this.site()?.currentUserMembership;
        return m?.isAdministrator === true;
    });

    /**
     * Gates the "Delete Site" action. Requires admin AND a non-default
     * slug — the catch-all `default` SiteSection cannot be deleted
     * (mirrors `DeleteSiteSectionProcessor::DEFAULT_SLUG` guard).
     */
    readonly canDelete = computed(() => {
        const s = this.site();
        return this.canAdminister()
            && s?.slug !== null && s?.slug !== undefined
            && s.slug !== SiteDetailPageComponent.DEFAULT_SLUG;
    });

    /**
     * Navigation actions for the cms-page-header bar — declared in the
     * `web:section-detail` layout config (ADR-127), not hardcoded here.
     */
    readonly headerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions),
    );

    /**
     * Primary / destructive actions for the fixed footer — declared in the
     * same layout config + gated per-item by `requires` against the loaded
     * site's membership (runtime state, not static config).
     */
    readonly footerActions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.footerActions, {}, requires => this.actionAllowed(requires)),
    );

    ngOnInit(): void {
        // Page chrome (actions) is backend-defined; fetch once (cached).
        this.config.layout('web:section-detail').pipe(
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
                this.error.set('No site slug in URL');
                this.loading.set(false);
                return;
            }
            this.loadSite(slug);
            this.loadMembers(slug);
        });
    }

    /**
     * Dispatches a header/footer action id (declared in the layout config)
     * to its handler. Unknown ids are ignored so config can be extended
     * ahead of the FE wiring without breaking.
     */
    onAction(actionId: string): void {
        switch (actionId) {
            case 'back':          void this.router.navigate(['/sections']); break;
            case 'edit-settings': this.openEditSettings();                  break;
            case 'delete-site':   this.confirmDelete();                     break;
        }
    }

    /**
     * Evaluates a config action's `requires` capability against runtime
     * membership. Stays here rather than becoming a `showWhen`: it asks what
     * THIS USER may do, not what state the site is in.
     */
    private actionAllowed(requires: string): boolean {
        switch (requires) {
            case 'administer': return this.canAdminister();
            case 'delete':     return this.canDelete();
            default:           return true;
        }
    }

    private loadSite(slug: string): void {
        this.loading.set(true);
        this.error.set(null);
        this.api.getSite(slug).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: site => {
                this.site.set(site);
                this.loading.set(false);
                this.titleSvc.set(site.label ?? `Site ${slug}`);
            },
            error: (err: unknown) => {
                this.loading.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }

    private loadMembers(slug: string): void {
        this.membersLoading.set(true);
        this.membersError.set(null);
        this.api.listSiteMembers(slug).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: members => {
                this.members.set(members);
                this.membersLoading.set(false);
            },
            error: (err: unknown) => {
                this.membersLoading.set(false);
                this.membersError.set(this.errors.humanize(err));
            },
        });
    }

    /**
     * Opens the existing SectionFormComponent dialog (the same modal
     * used on the Sections list) so settings editing has exactly one
     * implementation. The Web Site Detail response carries enough fields
     * to denormalise into a `SiteSectionDto` for the dialog's
     * `DIALOG_DATA`.
     */
    openEditSettings(): void {
        const s = this.site();
        if (!s || !s.sectionId || !s.slug) return;

        const sectionDto: SiteSectionDto = {
            '@id':            `/api/v1/sections/${s.sectionId}`,
            id:               s.sectionId,
            slug:             s.slug,
            label:            s.label ?? s.slug,
            matchHost:        s.host,
            matchPathPrefix:  s.pathPrefix,
            feStack:          s.feStack,
            matchPriority:    s.priority,
            themeSlug:        s.themeSlug,
            isActive:         s.isActive ?? true,
        };

        this.dialog.open(SectionFormComponent, {
            data: sectionDto,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter(Boolean),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            // Reload both the site detail and the cached NgXS sections
            // list so any other open tabs / lists pick the change up.
            this.store.dispatch(new LoadSections());
            this.loadSite(s.slug!);
        });
    }

    /**
     * Confirm + delete via the Web composition endpoint. Backend
     * blocks deletion when NaviTree FKs still reference the section
     * (surfaced via ErrorHandlerService.humanize). Navigates back to
     * the Sections list on success.
     */
    confirmDelete(): void {
        const s = this.site();
        if (!s || !s.slug) return;

        this.confirmSvc.confirmDelete(s.label ?? s.slug).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteSite(s.slug!)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success(`Site "${s.label ?? s.slug}" deleted`);
                this.store.dispatch(new LoadSections());
                this.router.navigate(['/sections']);
            },
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    /** Shortens a UUID to `abc12345…` for display; full UUID surfaces in the tooltip. */
    shortenId(id: string | null): string {
        if (!id) return this.noneText;
        return id.length > 8 ? id.slice(0, 8) + '…' : id;
    }

    /** Renders a Unix-style mode (e.g. 1533 -> `0o2775`, the on-disk seed mode). */
    formatMode(modeInt: number): string {
        // 4-digit octal, zero-padded, no surprises for non-positive values.
        const oct = (modeInt & 0o7777).toString(8).padStart(4, '0');
        return `0o${oct}`;
    }
}
