import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
    ConfirmDialogService,
    ContextMenuService,
    DataGridData,
    DynamicRecordDto,
    DynamicRecordFormComponent,
    DynamicRecordService,
    PageFooterService,
    ToastService,
} from '@coolms/ui-angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@angular/cdk/dialog';
import { debounceTime, filter, forkJoin, of, Subject, switchMap } from 'rxjs';
import {
    DomainEntityItem,
    DomainModuleGroup,
    DynamicEntityTypeDto,
    EntityTypeSchema,
    FieldSchemaItem,
    SchemaService,
} from './schema.service';
import { FieldDefinitionFormComponent } from './field-definition-form.component';
import { DynamicTypeDialogComponent } from './dynamic-type-dialog.component';
import { NaviGraphService, NaviGraphNode, UserPreferencesService } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';

export interface TypeTreeNode {
    type:     DynamicEntityTypeDto;
    children: TypeTreeNode[];
    depth:    number;
}

/**
 * Scoped state service for DomainExplorerComponent.
 * Provided in DomainExplorerComponent.providers — destroyed with the host.
 * Injected by DomainExplorerTreeComponent and DomainExplorerDetailComponent
 * via the slot component injector chain.
 */
@Injectable()
export class DomainExplorerStateService {
    private readonly schemaSvc  = inject(SchemaService);
    private readonly naviGraph  = inject(NaviGraphService);
    private readonly ctxMenu    = inject(ContextMenuService);
    private readonly recordSvc  = inject(DynamicRecordService);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly footer     = inject(PageFooterService, { optional: true });
    private readonly destroyRef = inject(DestroyRef);
    private readonly http       = inject(HttpClient);
    private readonly prefs      = inject(UserPreferencesService);

    // -- Lazy-tree constants ---------------------------------------------------
    private readonly ROOT_KEY   = 'root';
    /** Track which parent keys have already been fetched to avoid duplicate requests. */
    private readonly loadedIds  = new Set<string>();
    /** Feed filterText changes into this to trigger debounced server-side search. */
    private readonly searchText$ = new Subject<string>();

    // -- Signals ---------------------------------------------------------------
    readonly modules           = signal<DomainModuleGroup[]>([]);
    /** Map of parentId -> direct children. 'root' key holds root-level types. */
    readonly childrenMap       = signal<Map<string, DynamicEntityTypeDto[]>>(new Map());
    /** Set of type IDs that are currently expanded in the tree. */
    readonly expandedIds       = signal<Set<string>>(new Set());
    /**
     * Non-null while a server-side search is active (filterText is set).
     * null means "no search active" — show the lazy tree instead.
     */
    readonly searchResults     = signal<DynamicEntityTypeDto[] | null>(null);
    readonly loading           = signal(true);
    readonly filterText        = signal('');
    readonly activeModule      = signal<string | null>(null);
    readonly activeEntity      = signal<DomainEntityItem | null>(null);
    readonly activeRuntimeType = signal<DynamicEntityTypeDto | null>(null);
    readonly runtimeExpanded   = signal(true);
    readonly activeSchema      = signal<EntityTypeSchema | null>(null);
    readonly schemaLoading     = signal(false);
    readonly showDynamicTypes  = signal<boolean>(false);
    readonly showEntities      = signal<boolean>(true);
    readonly viewMode          = signal<'structure' | 'records'>('structure');

    // -- NaviGraph-driven toolbar ----------------------------------------------
    /** Flat resolved nodes from navi.toolbar.domain_explorer, loaded once on init. */
    readonly domainToolbarNodes = signal<NaviGraphNode[]>([]);

    /** Unified evaluation context for the page toolbar and context menus. */
    readonly context = computed(() => this.buildUnifiedContext());

    readonly toolbarBreadcrumb = computed((): string => {
        const rt = this.activeRuntimeType();
        if (rt) return this.buildTypePath(rt);
        const entity = this.activeEntity();
        if (entity) return this.buildEntityPath(entity);
        return '';
    });

    /** Currently highlighted field row in the embedded datagrid (structure mode). */
    readonly selectedField  = signal<Record<string, unknown> | null>(null);
    /** Currently highlighted record row in the embedded datagrid (records mode). */
    readonly selectedRecord = signal<Record<string, unknown> | null>(null);

    // -- Static-entity record list (loaded on demand) --------------------------
    /** Paginated row data fetched from the static entity's collection endpoint. */
    readonly entityRecordsData    = signal<DataGridData | null>(null);
    /** True while the static-entity record list is being fetched. */
    readonly entityRecordsLoading = signal(false);

    /**
     * Memoised key that changes only when the entity identity *or* viewMode
     * changes in a way that requires a records reload.  Deliberately excludes
     * mutable sub-properties (e.g. fields) so that loadEntityFields() updating
     * activeEntity does not cause a spurious second loadEntityRecords() call.
     */
    private readonly recordsLoadKey = computed(() => {
        const entity = this.activeEntity();
        const mode   = this.viewMode();
        // Fire for any entity that has an explicit recordsUrl, except 'runtime' dynamic
        // entities — those use DynamicRecordListComponent which manages its own loading.
        if (entity?.recordsUrl && entity.dynamicOrigin !== 'runtime' && mode === 'records') {
            return `${entity.className}::${entity.recordsUrl}`;
        }
        return null;
    });

    // -- Computed --------------------------------------------------------------
    readonly filteredModules = computed(() => {
        const q = this.filterText().toLowerCase().trim();
        if (!q) return this.modules();
        return this.modules()
            .map(m => ({
                ...m,
                entities: m.entities.filter(e =>
                    e.shortName.toLowerCase().includes(q) ||
                    e.className.toLowerCase().includes(q),
                ),
            }))
            .filter(m => m.entities.length > 0);
    });

    /**
     * Flat union of all currently-loaded types across the entire tree.
     * Computed from childrenMap — used for breadcrumb path-building, availableTypes, etc.
     */
    readonly runtimeTypes = computed((): DynamicEntityTypeDto[] => {
        const all: DynamicEntityTypeDto[] = [];
        for (const children of this.childrenMap().values()) {
            all.push(...children);
        }
        return all;
    });

    readonly filteredRuntimeTypes = computed(() => {
        // managed entries are hidden from the DYNAMIC TYPES sidebar —
        // they appear under ENTITIES instead.
        const nonPhp = this.runtimeTypes().filter(t => t.origin !== 'managed');
        const q = this.filterText().toLowerCase().trim();
        if (!q) return nonPhp;
        return nonPhp.filter(t =>
            t.slug.toLowerCase().includes(q) ||
            t.label.toLowerCase().includes(q),
        );
    });

    /**
     * Flat, depth-first ordered list of visible type nodes for the tree panel.
     *
     * When a filter is active (searchResults non-null), shows server search results flat.
     * While awaiting search results (filterText set but searchResults still null), returns [].
     * When no filter, respects expand/collapse state and lazy-loaded children.
     */
    readonly flatTypes = computed((): TypeTreeNode[] => {
        const q = this.filterText().toLowerCase().trim();
        if (q) {
            const results = this.searchResults();
            if (results === null) {
                // Debounce in progress — show nothing until the response arrives
                return [];
            }
            return results
                .filter(t => t.origin !== 'managed')
                .map(t => ({ type: t, children: [], depth: 0 }));
        }
        return this.flattenChildren(this.ROOT_KEY, 0);
    });

