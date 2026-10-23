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
    CmsSettingsPaneComponent,
    CmsSettingsShellComponent,
    type CmsSettingsSection,
    ConfirmDialogService,
    DynamicFormComponent,
    ErrorBannerComponent,
    type HasUnsavedChanges,
    LoadingComponent,
    PageTitleService,
    PageToolbarComponent,
    ToastService,
    ToolbarAction,
    UnsavedChangesService,
} from '@coolms/ui-angular';
import { ErrorHandlerService } from '@coolms/core-angular';

import { Store } from '@ngxs/store';

import { SectionState } from '../sections/section.state';
import { SiteSelectorComponent } from '../sections/site-selector/site-selector.component';
import { ModuleSettingsService } from './module-settings.service';
import { ModuleSettingsBlockDto } from './module-settings.types';
import { adoptSavedBlock, withoutPinnedKeys } from './settings-payload.util';
import { deslugify, groupBlocks, isEdited } from './settings-grouping.util';
import { type SettingsScope } from './settings.routes';

/**
 * Settings, on the settings shell: the section list on the left, one setting's pane at a time on the right.
 *
 * **The ROUTE chooses the scope, never the setting picked.** `/settings/{module}/{key}` is the global scope -- every
 * module listed, a filter above them -- and picking any setting there changes only the pane and the URL.
 * `/{module}/settings/{key}` is that module's scope, with "All settings" back to the global route on the same
 * setting. The two used to share one URL shape, `/settings/{module}/{key}`, and the page read the scope from the
 * `{module}` in it, so picking another module's setting turned the global list into that module's.
 *
 * **Generated from the registry, never listed here.** A module that is not installed contributes no setting, and the
 * list holds only what `GET /module-settings` gives this caller.
 */
