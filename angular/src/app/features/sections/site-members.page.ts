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
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { forkJoin, of, switchMap } from 'rxjs';
import { filter } from 'rxjs/operators';
import {
    ApiService,
    IdentityUserDto,
    SiteDto,
    SiteMemberDto,
} from '../../api/api.service';
import { AuthState, ErrorHandlerService, ConfigService, LayoutConfig, AppConfigState } from '@coolms/core-angular';
import {
    CmsPageHeaderComponent,
    ConfirmDialogService,
    ErrorBannerComponent,
    LayoutActionsService,
    LoadingComponent,
    PageTitleService,
    ToastService,
    ToolbarAction,
    UserSearchSelectComponent,
} from '@coolms/ui-angular';

/**
 * Phase I Layer 3d.3 — Members management page (ADR-117).
 *
 * Routed at `/admin/sections/:slug/members`. Self-contained
 * page that lets an admin (anyone with
 * `currentUserMembership.canAdminister`) change site membership.
 *
 * Per ADR-117 site membership is *VFS perms on `/content/{slug}`*:
 * - the Node's `uid` is the owner
 * - the Node's `gid` is the editor group (`content` group ID for
 *   the default site)
 * - "add editor"      = add user to the editor group
 *                       (`POST /api/v1/auth/users/{id}/groups`)
 * - "remove editor"   = remove user from the editor group
 *                       (same endpoint, replace-all semantics)
 * - "transfer owner"  = chown the Node to a new uid
 *                       (`PATCH /api/v1/vfs/files/owner`)
 *
 * No new backend endpoints — this ship consumes only existing ones.
 *
 * Note on `assignUserGroups` semantics: the Identity endpoint
 * replaces the whole group list, so add/remove operations fetch
 * the user's current groups via `GET /api/v1/auth/users/{id}`
 * first, mutate the list locally, then POST the full set.
 */
