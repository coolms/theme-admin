import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    OnInit,
    signal,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import {
    CmsPageHeaderComponent,
    CmsPaneSplitterComponent,
    CmsSectionHeaderComponent,
    ConfirmDialogService,
    DynamicFormComponent,
    ErrorBannerComponent,
    LoadingComponent,
    PageTitleService,
    PageToolbarComponent,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { ErrorHandlerService, UserPreferencesService } from '@coolms/core-angular';


import { Store } from '@ngxs/store';

import { SectionState } from '../sections/section.state';
import { ModuleSettingsService } from './module-settings.service';
import { ModuleSettingsBlockDto } from './module-settings.types';
import { adoptSavedBlock, withoutPinnedKeys } from './settings-payload.util';
import { deslugify, groupBlocks, isEdited, type ModuleGroup } from './settings-grouping.util';

/** Where the rail's folded branches are remembered, per user. */
const PREFS_KEY = 'settings';

/**
 * Settings (`/admin/settings`, ROLE_ADMIN) — the classic options shape: a tree
 * of every module's blocks on the left, the selected block's form in the main
 * area, its actions along the bottom.
 *
 * **Why this and not the two shapes before it.** A grid of panes had nothing to
 * fill a wide screen with and no answer at twenty modules; a modal capped how
 * big a block could grow and made moving between blocks a close-then-open. A
 * rail plus a content pane is what every settings screen converges on because it
 * scales in the one direction settings actually grow — more of them — and it
 * lets a block have as much room as it needs.
 *
 * **Reuses the Explorer's resizable rail, not its shell.** `cms-pane-splitter`
 * is the part worth having (a drag handle whose width persists per user);
 * `cms-explorer-layout` is driven by a server-declared `LayoutConfig` of named
 * slot components, which earns its keep where the layout itself is configurable
 * per deployment (VFS, Media, Pages) and would be ceremony here.
 *
 * **Selection lives in the QUERY STRING** — `?block=` for the selection,
 * `?module=` to root the tree at one module (what a module's own Settings button
 * links to). Both are deep-linkable, and a query-param change does not re-create
 * the component, so moving between blocks costs nothing. The older
 * `/settings/{key}` path still works and is rewritten to `?block=` on arrival.
 *
 * **Generated from the registry, never listed here.** A module that is not
 * installed contributes no block and simply does not appear.
 */
@Component({
    selector: 'coolms-admin-settings-hub',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CmsPageHeaderComponent,
        CmsPaneSplitterComponent,
        PageToolbarComponent,
        CmsSectionHeaderComponent,
        DynamicFormComponent,
        LoadingComponent,
        ErrorBannerComponent,
    ],
    template: `
        <div class="settings">
            <cms-page-header
                [title]="scopeLabel() || 'Settings'"
                icon="sliders"
                [subtitle]="subtitle()"
                [actions]="headerActions()"
                (actionClick)="onHeaderAction($event)">
            </cms-page-header>

            <!-- Declares nothing itself: the tree says which buttons exist, and
                 its show-when condition decides whether All settings applies,
                 from the context below. The bar renders nothing, both nodes
                 being position header. -->
            <app-page-toolbar
                [treeSlug]="toolbarTree"
                [context]="toolbarContext()"
                (headerActionsChanged)="headerActions.set($event)"
                (actionClick)="onHeaderAction($event)" />

            @if (loading()) {
                <app-loading label="Loading settings…" />
            }
            @if (loadError(); as err) {
                <app-error-banner [message]="err" [showRetry]="true" (retry)="load()" />
            }

            @if (ready()) {
                <div class="settings__body">
                    <aside class="settings__rail" [class.settings__rail--rooted]="scope() !== null">
                        @if (visibleGroups().length === 0) {
                            <p class="settings__rail-empty">
                                {{ scope() ? scopeLabel() + ' declares no settings.' : 'No installed module declares any settings yet.' }}
                            </p>
                        }
                        @for (group of visibleGroups(); track group.module) {
                            <div class="rail-group">
                                <!-- Only on the all-modules tree. Rooted at one
                                     module, the page header already names it and
                                     a rail heading would say it twice — and there
                                     is nothing to fold it against.
                                     Chevron on the RIGHT so the module icon stays
                                     the left anchor: a disclosure control in
                                     front would push every label off the line the
                                     page header and the items share. -->
                                @if (scope() === null) {
                                    <button type="button"
                                            class="rail-group__head"
                                            [attr.aria-expanded]="isOpen(group.module)"
                                            (click)="toggleGroup(group.module)">
                                        <i class="bi" [class]="'bi-' + group.icon"></i>
                                        <span class="rail-group__label">{{ group.label }}</span>
                                        @if (group.badge) {
                                            <span class="rail-group__badge">{{ group.badge }}</span>
                                        }
                                        <i class="bi rail-group__chevron"
                                           [class]="isOpen(group.module) ? 'bi-chevron-down' : 'bi-chevron-right'"></i>
                                    </button>
                                }
                                @if (isOpen(group.module)) {
                                    @for (block of group.blocks; track block.key) {
                                        <button type="button"
                                                class="rail-item"
                                                [class.rail-item--active]="block.key === selectedKey()"
                                                (click)="select(block)">
                                            <span class="rail-item__label">{{ block.label }}</span>
                                            @if (edited(block)) {
                                                <span class="rail-item__dot"
                                                      title="Saved values are overriding the shipped defaults"></span>
                                            }
                                        </button>
                                    }
                                }
                            </div>
                        }
                    </aside>

                    <cms-pane-splitter storageKey="cms.settings.railW" [minWidth]="200" [maxWidth]="440" />

                    <section class="settings__content">
                        @if (selected(); as b) {
                            <!-- Header strip, scrolling body, action bar — the
                                 three parts an options pane has. The strip and
                                 the bar stay put; only the form moves, so the
                                 reader never loses which block they are in or
                                 how to save it. -->
                            <div class="settings__head">
                                <cms-section-header
                                    [icon]="b.moduleIcon ?? 'sliders'"
                                    [title]="b.label"
                                    [subtitle]="b.moduleLabel ?? deslug(b.module)"
                                    [flush]="true" />
                            </div>

                            <div class="settings__pane">
                                @if (b.siteScopable && multiSite()) {
                                    <!-- Only where the block declared it. Offering
                                         the choice on a platform-wide block would
                                         invite a save the server refuses.

                                         WHICH site comes from the header's Site
                                         Selector, not from a second list here.
                                         This control picks the LAYER; that one
                                         picks the site, as it already does
                                         everywhere else in the admin. -->
                                    <div class="settings__scope-bar">
                                    @if (activeSite(); as site) {
                                        <div class="settings__scope">
                                            <span id="scope-label">Applies to</span>
                                            <div class="settings__scope-choice" role="group" aria-labelledby="scope-label">
                                                <button type="button"
                                                        [class.is-active]="'platform' === scopeMode()"
                                                        [attr.aria-pressed]="'platform' === scopeMode()"
                                                        (click)="chooseScope('platform')">Platform (every site)</button>
                                                <button type="button"
                                                        [class.is-active]="'site' === scopeMode()"
                                                        [attr.aria-pressed]="'site' === scopeMode()"
                                                        (click)="chooseScope('site')">{{ site.label }}</button>
                                            </div>
                                        </div>
                                    } @else {
                                        <p class="settings__note">
                                            Editing the values every site uses. To set them for one site, pick that
                                            site in the header first.
                                        </p>
                                    }
                                    @if ('site' === scopeMode() && activeSite()) {
                                        <!-- The saved values are what THIS SITE
                                             overrode; the rest is inherited. Without
                                             saying so, an operator cannot tell a
                                             value they set here from one coming
                                             from the platform. -->
                                        <p class="settings__note">
                                            Showing this site's settings. Fields it has not overridden are
                                            inherited from the platform, and Reset drops only this site's
                                            overrides &mdash; it does not change the platform.
                                        </p>
                                    }
                                    </div>
                                }
                                @if (b.formId) {
                                    <!-- Rebuilt on formKey() so Reset and Discard
                                         re-read the stored values into the
                                         controls. The form patches its initial
                                         value ONCE, at definition load. -->
                                    @for (k of [formKey()]; track k) {
                                        <app-dynamic-form
                                            [formId]="b.formId"
                                            context="edit"
                                            [initialValue]="b.effective"
                                            [readonlyFields]="lockedAliases(b)"
                                            [showActions]="false"
                                            (submitted)="save($event)" />
                                    }
                                    @if (lockedAliases(b).length) {
                                        <!-- Naming the variable is the point. A greyed
                                             control with no explanation reads as a bug;
                                             "set by PAGE_CACHE_TTL" tells an operator
                                             exactly where to change it for real. -->
                                        <p class="settings__note">
                                            Set by the environment and not editable here:
                                            @for (entry of lockedEntries(b); track entry.alias) {
                                                <code>{{ entry.alias }}</code> (<code>{{ entry.variable }}</code>){{ $last ? '' : ', ' }}
                                            }
                                        </p>
                                    }
                                } @else {
                                    <p class="settings__note">
                                        This module declared a settings block but no form for it, so there
                                        is nothing to render here. The values below are what is stored;
                                        they remain editable over the API.
                                    </p>
                                    <pre class="settings__raw">{{ prettyData() }}</pre>
                                }
                            </div>

                            <div class="settings__actions">
                                <div class="settings__meta">
                                    <code>{{ b.key }}</code>
                                    @if (b.storedAt; as where) {
                                        <span class="settings__stored">saved to {{ where }}</span>
                                    }
                                </div>

                                <div class="settings__buttons">
                                    @if (isEditedBlock()) {
                                        <button type="button" class="cms-btn cms-btn-sm cms-btn-danger"
                                                (click)="reset()">
                                            <i class="bi bi-arrow-counterclockwise"></i>
                                            <span>Reset to defaults</span>
                                        </button>
                                    }
                                    @if (b.formId) {
                                        <button type="button" class="cms-btn" (click)="discard()">
                                            Discard
                                        </button>
                                        <!-- Never disabled on invalid: a greyed-out Save with
                                             no explanation is a dead end, where submitting an
                                             incomplete form marks its fields and says what is
                                             missing. -->
                                        <button type="button" class="cms-btn cms-btn-primary"
                                                [disabled]="saving()"
                                                (click)="submit()">
                                            {{ saving() ? 'Saving…' : 'Save settings' }}
                                        </button>
                                    }
                                </div>
                            </div>
                        } @else {
                            <div class="settings__placeholder">
                                <i class="bi bi-sliders"></i>
                                <p>Select a setting to edit it.</p>
                            </div>
                        }
                    </section>
                </div>
            }
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        .settings { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        .settings__body { display: flex; flex: 1; min-height: 0; }

        /* Left padding matches cms-page-header's 20px so the rail's labels sit
           on the same vertical line as the page title above them. The items
           bleed their hover background back out past it -- see rail-item. */
        .settings__rail {
            width: 260px;
            flex-shrink: 0;
            overflow-y: auto;
            padding: 4px 12px 12px 20px;
        }

        .settings__rail-empty {
            font-size: .8125rem;
            color: var(--cms-text-muted);
            padding: 8px 0;
            margin: 0;
        }

        .rail-group + .rail-group { margin-top: 14px; }

        .rail-group__head {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            padding: 4px 0;
            border: 0;
            background: transparent;
            font-size: .75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .03em;
            color: var(--cms-text-muted);
            text-align: left;
            cursor: pointer;
        }
        .rail-group__head:hover { color: var(--cms-text); }
        .rail-group__head:focus-visible { outline: 2px solid var(--cms-accent); outline-offset: 2px; }
        .rail-group__head .bi { font-size: .8125rem; }

        .rail-group__chevron { margin-left: auto; opacity: .7; }

        .rail-group__badge {
            font-size: .6875rem;
            line-height: 1;
            padding: 2px 6px;
            border-radius: 999px;
            background: var(--cms-bg-muted);
        }

        /* Geometry, so the label lands exactly on the rail's 20px line: pulled
           10px left, 2px of accent rule, 8px of padding. The background then
           bleeds past the text on both sides, which is what makes a selected
           row read as a band rather than a floating pill. */
        .rail-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            width: calc(100% + 20px);
            margin: 0 -10px;
            /* 29px = the 23px the group heading's icon and gap take up, plus the
               10px pulled back by the margin, minus the 2px accent rule — so a
               block's label lands exactly under its module's label, the way a
               tree indents a child rather than starting a new column. */
            padding: 6px 10px 6px 29px;
            border: 0;
            border-left: 2px solid transparent;
            background: transparent;
            color: var(--cms-text);
            font-size: .8125rem;
            text-align: left;
            cursor: pointer;
        }

        /* No module heading to sit under, so no child indent: the blocks are the
           rail's top level and align with the page header like everything else. */
        .settings__rail--rooted .rail-item { padding-left: 8px; }
        .rail-item:hover { background: var(--cms-hover-bg); }
        .rail-item:focus-visible { outline: 2px solid var(--cms-accent); outline-offset: -2px; }
        .rail-item--active {
            background: var(--cms-accent-light, #FEF7E6);
            border-left-color: var(--cms-accent);
            font-weight: 600;
        }

        .rail-item__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .rail-item__dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--cms-accent);
            flex-shrink: 0;
        }

        .settings__content {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
        }

        /* Header strip: same 20px gutter as the page header above it, and its
           own full-width rule (the section header runs flush inside it, so the
           divider is drawn once). */
        .settings__head {
            flex-shrink: 0;
            padding: 12px 20px;
            border-bottom: 1px solid var(--cms-border);
        }

        /* 20px inside the splitter, the same gutter the page header keeps from
           the content edge, so the form's left rule continues the title's. */
        .settings__pane {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 4px 20px 16px;
            max-width: 780px;
        }

        .settings__note { font-size: .8125rem; color: var(--cms-text-muted); margin: 0 0 8px; }

        /* The scope picker is a control ABOUT the form, not a field in it. The
           rule and the gap sit under the picker AND its explanation, so the two
           read as one band that the form starts below — not as a separator
           driven between a control and the sentence describing it.

           Reported from the screen: without this the select sat hard against the
           first checkbox and the two looked like one group. */
        .settings__scope-bar {
            margin: 0 0 18px;
            padding-bottom: 14px;
            border-bottom: 1px solid var(--cms-border);
        }

        .settings__scope {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 0 0 6px;
            font-size: .8125rem;
            color: var(--cms-text-muted);
        }

        .settings__scope-choice { display: inline-flex; }

        .settings__scope-choice button {
            border: 1px solid var(--cms-border);
            background: var(--cms-surface);
            color: var(--cms-text);
            padding: 4px 12px;
            font-size: .8125rem;
            cursor: pointer;
        }

        .settings__scope-choice button:first-child {
            border-radius: var(--cms-radius-sm) 0 0 var(--cms-radius-sm);
        }

        .settings__scope-choice button:last-child {
            border-radius: 0 var(--cms-radius-sm) var(--cms-radius-sm) 0;
            border-left: none;
        }

        /* The selected layer, in the accent the admin uses for a chosen state. */
        .settings__scope-choice button.is-active {
            background: var(--cms-accent);
            border-color: var(--cms-accent);
            color: var(--cms-accent-fg);
        }

        /* Already spaced by the bar below it. */
        .settings__scope-bar .settings__note { margin-bottom: 0; }

        .settings__raw {
            background: var(--cms-code-bg);
            color: var(--cms-code-text);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            padding: 12px;
            font-size: .8125rem;
            overflow-x: auto;
        }

        /* Actions along the BOTTOM of the content pane, the way an options
           dialog puts them: the form scrolls, the actions never leave. */
        .settings__actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
            flex-shrink: 0;
            padding: 10px 20px;
            border-top: 1px solid var(--cms-border);
        }

        .settings__meta {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
            font-size: .75rem;
            color: var(--cms-text-muted);
        }
        .settings__meta code { word-break: break-all; }
        .settings__stored { word-break: break-all; }

        .settings__buttons { display: flex; align-items: center; gap: 8px; margin-left: auto; }

        .settings__placeholder {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            color: var(--cms-text-muted);
        }
        .settings__placeholder .bi { font-size: 1.75rem; }
    `],
})
export class SettingsHubPageComponent implements OnInit {
    readonly loading = signal(true);
    readonly loadError = signal<string | null>(null);
    readonly blocks = signal<readonly ModuleSettingsBlockDto[]>([]);

