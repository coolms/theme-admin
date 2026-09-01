import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    inject,
    signal,
} from '@angular/core';

import { Dialog } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap } from 'rxjs';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';
import { SiteSectionDto, ThemeDto, ThemeTemplateDto, ThemesService } from './themes.service';

/** A theme's templates folded into `emails/`, `pages/`, … for display. */
interface TemplateGroup {
    readonly dir:   string;
    readonly paths: readonly string[];
}

/**
 * Themes Explorer — the admin surface for which theme skins the site
 * and what it overrides.
 *
 * ## Why this page exists
 *
 * The Theme module has had `/themes`, `/themes/{id}` and
 * `/themes/{slug}/templates` for some time with no admin UI at all, so the only
 * way to see which theme was serving a site — or to change it — was the database
 * or the CLI. made that concrete: a theme's `emails/default.html.dtmpl`
 * shadows MailComposer's own layout, and fixing the shadowed copy meant editing
 * a file on disk with nothing in the admin even hinting the override existed.
 *
 * ## Deliberate limits (backend, not oversight)
 *
 *  - **No install action.** `ThemeResource` ships no POST; themes are installed
 *    via `coolms:theme:install <slug>` — and only for a theme whose BUNDLE is
 *    registered, since the command resolves a registered provider, not a
 *    directory. (`ThemeResource`'s docblock says `<path>`; the command's own
 *    signature says slug, and it is right.) The page states this rather than
 *    offering a button that cannot work.
 *  - **Only SSR themes can be activated** — see {@link isSiteTheme}.
 *
 * Templates became READABLE in : `/themes/{slug}/template-source` returns
 * one file's bytes, and clicking a row opens {@link TemplateSourceDialog}. The
 * view is read-only by design — a theme package is not an editing surface, and
 * writing to one would be edited-in-place state that no reinstall preserves.
 *
 * Cards rather than a DataGrid: an install has a handful of themes, each with
 * prose metadata (description, author, requires) that reads badly in a row, and
 * a grid here would need a backend datagrid config this slice deliberately
 * avoids. Same reasoning as the Experiments page.
 */