    readonly dynamicFields = computed(() =>
        this.activeSchema()?.fields.filter(f => f.source !== 'entity') ?? [],
    );

    readonly inheritedFields = computed(() =>
        this.activeSchema()?.fields.filter(f => f.locked) ?? [],
    );

    readonly ownFields = computed(() =>
        this.activeSchema()?.fields.filter(f => !f.locked) ?? [],
    );

    readonly allFields = computed((): FieldSchemaItem[] => {
        const hasType   = this.activeRuntimeType() !== null;
        const hasEntity = this.activeEntity()?.isDynamic === true;
        if ((!hasType && !hasEntity) || !this.activeSchema()) {
            return [];
        }
        return [
            ...this.inheritedFields(),
            ...this.ownFields(),
        ].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
    });

    readonly childTypes = computed(() => {
        const rt = this.activeRuntimeType();
        if (!rt) return [];
        return this.runtimeTypes().filter(t => t.parentId === rt.id);
    });

    readonly totalEntityCount = computed(() =>
        this.modules().reduce((acc, m) => acc + m.entities.length, 0),
    );

    /**
     * Derived footer string for the Domain Explorer status bar.
     *
     * viewMode 'structure' -> "N fields"
     * viewMode 'records'   -> "N of M records" (or "N records" when all loaded)
     *
     * Returns null for runtime-dynamic entities in records view (they populate
     * entityRecordsData from a different code path) so the last-written footer
     * value is preserved.
     */
    readonly footerText = computed((): string | null => {
        const entity = this.activeEntity();
        if (!entity) return null;

        if (this.viewMode() === 'records') {
            const data = this.entityRecordsData();
            if (!data) return null;
            const shown = data.items.length;
            const total = data.totalItems;
            if (shown === total) {
                return `${total} record${total === 1 ? '' : 's'}`;
            }
            return `${shown} of ${total} records`;
        }

        const fields = this.activeSchema()?.fields ?? entity.fields ?? [];
        const count  = fields.length;
        return `${count} field${count === 1 ? '' : 's'}`;
    });

    // -- Bootstrap -------------------------------------------------------------