@Component({
    selector: 'coolms-admin-settings-hub',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CmsSettingsShellComponent,
        CmsSettingsPaneComponent,
        PageToolbarComponent,
        DynamicFormComponent,
        LoadingComponent,
        ErrorBannerComponent,
        SiteSelectorComponent,
    ],
    template: `
        <!-- Declares nothing itself: the server's toolbar tree says which buttons exist (Reload; All settings when
             its show-when finds the module scope in the context below). -->
        <app-page-toolbar
            [treeSlug]="toolbarTree"
            [context]="toolbarContext()"
            (headerActionsChanged)="headerActions.set($event)"
            (actionClick)="onHeaderAction($event)" />

        <cms-settings-shell
            [title]="title()"
            [scopeLine]="scopeLine()"
            [actions]="headerActions()"
            [sections]="sections()"
            [selectedId]="selectedKey()"
            [filterable]="'global' === scope()"
            [emptyText]="emptyText()"
            listLabel="Settings"
            splitterKey="cms.settings.railW"
            (select)="select($event)"
            (actionClick)="onHeaderAction($event)">

            @if (loading()) {
                <app-loading label="Loading settings…" />
            }
            @if (loadError(); as err) {
                <app-error-banner [message]="err" [showRetry]="true" (retry)="load()" />
            }

            @if (selected(); as b) {
                <cms-settings-pane
                    [title]="b.label"
                    [icon]="b.moduleIcon ?? 'sliders'"
                    [owner]="b.moduleLabel ?? deslug(b.module)"
                    [settingKey]="b.key"
                    [meta]="b.storedAt ? 'saved to ' + b.storedAt : ''"
                    [dirty]="dirty()"
                    [saving]="saving()"
                    (save)="submit()"
                    (discard)="discard()">

                    @if (b.siteScopable && multiSite()) {
                        <!-- Only where the setting declared it. The site picker lives here, the one place the choice
                             decides something; this picks the LAYER, the picker the site. -->
                        <div class="mb-3">
                            <app-site-selector [alwaysShow]="true" />
                            @if (activeSite(); as site) {
                                <div class="d-flex align-items-center gap-2 mt-2" role="group" aria-label="Applies to">
                                    <span class="cms-field-hint">Applies to</span>
                                    <button type="button" class="cms-btn cms-btn-sm"
                                            [class.cms-btn-active]="'platform' === scopeMode()"
                                            [attr.aria-pressed]="'platform' === scopeMode()"
                                            (click)="chooseScope('platform')">Platform (every site)</button>
                                    <button type="button" class="cms-btn cms-btn-sm"
                                            [class.cms-btn-active]="'site' === scopeMode()"
                                            [attr.aria-pressed]="'site' === scopeMode()"
                                            (click)="chooseScope('site')">{{ site.label }}</button>
                                </div>
                            } @else {
                                <p class="cms-field-hint">
                                    Editing the values every site uses. To set them for one site, pick that site above
                                    first.
                                </p>
                            }
                            @if ('site' === scopeMode() && activeSite()) {
                                <p class="cms-field-hint">
                                    Showing this site's settings. Fields it has not overridden are inherited from the
                                    platform, and Reset drops only this site's overrides &mdash; it does not change the
                                    platform.
                                </p>
                            }
                        </div>
                    }

                    @if (b.formId) {
                        <!-- Rebuilt on formKey() so Reset and Discard re-read the stored values: the form patches its
                             initial value once, at definition load. -->
                        @for (k of [formKey()]; track k) {
                            <app-dynamic-form
                                [formId]="b.formId"
                                context="edit"
                                [initialValue]="b.effective"
                                [readonlyFields]="lockedAliases(b)"
                                [showActions]="false"
                                (formChanged)="dirty.set(true)"
                                (submitted)="save($event)" />
                        }
                        @if (lockedAliases(b).length) {
                            <!-- Naming the variable is the point: "set by PAGE_CACHE_TTL" says where to change it. -->
                            <p class="cms-field-hint">
                                Set by the environment and not editable here:
                                @for (entry of lockedEntries(b); track entry.alias) {
                                    <code>{{ entry.alias }}</code> (<code>{{ entry.variable }}</code>){{ $last ? '' : ', ' }}
                                }
                            </p>
                        }
                    } @else {
                        <p class="cms-field-hint">
                            This module declared a setting but no form for it, so there is nothing to render here. The
                            values below are what is stored; they remain editable over the API.
                        </p>
                        <pre class="cms-card p-3">{{ prettyData() }}</pre>
                    }

                    @if (isEditedBlock()) {
                        <button paneActions type="button" class="cms-btn cms-btn-sm cms-btn-danger" (click)="reset()">
                            <i class="bi bi-arrow-counterclockwise"></i>
                            <span>Reset to defaults</span>
                        </button>
                    }
                </cms-settings-pane>
            }
        </cms-settings-shell>
    `,
    styles: [`:host { display: flex; flex-direction: column; flex: 1; min-height: 0; }`],
})
export class SettingsHubPageComponent implements OnInit, HasUnsavedChanges {
    readonly loading = signal(true);
    readonly loadError = signal<string | null>(null);
    readonly blocks = signal<readonly ModuleSettingsBlockDto[]>([]);

    /** The scope, from the ROUTE's data -- never from the setting open. */
    readonly scope = signal<SettingsScope>('global');

    /** In the module scope, which module; in the global scope, where the open setting lives (not a filter). */
    readonly module = signal<string | null>(null);

    /** Which setting the pane shows, from the URL. */
    readonly selectedKey = signal<string | null>(null);

    /** Bumped to rebuild the form from the stored values. */
    readonly formKey = signal(0);

    /** The pane has edits not yet saved. */
    readonly dirty = signal(false);

    //  Declared ABOVE the signals that read it: field initialisers run in source order.
    private readonly store = inject(Store);

    /** Which LAYER is being edited (the platform, or the picked site's overrides). The SITE is not chosen here. */
    readonly scopeMode = signal<'platform' | 'site'>('platform');

    private readonly siteSections = toSignal(this.store.select(SectionState.sections), { initialValue: [] });

    /** The picked site, or null when none is chosen. */
    readonly activeSite = toSignal(this.store.select(SectionState.currentSection), { initialValue: null });

    /** With one site the platform's values ARE that site's, and a layer toggle would offer a choice of one. */
    readonly multiSite = computed(() => this.siteSections().length > 1);

    /** The site to address the API with, or null for the platform. SET in chooseScope, not computed: see there. */
    readonly selectedSite = signal<string | null>(null);

    /** The open setting as seen at `selectedSite()`, held apart from the list, which is the platform-wide view. */
    readonly scopedBlock = signal<ModuleSettingsBlockDto | null>(null);