@Component({
    selector: 'app-site-members-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UserSearchSelectComponent, LoadingComponent, ErrorBannerComponent, CmsPageHeaderComponent],
    template: `
        @if (loading()) {
            <app-loading label="Loading members…" />
        } @else if (error()) {
            <app-error-banner [message]="error()!" />
        } @else if (site()) {
            @let s = site()!;

                <!--
                  Standard page chrome. The back action is declared in the
                  backend layout config (web:section-members) and rendered in
                  the cms-page-header bar (ADR-127); the FE re-labels it with
                  the loaded site's name. Slug / member-count / read-only chips
                  project into the header-meta slot on the title baseline.
                  Owner / Editors mutations stay card-internal (contextual).
                -->
                <cms-page-header
                    [title]="layout()?.title || 'Members'"
                    [icon]="layout()?.icon || 'people'"
                    [actions]="headerActions()"
                    (actionClick)="onAction($event)">
                    <div header-meta class="detail-chips">
                        <span class="chip chip--slug">{{ s.slug }}</span>
                        <span class="chip chip--count">
                            {{ members().length }} member{{ members().length === 1 ? '' : 's' }}
                        </span>
                        @if (!canAdminister()) {
                            <span class="chip chip--readonly" title="You don't have admin rights on this site">
                                <i class="bi bi-eye"></i> read-only
                            </span>
                        }
                    </div>
                </cms-page-header>

                <div class="page">

                @if (membersError()) {
                    <div class="banner banner--error">{{ membersError() }}</div>
                }

                <!-- Owner card -->
                <section class="card">
                    <header class="card__head">
                        <h2 class="card__title">
                            <i class="bi bi-person-fill"></i> Owner
                        </h2>
                    </header>
                    <div class="card__body">
                        @if (owner(); as o) {
                            <div class="member-row">
                                <div class="member-row__main">
                                    <span class="name">{{ o.username }}</span>
                                    @if (o.email && o.email !== o.username) {
                                        <span class="muted">{{ o.email }}</span>
                                    }
                                    <span class="mono mono--muted" [title]="o.userId">
                                        {{ shortenId(o.userId) }}
                                    </span>
                                </div>
                                @if (canAdminister()) {
                                    <button type="button"
                                            class="cms-btn cms-btn-sm"
                                            [disabled]="busy() || isSystemSite()"
                                            [title]="isSystemSite()
                                                ? 'The default site is system-managed — ownership is fixed.'
                                                : 'Pick a new owner for this site'"
                                            (click)="openTransferOwnership()">
                                        <i class="bi bi-arrow-left-right"></i> Transfer ownership
                                    </button>
                                }
                            </div>
                        } @else {
                            <p class="empty">No owner resolved.</p>
                        }
                        @if (canAdminister() && isSystemSite()) {
                            <p class="hint">
                                The <code>default</code> site is system-managed.
                                Transfer is disabled to keep its root Node stable.
                            </p>
                        }
                    </div>
                </section>

                <!-- Editors card -->
                <section class="card">
                    <header class="card__head">
                        <h2 class="card__title">
                            <i class="bi bi-pencil-square"></i> Editors
                        </h2>
                        <span class="card__count">{{ editors().length }}</span>
                    </header>
                    <div class="card__body">
                        @if (editors().length === 0) {
                            <p class="empty">No editors yet.</p>
                        } @else {
                            <ul class="list">
                                @for (m of editors(); track m.userId) {
                                    <li class="member-row">
                                        <div class="member-row__main">
                                            <span class="name">{{ m.username }}</span>
                                            @if (m.email && m.email !== m.username) {
                                                <span class="muted">{{ m.email }}</span>
                                            }
                                            <span class="mono mono--muted" [title]="m.userId">
                                                {{ shortenId(m.userId) }}
                                            </span>
                                            @if (isCurrentUser(m.userId)) {
                                                <span class="chip chip--you">you</span>
                                            }
                                        </div>
                                        @if (canAdminister()) {
                                            <button type="button"
                                                    class="cms-btn cms-btn-danger cms-btn-sm"
                                                    [disabled]="busy() || isCurrentUser(m.userId)"
                                                    [title]="isCurrentUser(m.userId)
                                                        ? 'You cannot remove yourself — ask another admin'
                                                        : 'Remove from editors'"
                                                    (click)="confirmRemoveEditor(m)">
                                                <i class="bi bi-x-lg"></i> Remove
                                            </button>
                                        }
                                    </li>
                                }
                            </ul>
                        }

                        @if (canAdminister() && editorGroupId()) {
                            <div class="add-row">
                                <div class="add-row__picker">
                                    <app-user-search-select
                                            [apiUrl]="usersApiUrl()"
                                            [value]="pickedUserId()"
                                            entityLabel="user"
                                            placeholder="Pick a user to add…"
                                            (valueChange)="onUserPicked($event)" />
                                </div>
                                <button type="button"
                                        class="cms-btn cms-btn-primary cms-btn-sm"
                                        [disabled]="busy() || !pickedUserId() || isAlreadyEditor(pickedUserId())"
                                        (click)="addEditor()">
                                    <i class="bi bi-plus-lg"></i> Add editor
                                </button>
                            </div>
                            @if (pickedUserId() && isAlreadyEditor(pickedUserId())) {
                                <p class="hint hint--warn">
                                    This user is already an editor.
                                </p>
                            }
                        }
                    </div>
                </section>

                <!-- VFS perms summary (admin-only diagnostic) -->
                @if (canAdminister() && s.contentRoot; as cr) {
                    <section class="card card--mini">
                        <header class="card__head">
                            <h2 class="card__title">
                                <i class="bi bi-info-circle"></i> Underlying VFS
                            </h2>
                        </header>
                        <div class="card__body">
                            <dl class="kv">
                                <dt>Path</dt>
                                <dd><span class="mono">{{ cr.path }}</span></dd>
                                <dt>Owner uid</dt>
                                <dd>
                                    <span class="mono mono--muted" [title]="cr.ownerId ?? noneText">
                                        {{ shortenId(cr.ownerId) }}
                                    </span>
                                </dd>
                                <dt>Editor gid</dt>
                                <dd>
                                    <span class="mono mono--muted" [title]="cr.editorGroupId ?? noneText">
                                        {{ shortenId(cr.editorGroupId) }}
                                    </span>
                                </dd>
                            </dl>
                            <p class="hint">
                                Membership is VFS perms on this Node (per ADR-117).
                            </p>
                        </div>
                    </section>
                }

                <!-- Transfer-ownership confirm panel -->
                @if (transferOpen()) {
                    <div class="overlay" (click)="closeTransfer()">
                        <div class="modal" (click)="$event.stopPropagation()">
                            <header class="modal__head">
                                <h3 class="modal__title">
                                    <i class="bi bi-arrow-left-right"></i> Transfer ownership
                                </h3>
                            </header>
                            <div class="modal__body">
                                <p class="warn">
                                    <strong>Warning.</strong> This makes the picked
                                    user the new owner of <code>{{ s.contentRoot?.path }}</code>.
                                    You will lose admin rights on this site unless you
                                    are also in the editor group.
                                </p>
                                <label class="label">New owner</label>
                                <app-user-search-select
                                        [apiUrl]="usersApiUrl()"
                                        [value]="transferTargetUserId()"
                                        entityLabel="user"
                                        placeholder="Pick the new owner…"
                                        (valueChange)="transferTargetUserId.set($event)" />
                            </div>
                            <footer class="modal__foot">
                                <button type="button"
                                        class="cms-btn cms-btn-sm"
                                        [disabled]="busy()"
                                        (click)="closeTransfer()">
                                    Cancel
                                </button>
                                <button type="button"
                                        class="cms-btn cms-btn-danger cms-btn-sm"
                                        [disabled]="busy() || !transferTargetUserId() || transferTargetUserId() === currentOwnerId()"
                                        (click)="confirmTransferOwnership()">
                                    <i class="bi bi-arrow-left-right"></i> Transfer
                                </button>
                            </footer>
                        </div>
                    </div>
                }

            </div>
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        .page { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 0 32px; }

        /* Slug / member-count / read-only chips projected into the
           cms-page-header header-meta slot (matches site-detail). */
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
            border-radius: var(--cms-radius-lg, 10px);
            font-size: .75rem;
            font-weight: 500;
            background: var(--cms-surface-muted);
            color: var(--cms-text-body);
        }
        .chip--slug     { background: var(--cms-surface-muted); font-family: var(--cms-font-mono, monospace); }
        .chip--count    { background: var(--cms-info-subtle); color: var(--cms-info-text); }
        .chip--readonly { background: var(--cms-warning-subtle); color: var(--cms-warning-text); }
        .chip--you      { background: var(--cms-meta-subtle); color: var(--cms-meta-text); }

        .banner {
            padding: 8px 12px;
            border-radius: var(--cms-radius, 6px);
            margin-bottom: 12px;
            font-size: .875rem;
        }
        .banner--error { background: var(--cms-danger-light); color: var(--cms-danger-text); border: 1px solid var(--cms-danger-subtle-border); }

        .card {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px);
            margin-bottom: 16px;
            overflow: hidden;
        }
        .card--mini { background: var(--cms-surface-muted); }
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
            color: var(--cms-text, #111827);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .card__count {
            font-size: .8rem;
            color: var(--cms-text-muted, #848b96);
            background: var(--cms-surface-muted);
            border-radius: var(--cms-radius-lg, 10px);
            padding: 1px 8px;
        }
        .card__body { padding: 12px 16px; }

        .list { list-style: none; margin: 0 0 8px; padding: 0; }
        /* NB: NOT '.row' — that collides with Bootstrap's grid '.row'
           (loaded globally), whose '.row > * { width:100% }' +
           'flex-wrap:wrap' would force the name block and the action
           button to full-width and stack them. site-detail dodges this
           with '.list__row'; we use '.member-row'. */
        .member-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 0;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
        }
        .member-row:last-child { border-bottom: 0; }
        .member-row__main {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
            flex-wrap: wrap;
        }
        .name { font-weight: 500; color: var(--cms-text, #111827); }
        .muted { color: var(--cms-text-muted, #848b96); font-size: .85rem; }
        .mono { font-family: var(--cms-font-mono, monospace); font-size: .8rem; }
        .mono--muted { color: var(--cms-text-muted, #848b96); }

        .empty { color: var(--cms-text-muted, #848b96); margin: 0 0 8px 0; }

        .add-row {
            display: flex;
            gap: 8px;
            align-items: center;
            border-top: 1px solid var(--cms-border, #e5e7eb);
            padding-top: 12px;
            margin-top: 4px;
        }
        .add-row__picker { flex: 1; min-width: 200px; }

        .kv {
            margin: 0;
            display: grid;
            grid-template-columns: minmax(120px, max-content) 1fr;
            gap: 6px 16px;
        }
        .kv dt {
            color: var(--cms-text-muted, #848b96);
            font-size: .8rem;
            align-self: center;
        }
        .kv dd { margin: 0; color: var(--cms-text, #111827); word-break: break-word; }

        .hint {
            margin: 8px 0 0;
            font-size: .75rem;
            color: var(--cms-text-muted, #848b96);
        }
        .hint code {
            background: var(--cms-surface-muted);
            padding: 1px 4px;
            border-radius: 3px;
            font-family: var(--cms-font-mono, monospace);
        }
        .hint--warn { color: var(--cms-warning-text); }


        .overlay {
            position: fixed;
            inset: 0;
            background: var(--cms-overlay-scrim);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1100;
        }
        .modal {
            background: var(--cms-surface);
            border-radius: var(--cms-radius-md, 8px);
            width: 520px;
            max-width: 95vw;
            box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12));
            display: flex;
            flex-direction: column;
        }
        .modal__head { padding: 12px 16px; border-bottom: 1px solid var(--cms-border, #e5e7eb); }
        .modal__title { margin: 0; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: 6px; }
        .modal__body { padding: 16px; }
        .modal__foot {
            padding: 12px 16px;
            border-top: 1px solid var(--cms-border, #e5e7eb);
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }
        .warn {
            background: var(--cms-warning-subtle);
            color: var(--cms-warning-text);
            padding: 8px 12px;
            border-radius: var(--cms-radius, 6px);
            margin: 0 0 12px 0;
            font-size: .85rem;
        }
        .warn code {
            background: var(--cms-surface-muted);
            padding: 1px 4px;
            border-radius: 3px;
        }
        .label {
            display: block;
            margin-bottom: 4px;
            font-size: .8rem;
            font-weight: 500;
            color: var(--cms-text-muted, #848b96);
        }
    `],
})
export class SiteMembersPageComponent implements OnInit {
    readonly noneText = '—';

