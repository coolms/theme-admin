import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    ViewChild,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { ApiService, type DefinitionCatalogDto } from '../../api/api.service';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    ToastService,
    type ActiveFilter,
    type DataGridData,
} from '@coolms/ui-angular';
import {
    DesignerEditorDialogComponent,
    type DesignerEditorDialogData,
    type DesignerSurface,
} from '../designer/designer-editor-dialog.component';

/**
 * Rows per server page. Matches the catalog endpoint's own default so
 * `page` arithmetic over the grid's `offset` lands on real boundaries.
 */
const PAGE_SIZE = 30;

/**
 * Decodes the grid's multi-select filter value — a JSON array string,
 * the shape `columnFilterRql` splices into an `in (...)` expression.
 * Falls back to treating the raw value as a single token, so a
 * single-op filter on the same column still works.
 */
function decodeTokens(value: string): string[] {
    try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
        // Not JSON — a plain scalar filter value.
    }

    return value === '' ? [] : [value];
}

/**
 * Unified Definitions admin list slot (`DefinitionsList`).
 *
 * Cross-module read surface — surfaces every deployed + draft
 * definition across Workflow + Decision (today; future Form, etc.).
 * Backend feeds rows from each registered
 * `DefinitionCatalogProviderInterface` via the tagged lazy
 * registry; this slot renders them as one paginable, sortable table.
 *
 * Mounted inside `<cms-list-layout layoutId="definition:list">` —
 * page header + footer come from the layout shell, this component
 * owns the toolbar + grid + drill-down behaviour. Title is set in
 * `config/modules/definition/layout/definitions-list.yaml`.
 *
 * **Toolbar**: bound to the `navi.toolbar.definition.catalog` tree.
 * Reload + row-action Open (visible whenever a row is selected).
 *
 * **Click-through drill-down** — every row opens the generic
 * {@link DesignerEditorDialogComponent} MODAL (Workflow -> `bpmn-lite`,
 * Decision -> `dmn-table`), the same modal the VFS file explorer now
 * uses for `.bpmn.json` files. Modal-for-all mirrors how the image /
 * DTMPL file editors are invoked, so the chrome the operator sees is
 * consistent across surfaces. The standalone `/admin/designer/...`
 * routes stay as deep-linkable surfaces.
 *
 * **Loading mode** — `client`. Backend caps the page at 200 rows
 * (default 30); FE loads the first page on mount and renders. Lazy
 * server-side pagination follows when the catalog crosses ~100 rows.
 *
 * **Lifecycle actions** — Retire / Restore / Delete, routed
 * through the shared `DefinitionLifecycleRegistry` seam. BODY editing
 * still belongs to the per-module Designer (Save/Deploy, Fork-to-VFS,
 * Revert); what lives here is the cross-module lifecycle, which has no
 * per-module home.
 *
 * Retire is the primary verb: deployed bodies are immutable audit
 * records and running instances resolve their AST through the
 * definition, so anything that has ever shipped is archived rather than
 * removed. Delete is offered for the never-deployed Designer
 * experiment; for everything else the backend answers 409 naming the
 * blocker, and that message is what the operator sees.
 *
 * The list asks for ACTIVE definitions only unless the toolbar's
 * Archive toggle is on — otherwise retiring would visibly do nothing.
 */