    /** Which block the content pane shows, from `?block=`. */
    readonly selectedKey = signal<string | null>(null);

    /** Which module roots the tree, from `?module=`; null shows every module. */
    readonly scope = signal<string | null>(null);

    /** Bumped to force the form to rebuild from the stored values. */
    readonly formKey = signal(0);

    // ⚠️ Declared ABOVE the signals that read it. Field initialisers run in
    // source order, so a `toSignal(this.store…)` above this line compiles and
    // then reads undefined at runtime — TS2729 catches it, which is the only
    // reason it is not a boot-time mystery.
    private readonly store = inject(Store);

    /**
     * Which LAYER is being edited. The SITE is not chosen here.
     *
     * ⚠️ This screen used to carry its own list of sites, which put a second site
     * picker on a page that already had one in the header — and the header's is
     * the platform's answer to "which site am I working on", stamped onto every
     * API call as `X-CoolMS-Section`. Two controls for one question is the
     * question asked twice.
     *
     * What the header CANNOT express is the platform itself: its empty option is
     * `(host-derived)`, meaning "infer the site from the host", which is not the
     * same as "the values every site shares". That distinction is the only thing
     * this control exists for.
     */
    readonly scopeMode = signal<'platform' | 'site'>('platform');

    /** Every section the operator can see, from the same state the header uses. */
    private readonly sections = toSignal(this.store.select(SectionState.sections), { initialValue: [] });