    private readonly layoutActions = inject(LayoutActionsService);

    private readonly route       = inject(ActivatedRoute);
    private readonly router      = inject(Router);
    private readonly api         = inject(ApiService);
    private readonly store       = inject(Store);
    private readonly confirmSvc  = inject(ConfirmDialogService);
    private readonly toast       = inject(ToastService);
    private readonly errors      = inject(ErrorHandlerService);
    private readonly titleSvc    = inject(PageTitleService);
    private readonly config      = inject(ConfigService);
    private readonly destroyRef  = inject(DestroyRef);

    /** Backend-defined page chrome (`web:section-members` layout config). */
    readonly layout       = signal<LayoutConfig | null>(null);

    readonly site         = signal<SiteDto | null>(null);
    readonly members      = signal<SiteMemberDto[]>([]);
    readonly loading      = signal(true);
    readonly error        = signal<string | null>(null);
    readonly membersError = signal<string | null>(null);
    /** True while any mutation is in flight. Buttons disable so we don't double-submit. */
    readonly busy         = signal(false);

    /** Selected user in the "Add editor" picker. Empty until the user clicks one. */
    readonly pickedUserId = signal<string>('');

    /** Transfer-ownership modal open + picked target user. */
    readonly transferOpen         = signal(false);
    readonly transferTargetUserId = signal<string>('');