    /** What the list shows: every module's settings, or the module's in the module scope. */
    readonly visibleBlocks = computed((): ModuleSettingsBlockDto[] => {
        const all = groupBlocks(this.blocks()).flatMap(g => g.blocks);

        return 'module' === this.scope() ? all.filter(b => b.module === this.module()) : all;
    });

    readonly sections = computed((): CmsSettingsSection[] => {
        const global = 'global' === this.scope();
        const groups = groupBlocks(this.blocks());

        return this.visibleBlocks().map(b => {
            const group = groups.find(g => g.module === b.module);

            return {
                id: b.key,
                label: b.label,
                keywords: b.key,
                marker: isEdited(b) ? 'Saved values are overriding the shipped defaults' : undefined,
                group: global && group ? { id: group.module, label: group.label, icon: group.icon } : undefined,
            };
        });
    });

    readonly selected = computed((): ModuleSettingsBlockDto | null => {
        const key = this.selectedKey();
        const scoped = this.scopedBlock();
        if (null !== key && null !== scoped && scoped.key === key && null !== this.selectedSite()) {
            return scoped;
        }

        return null === key ? null : this.visibleBlocks().find(b => b.key === key) ?? null;
    });

    readonly isEditedBlock = computed((): boolean => {
        const b = this.selected();

        return null !== b && isEdited(b);
    });

    /** The raw view shows what is IN FORCE, same as the form would. */
    readonly prettyData = computed((): string => JSON.stringify(this.selected()?.effective ?? {}, null, 2));

    readonly moduleLabel = computed((): string => {
        const module = this.module();
        if (null === module) {
            return '';
        }

        return groupBlocks(this.blocks()).find(g => g.module === module)?.label ?? deslugify(module);
    });

    readonly title = computed((): string =>
        'module' === this.scope() ? `${this.moduleLabel()} settings` : 'Settings');

    readonly scopeLine = computed((): string =>
        'module' === this.scope()
            ? 'Settings this module owns. Changes take effect immediately.'
            : 'Every module\'s settings. Changes take effect immediately.');

    readonly emptyText = computed((): string =>
        'module' === this.scope() ? `${this.moduleLabel()} declares no settings.` : 'No installed module declares any settings yet.');

    /** @see SettingsToolbarContributor -- the server owns which buttons exist. */
    readonly toolbarTree = 'navi.toolbar.settings';

    readonly headerActions = signal<ToolbarAction[]>([]);

    /** `_scoped` is the one fact the toolbar tree's show-when reads (All settings in the module scope only). */
    readonly toolbarContext = computed((): Record<string, unknown> => ({ _scoped: 'module' === this.scope() }));

    readonly saving = computed((): boolean => this.form()?.saving() ?? false);

    private readonly form = viewChild(DynamicFormComponent);

    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly settings = inject(ModuleSettingsService);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly toast = inject(ToastService);
    private readonly pageTitle = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    constructor() {
        // The breadcrumb says where you ARE: the setting open, or the scope.
        effect(() => this.pageTitle.set(this.selected()?.label ?? this.title()));

        // Closing the tab or reloading with a dirty pane asks the browser's own question.
        const stop = inject(UnsavedChangesService).watch(this, () => this.dirty());
        inject(DestroyRef).onDestroy(stop);

        // With nothing selected, open the first setting -- once the list has arrived.
        effect(() => {
            if (null === this.selectedKey() && !this.loading()) {
                const first = this.firstBlock();
                if (null !== first) {
                    void this.router.navigate(this.linkTo(first), { replaceUrl: true });
                }
            }
        });
    }