    /** The header's current site, or null when it is host-derived. */
    readonly activeSite = toSignal(this.store.select(SectionState.currentSection), { initialValue: null });

    /**
     * Whether a per-site choice means anything here.
     *
     * With one section there is nothing to distinguish — the platform's values
     * ARE that site's — and the header's own selector hides itself for exactly
     * that reason. A layer toggle there would offer a decision with one outcome.
     */
    readonly multiSite = computed(() => this.sections().length > 1);

    /**
     * The scope to address the API with: a site id, or null for the platform.
     *
     * ⚠️ A plain signal, SET in {@link chooseScope} -- not a computed over
     * `scopeMode` and `activeSite`. As a computed it fed `selected()`, which the
     * template reads, and clicking the site button FROZE the renderer. The exact
     * cycle was not worth chasing: a settings screen that hangs the admin is not
     * a trade to make for removing one assignment.
     */
    readonly selectedSite = signal<string | null>(null);

    /**
     * The selected block AS SEEN AT `selectedSite()`.
     *
     * Held apart from {@link blocks} rather than written into it: that list is
     * the platform-wide view the rail renders, and folding a site's values into
     * it would make the rail describe one site while claiming to describe the
     * platform.
     */
    readonly scopedBlock = signal<ModuleSettingsBlockDto | null>(null);