    readonly owner = computed<SiteMemberDto | null>(
        () => this.members().find(m => m.isOwner) ?? null,
    );

    readonly editors = computed(
        () => this.members().filter(m => m.isEditor),
    );

    readonly canAdminister = computed(
        () => this.site()?.currentUserMembership?.isAdministrator === true,
    );

    /** Editor group ID = `gid` of the content-root Node. */
    readonly editorGroupId = computed<string | null>(
        () => this.site()?.contentRoot?.editorGroupId ?? null,
    );

    readonly currentOwnerId = computed<string | null>(
        () => this.site()?.contentRoot?.ownerId ?? null,
    );

    /**
     * The default site's `/content/default` Node is system-marked
     * (`is_system = true` in DB) so VFSManager::chown rejects it as
     * a system node. Surface this on the FE so admins don't try
     * to transfer and hit a backend 403.
     */
    readonly isSystemSite = computed<boolean>(
        () => this.site()?.slug === 'default',
    );

    readonly currentUserId = computed<string | null>(() => {
        const u = this.store.selectSnapshot(AuthState.currentUser);
        return u?.id ?? null;
    });

    /** Resolved `auth/users` list URL from the boot manifest. */
    readonly usersApiUrl = computed<string>(() => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        return m?.identity?.usersUrl ?? '';
    });

    /**
     * Navigation actions for the cms-page-header bar — declared in the
     * `web:section-members` layout config (ADR-127), not hardcoded. The
     * generic `back` action is re-labelled at runtime with the loaded
     * site's name so it reads as the natural up-one-level destination.
     */
    readonly headerActions = computed<ToolbarAction[]>(() => {
        const siteName = this.site()?.label ?? this.site()?.slug ?? 'site';
        return this.layoutActions.resolve(this.layout()?.headerActions).map(action => {
            // Not a condition: the label is the loaded site's NAME, which no
            // config can know. Conditions decide state, content stays here.
            if (action.id === 'back') {
                action.label = siteName;
                action.title = `Back to ${siteName}`;
            }
            return action;
        });
    });

    ngOnInit(): void {
        // Page chrome (back action) is backend-defined; fetch once (cached).
        this.config.layout('web:section-members').pipe(
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
            this.loadAll(slug);
        });
    }

    /**
     * Dispatches a header action id (declared in the layout config) to its
     * handler. `back` returns to the parent site detail. Unknown ids are
     * ignored so config can extend ahead of FE wiring without breaking.
     */
    onAction(actionId: string): void {
        if (actionId === 'back') {
            const slug = this.site()?.slug;
            void this.router.navigate(slug ? ['/sections', slug] : ['/sections']);
        }
    }

    /** Load the composed Site view and the members list in parallel. */
    private loadAll(slug: string): void {
        this.loading.set(true);
        this.error.set(null);
        this.membersError.set(null);

        forkJoin({
            site:    this.api.getSite(slug),
            members: this.api.listSiteMembers(slug),
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: ({ site, members }) => {
                this.site.set(site);
                this.members.set(members);
                this.loading.set(false);
                this.titleSvc.set(`Members — ${site.label ?? slug}`);
            },
            error: (err: unknown) => {
                this.loading.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }

    /** Refresh just the members list (after a mutation). */
    private reloadMembers(): void {
        const slug = this.site()?.slug;
        if (!slug) return;
        // Also refresh the composed Site view so `contentRoot.ownerId`
        // reflects an ownership transfer immediately.
        forkJoin({
            site:    this.api.getSite(slug),
            members: this.api.listSiteMembers(slug),
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: ({ site, members }) => {
                this.site.set(site);
                this.members.set(members);
            },
            error: (err: unknown) => {
                this.membersError.set(this.errors.humanize(err));
            },
        });
    }

    onUserPicked(id: string): void {
        this.pickedUserId.set(id);
    }

    /** True when the picked user is already in the editors list. */
    isAlreadyEditor(userId: string | null): boolean {
        if (!userId) return false;
        return this.editors().some(m => m.userId === userId);
    }

    isCurrentUser(userId: string): boolean {
        return this.currentUserId() === userId;
    }

    /** Shortens a UUID to `abc12345…` for inline display. */
    shortenId(id: string | null | undefined): string {
        if (!id) return this.noneText;
        return id.length > 8 ? id.slice(0, 8) + '…' : id;
    }

    // ── Add editor ──────────────────────────────────────────────────────────

    /**
     * Adds the picked user to the editor group. The Identity
     * group-assign endpoint replaces the full membership list, so
     * we fetch the user's current groups first, add the editor group
     * if not already present, then POST the merged set.
     */
    addEditor(): void {
        const userId = this.pickedUserId();
        const groupId = this.editorGroupId();
        if (!userId || !groupId || this.isAlreadyEditor(userId)) return;

        this.busy.set(true);
        this.api.getUser(userId).pipe(
            switchMap((user: IdentityUserDto) => {
                const existing = user.groups.map(g => g.id);
                if (existing.includes(groupId)) {
                    return of(null);
                }
                return this.api.assignUserGroups(userId, [...existing, groupId]);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.busy.set(false);
                this.pickedUserId.set('');
                this.toast.success('Editor added');
                this.reloadMembers();
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    // ── Remove editor ───────────────────────────────────────────────────────

    confirmRemoveEditor(m: SiteMemberDto): void {
        if (this.isCurrentUser(m.userId)) return; // self-protection

        this.confirmSvc.open({
            title:        `Remove ${m.username} from editors?`,
            message:      `${m.username} will lose edit access to /content/${this.site()?.slug}.`,
            confirmLabel: 'Remove',
            danger:       true,
        }).pipe(
            filter(Boolean),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => this.removeEditor(m));
    }

    private removeEditor(m: SiteMemberDto): void {
        const groupId = this.editorGroupId();
        if (!groupId) return;

        this.busy.set(true);
        this.api.getUser(m.userId).pipe(
            switchMap((user: IdentityUserDto) => {
                const remaining = user.groups
                    .map(g => g.id)
                    .filter(id => id !== groupId);
                // POST with empty array would trigger the backend's
                // `user`-group fallback (see UserAssignGroupsProcessor).
                // Keeping the user in *some* group is the safer default.
                return this.api.assignUserGroups(m.userId, remaining);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.busy.set(false);
                this.toast.success(`Removed ${m.username}`);
                this.reloadMembers();
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    // ── Transfer ownership ──────────────────────────────────────────────────

    openTransferOwnership(): void {
        this.transferTargetUserId.set('');
        this.transferOpen.set(true);
    }

    closeTransfer(): void {
        this.transferOpen.set(false);
    }

    confirmTransferOwnership(): void {
        const newOwner = this.transferTargetUserId();
        const cr       = this.site()?.contentRoot;
        if (!newOwner || !cr || !cr.editorGroupId) return;
        if (newOwner === cr.ownerId)              return;

        this.busy.set(true);
        this.api.chownNode({
            path: cr.path,
            uid:  newOwner,
            // Keep gid stable — the editor group should not change
            // when ownership changes (use the "Change editor group"
            // flow on a dedicated screen if that ever lands).
            gid:  cr.editorGroupId,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.busy.set(false);
                this.transferOpen.set(false);
                this.toast.success('Ownership transferred');
                // The caller may have lost admin rights — reloading
                // pulls a fresh `currentUserMembership` so UX gates
                // reflect the new state. We stay on this page; if
                // canAdminister is now false, the buttons hide.
                this.reloadMembers();
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

}