@Component({
    selector: 'coolms-admin-definitions-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Definitions"
            icon="journal-bookmark"
            toolbarTreeSlug="navi.toolbar.definition.catalog"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="definition:catalog"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowActionTriggered)="onRowAction($event)"
                (loadMore)="onLoadMore($event)"
                (rowSelected)="onRowSelected($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class DefinitionsListPageComponent implements OnInit {
    /**
     * `@Optional`-style access: the toolbar's Reload can fire before the
     * view settles, so callers use `this.grid?.reload()`.
     */
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;

    /** Guards against out-of-order responses; see {@link onLoadMore}. */
    private loadEpoch = 0;

    private readonly api         = inject(ApiService);
    private readonly store       = inject(Store);
    private readonly dialog      = inject(Dialog);
    private readonly toast       = inject(ToastService);
    private readonly confirm     = inject(ConfirmDialogService);
    private readonly errors      = inject(ErrorHandlerService);
    private readonly destroyRef  = inject(DestroyRef);

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    readonly rows        = signal<DefinitionCatalogDto[]>([]);
    readonly totalItems  = signal(0);
    readonly selectedRow = signal<Record<string, unknown> | null>(null);
    /** Flips true after the first load so the footer count stays blank until then. */
    readonly loaded      = signal(false);
    /**
     * Archive toggle. `false` (default) asks for active definitions
     * only — matching the backend default, so retiring a definition
     * visibly removes it from the list. `true` requests `retired=all`
     * so the operator can find and restore something.
     */
    readonly showArchive = signal(false);

    /**
     * Footer-bar label fed to `<cms-list-page [footerCount]>`.
     *
     * `totalItems` is the count the SERVER reports for the current
     * filter, so it needs no client-side adjustment — that is a direct
     * consequence of filtering server-side. While the grid was
     * `loadingMode: client` this number was the unfiltered total and
     * contradicted the table.
     */
    readonly footerLabel = computed(() =>
        this.loaded()
            ? `${this.totalItems()} definition${this.totalItems() === 1 ? '' : 's'}`
              + (this.showArchive() ? ' (incl. archive)' : '')
            : '',
    );

    /**
     * Toolbar context for `showWhen` evaluation. `_selected` gates
     * Open + Delete; `_active` / `_retired` split Retire from Restore
     * so the two never show at once.
     */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const row = this.selectedRow();
        const retired = row !== null && Boolean(row['retiredAt']);

        return {
            _selected: row !== null,
            _active:   row !== null && !retired,
            _retired:  retired,
        };
    });

    /**
     * Grid payload. `hasMore` drives the sentinel-based lazy fetch loop:
     * true until the loaded window covers the server's reported total.
     * It must also be true before the first load resolves, or the grid
     * never emits its initial `(loadMore)` and nothing is ever fetched.
     */
    readonly gridData = computed((): DataGridData => {
        const rows = this.rows();

        return {
            // `status` is derived here, not served: the API carries the
            // `retiredAt` timestamp, and the grid's badge column wants a
            // word. Keeping the derivation in one place means the badge and
            // the toolbar's `_active` / `_retired` gating can never disagree.
            items: rows.map(row => ({
                ...row,
                status: row.retiredAt ? 'retired' : 'active',
            })),
            totalItems: this.totalItems(),
            page:       1,
            limit:      PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(this.totalItems() / PAGE_SIZE)),
            hasMore:    !this.loaded() || rows.length < this.totalItems(),
        };
    });

    ngOnInit(): void {
        // No fetch here: the grid emits `(loadMore)` on mount, which is
        // the single entry point. Fetching here as well would race it and
        // double-load the first page.
    }

    /**
     * The one place definitions are fetched. Fired by the grid on mount,
     * on every filter/sort change (`reset: true`, offset 0) and when the
     * lazy sentinel scrolls into view (`reset: false`, offset > 0).
     *
     * Filters and sort go to the SERVER. The grid used to apply them in
     * memory over one 200-row page, so a filter searched only what the
     * browser happened to hold and presented that as the whole answer.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
        activeFilters: ReadonlyArray<ActiveFilter>;
    }): void {
        const page  = Math.floor(event.offset / PAGE_SIZE) + 1;
        const epoch = ++this.loadEpoch;

        this.api.listDefinitions({
            page,
            itemsPerPage: PAGE_SIZE,
            ...(event.sort ? { sort: event.sort } : {}),
            ...(this.showArchive() ? { retired: 'all' as const } : {}),
            ...this.toQueryFilters(event.activeFilters),
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => {
                // Drop a stale response: filter changes fire in quick
                // succession and the responses can land out of order,
                // which would otherwise show rows for a filter the user
                // has already moved off.
                if (epoch !== this.loadEpoch) return;

                this.rows.set(event.reset ? result.items : [...this.rows(), ...result.items]);
                this.totalItems.set(result.totalItems);
                this.loaded.set(true);
                if (event.reset) {
                    // The selection may refer to a row the new filter (or a
                    // retire/delete) removed; a stale selection would keep
                    // offering row actions against something not shown.
                    this.selectedRow.set(null);
                }
            },
            error: (e: unknown) => {
                if (epoch !== this.loadEpoch) return;
                // Without this the grid keeps `hasMore` true and the
                // sentinel retries the failed page forever.
                this.loaded.set(true);
                this.toast.error(this.errors.humanize(e));
            },
        });
    }

    /**
     * Maps the grid's structured column filters onto the catalog
     * endpoint's named query params.
     *
     * The grid also emits ready-made RQL (`columnFilters`), which is what
     * relational list endpoints consume — but this endpoint merges
     * rows across modules in memory and has no RQL parser behind it, so
     * it takes named params instead. Reading the structured filters is
     * the honest translation; picking the RQL strings apart with regexes
     * would not be.
     *
     * An unmapped column is IGNORED rather than guessed at — silently
     * dropping it is better than sending a param the backend will refuse,
     * and the backend allowlist is the real gate either way.
     */
    private toQueryFilters(filters: ReadonlyArray<ActiveFilter>): {
        modules?:       string[];
        sources?:       string[];
        definitionKey?: string;
        displayName?:   string;
        moduleLock?:    boolean;
    } {
        const out: {
            modules?:       string[];
            sources?:       string[];
            definitionKey?: string;
            displayName?:   string;
            moduleLock?:    boolean;
        } = {};

        for (const f of filters) {
            switch (f.column) {
                case 'module':
                    out.modules = decodeTokens(f.value);
                    break;
                case 'latestVersionSource':
                    out.sources = decodeTokens(f.value);
                    break;
                case 'definitionKey':
                    out.definitionKey = f.value;
                    break;
                case 'displayName':
                    out.displayName = f.value;
                    break;
                case 'moduleLock':
                    out.moduleLock = f.value === 'true';
                    break;
            }
        }

        return out;
    }

    /** Re-runs the current query from page 1, keeping filters and sort. */
    private loadDefinitions(): void {
        this.grid?.reload();
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const row = event.row as unknown as DefinitionCatalogDto;
        switch (event.action) {
            case 'open':    this.drillDown(row); return;
            case 'retire':  this.retire(row);    return;
            case 'delete':  this.remove(row);    return;
        }
    }

    onToolbarAction(id: string): void {
        if (id === 'reload') { this.loadDefinitions(); return; }
        if (id === 'toggle-archive') {
            this.showArchive.update(v => !v);
            this.loadDefinitions();
            return;
        }

        const selected = this.selectedRow();
        if (!selected) return;
        const row = selected as unknown as DefinitionCatalogDto;

        switch (id) {
            case 'open':     this.drillDown(row); break;
            case 'retire':   this.retire(row);    break;
            case 'unretire': this.unretire(row);  break;
            case 'delete':   this.remove(row);    break;
        }
    }

    // --- lifecycle actions ---------------------------------------

    /**
     * Retire = archive. Reversible and lossless, so no confirm — the
     * Restore button is right there under the Archive toggle.
     */
    private retire(row: DefinitionCatalogDto): void {
        const { module, definitionKey } = row;
        if (!module || !definitionKey) return;

        this.api.retireDefinition(module, definitionKey).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success(`Retired "${definitionKey}".`);
                this.loadDefinitions();
            },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    private unretire(row: DefinitionCatalogDto): void {
        const { module, definitionKey } = row;
        if (!module || !definitionKey) return;

        this.api.unretireDefinition(module, definitionKey).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success(`Restored "${definitionKey}".`);
                this.loadDefinitions();
            },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    /**
     * Permanent delete. The backend refuses anything that has ever
     * deployed with a 409 that names the blocker and points at Retire,
     * so the humanized error IS the guidance here — no special-casing.
     *
     * ALWAYS confirms first, whichever path got here. The row action's
     * `confirm: true` in the grid YAML is descriptive only — the
     * DataGrid never reads it, so a caller that trusts the grid to have
     * already asked deletes silently. Confirmation lives here.
     */
    private remove(row: DefinitionCatalogDto): void {
        const { module, definitionKey } = row;
        if (!module || !definitionKey) return;

        this.confirm.confirmDelete(definitionKey).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(ok => {
            if (!ok) return;
            this.api.deleteDefinition(module, definitionKey).pipe(
                takeUntilDestroyed(this.destroyRef),
            ).subscribe({
                next: () => {
                    this.toast.success(`Deleted "${definitionKey}".`);
                    this.loadDefinitions();
                },
                error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
            });
        });
    }

    /**
     * Per-module drill-down. Every designer now opens as an in-place
     * MODAL (matching the image / DTMPL / BPMN file editors), so the
     * chrome is consistent: Workflow -> the BPMN-Lite editor modal,
     * Decision -> the generic designer-editor modal hosting the DMN-table
     * page. The standalone `/admin/designer/...` routes stay as
     * deep-linkable surfaces.
     */
    private drillDown(row: DefinitionCatalogDto): void {
        const key = row.definitionKey;
        if (!key) return;

        switch (row.module) {
            case 'workflow':
                this.openDesignerEditor('bpmn-lite', key, `Workflow: ${key}`);
                return;
            case 'decision':
                this.openDesignerEditor('dmn-table', key, `Decision: ${key}`);
                return;
            default:
                this.toast.error(`No Designer wired for module "${row.module ?? '(unknown)'}".`);
        }
    }

    /**
     * Launch the generic {@link DesignerEditorDialogComponent} for a
     * non-workflow designer surface (today: DMN decision-table). The
     * dialog hosts the matching routed page embedded, so editing,
     * Save/Deploy + load behaviour are identical to the full-page route.
     */
    private openDesignerEditor(
        surface: DesignerSurface,
        key: string,
        title: string,
    ): void {
        this.dialog.open<void, DesignerEditorDialogData>(DesignerEditorDialogComponent, {
            data: { surface, key, title },
            backdropClass: 'cdk-overlay-dark-backdrop',
            panelClass: 'bpmn-editor-dialog-panel',
            hasBackdrop: true,
            disableClose: false,
        });
    }
}