    /**
     * Modules whose branch is folded away — the COLLAPSED set, not the expanded
     * one, so a newly installed module shows up rather than hiding until someone
     * finds it.
     *
     * Independently collapsible and remembered per user, NOT a strict accordion:
     * one-at-a-time would close the branch you were comparing against every time
     * you opened another, and a settings tree earns its keep by being scannable.
     */
    readonly collapsed = signal<ReadonlySet<string>>(new Set<string>());

    readonly ready = computed((): boolean => !this.loading() && null === this.loadError());

    readonly groups = computed(() => groupBlocks(this.blocks()));

    readonly visibleGroups = computed((): ModuleGroup[] => {
        const module = this.scope();

        return null === module ? this.groups() : this.groups().filter(g => g.module === module);
    });

    readonly selected = computed((): ModuleSettingsBlockDto | null => {
        const key = this.selectedKey();
        const scoped = this.scopedBlock();
        if (null !== key && null !== scoped && scoped.key === key && null !== this.selectedSite()) {
            return scoped;
        }

        return null === key ? null : this.blocks().find(b => b.key === key) ?? null;
    });

    readonly isEditedBlock = computed((): boolean => {
        const b = this.selected();

        return null !== b && isEdited(b);
    });

    /** The raw view shows what is IN FORCE, same as the form above it. */
    readonly prettyData = computed((): string => JSON.stringify(this.selected()?.effective ?? {}, null, 2));