    ngOnInit(): void {
        // Subscribed, not snapshotted: a param change does not re-create this component (see settingsUrlMatcher).
        this.scope.set((this.route.snapshot.data['settingsScope'] as SettingsScope | undefined) ?? 'global');
        this.route.paramMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                this.module.set(params.get('module'));
                const key = params.get('block');
                if (key !== this.selectedKey()) {
                    this.selectedKey.set(key);
                    this.rebuild();
                }
            });

        this.load();
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
            // The global route, on the same setting.
            const b = this.selected();
            void this.router.navigate(null === b ? ['/settings'] : ['/settings', b.module, b.key]);

            return;
        }

        this.load();
    }

    /** Pick a setting: only the pane and the URL change, in the scope the route chose. */
    select(key: string): void {
        const block = this.visibleBlocks().find(b => b.key === key);
        if (undefined !== block) {
            void this.router.navigate(this.linkTo(block));
        }
    }

    deslug(slug: string): string {
        return deslugify(slug);
    }

    submit(): void {
        this.form()?.submit();
    }

    /** Throw away edits by rebuilding the form from what is stored. */
    discard(): void {
        this.rebuild();
    }

    lockedAliases(block: ModuleSettingsBlockDto): string[] {
        return Object.keys(block.locked ?? {});
    }

    lockedEntries(block: ModuleSettingsBlockDto): { alias: string; variable: string }[] {
        return Object.entries(block.locked ?? {}).map(([alias, variable]) => ({ alias, variable }));
    }

    save(value: Record<string, unknown>): void {
        const key = this.selectedKey();
        if (null === key) {
            return;
        }

        // Pinned keys must not travel -- see `withoutPinnedKeys`.
        const payload = withoutPinnedKeys(value, this.selected()?.locked ?? {});

        this.settings.save(key, payload, this.selectedSite()).subscribe({
            next: saved => {
                // Adopt the response into the RIGHT place -- see `adoptSavedBlock`.
                const { blocks, scoped } = adoptSavedBlock(this.blocks(), saved, this.selectedSite());
                this.blocks.set(blocks);
                if (null !== scoped) {
                    this.scopedBlock.set(scoped);
                }
                this.form()?.resetSaving();
                this.dirty.set(false);
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
        // A site sits ON TOP of the platform row, so dropping its overrides reveals the platform's values.
        const question = null === site ? 'Reset to defaults?' : "Drop this site's overrides?";
        const detail = null === site
            ? `Drops the saved values for "${b.label}". The module's shipped defaults apply again.`
            : `Drops what this site overrode for "${b.label}". The platform's values apply again.`;

        this.confirm.confirm(question, detail).subscribe(ok => {
            if (!ok) {
                return;
            }

            this.settings.reset(b.key, site).subscribe({
                next: () => {
                    if (null === site) {
                        const cleared = { ...b, data: {}, storedAt: null };
                        this.blocks.update(rows => rows.map(r => (r.key === cleared.key ? cleared : r)));
                    }
                    // Re-read: at a site scope the values in force are the platform's, which this client must not guess.
                    this.reloadScoped();
                    this.rebuild();
                    this.toast.success(null === site ? 'Settings reset to defaults.' : "This site's overrides dropped.");
                },
                error: err => this.toast.error(this.errors.humanize(err)),
            });
        });
    }

    /**
     * Switch which LAYER the form edits. The form is rebuilt when the values ARRIVE (reloadScoped), not when the
     * layer is chosen: the form patches its initial value once, so an early rebuild showed the platform's values.
     */
    chooseScope(mode: 'platform' | 'site'): void {
        const site = this.activeSite();
        this.scopeMode.set(mode);
        this.selectedSite.set('site' === mode && site?.id ? site.id : null);
        this.scopedBlock.set(null);
        this.reloadScoped();

        if (null === this.selectedSite()) {
            this.rebuild();
        }
    }

    /** The URL of a setting in the scope the route chose. */
    private linkTo(block: ModuleSettingsBlockDto): unknown[] {
        return 'module' === this.scope()
            ? ['/', block.module, 'settings', block.key]
            : ['/settings', block.module, block.key];
    }

    /** The first setting to open: the global scope's `/settings/{module}` opens that module's first. */
    private firstBlock(): ModuleSettingsBlockDto | null {
        const visible = this.visibleBlocks();
        const module = this.module();

        return (null !== module ? visible.find(b => b.module === module) : undefined) ?? visible[0] ?? null;
    }

    private rebuild(): void {
        this.formKey.update(k => k + 1);
        this.dirty.set(false);
    }

    /** Fetch the open setting at the selected site; a no-op at the platform layer, which the list already holds. */
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
                this.rebuild();
            },
            error: err => {
                // Back to the platform view rather than a setting whose values belong to neither layer.
                this.scopeMode.set('platform');
                this.selectedSite.set(null);
                this.scopedBlock.set(null);
                this.rebuild();
                this.toast.error(this.errors.humanize(err));
            },
        });
    }
}