@Component({
    selector: 'app-themes-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent],
    template: `
        <cms-list-page title="Themes" icon="palette"
                       subtitle="Which theme skins each site, and what it overrides">

            @if (loading()) {
                <p class="state">Loading themes…</p>
            } @else if (error()) {
                <!-- Banner for a failed LOAD; toasts are for actions (platform rule). -->
                <div class="cms-banner cms-banner-error">{{ error() }}</div>
            } @else if (themes().length === 0) {
                <p class="state">
                    No themes installed. Themes are installed from the command line:
                    <code>php bin/console coolms:theme:install &lt;slug&gt;</code>
                </p>
            } @else {
                <div class="themes">
                    @for (t of themes(); track t.id) {
                        <article class="theme" [class.theme--active]="t.isActive">
                            <header class="theme__head">
                                <div class="theme__title">
                                    <h3>{{ t.manifest.name || t.manifest.slug }}</h3>
                                    <code class="theme__slug">{{ t.manifest.slug }}</code>
                                </div>
                                <div class="theme__badges">
                                    @if (t.isActive) {
                                        <span class="badge badge--ok">Active</span>
                                    }
                                    @if (t.isPublished) {
                                        <span class="badge">Published</span>
                                    }
                                    @if (!isSiteTheme(t)) {
                                        <span class="badge badge--muted"
                                              [title]="'feStack: ' + (t.manifest.feStack ?? 'unknown')">Not a site theme</span>
                                    } @else if (t.sections.length === 0) {
                                        <span class="badge badge--muted" title="Serves any site without its own theme">Fallback</span>
                                    }
                                </div>
                            </header>

                            @if (t.manifest.description) {
                                <p class="theme__desc">{{ t.manifest.description }}</p>
                            }

                            <dl class="theme__meta">
                                @if (t.manifest.version) { <dt>Version</dt><dd>{{ t.manifest.version }}</dd> }
                                @if (t.manifest.author) { <dt>Author</dt><dd>{{ t.manifest.author }}</dd> }
                                @if (t.manifest.license) { <dt>License</dt><dd>{{ t.manifest.license }}</dd> }
                                @if (t.manifest.feStack) { <dt>Stack</dt><dd>{{ t.manifest.feStack }}</dd> }
                                <!--
                                  The AUTHORITATIVE binding first (#1751): a section
                                  naming this theme resolves to it directly, ignoring
                                  isActive and Theme.sections entirely.
                                -->
                                @if (servedSections(t).length > 0) {
                                    <dt title="These sections name this theme, so they always get it">Serves</dt>
                                    <dd>{{ servedSections(t).join(', ') }}</dd>
                                }
                                @if (t.isActive && unassignedSections().length > 0) {
                                    <dt title="Sections naming no theme of their own fall back to the active theme">Fallback for</dt>
                                    <dd>{{ unassignedSections().join(', ') }}</dd>
                                }
                                <!-- An SPA theme ships no templates directory, so fsPath is empty. -->
                                @if (t.source.fsPath) {
                                    <dt>Files</dt>
                                    <dd><code class="path">{{ t.source.fsPath }}</code></dd>
                                }
                            </dl>

                            @if (divergence(t); as d) {
                                <p class="warn">
                                    <i class="bi bi-exclamation-triangle"></i>
                                    {{ d }}
                                </p>
                            }

                            <div class="theme__actions">
                                <button type="button" class="cms-btn"
                                        [disabled]="busy()"
                                        (click)="toggleTemplates(t)">
                                    {{ expanded() === t.manifest.slug ? 'Hide templates' : 'Templates' }}
                                    @if (templateCount(t.manifest.slug) !== null) {
                                        <span class="count">{{ templateCount(t.manifest.slug) }}</span>
                                    }
                                </button>

                                @if (canActivate(t)) {
                                    <button type="button" class="cms-btn cms-btn-primary"
                                            [disabled]="busy()"
                                            [title]="'Applies to sections naming no theme: ' + unassignedSections().join(', ')"
                                            (click)="activate(t)">Activate</button>
                                }

                                <button type="button" class="cms-btn cms-btn-danger"
                                        [disabled]="busy() || t.isActive"
                                        [title]="t.isActive ? 'Deactivate before uninstalling' : 'Uninstall this theme'"
                                        (click)="uninstall(t)">Uninstall</button>
                            </div>

                            @if (expanded() === t.manifest.slug) {
                                <section class="tpl">
                                    @if (templatesLoading()) {
                                        <p class="state">Loading templates…</p>
                                    } @else if (groups().length === 0) {
                                        <p class="state">This theme ships no templates.</p>
                                    } @else {
                                        @for (g of groups(); track g.dir) {
                                            <div class="tpl__group">
                                                <h4>
                                                    {{ g.dir }}
                                                    <span class="count">{{ g.paths.length }}</span>
                                                    @if (g.dir === 'emails') {
                                                        <span class="hint">— overrides the platform email layout</span>
                                                    }
                                                </h4>
                                                <ul>
                                                    @for (p of g.paths; track p) {
                                                        <li>
                                                            <button type="button" class="tpl__open"
                                                                    [title]="'View source of ' + p"
                                                                    (click)="viewSource(t.manifest.slug, p)">
                                                                <code>{{ p }}</code>
                                                            </button>
                                                        </li>
                                                    }
                                                </ul>
                                            </div>
                                        }
                                    }
                                </section>
                            }
                        </article>
                    }
                </div>

                @if (unassignedSections().length === 0 && sections().length > 0) {
                    <p class="state state--foot">
                        Every section names its own theme, so activation would change nothing —
                        a section's own choice always wins. Assign a theme on the
                        <strong>Sections</strong> page.
                    </p>
                }
                <p class="state state--foot">
                    Themes are installed from the command line —
                    <code>php bin/console coolms:theme:install &lt;slug&gt;</code>
                </p>
            }
        </cms-list-page>
    `,
    styles: [`
        /*
         * align-items:start is load-bearing. Without it, grid stretches every
         * card in a row to the tallest, so expanding one theme's 59-template
         * list inflated its neighbour into a mostly-empty card of equal height.
         * (No backticks in these comments: the styles block is a JS template
         * literal and one would end the string mid-CSS.)
         */
        .themes {
            display: grid; gap: 0.9rem; align-items: start;
            grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
        }
        .theme {
            border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-md, 8px);
            padding: 0.9rem 1rem; background: var(--cms-surface, #fff);
        }
        .theme--active { border-color: var(--cms-accent, #F5A623); }
        .theme__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
        .theme__title h3 { margin: 0; font-size: 1rem; }
        .theme__slug { font-size: 0.75rem; color: var(--cms-text-muted, #848b96); }
        .theme__badges { display: flex; gap: 4px; flex-wrap: wrap; }
        .badge {
            font-size: 0.7rem; padding: 1px 7px; border-radius: 999px;
            background: var(--cms-border-light, #f0f2f5); color: var(--cms-text, #111827); white-space: nowrap;
        }
        .badge--ok { background: var(--cms-success-subtle); color: var(--cms-success-text); }
        .badge--muted { background: transparent; border: 1px dashed var(--cms-border, #e5e7eb); color: var(--cms-text-muted, #848b96); }
        .theme__desc { margin: 0.5rem 0 0.6rem; font-size: 0.85rem; color: var(--cms-text-secondary, #6b7280); }
        .theme__meta {
            display: grid; grid-template-columns: auto 1fr; gap: 2px 10px;
            margin: 0 0 0.75rem; font-size: 0.78rem;
        }
        .theme__meta dt { color: var(--cms-text-muted, #848b96); }
        .theme__meta dd { margin: 0; overflow-wrap: anywhere; }
        .path { font-size: 0.72rem; }
        .theme__actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .count {
            display: inline-block; margin-left: 5px; padding: 0 5px; border-radius: 999px;
            background: var(--cms-border-light, #f0f2f5); font-size: 0.7rem;
        }
        /*
         * Capped + self-scrolling: a theme can ship 59 templates, and letting
         * the card grow to fit them pushes everything below it off-screen.
         */
        .tpl {
            margin-top: 0.85rem; border-top: 1px solid var(--cms-border, #e5e7eb);
            padding-top: 0.7rem; max-height: 22rem; overflow-y: auto;
        }
        .tpl__group + .tpl__group { margin-top: 0.6rem; }
        .tpl__group h4 { margin: 0 0 0.25rem; font-size: 0.8rem; }
        .tpl__group ul { margin: 0; padding-left: 1.1rem; }
        .tpl__group li { font-size: 0.75rem; color: var(--cms-text-secondary, #6b7280); }
        /*
         * A button, not a bare <li> with a click handler: these open a dialog,
         * so they must be reachable and activatable from the keyboard. Styled
         * back down to look like the list text it replaced.
         */
        .tpl__open {
            padding: 0; border: 0; background: none; font: inherit; color: inherit;
            text-align: left; cursor: pointer;
        }
        .tpl__open:hover code, .tpl__open:focus-visible code {
            text-decoration: underline; color: var(--cms-primary, #2563eb);
        }
        .hint { font-weight: 400; font-size: 0.72rem; color: var(--cms-text-muted, #848b96); }
        .warn {
            margin: 0 0 0.6rem; padding: 6px 8px; border-radius: var(--cms-radius, 6px);
            background: var(--cms-warning-subtle); color: var(--cms-warning-text); font-size: 0.76rem;
        }
        .state { font-size: 0.85rem; color: var(--cms-text-muted, #848b96); }
        .state--foot { margin-top: 1rem; }
    `],
})
export class ThemesListComponent {
    private readonly api        = inject(ThemesService);
    private readonly toast      = inject(ToastService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dialog     = inject(Dialog);

    readonly themes  = signal<ThemeDto[]>([]);
    readonly loading = signal(true);
    readonly busy    = signal(false);
    readonly error   = signal<string | null>(null);

    /** Slug of the theme whose templates are open; only one at a time. */
    readonly expanded         = signal<string | null>(null);
    readonly templatesLoading = signal(false);

    private readonly templates = signal<Record<string, ThemeTemplateDto[]>>({});

    /** Read for `themeSlug` only — the asset half of the binding. */
    readonly sections = signal<SiteSectionDto[]>([]);

    readonly groups = computed<TemplateGroup[]>(() => {
        const slug = this.expanded();
        if (null === slug) return [];
        const rows = this.templates()[slug] ?? [];

        const byDir = new Map<string, string[]>();
        for (const row of rows) {
            const dir = row.path.includes('/') ? row.path.slice(0, row.path.indexOf('/')) : '(root)';
            byDir.set(dir, [...(byDir.get(dir) ?? []), row.path]);
        }

        // `emails` first: it is the group that silently overrides a platform
        // default, so it is the one an operator most needs to notice.
        return [...byDir.entries()]
            .map(([dir, paths]) => ({ dir, paths: paths.sort() }))
            .sort((a, b) => (a.dir === 'emails' ? -1 : b.dir === 'emails' ? 1 : a.dir.localeCompare(b.dir)));
    });

    constructor() {
        inject(PageTitleService).set('Themes');
        this.load();
    }

    /** null until this theme's templates have been fetched at least once. */
    templateCount(slug: string): number | null {
        return this.templates()[slug]?.length ?? null;
    }

    /**
     * Only an SSR theme can skin the public site — so only an SSR theme may be
     * activated.
     *
     * `ThemeRepository::findActive()` has NO feStack filter, so activating the
     * admin SPA (`feStack: spa`) would genuinely make it the site's active theme
     * — and `ThemeAwareVfsLoader` bails on anything that is not SSR, leaving the
     * public site with no templates. The button is withheld rather than the
     * failure being explained after the fact.
     */
    isSiteTheme(theme: ThemeDto): boolean {
        return 'ssr' === theme.manifest.feStack;
    }

    /**
     * Sections this theme actually serves — the AUTHORITATIVE binding.
     *
     * `ThemeSubscriber` fast-paths on `SiteSection.themeSlug`: when a section
     * names a theme it is resolved by slug and `isActive` / `Theme.sections[]`
     * are never consulted. So this, not `Theme.sections`, is what a reader wants
     * to see.
     */
    servedSections(theme: ThemeDto): string[] {
        return this.sections()
            .filter(s => s.themeSlug === theme.manifest.slug)
            .map(s => s.slug);
    }

    /** Sections naming no theme — the only ones `isActive` can still decide. */
    unassignedSections(): string[] {
        return this.sections().filter(s => !s.themeSlug).map(s => s.slug);
    }

    /**
     * Activation only reaches sections that name no theme of their own.
     *
     * Offering it unconditionally was misleading: on an install where every
     * section carries a `themeSlug`, activating a theme changes the database and
     * nothing else — the button appeared to work and the site never moved.
     */
    canActivate(theme: ThemeDto): boolean {
        return !theme.isActive && this.isSiteTheme(theme) && this.unassignedSections().length > 0;
    }

    /**
     * Leftover `Theme.sections[]` from before the binding was unified.
     *
     * The value is no longer read by anything — `Version20260731120000` folded it
     * into `SiteSection.themeSlug` and the resolver's per-section step is gone.
     * Surfaced only so an operator who remembers configuring it here is told
     * where it went, instead of silently seeing it stop mattering.
     */
    divergence(theme: ThemeDto): string | null {
        if (theme.sections.length === 0) return null;

        return `Legacy assignment (${theme.sections.join(', ')}) — no longer used. `
            + 'A section\'s theme is set on the Sections page.';
    }

    toggleTemplates(theme: ThemeDto): void {
        const slug = theme.manifest.slug;
        if (this.expanded() === slug) {
            this.expanded.set(null);

            return;
        }

        this.expanded.set(slug);
        if (this.templates()[slug]) return; // already fetched — keep it cached

        this.templatesLoading.set(true);
        this.api.listTemplates(slug).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: rows => {
                this.templates.update(all => ({ ...all, [slug]: rows }));
                this.templatesLoading.set(false);
            },
            error: () => {
                this.templatesLoading.set(false);
                this.toast.error(`Could not load templates for “${slug}”`);
                this.expanded.set(null);
            },
        });
    }

    /**
     * Open one template's source.
     *
     * The dialog does its own fetch rather than being handed content: it is
     * lazily imported, so loading state and read failures belong to it and the
     * list stays responsive while a large template arrives.
     */
    viewSource(slug: string, path: string): void {
        void import('./template-source.dialog').then(m => {
            this.dialog.open(m.TemplateSourceDialog, { data: { slug, path } });
        });
    }

    activate(theme: ThemeDto): void {
        // Name the sections it will actually reach. "Will skin the public site"
        // was a promise the fast-path does not keep for sections that name a
        // theme of their own.
        const reached = this.unassignedSections().join(', ');

        this.confirmSvc.open({
            title:        'Activate theme',
            message:      `“${theme.manifest.name || theme.manifest.slug}” will serve ${reached} — `
                + 'the sections that name no theme of their own. Sections with their own theme are unaffected.',
            confirmLabel: 'Activate',
        }).pipe(
            filter(Boolean),
            switchMap(() => {
                this.busy.set(true);

                return this.api.setActive(theme.id, true);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.busy.set(false);
                this.toast.success(`“${theme.manifest.name || theme.manifest.slug}” is now active`);
                this.load();
            },
            error: () => {
                this.busy.set(false);
                this.toast.error('Could not activate that theme');
            },
        });
    }

    uninstall(theme: ThemeDto): void {
        this.confirmSvc.open({
            title:        'Uninstall theme',
            message:      `Remove “${theme.manifest.name || theme.manifest.slug}”? Its files stay on disk; only the installation record is removed.`,
            confirmLabel: 'Uninstall',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => {
                this.busy.set(true);

                return this.api.uninstall(theme.id);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.busy.set(false);
                this.toast.success('Theme uninstalled');
                this.load();
            },
            error: () => {
                this.busy.set(false);
                this.toast.error('Could not uninstall that theme');
            },
        });
    }

    private load(): void {
        this.loading.set(true);
        this.error.set(null);
        this.api.listThemes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: rows => {
                this.themes.set(rows);
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
                this.error.set('Could not load themes.');
            },
        });

        // Sections are supplementary: they enrich the cards with the asset
        // binding, so a failure here degrades that detail rather than the page.
        this.api.listSections().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: rows => this.sections.set(rows),
            error: () => this.sections.set([]),
        });
    }
}