    readonly scopeLabel = computed((): string => {
        const module = this.scope();
        if (null === module) {
            return '';
        }

        return this.groups().find(g => g.module === module)?.label ?? deslugify(module);
    });

    readonly subtitle = computed((): string =>
        null === this.scope()
            ? 'Per-module configuration. Changes take effect immediately.'
            : 'Settings this module owns. Changes take effect immediately.',
    );

    /** @see SettingsToolbarContributor — the server owns which buttons exist. */
    readonly toolbarTree = 'navi.toolbar.settings';

    /** Filled from the toolbar tree, not built here. */
    readonly headerActions = signal<ToolbarAction[]>([]);

    /**
     * What the tree's conditions are evaluated against.
     *
     * `_scoped` is the only fact the server needs to decide whether widening the
     * tree is offered, and publishing it as CONTEXT rather than acting on it
     * here is the difference between the page describing its state and the page
     * deciding its chrome.
     */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _scoped: null !== this.scope(),
    }));

    /** Mid-save, read from the form — both `saving` and `viewChild` are signals. */
    readonly saving = computed((): boolean => this.form()?.saving() ?? false);

    private readonly form = viewChild(DynamicFormComponent);

    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly settings = inject(ModuleSettingsService);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly toast = inject(ToastService);
    private readonly pageTitle = inject(PageTitleService);
    private readonly prefs = inject(UserPreferencesService);
    private readonly destroyRef = inject(DestroyRef);

    ngOnInit(): void {
        // Subscribed, not snapshotted: a param change does not re-create this
        // component (see settingsUrlMatcher), which is exactly what makes
        // walking the tree free.
        const saved = this.prefs.getPageState<{ collapsed?: string[] }>(PREFS_KEY);
        this.collapsed.set(new Set(saved?.collapsed ?? []));

        this.route.paramMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                const module = params.get('module');
                this.scope.set(module);

                const key = params.get('block');
                if (key !== this.selectedKey()) {
                    this.selectedKey.set(key);
                    this.formKey.update(k => k + 1);
                }

                if (null !== key) {
                    this.revealSelected(module);
                }
            });

        this.load();
    }

    constructor() {
        // The breadcrumb should say where you ARE — the block, or the module
        // whose tree is open — not repeat the section's own name back at you.
        effect(() => this.pageTitle.set(
            this.selected()?.label ?? (this.scopeLabel() || 'Settings'),
        ));
    }

    load(): void {
        this.loading.set(true);
        this.loadError.set(null);
        this.settings.list().subscribe({
            next: blocks => {
                this.blocks.set(blocks);
                this.loading.set(false);
            },
            error: err => {
                this.loadError.set(this.errors.humanize(err));
                this.loading.set(false);
            },
        });
    }

    onHeaderAction(id: string): void {
        if ('all' === id) {
            void this.router.navigate(['/settings']);

            return;
        }

        this.load();
    }

    /** Walk to a block: `/admin/settings/{module}/{block}`. */
    select(block: ModuleSettingsBlockDto): void {
        void this.router.navigate(['/settings', block.module, block.key]);
    }

    /**
     * Rooted at one module, always open — its heading is hidden there, so a
     * branch folded earlier on the all-modules tree would leave the rail empty
     * with no control anywhere to open it again.
     */
    isOpen(module: string): boolean {
        return null !== this.scope() || !this.collapsed().has(module);
    }

    toggleGroup(module: string): void {
        const next = new Set(this.collapsed());
        if (!next.delete(module)) {
            next.add(module);
        }

        this.collapsed.set(next);
        this.prefs.setPageState(PREFS_KEY, { collapsed: [...next] });
    }

    /**
     * Never leave the open block inside a folded branch.
     *
     * A deep link, or a Settings button on a module page, can land on a block
     * whose module the reader collapsed weeks ago — the form would open with no
     * highlighted row anywhere in the rail to say where it came from.
     */
    private revealSelected(module: string | null): void {
        if (null === module || !this.collapsed().has(module)) {
            return;
        }

        const next = new Set(this.collapsed());
        next.delete(module);
        this.collapsed.set(next);
        this.prefs.setPageState(PREFS_KEY, { collapsed: [...next] });
    }

    edited(block: ModuleSettingsBlockDto): boolean {
        return isEdited(block);
    }

    deslug(slug: string): string {
        return deslugify(slug);
    }

    submit(): void {
        this.form()?.submit();
    }

    /** Throw away edits by rebuilding the form from what is stored. */
    discard(): void {
        this.formKey.update(k => k + 1);
    }

    /** Aliases this deployment pins in its environment. */
    lockedAliases(block: ModuleSettingsBlockDto): string[] {
        return Object.keys(block.locked ?? {});
    }

    /** The same, paired with the variable that owns each, for the note. */
    lockedEntries(block: ModuleSettingsBlockDto): { alias: string; variable: string }[] {
        return Object.entries(block.locked ?? {}).map(([alias, variable]) => ({ alias, variable }));
    }

    save(value: Record<string, unknown>): void {
        const key = this.selectedKey();
        if (null === key) {
            return;
        }

        // Pinned keys must not travel — see `withoutPinnedKeys` for why a
        // disabled control still ends up in the payload, and what it costs.
        const payload = withoutPinnedKeys(value, this.selected()?.locked ?? {});

        this.settings.save(key, payload, this.selectedSite()).subscribe({
            next: saved => {
                // Adopt the response: the store normalises and strips its own
                // bookkeeping, so what came back is what a reload would show —
                // but into the RIGHT place. See `adoptSavedBlock`.
                const { blocks, scoped } = adoptSavedBlock(this.blocks(), saved, this.selectedSite());
                this.blocks.set(blocks);
                if (null !== scoped) {
                    this.scopedBlock.set(scoped);
                }
                this.form()?.resetSaving();
                this.toast.success('Settings saved.');
            },
            error: err => this.form()?.setServerError(this.errors.humanize(err)),
        });
    }

    reset(): void {
        const b = this.selected();
        if (null === b) {
            return;
        }

        const site = this.selectedSite();
        // ⚠️ Different promise per scope. A site sits ON TOP of the platform
        // row, so dropping its overrides reveals the platform's values, not the
        // module's shipped ones -- and an operator told "defaults apply again"
        // would expect the wrong outcome.
        const question = null === site ? 'Reset to defaults?' : "Drop this site's overrides?";
        const detail = null === site
            ? `Drops the saved values for "${b.label}". The module's shipped defaults apply again.`
            : `Drops what this site overrode for "${b.label}". The platform's values apply again.`;

        this.confirm
            .confirm(question, detail)
            .subscribe(ok => {
                if (!ok) {
                    return;
                }

                this.settings.reset(b.key, site).subscribe({
                    next: () => {
                        if (null === site) {
                            const cleared = { ...b, data: {}, storedAt: null };
                            this.blocks.update(rows => rows.map(r => (r.key === cleared.key ? cleared : r)));
                        }
                        // Re-read rather than patch: at a site scope the values
                        // in force after a reset are the platform's, which this
                        // client does not hold and must not guess.
                        this.reloadScoped();
                        this.formKey.update(k => k + 1);
                        this.toast.success(null === site ? 'Settings reset to defaults.' : "This site's overrides dropped.");
                    },
                    error: err => this.toast.error(this.errors.humanize(err)),
                });
            });
    }

    /**
     * Switch which LAYER the form is editing. The site comes from the header.
     *
     * ⚠️ **The form is rebuilt when the values ARRIVE, not when the layer is
     * chosen.** `DynamicFormComponent` patches its initial value once, at
     * definition load, so a rebuild triggered here — before the scoped fetch
     * returns — patches the PLATFORM's values and then never re-reads. On the
     * real screen that showed a site with a saved TTL of 60 as 300, with a Reset
     * button proving a row existed: the screen contradicting itself.
     *
     * So only the platform switch bumps synchronously; the site switch leaves it
     * to {@link reloadScoped}, which knows when there is something to show.
     */
    chooseScope(mode: 'platform' | 'site'): void {
        const site = this.activeSite();
        this.scopeMode.set(mode);
        this.selectedSite.set('site' === mode && site?.id ? site.id : null);
        this.scopedBlock.set(null);
        this.reloadScoped();

        if (null === this.selectedSite()) {
            this.formKey.update(k => k + 1);
        }
    }

    // ⚠️ There is deliberately NO effect watching the header's site here.
    // The first attempt at one wrote `scopeMode` while also reading it, and the
    // renderer FROZE -- a settings screen that hangs the admin is a far worse
    // trade than a stale label. If the header's site changes while this screen is
    // open, the toggle still names the site it was showing until it is clicked
    // again; that is visible and recoverable, which a frozen tab is not.
    /**
     * Fetch the selected block at the selected scope.
     *
     * A no-op at the platform scope: {@link blocks} already holds that view, and
     * re-fetching it would be a second source for the same row.
     */
    private reloadScoped(): void {
        const key = this.selectedKey();
        const site = this.selectedSite();
        if (null === key || null === site) {
            this.scopedBlock.set(null);

            return;
        }

        this.settings.get(key, site).subscribe({
            next: block => {
                this.scopedBlock.set(block);
                // NOW the form has something scoped to render — see chooseSite.
                this.formKey.update(k => k + 1);
            },
            error: err => {
                // Fall back to the platform view rather than showing a block
                // whose values belong to neither scope.
                this.scopeMode.set('platform');
                this.selectedSite.set(null);
                this.scopedBlock.set(null);
                this.formKey.update(k => k + 1);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

}