    constructor() {
        // -- Restore persisted view mode ---------------------------------------
        // Must run before any effects so the signal starts at the saved value.
        const savedPage = this.prefs.getPageState<{ viewMode?: string }>('domainExplorer');
        if (savedPage?.viewMode === 'records' || savedPage?.viewMode === 'structure') {
            this.viewMode.set(savedPage.viewMode);
        }

        // Debounced server-side search: fires 300 ms after filterText settles.
        // switchMap cancels any in-flight request when the text changes again.
        this.searchText$.pipe(
            debounceTime(300),
            switchMap(text => text
                ? this.schemaSvc.searchRuntimeTypes(text)
                : of(null),
            ),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(results => this.searchResults.set(results));

        // Push filterText into the search Subject whenever it changes.
        effect(() => {
            const text = this.filterText();
            untracked(() => {
                if (!text) {
                    this.searchResults.set(null);
                }
                this.searchText$.next(text);
            });
        });

        // Persist view mode to user preferences (server-synced with 2 s debounce
        // inside UserPreferencesService — no need for an extra debounce here).
        effect(() => {
            const mode = this.viewMode();
            untracked(() => this.prefs.setPageState('domainExplorer', { viewMode: mode }));
        });

        // Load records for static (non-dynamic) entities with a recordsUrl when records
        // mode is active.  Dynamic entities (isDynamic=true) use DynamicRecordListComponent
        // which manages its own data loading — this effect must not fire for them.
        //
        // We track recordsLoadKey() (a memoised string) instead of activeEntity()
        // directly.  activeEntity() is mutated when loadEntityFields() appends fields,
        // which would otherwise cause a second spurious loadEntityRecords() call.
        // Because recordsLoadKey is a computed signal, Angular only notifies this
        // effect when the string value actually changes (className or recordsUrl).
        effect(() => {
            const key = this.recordsLoadKey();
            untracked(() => {
                if (key) {
                    const entity = this.activeEntity();
                    if (entity) this.loadEntityRecords(entity);
                }
            });
        });

        // Reset field/record selection whenever the active runtime type changes.
        // viewMode is intentionally NOT reset here — it persists via preferences.
        effect(() => {
            this.activeRuntimeType(); // track
            untracked(() => {
                this.selectedField.set(null);
                this.selectedRecord.set(null);
            });
        });

        // Reactive footer sink — single source of truth for the Domain Explorer
        // status bar.  Replaces scattered `this.footer?.set(...)` calls that
        // could leak stale "N fields" text into records view.
        effect(() => {
            const text = this.footerText();
            if (text !== null) {
                untracked(() => this.footer?.set({ count: text }));
            }
        });

        // Self-load NaviGraph toolbar nodes for context menus and the page toolbar.
        const toolbarUrl = this.schemaSvc.domainExplorerToolbarUrl;
        if (toolbarUrl) {
            this.naviGraph.loadTree(toolbarUrl)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(nodes => this.domainToolbarNodes.set(nodes));
        }
    }

    /** Build the unified evaluation context for NaviGraph's isVisible / activeWhen.
     *  Reads from live signals. Optionally override rt/entity for context-menu openers
     *  that need to build the context for a hovered item without mutating signals. */
    buildUnifiedContext(
        overrideRt?:     DynamicEntityTypeDto | null,
        overrideEntity?: DomainEntityItem | null,
    ): Record<string, unknown> {
        const rt       = overrideRt     !== undefined ? overrideRt     : this.activeRuntimeType();
        const entity   = overrideEntity !== undefined ? overrideEntity : this.activeEntity();
        const mode     = this.viewMode();
        const selField = this.selectedField();
        const selRec   = this.selectedRecord();

        if (!rt && !entity) {
            return { _context: 'background', _mode: mode, _selected: false, _selection: 'none', isDynamic: false, dynamicOrigin: null, hasRecordsView: false, source: '', locked: false, hasOverride: null, overrideAction: null };
        }

        const selection = selField ? 'field' : selRec ? 'record' : 'none';

        return {
            _context:       rt ? 'type' : 'entity',
            _mode:          mode,
            _selected:      selection !== 'none',
            _selection:     selection,
            isDynamic:      rt ? true : Boolean(entity?.isDynamic),
            dynamicOrigin:  rt ? 'runtime' : (entity?.dynamicOrigin ?? null),
            // hasRecordsView: true when the entity/type can display a records list.
            //   runtime type (rt)                            -> always true (DynamicRecordListComponent)
            //   entity.isDynamic = true, origin = 'runtime'  -> true (DynamicRecordListComponent via dynamicAlias)
            //   entity.isDynamic = true, origin = 'managed'  -> false ('managed' types live in Entities section)
            //   entity.isDynamic = false                     -> true only when recordsUrl is set
            hasRecordsView: rt ? true
                : (entity?.isDynamic === true && entity?.dynamicOrigin === 'runtime')
                    || Boolean(entity?.recordsUrl),
            source:         selField ? String(selField['source'] ?? '')       : '',
            locked:         selField ? Boolean(selField['locked'])            : false,
            hasOverride:    selField ? (selField['hasOverride'] ?? null)      : null,
            overrideAction: selField ? (selField['overrideAction'] ?? null)   : null,
        };
    }

    // -- Global context menu (delegates to ContextMenuService) -----------------

    /** Right-click on a dynamic type row — opens the context menu without navigating.
     *  Builds context for the hovered type WITHOUT touching any signals, so the current
     *  content area (viewMode / selectedField / selectedRecord) is untouched.
     *  The full selectRuntimeType() fires only when the user actually picks an action. */
    openTypeCtxMenu(event: MouseEvent, type: DynamicEntityTypeDto): void {
        const ctx = this.buildUnifiedContext(type, null);
        this.ctxMenu.openFromNodes(
            event,
            this.domainToolbarNodes(),
            ctx,
            id => {
                this.selectRuntimeType(type); // full select only when action is invoked
                this.handleToolbarAction(id);
            },
        );
    }

    /** Right-click on a domain entity row — opens the context menu without navigating.
     *  Builds context for the hovered entity WITHOUT touching any signals, so the current
     *  content area (viewMode / selectedField / selectedRecord) is untouched. */
    openEntityCtxMenu(event: MouseEvent, entity: DomainEntityItem): void {
        const ctx = this.buildUnifiedContext(null, entity);
        this.ctxMenu.openFromNodes(
            event,
            this.domainToolbarNodes(),
            ctx,
            id => this.handleToolbarAction(id),
        );
    }

    /** Right-click on a field row — selects the field and opens the context menu. */
    openFieldCtxMenu(
        event: MouseEvent,
        field: Record<string, unknown>,
    ): void {
        this.selectedField.set(field);
        const ctx = this.buildUnifiedContext();
        this.ctxMenu.openFromNodes(
            event,
            this.domainToolbarNodes(),
            ctx,
            id => this.handleToolbarAction(id),
        );
    }

    /** Right-click on a record row — selects the record and opens the context menu.
     *  Builds a unified context with `_selection: 'record'` so contributor showWhen
     *  conditions for record-scoped actions (Edit Record, Delete Record) match. */
    openRecordCtxMenu(
        event: MouseEvent,
        row: Record<string, unknown>,
    ): void {
        this.selectedRecord.set(row);
        const ctx = this.buildUnifiedContext();
        this.ctxMenu.openFromNodes(
            event,
            this.domainToolbarNodes(),
            ctx,
            id => this.handleToolbarAction(id),
        );
    }

    /** Right-click on a blank area — opens the context menu.
     *  When inside a type or entity view, preserves that context (so "Add field"
     *  and view-toggle items still appear). Falls back to 'background' only when
     *  no type/entity is active (e.g. the left-panel empty area). */
    openBackgroundCtxMenu(event: MouseEvent): void {
        const mode     = this.viewMode();
        const rt       = this.activeRuntimeType();
        const entity   = this.activeEntity();
        const isDynamic        = rt ? true : Boolean(entity?.isDynamic);
        const hasDynamicRecords = rt ? true
            : entity?.isDynamic === true && entity?.dynamicOrigin === 'runtime';
        const _context  = rt ? 'type' : entity ? 'entity' : 'background';

        this.ctxMenu.openFromNodes(
            event,
            this.domainToolbarNodes(),
            { _context, _mode: mode, _selected: false, _selection: 'none', isDynamic, hasRecordsView: hasDynamicRecords || Boolean(entity?.recordsUrl), source: '', locked: false, hasOverride: null, overrideAction: null },
            id => this.handleToolbarAction(id),
        );
    }

    loadAll(): void {
        const wantEntities = this.showEntities();
        const wantTypes    = this.showDynamicTypes();

        if (wantEntities && wantTypes) {
            this.schemaSvc.listDomain()
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: domain => {
                        this.modules.set(domain);
                        this.loading.set(false);
                        if (domain.length > 0 && !this.activeEntity() && !this.activeRuntimeType()) {
                            this.activeModule.set(domain[0].module);
                        }
                    },
                    error: () => {
                        this.loading.set(false);
                        this.toast.error('Failed to load domain data');
                    },
                });
            this.loadRoot();

        } else if (wantEntities) {
            this.schemaSvc.listDomain()
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: domain => {
                        this.modules.set(domain);
                        this.loading.set(false);
                        if (domain.length > 0 && !this.activeEntity()) {
                            this.activeModule.set(domain[0].module);
                        }
                        if (!this.activeEntity()) {
                            this.footer?.set({ count: `${this.totalEntityCount()} entities` });
                        }
                    },
                    error: () => {
                        this.loading.set(false);
                        this.toast.error('Failed to load domain data');
                    },
                });

        } else if (wantTypes) {
            this.loadRoot();

        } else {
            this.loading.set(false);
        }
    }

    /** Loads the root level of the dynamic-type tree (called once on page init). */
    loadRoot(): void {
        this.fetchChildren(this.ROOT_KEY);
    }

    /**
     * Toggles expand/collapse for a type node.
     * On first expand, fetches children from the API.
     */
    toggleType(type: DynamicEntityTypeDto): void {
        const id = type.id!;
        if (this.expandedIds().has(id)) {
            this.expandedIds.update(s => { const n = new Set(s); n.delete(id); return n; });
        } else {
            this.expandedIds.update(s => new Set([...s, id]));
            this.fetchChildren(id);
        }
    }

    /**
     * Invalidates the cache for a parent key and re-fetches its children.
     * Call after creating or deleting a type to refresh the affected subtree level.
     */
    reloadChildren(parentId: string): void {
        this.loadedIds.delete(parentId);
        this.fetchChildren(parentId);
    }

    openAddRecord(): void {
        const rt     = this.activeRuntimeType();
        const entity = this.activeEntity();
        const alias  = rt?.slug ?? (entity?.isDynamic ? (entity.dynamicAlias ?? null) : null);
        if (!alias) return;
        this.dialog.open(DynamicRecordFormComponent, {
            data: {
                typeAlias: alias,
                schema:    this.activeSchema(),
                mode:      'create',
            },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                // Reload the active runtime type so record counts refresh
                if (rt?.id) {
                    this.schemaSvc.getType(rt.id)
                        .pipe(takeUntilDestroyed(this.destroyRef))
                        .subscribe(refreshed => {
                            this.activeRuntimeType.set(refreshed);
                            this.updateTypeInMap(refreshed);
                            this.footer?.set({
                                count: `${refreshed.recordCount} record${refreshed.recordCount === 1 ? '' : 's'}`,
                            });
                        });
                }
            });
    }

    openEditRecord(): void {
        const row = this.selectedRecord();
        if (!row) return;
        const rt     = this.activeRuntimeType();
        const entity = this.activeEntity();
        // DynamicRecordFormComponent is the wrong UI for static and
        // managed-dynamic records -- their records are not in
        // coolms_dynamic_records and dedicated module admin UIs own their CRUD.
        const isRuntimeDynamic = rt !== null
            || (entity?.isDynamic === true && entity.dynamicOrigin === 'runtime');
        if (!isRuntimeDynamic) return;
        const alias  = rt?.slug ?? (entity?.dynamicAlias ?? null);
        if (!alias) return;
        this.dialog.open(DynamicRecordFormComponent, {
            data: {
                typeAlias: alias,
                schema:    this.activeSchema(),
                record:    row as DynamicRecordDto,
                mode:      'edit',
            },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                this.selectedRecord.set(null);
                if (rt?.id) {
                    this.schemaSvc.getType(rt.id)
                        .pipe(takeUntilDestroyed(this.destroyRef))
                        .subscribe(refreshed => {
                            this.activeRuntimeType.set(refreshed);
                            this.updateTypeInMap(refreshed);
                        });
                } else if (entity?.recordsUrl) {
                    this.loadEntityRecords(entity, 0, true);
                }
            });
    }

    confirmDeleteRecord(): void {
        const row = this.selectedRecord();
        if (!row) return;
        // DynamicRecordService only knows the coolms_dynamic_records table.
        // Static and managed-dynamic entities live in their own tables (groups,
        // users, page_variants, ...) and have their own admin UIs for CRUD.
        // Domain Explorer is read-only for those -- guard to avoid a stray
        // DELETE /dynamic-entity/records/{uuid} that backend correctly 404s.
        const rt     = this.activeRuntimeType();
        const entity = this.activeEntity();
        const isRuntimeDynamic = rt !== null
            || (entity?.isDynamic === true && entity.dynamicOrigin === 'runtime');
        if (!isRuntimeDynamic) return;

        const id   = String(row['id'] ?? '');
        const name = String(row['title'] ?? row['name'] ?? row['slug'] ?? id);
        this.confirmSvc.confirmDelete(name)
            .pipe(
                filter(Boolean),
                switchMap(() => this.recordSvc.deleteRecord(id)),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: () => {
                    this.toast.success('Record deleted');
                    this.selectedRecord.set(null);
                },
                error: (e: { error?: { detail?: string } }) =>
                    this.toast.error(e?.error?.detail ?? 'Delete failed'),
            });
    }

    handleToolbarAction(id: string): void {
        switch (id) {
            case 'DeAddField':      this.openAddField(); break;
            case 'DeAddRecord':     this.openAddRecord(); break;
            case 'DeViewStructure':
            case 'view-structure':  this.switchViewMode('structure'); break;
            case 'DeViewRecords':
            case 'view-records':    this.switchViewMode('records');   break;
            case 'DeEditField': {
                const name = String(this.selectedField()?.['name'] ?? '');
                const f    = this.allFields().find(f => f.name === name);
                if (!f || f.locked) break;

                const rt = this.activeRuntimeType();
                if (!rt) {
                    // Entity context: showWhen already guards source === 'runtime'
                    if (f.source === 'runtime') this.openEditField(f);
                    break;
                }
                // Type context: check whether the field is inherited from an ancestor type.
                const isInherited = f.source !== 'runtime'
                    || (f.entityAlias !== '' && f.entityAlias !== rt.slug);
                if (isInherited) {
                    this.openOverrideField(f);
                } else {
                    this.openEditField(f);
                }
                break;
            }
            case 'DeResetField': {
                const name = String(this.selectedField()?.['name'] ?? '');
                // Read kind from the selected row — populated in both fieldGridData
                // (type context) and entityFieldGridData (entity context), so this
                // works even when allFields() is empty.
                const kind = this.selectedField()?.['hasOverride'] as string | null | undefined;
                if (kind !== 'db' && kind !== 'file' && kind !== 'parent') break;

                if (kind === 'db' || kind === 'parent') {
                    // DB or parent-type override: a FieldDefinition row exists for the
                    // active alias. Deleting it lets SchemaProvider's chain merge fall
                    // back to either the PHP default ('db') or the parent's row ('parent').
                    const f = this.allFields().find(f => f.name === name);
                    if (f?.id) this.deleteFieldDefinition(f.id);
                } else {
                    // File override: delete via API -> FileFieldOverrideStorage.delete()
                    const entity = this.activeEntity();
                    if (!entity) break;
                    const alias = entity.entityAlias ?? entity.dynamicAlias ?? entity.className;
                    this.schemaSvc.deleteFieldOverride(alias, name)
                        .pipe(takeUntilDestroyed(this.destroyRef))
                        .subscribe({
                            next:  () => {
                                this.toast.success('Field reset to default');
                                this.reloadActiveEntity();
                            },
                            error: () => this.toast.error('Failed to reset field'),
                        });
                }
                break;
            }
            case 'DeDeleteField': {
                const name = String(this.selectedField()?.['name'] ?? '');
                const f    = this.allFields().find(f => f.name === name);
                if (f) this.confirmDeleteField(f);
                break;
            }
            case 'DeEditOverride':
            case 'DeOverrideField': {
                const name = String(this.selectedField()?.['name'] ?? '');
                if (!name) break;

                // Dynamic type schema field path (activeRuntimeType is set)
                const schemaField = this.allFields().find(f => f.name === name);
                if (schemaField) {
                    this.openOverrideField(schemaField);
                    break;
                }

                // Static entity field path — allFields() is empty when activeRuntimeType is null.
                // Build a minimal FieldSchemaItem from EntityFieldMetadata so the override form
                // receives enough data to pre-fill name/type/label.
                const entity = this.activeEntity();
                if (!entity) break;
                const entityField = entity.fields.find(f => f.name === name);
                if (!entityField) break;

                // Use the server-resolved entityAlias (dynamic alias or FQCN as fallback).
                const alias = entity.entityAlias ?? entity.dynamicAlias ?? entity.className;
                const syntheticField: FieldSchemaItem = {
                    id:               null,
                    name:             entityField.name,
                    type:             entityField.type,
                    label:            entityField.label ?? entityField.name,
                    locked:           false,
                    source:           'entity',
                    entityAlias:      alias,
                    isRequired:       false,
                    sortOrder:        entityField.sortOrder ?? 0,
                    typeOptions:      {},
                    security:         { read: [], write: [] },
                    validationRules:  {},
                    options:          {},
                    formConfig:       {},
                    apiConfig:        {},
                    serializerConfig: {},
                };
                this.dialog.open(FieldDefinitionFormComponent, {
                    data: {
                        entityAlias: alias,
                        mode:        'override',
                        field:       syntheticField,
                        availableTypes: this.availableTypes(),
                    },
                    backdropClass: 'cdk-overlay-dark-backdrop',
                }).closed
                    .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
                    .subscribe(() => this.reloadActiveEntity());
                break;
            }
            case 'DeEditRecord':   this.openEditRecord(); break;
            case 'DeDeleteRecord': this.confirmDeleteRecord(); break;
            case 'DeEditType': {
                const rt = this.activeRuntimeType();
                if (rt) this.openEditType(rt);
                break;
            }
            case 'DeDeleteType': {
                const rt = this.activeRuntimeType();
                if (rt) this.confirmDeleteType(rt);
                break;
            }
            case 'DeAddChildType': {
                const rt = this.activeRuntimeType();
                if (rt) this.openAddChildType(rt);
                break;
            }
            case 'DeNewType':
                this.openCreateType();
                break;
        }
    }

    /**
     * Switches the active view mode and clears selections that belong to the
     * other mode. Field selection is meaningful only in Structure; record
     * selection is meaningful only in Records. Carrying either across modes
     * leaves NaviGraph `_selection` evaluation in an impossible state where
     * neither `none` nor `field` nor `record` matches the active surface.
     */
    private switchViewMode(mode: 'structure' | 'records'): void {
        this.viewMode.set(mode);
        this.selectedField.set(null);
        this.selectedRecord.set(null);
    }

    clearSelection(): void {
        this.activeRuntimeType.set(null);
        this.activeEntity.set(null);
        this.activeSchema.set(null);
        this.footer?.set({ count: '' });
        // toolbarBreadcrumb + context are computed — clear automatically via the signals above
    }

    /**
     * Re-fetches the full domain list and updates modules + the active entity reference.
     * Called after an override/create operation that may change a domain entity's field list.
     *
     * For dynamic entities, also reloads the active schema so that the field datagrid
     * (which reads allFields() -> activeSchema().fields) reflects the saved overrides
     * (isRequired, label, sortOrder, etc.) without requiring a full page reload.
     */
    reloadActiveEntity(): void {
        const entity = this.activeEntity();
        if (!entity) return;
        this.schemaSvc.listDomain()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(domain => {
                this.modules.set(domain);
                const updated = domain
                    .flatMap(g => g.entities)
                    .find(e => e.className === entity.className);
                if (updated) {
                    // Preserve the currently loaded fields until the detail fetch
                    // completes — the list endpoint returns fields: null.
                    this.activeEntity.set({ ...updated, fields: entity.fields });
                    // Dynamic entities display their fields through activeSchema (not
                    // entity.fields).  listDomain() does not carry per-field override data,
                    // so we must reload the schema separately to update isRequired, label,
                    // sortOrder, etc. in the datagrid immediately after a save.
                    if (updated.isDynamic && updated.dynamicAlias) {
                        this.loadSchema(updated.dynamicAlias);
                    }
                    // Reload entity fields — hasOverride / overrideAction may have changed.
                    this.loadEntityFields(updated);
                }
            });
    }

    private readonly RESERVED_FIELD_NAMES = new Set([
        'id', 'createdAt', 'updatedAt', 'accessedAt',
        'expiresAt', 'createdBy', 'updatedBy',
        'type', 'table', 'extras',
    ]);

    /**
     * Persists sortOrder for all fields in the reorder payload in a single round-trip.
     *
     * Buckets the payload into two groups:
     *  - Fields with an existing FieldDefinition id  -> single PATCH via reorderFields()
     *  - Fields without a FieldDefinition (new)       -> parallel POSTs via forkJoin(createField())
     *
     * reloadActiveEntity() is called exactly once after all requests complete.
     */
    batchReorderFields(payload: Array<{ name: string; sortOrder: number }>): void {
        const entity = this.activeEntity();
        if (!entity || payload.length === 0) return;

        const alias = entity.entityAlias ?? entity.dynamicAlias ?? entity.className;

        // Separate into: fields with an existing DB record vs fields that need creating
        const toReorder: Array<{ id: string; sortOrder: number }> = [];
        const toCreate: Array<{ name: string; type: string; label: string; sortOrder: number }> = [];

        for (const { name, sortOrder } of payload) {
            const schemaField = this.allFields().find(f => f.name === name);
            if (schemaField?.id) {
                toReorder.push({ id: schemaField.id, sortOrder });
            } else if (schemaField) {
                // Schema entry exists but no DB row -> create minimal sortOrder override
                toCreate.push({ name, sortOrder, type: schemaField.type, label: schemaField.label });
            } else {
                // Pure entity field (Path B) — no schema entry at all
                const entityField = entity.fields.find(f => f.name === name);
                if (entityField) {
                    toCreate.push({
                        name,
                        sortOrder,
                        type:  entityField.type ?? 'text',
                        label: entityField.label ?? name,
                    });
                }
            }
        }

        const requests = [
            ...(toReorder.length > 0 ? [this.schemaSvc.reorderFields(toReorder)] : []),
            ...toCreate.map(({ name, type, label, sortOrder }) =>
                this.schemaSvc.createField({ entityAlias: alias, name, type, label, sortOrder }),
            ),
        ];

        if (requests.length === 0) return;

        forkJoin(requests)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next:  () => this.reloadActiveEntity(),
                error: (e: { error?: { detail?: string } }) =>
                    this.toast.error(e?.error?.detail ?? 'Failed to save field order'),
            });
    }

    /**
     * Persists a sortOrder change after a drag-reorder in the entity-field DataGrid.
     *
     * Two paths:
     *  1. Field already has a FieldDefinition (schemaField.id non-null):
     *     PATCH the reorder endpoint — only sortOrder is touched, all other override
     *     data (isRequired, apiConfig, etc.) is preserved.
     *  2. No FieldDefinition yet (native entity column with no prior override):
     *     POST createField to create a minimal sortOrder-only override.
     *
     * The `source === 'entity'` check that previously blocked native PHP columns
     * has been removed — reordering those columns is exactly the purpose of this method.
     */
    createSortOrderOverride(fieldName: string, sortOrder: number): void {
        const entity = this.activeEntity();
        if (!entity) return;

        const alias = entity.entityAlias ?? entity.dynamicAlias ?? entity.className;

        // -- Path A: field is in the loaded schema (dynamic entity / entity with schema) -
        const schemaField = this.allFields().find(f => f.name === fieldName);
        if (schemaField) {
            // Note: do NOT gate on schemaField.locked here.
            // The `locked` flag means "no edit/delete via Schema Editor", but
            // sortOrder is a display-only override that should always be allowed —
            // that is the entire point of drag-to-reorder for entity/module fields.

            if (schemaField.id) {
                // Existing FieldDefinition: use the dedicated reorder endpoint so only
                // sortOrder is patched — other override fields are not overwritten.
                this.schemaSvc.reorderFields([{ id: schemaField.id, sortOrder }])
                    .pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe({
                        next:  () => this.reloadActiveEntity(),
                        error: (e: { error?: { detail?: string } }) =>
                            this.toast.error(e?.error?.detail ?? 'Failed to save field'),
                    });
            } else {
                // No FieldDefinition yet: create a minimal override that sets sortOrder.
                this.schemaSvc.createField({
                    entityAlias: alias,
                    name:        fieldName,
                    type:        schemaField.type,
                    label:       schemaField.label,
                    sortOrder,
                }).pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe({
                        next:  () => this.reloadActiveEntity(),
                        error: (e: { error?: { detail?: string } }) =>
                            this.toast.error(e?.error?.detail ?? 'Failed to save field'),
                    });
            }
            return;
        }

        // -- Path B: no schema loaded (pure static entity, isDynamic = false) ---------
        // Fall back to EntityFieldMetadata from the domain list.
        const entityField = entity.fields.find(f => f.name === fieldName);
        if (!entityField) return;

        this.schemaSvc.createField({
            entityAlias: alias,
            name:        fieldName,
            type:        entityField.type ?? 'text',
            label:       entityField.label ?? fieldName,
            sortOrder,
        }).pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next:  () => this.reloadActiveEntity(),
                error: (e: { error?: { detail?: string } }) =>
                    this.toast.error(e?.error?.detail ?? 'Failed to save field'),
            });
    }

    // -- Navigation ------------------------------------------------------------
    toggleModule(module: string): void {
        this.activeModule.set(this.activeModule() === module ? null : module);
    }

    selectEntity(entity: DomainEntityItem): void {
        const current = this.activeEntity();
        const changed = current?.className !== entity.className;

        this.activeEntity.set(entity);
        this.activeRuntimeType.set(null);
        this.activeSchema.set(null);
        this.selectedField.set(null);
        this.selectedRecord.set(null);

        if (changed) {
            // Clear stale records from the previous entity so the spinner appears
            // immediately while the new entity's records are loading.  Do NOT
            // clear when the same entity is clicked again -- recordsLoadKey
            // would not change, no refetch would fire, and the grid would be
            // stuck empty.  Bug 2 is handled by Option A (datagrid sentinel
            // guards on hasMore) + Option B (loadEntityRecords append guard).
            this.entityRecordsData.set(null);
        }

        // hasRecordsView mirrors the logic in buildUnifiedContext():
        //   runtime dynamic entity  -> true (DynamicRecordListComponent)
        //   managed dynamic entity  -> false (no records list; schema editor only)
        //   static entity + URL     -> true (entityRecordsData grid)
        //   static entity, no URL   -> false
        const hasRecordsView = (entity.isDynamic && entity.dynamicOrigin === 'runtime')
            || Boolean(entity.recordsUrl);
        if (changed && !hasRecordsView) {
            this.viewMode.set('structure');
        }

        if (entity.isDynamic && entity.dynamicAlias) {
            this.loadSchema(entity.dynamicAlias);
        }

        // Lazy-load fields: the list endpoint omits them to reduce payload size.
        if (!entity.fields?.length) {
            this.loadEntityFields(entity);
        }
    }

    selectRuntimeType(type: DynamicEntityTypeDto): void {
        this.activeRuntimeType.set(type);
        this.activeEntity.set(null);
        this.activeSchema.set(null);
        this.activeSchema.set({ alias: type.slug, label: type.label, fields: type.fields });

        // viewMode is preserved from user preferences — no reset here.

        this.footer?.set({
            count: `${type.recordCount} record${type.recordCount === 1 ? '' : 's'}`,
        });

        // If a search is active, clear it and reveal the type in tree
        if (this.filterText() !== '') {
            this.filterText.set('');
            this.revealTypeInTree(type);
        }
    }

    // -- Type management -------------------------------------------------------
    openCreateType(): void {
        const phpEntitySlugs: Record<string, string> = {};
        for (const group of this.modules()) {
            for (const entity of group.entities) {
                if (entity.isDynamic && entity.dynamicAlias) {
                    phpEntitySlugs[entity.dynamicAlias] = entity.shortName;
                }
            }
        }
        // Pre-fill parent from the currently selected type so "New Type" in the
        // header creates a sibling/child of whatever is active in the panel.
        const activeParentId = this.activeRuntimeType()?.id ?? undefined;
        this.dialog.open(DynamicTypeDialogComponent, {
            data: {
                mode: 'create',
                runtimeTypes: this.runtimeTypes(),
                phpEntitySlugs,
                parentId: activeParentId,
            },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.reloadData());
    }

    openAddChildType(parent: DynamicEntityTypeDto): void {
        const phpEntitySlugs: Record<string, string> = {};
        for (const group of this.modules()) {
            for (const entity of group.entities) {
                if (entity.isDynamic && entity.dynamicAlias) {
                    phpEntitySlugs[entity.dynamicAlias] = entity.shortName;
                }
            }
        }
        this.dialog.open(DynamicTypeDialogComponent, {
            data: { mode: 'create', runtimeTypes: this.runtimeTypes(), phpEntitySlugs, parentId: parent.id },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.reloadData());
    }

    openEditType(type: DynamicEntityTypeDto): void {
        this.dialog.open(DynamicTypeDialogComponent, {
            data: { mode: 'edit', type, runtimeTypes: this.runtimeTypes() },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.reloadData());
    }

    confirmDeleteType(type: DynamicEntityTypeDto): void {
        if (!type.id || type.origin === 'managed') {
            this.toast.error('This type is managed by a PHP entity and cannot be deleted.');
            return;
        }
        if (type.recordCount > 0) {
            this.toast.error(
                `Type "${type.slug}" has ${type.recordCount} records. Delete all records first.`,
            );
            return;
        }
        this.confirmSvc.confirmDelete(type.label || type.slug)
            .pipe(
                filter(Boolean),
                switchMap(() => this.schemaSvc.deleteType(type.id!)),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: () => {
                    this.toast.success('Type deleted');
                    this.activeRuntimeType.set(null);
                    this.activeSchema.set(null);
                    this.reloadData();
                },
                error: (e: { error?: { detail?: string } }) =>
                    this.toast.error(e?.error?.detail ?? 'Cannot delete type'),
            });
    }

    // -- Field management ------------------------------------------------------
    openAddField(): void {
        const alias = this.activeRuntimeType()?.slug ?? this.activeEntity()?.dynamicAlias;
        if (!alias) return;
        this.dialog.open(FieldDefinitionFormComponent, {
            data: { entityAlias: alias, mode: 'create', availableTypes: this.availableTypes() },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.loadSchema(alias));
    }

    openEditField(field: FieldSchemaItem): void {
        const alias = this.activeRuntimeType()?.slug ?? this.activeEntity()?.dynamicAlias;
        if (!alias) return;
        this.dialog.open(FieldDefinitionFormComponent, {
            data: { entityAlias: alias, field, mode: 'edit', availableTypes: this.availableTypes() },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.loadSchema(alias));
    }

    /**
     * Opens a pre-filled form for creating a child-type override of an inherited field.
     * Submits as POST (createField) targeting the currently active child type's alias,
     * keeping the same field name so the child definition shadows the parent's.
     */
    openOverrideField(field: FieldSchemaItem): void {
        const rt = this.activeRuntimeType();

        // Entity context: open override form targeting the entity alias
        if (!rt) {
            const entity = this.activeEntity();
            if (!entity) return;
            const alias = entity.entityAlias ?? entity.dynamicAlias ?? entity.className;
            this.dialog.open(FieldDefinitionFormComponent, {
                data: {
                    entityAlias:    alias,
                    field,
                    mode:           'override',
                    availableTypes: this.availableTypes(),
                },
                backdropClass: 'cdk-overlay-dark-backdrop',
            }).closed
                .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
                .subscribe(() => this.reloadActiveEntity());
            return;
        }

        // Type context (existing code):
        this.dialog.open(FieldDefinitionFormComponent, {
            data: { entityAlias: rt.slug, field, mode: 'override', availableTypes: this.availableTypes() },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.loadSchema(rt.slug));
    }

    confirmDeleteField(field: FieldSchemaItem): void {
        const alias = this.activeRuntimeType()?.slug ?? this.activeEntity()?.dynamicAlias;
        if (!alias) return;
        this.confirmSvc.confirmDelete(field.label)
            .pipe(
                filter(Boolean),
                switchMap(() => this.schemaSvc.deleteField(field.id!)),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: () => {
                    this.toast.success('Field deleted');
                    this.loadSchema(alias);
                },
                error: (e: { error?: { detail?: string } }) =>
                    this.toast.error(e?.error?.detail ?? 'Cannot delete locked field'),
            });
    }

    /**
     * Delete a FieldDefinition row by id, then refresh whichever view is active.
     * Used for "Reset to default":
     *   - static entity context: schema falls back to the PHP default after the row dies.
     *   - runtime-type context (child of a parent type): SchemaProvider's chain merge
     *     re-exposes the parent's row in place of the deleted child override.
     */
    private deleteFieldDefinition(id: string): void {
        this.schemaSvc.deleteField(id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next:  () => {
                    this.toast.success('Field reset to default');
                    const rt = this.activeRuntimeType();
                    if (rt) {
                        this.loadSchema(rt.slug);
                    } else {
                        this.reloadActiveEntity();
                    }
                },
                error: () => this.toast.error('Failed to reset field'),
            });
    }

    // -- Private helpers -------------------------------------------------------

    /**
     * Build the full ancestor path for a type, joined with backslash.
     * Uses name if available, falls back to slug.
     * Example: root "Product" -> child "Catalog" -> "Product\Catalog"
     */
    private buildTypePath(type: DynamicEntityTypeDto): string {
        const types = this.runtimeTypes();
        const parts: string[] = [];
        let current: DynamicEntityTypeDto | undefined = type;

        while (current) {
            parts.unshift(current.name || current.slug);
            if (!current.parentId && !current.parentAlias) break;
            // Try parentId first, fall back to parentAlias
            current = current.parentId
                ? types.find(t => t.id === current!.parentId)
                : types.find(t => t.slug === current!.parentAlias);
            if (!current) break;
        }

        return parts.join('\\');
    }

    /**
     * Returns the fully-qualified PHP class name for the breadcrumb.
     * e.g. "PageVariant"
     */
    private buildEntityPath(entity: DomainEntityItem): string {
        return entity.className;
    }

    private reloadData(): void {
        // Reload domain entities if shown
        if (this.showEntities()) {
            this.schemaSvc.listDomain()
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({ next: domain => this.modules.set(domain) });
        }
        // Re-fetch all currently-loaded tree levels
        const loadedKeys = [...this.childrenMap().keys()];
        for (const key of loadedKeys) {
            this.reloadChildren(key);
        }
        // Refresh the active type's data (label, schema, recordCount)
        const current = this.activeRuntimeType();
        if (current?.id) {
            this.schemaSvc.getType(current.id)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: refreshed => {
                        this.activeRuntimeType.set(refreshed);
                        this.activeSchema.set({
                            alias:  refreshed.slug,
                            label:  refreshed.label,
                            fields: refreshed.fields,
                        });
                    },
                });
        }
    }

    /**
     * Called by the records-view DataGrid when its lazy-scroll sentinel enters the
     * viewport.  Loads the next page and appends it to entityRecordsData.
     * When reset=true (e.g. sort/filter change from the datagrid) the data is
     * replaced from the beginning instead of appended.
     */
    onEntityRecordsLoadMore(event: {
        offset:        number;
        reset:         boolean;
        sort:          string | null;
        columnFilters: ReadonlyArray<string>;
    }): void {
        const entity = this.activeEntity();
        // 'runtime' dynamic entities use DynamicRecordListComponent — skip here.
        if (!entity?.recordsUrl || entity.dynamicOrigin === 'runtime') return;
        this.loadEntityRecords(entity, event.offset, event.reset, event.sort, event.columnFilters);
    }

    /**
     * Fetches a paginated page of records for a static entity.
     *
     * offset=0 + reset=true  -> initial / refresh load (replace existing data).
     * offset>0 + reset=false -> infinite-scroll next page (append to existing data).
     *
     * Passes page / itemsPerPage to the API Platform collection endpoint.
     * Stores hasMore=true when more items remain beyond the current page so the
     * DataGrid sentinel continues firing until all records are loaded.
     */
    private loadEntityRecords(
        entity:        DomainEntityItem,
        offset         = 0,
        reset          = true,
        sort:          string | null = null,
        columnFilters: ReadonlyArray<string> = [],
    ): void {
        if (!entity.recordsUrl) return;
        // Guard against appending beyond the known total — happens when the
        // datagrid sentinel fires spuriously after a re-render cycle.  Without
        // this, page 1 gets re-fetched and concatenated -> duplicate rows.
        if (!reset) {
            const current = this.entityRecordsData();
            if (current && !current.hasMore) return;
        }

        const perPage = 50;
        const page    = Math.floor(offset / perPage) + 1;

        let httpParams = new HttpParams()
            .set('page', String(page))
            .set('itemsPerPage', String(perPage));

        for (const expr of columnFilters) {
            httpParams = httpParams.append('filter', expr);
        }
        if (sort) {
            httpParams = httpParams.set('sort', sort);
        }

        this.entityRecordsLoading.set(true);
        this.http.get<HydraCollection<Record<string, unknown>>>(entity.recordsUrl, {
            params: httpParams,
        })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: result => {
                    const newItems   = (result.member ?? []).map(item =>
                        this.flattenRecordItem(item),
                    );
                    const totalItems = result.totalItems ?? newItems.length;

                    if (reset) {
                        this.entityRecordsData.set({
                            items:      newItems,
                            totalItems,
                            page,
                            limit:      perPage,
                            totalPages: Math.ceil(totalItems / perPage) || 1,
                            hasMore:    offset + newItems.length < totalItems,
                        });
                    } else {
                        this.entityRecordsData.update(d => {
                            if (!d) return null;
                            const allItems = [...d.items, ...newItems];
                            return {
                                ...d,
                                items:      allItems,
                                totalItems,
                                hasMore:    allItems.length < totalItems,
                            };
                        });
                    }
                    this.entityRecordsLoading.set(false);
                },
                error: (err) => {
                    console.error('[RECORDS LOAD ERROR]', err);
                    if (reset) this.entityRecordsData.set(null);
                    this.entityRecordsLoading.set(false);
                    this.toast.error('Failed to load records');
                },
            });
    }

    /**
     * Converts non-primitive field values to display-safe strings for the DataGrid.
     * Arrays become "[N items]"; objects become their compact JSON representation.
     * Primitive values (string, number, boolean, null, undefined) pass through as-is.
     */
    private flattenRecordItem(item: Record<string, unknown>): Record<string, unknown> {
        const flat: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(item)) {
            if (Array.isArray(value)) {
                flat[key] = `[${value.length} items]`;
            } else if (value !== null && typeof value === 'object') {
                flat[key] = JSON.stringify(value);
            } else {
                flat[key] = value;
            }
        }
        return flat;
    }

    /**
     * Fetches entity fields from the detail endpoint and patches activeEntity.
     * Called from selectEntity() (lazy initial load) and reloadActiveEntity()
     * (refresh after override/reset, since the list endpoint omits fields).
     */
    private loadEntityFields(entity: DomainEntityItem): void {
        const alias = entity.entityAlias ?? entity.dynamicAlias ?? entity.className;
        if (!alias) return;
        this.schemaLoading.set(true);
        this.schemaSvc.getEntity(alias)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: detail => {
                    this.activeEntity.update(e =>
                        e?.className === entity.className ? { ...e, fields: detail.fields } : e,
                    );
                    this.schemaLoading.set(false);
                },
                error: (err) => { console.error('[LAZY FIELDS ERROR]', err); this.schemaLoading.set(false); },
            });
    }

    private loadSchema(alias: string): void {
        this.schemaLoading.set(true);
        // Use the active type's ID for a targeted single-type GET when possible.
        const rt = this.runtimeTypes().find(t => t.slug === alias);
        if (rt?.id) {
            this.schemaSvc.getType(rt.id)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: refreshed => {
                        this.activeSchema.set({
                            alias:  refreshed.slug,
                            label:  refreshed.label,
                            fields: refreshed.fields,
                        });
                        // Only update activeRuntimeType when we are already in
                        // type-view context (i.e. activeRuntimeType is currently set
                        // to this same type).  In entity-view context selectEntity()
                        // sets activeRuntimeType to null and it must remain null so
                        // fieldGridConfig() correctly computes isEntityView = true and
                        // sets reorderRoute = null — without this guard loadSchema
                        // would clobber the null and cause the DataGrid to use the
                        // UUID-based PATCH path, which silently drops all reorder
                        // events because entity field IDs are non-UUID strings.
                        if (this.activeRuntimeType()?.slug === refreshed.slug) {
                            this.activeRuntimeType.set(refreshed);
                        }
                        this.updateTypeInMap(refreshed);
                        this.schemaLoading.set(false);
                    },
                    error: () => this.schemaLoading.set(false),
                });
        } else {
            // Fallback for PHP-backed / domain entities: fetch by slug with includePhpBacked=true.
            this.schemaSvc.getTypeBySlug(alias)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: type => {
                        if (!type) {
                            // Managed entity not yet registered as a dynamic type —
                            // show entity.fields as-is without schema overlay.
                            this.schemaLoading.set(false);
                            return;
                        }
                        this.activeSchema.set({
                            alias:  type.slug,
                            label:  type.label,
                            fields: type.fields,
                        });
                        this.schemaLoading.set(false);
                    },
                    error: () => this.schemaLoading.set(false),
                });
        }
    }

    private availableTypes(): { alias: string; label: string; fields: FieldSchemaItem[] }[] {
        const fromDomain = this.modules()
            .flatMap(m => m.entities)
            .filter(e => e.isDynamic && !!e.dynamicAlias)
            .map(e => ({
                alias:  e.dynamicAlias!,
                label:  e.shortName,
                fields: this.activeSchema()?.alias === e.dynamicAlias
                    ? (this.activeSchema()?.fields ?? [])
                    : [],
            }));

        const fromRuntime = this.runtimeTypes().map(t => ({
            alias:  t.slug,
            label:  t.label,
            fields: this.activeSchema()?.alias === t.slug
                ? (this.activeSchema()?.fields ?? [])
                : t.fields,
        }));

        return [...fromDomain, ...fromRuntime];
    }

    /**
     * Ensures the given type is visible in the lazy tree after clearing a search.
     * Loads and expands the type's parent so the row appears in flatTypes.
     * Root-level types need no action (they are always loaded).
     */
    private revealTypeInTree(type: DynamicEntityTypeDto): void {
        if (!type.parentId && !type.parentAlias) return;

        // Resolve the parent's UUID: prefer parentId, fall back to looking up parentAlias
        const parentId = type.parentId
            ?? this.runtimeTypes().find(t => t.slug === type.parentAlias)?.id;

        if (!parentId) {
            // Parent not loaded yet — re-fetch root so the tree is at least coherent
            this.fetchChildren(this.ROOT_KEY);
            return;
        }

        // Ensure the parent's children list is loaded
        if (!this.loadedIds.has(parentId)) {
            this.fetchChildren(parentId);
        }

        // Expand the parent so the type row becomes visible in flatTypes
        this.expandedIds.update(s => new Set([...s, parentId]));
    }

    /**
     * Fetches children for parentId from the API and merges them into childrenMap.
     * Skips the request when the key is already loaded.
     */
    private fetchChildren(parentId: string): void {
        if (this.loadedIds.has(parentId)) return;
        this.loadedIds.add(parentId);

        this.schemaSvc.listRuntimeTypesForParent(parentId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: children => {
                    this.childrenMap.update(m => {
                        const next = new Map(m);
                        next.set(parentId, children);
                        return next;
                    });
                    // If this was the root fetch, update the footer count and loading state
                    if (parentId === this.ROOT_KEY) {
                        this.loading.set(false);
                        if (!this.activeRuntimeType()) {
                            const n = children.filter(t => t.origin !== 'managed').length;
                            this.footer?.set({ count: `${n} type${n === 1 ? '' : 's'}` });
                        }
                    }
                },
                error: () => {
                    // Remove from loadedIds so the caller can retry
                    this.loadedIds.delete(parentId);
                    if (parentId === this.ROOT_KEY) {
                        this.loading.set(false);
                        this.toast.error('Failed to load dynamic types');
                    }
                },
            });
    }

    /**
     * Builds the flat depth-first list of visible TypeTreeNodes starting from parentId.
     * Children of collapsed or unloaded nodes are not included.
     */
    private flattenChildren(parentId: string, depth: number): TypeTreeNode[] {
        const children = this.childrenMap().get(parentId) ?? [];
        const result: TypeTreeNode[] = [];
        for (const t of children) {
            result.push({ type: t, children: [], depth });
            if (t.hasChildren && this.expandedIds().has(t.id!)) {
                result.push(...this.flattenChildren(t.id!, depth + 1));
            }
        }
        return result;
    }

    /**
     * Updates a single type's entry in childrenMap after a refresh (e.g. after field edit).
     * Finds the entry by ID and replaces it in-place in its parent's list.
     */
    private updateTypeInMap(type: DynamicEntityTypeDto): void {
        const parentKey = type.parentId ?? this.ROOT_KEY;
        this.childrenMap.update(m => {
            const list = m.get(parentKey);
            if (!list) return m;
            const idx = list.findIndex(t => t.id === type.id);
            if (idx < 0) return m;
            const next    = new Map(m);
            const newList = [...list];
            newList[idx]  = type;
            next.set(parentKey, newList);
            return next;
        });
    }
}
