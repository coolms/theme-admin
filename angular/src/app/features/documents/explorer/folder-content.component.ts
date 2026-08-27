
import { CmsDropzoneDirective, CmsItemInteractionsDirective, ContextMenuService, DataGridComponent, DataGridData, FileEditorRegistry, PageFooterService, type CmsDropzoneConfig, type CmsSelectionChange } from '@coolms/ui-angular';
import { type DocumentTemplate } from '../shared/document-explorer.types';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    EventEmitter,
    OnDestroy,
    Output,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { Store } from '@ngxs/store';
import { AppConfigState, CmsLoaderComponent } from '@coolms/core-angular';
import { ApiService, NodeDto } from '../../../api/api.service';
import { DocumentPageStateService } from './document-page-state.service';
import { FormatInfoService } from './format-info.service';
import { filterTemplatesForFolder } from './vfs-tree.helpers';

/** DOCX MIME — the only template source format currently accepted. */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Folder-content view. Mounts inside the explorer's main panel when
 * a folder (not a template) is selected.
 *
 * Lists the templates that live in `state.currentPath()`. The path's
 * `.templates/` discriminator is flattened in: we list both the
 * folder itself and `<folder>/.templates/`, then match by Node `id`
 * against the master `state.templates()` (each template IS a Node
 * under `/docs/.templates/`), so a future format-mix-aware backend
 * doesn't need a UI change.
 *
 * Click selects (drives the right detail panel via
 * `state.selectTemplate(id)`). Double-click opens the Generate
 * wizard by routing through `state.actionDispatched$` with the
 * `'generate'` action, mirroring the F.13b grid's UX.
 */
@Component({
    selector: 'cms-folder-content',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
    CmsItemInteractionsDirective,
    CmsDropzoneDirective,
    DataGridComponent,
    CmsLoaderComponent
],
    template: `
        <div class="cms-folder-content"
             [cmsDropzone]="dropzoneConfig()"
             (contextmenu)="onBackgroundContextMenu($event)"
             (filesDropped)="onFilesDropped($event)">
            @if (loadingFolder()) {
                <div class="cms-folder-content__status cms-folder-content__status--loading">
                    <cms-loader label="Loading files" />
                </div>
            } @else if (folderError()) {
                <div class="cms-folder-content__status cms-folder-content__status--error">
                    {{ folderError() }}
                </div>
            } @else if (visibleTemplates().length === 0) {
                <div class="cms-folder-content__empty">
                    <i class="bi bi-file-earmark-text"></i>
                    <p>No templates in this folder.</p>
                    <p class="cms-folder-content__empty-hint">
                        Click <strong>Upload Template</strong> in the toolbar to add one here.
                    </p>
                </div>
            } @else if (viewMode() === 'details') {
                <!-- #1709 — the platform DataGrid, config at
                     /api/v1/datagrids/document:templates. Replaces a
                     hand-rolled table whose three headers were the only
                     sorting Documents had and which offered no filtering or
                     column picking at all. -->
                <coolms-datagrid
                    gridId="document:templates"
                    [configBaseUrl]="configBaseUrl()"
                    [externalData]="gridData()"
                    (rowSelected)="onGridRowSelected($event)"
                    (rowActivated)="onGridRowActivated($event)"
                    (rowContextMenu)="onGridRowContextMenu($event)"
                    (backgroundContextMenu)="onBackgroundContextMenu($event)">
                </coolms-datagrid>
            } @else {
                <div class="cms-folder-content__grid"
                     [attr.data-view-mode]="viewMode()">
                    @for (template of visibleTemplates(); track template.id) {
                        <button
                            type="button"
                            class="cms-folder-content__tile"
                            [class.cms-folder-content__tile--selected]="isSelected(template.id)"
                            [attr.data-selectable]="''"
                            [title]="tileTitle(template)"
                            cmsItemInteractions
                            [cmsItem]="template"
                            [currentSelection]="currentSelectionArray()"
                            (selectionChanged)="onSelectionChanged($event)"
                            (activated)="onActivate($event)"
                            (contextMenuRequested)="onContextMenu($event)"
                        >
                            <div class="cms-folder-content__tile-icon"
                                 [style.color]="iconColor(template.format)">
                                <i class="bi" [class]="iconClass(template.format)"></i>
                            </div>
                            <div class="cms-folder-content__tile-name" [title]="template.name">
                                {{ template.name }}
                            </div>
                            <div class="cms-folder-content__tile-meta">
                                <span class="cms-folder-content__tile-format">{{ formatLabel(template.format) }}</span>
                                <span class="cms-folder-content__tile-slug">{{ template.slug }}</span>
                            </div>
                        </button>
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        /*
         * Flex column, not a scrolling block (#1760).
         *
         * This was display:block + overflow:auto with the inner wrapper on
         * min-height:100%, so the DataGrid's own flex:1 had no flex
         * context to resolve against and took its height from its content —
         * (no backticks in this block: it lives inside a JS template literal
         * and one would end the string, which is how this file broke once)
         * the card stopped after the last row with dead white below it, the
         * same defect #1712 fixed on Pages. The scroll moves DOWN to whichever
         * branch is showing, because the two need opposite behaviour: tiles
         * scroll as a block, the grid scrolls its own card and must not be
         * wrapped in a second scroller.
         */
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            min-height: 0;
        }
        .cms-folder-content {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            transition: outline-color 120ms, background 120ms;
        }
        /* Fills the pane so the dropzone outline still covers the whole area
           and the grid has a definite height to flex into. */
        .cms-folder-content > coolms-datagrid {
            flex: 1;
            min-height: 0;
        }
        .cms-folder-content.cms-dropzone--active {
            outline: 2px dashed var(--cms-accent);
            outline-offset: -8px;
            background: var(--cms-accent-light);
        }
        .cms-folder-content__status {
            padding: var(--cms-content-padding);
            color: var(--cms-text-muted);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        /* The row above is built for ONE LINE of muted text — an error, a count
           — so it hugs the top-left of the pane. A loader is not a line of text
           but the pane's whole content while there is nothing else in it, and
           dropping the mark into the text row put it in the top-left corner.
           The flex:1 below works because .cms-folder-content is a flex COLUMN,
           so this takes the height the grid would have had and centres in it. */
        .cms-folder-content__status--loading {
            flex: 1;
            min-height: 0;
            justify-content: center;
        }
        .cms-folder-content__status--error {
            color: var(--cms-danger, #b91c1c);
        }
        .cms-folder-content__empty {
            padding: 2rem;
            text-align: center;
            color: var(--cms-text-muted);
        }
        .cms-folder-content__empty i {
            font-size: 2rem;
            display: block;
            margin-bottom: 0.5rem;
        }
        .cms-folder-content__empty-hint {
            font-size: 0.85rem;
        }
        .cms-folder-content__grid {
            /* Owns the scroll now that :host is a flex column (#1760): tiles
               overflow as a block, unlike the DataGrid which scrolls itself. */
            flex: 1;
            min-height: 0;
            overflow: auto;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            grid-auto-rows: min-content;
            gap: var(--cms-panel-padding);
            padding: var(--cms-content-padding);
        }
        .cms-folder-content__tile {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            padding: 16px 12px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            cursor: pointer;
            font: inherit;
            color: inherit;
            text-align: center;
            transition: border-color 0.1s, box-shadow 0.1s;
        }
        .cms-folder-content__tile:hover {
            border-color: var(--cms-text-muted);
            box-shadow: var(--cms-shadow-sm);
        }
        .cms-folder-content__tile--selected {
            border-color: var(--cms-text-secondary);
            box-shadow: var(--cms-shadow-md);
        }
        .cms-folder-content__tile-icon {
            font-size: 2.5rem;
            line-height: 1;
        }
        .cms-folder-content__tile-name {
            font-weight: 500;
            word-break: break-word;
        }
        .cms-folder-content__tile-meta {
            display: flex;
            flex-direction: column;
            font-size: 0.75rem;
            color: var(--cms-text-muted);
        }
        .cms-folder-content__tile-format {
            text-transform: uppercase;
            letter-spacing: 0.04em;
            font-weight: 500;
        }
        .cms-folder-content__table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
        }
        .cms-folder-content__table th {
            text-align: left;
            font-weight: 500;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--cms-text-muted);
            border-bottom: 1px solid var(--cms-border);
            padding: 8px var(--cms-content-padding);
            background: var(--cms-surface);
            position: sticky;
            top: 0;
        }
        .cms-folder-content__row {
            cursor: pointer;
            border-bottom: 1px solid var(--cms-border-light);
        }
        .cms-folder-content__row:hover {
            background: var(--cms-border-light);
        }
        .cms-folder-content__row--selected {
            background: var(--cms-border-light);
            font-weight: 500;
        }
        .cms-folder-content__row td {
            padding: 8px var(--cms-content-padding);
        }
        .cms-folder-content__row td:first-child {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .cms-folder-content__muted {
            color: var(--cms-text-muted);
        }

        /* #1709 — the three non-table renderings are the same tile at three
           sizes, selected by the shared vocabulary. "large" is the untouched
           default the module has always shipped. */
        .cms-folder-content__grid[data-view-mode='small'] {
            grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
            gap: 10px;
        }
        .cms-folder-content__grid[data-view-mode='small'] .cms-folder-content__tile-meta {
            display: none;
        }
        /* Content — one wide row: icon left, name and meta right. */
        .cms-folder-content__grid[data-view-mode='content'] {
            grid-template-columns: 1fr;
            gap: 6px;
        }
        .cms-folder-content__grid[data-view-mode='content'] .cms-folder-content__tile {
            flex-direction: row;
            align-items: center;
            gap: 12px;
            text-align: left;
        }
        .cms-folder-content__grid[data-view-mode='content'] .cms-folder-content__tile-meta {
            flex-direction: row;
            gap: 10px;
        }
    `],
})
export class FolderContentComponent implements OnDestroy {
    private readonly api = inject(ApiService);
    private readonly state = inject(DocumentPageStateService);
    private readonly formatInfo = inject(FormatInfoService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly footer = inject(PageFooterService);
    private readonly store = inject(Store);

    protected readonly currentPath = this.state.currentPath;
    protected readonly templates = this.state.templates;
    protected readonly viewMode = this.state.viewMode;

    protected readonly loadingFolder = signal(false);
    protected readonly folderError = signal<string | null>(null);
    protected readonly folderNodes = signal<NodeDto[]>([]);

    protected readonly visibleTemplates = computed<DocumentTemplate[]>(() =>
        filterTemplatesForFolder(this.folderNodes(), this.templates()),
    );

    /** Where the grid fetches its column config from (#1709). */
    protected readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /**
     * The same templates, shaped for the DataGrid (#1709).
     *
     * `formatLabel` is resolved HERE rather than declared as a cell type: the
     * label comes from `FormatInfoService`, which is a client-side registry the
     * grid config cannot reach. Sending the raw format instead would put
     * `docx` in the column while the tiles said "Word document".
     */
    protected readonly gridData = computed((): DataGridData => {
        // The tile views have always shown a format icon; the details view
        // showed a bare filename, so switching modes lost the one signal that
        // says what a row IS (#1762). The grid's `icon` cell reads these off
        // the row, so the format→glyph mapping stays here with the other
        // format knowledge rather than leaking into the shared DataGrid.
        const items = this.visibleTemplates().map(t => ({
            ...t,
            formatLabel: this.formatLabel(t.format),
            iconClass: this.iconClass(t.format),
            iconColor: this.iconColor(t.format),
        }));

        // One page, always: the templates listing is not paginated (the
        // backend returns the space's whole set), so claiming otherwise would
        // give the grid a pager for a second page that does not exist.
        return {
            items,
            totalItems: items.length,
            page:       1,
            limit:      items.length,
            totalPages: 1,
            hasMore:    false,
        };
    });

    /** Grid selection → the single-id selection model both views share. */
    protected onGridRowSelected(row: Record<string, unknown> | null): void {
        const id = row?.['id'];
        this.gridRow = 'string' === typeof id ? id : null;
        if (null !== this.gridRow) {
            this.state.selectTemplate(this.gridRow);
        }
    }

    /**
     * The row the grid last selected, remembered because the shared state
     * cannot be read back in the same tick (#1710).
     *
     * The grid emits `rowSelected` and then `rowContextMenu` synchronously
     * from one handler, so at right-click time `state.selectedId()` still
     * holds the PREVIOUS selection.
     */
    private gridRow: string | null = null;

    /** Double-click in the grid means what it means on a tile. */
    protected onGridRowActivated(row: Record<string, unknown>): void {
        const template = this.templateFor(row);
        if (template) {
            this.onActivate(template);
        }
    }

    /**
     * Right-click inside the grid. The grid emits `rowSelected` before this,
     * so the selected template is already the one under the cursor — which is
     * why this reads state rather than the event.
     */
    protected onGridRowContextMenu(event: MouseEvent): void {
        const id = this.gridRow;
        const template = null === id ? undefined : this.visibleTemplates().find(t => t.id === id);
        if (!template) {
            return;
        }
        this.onContextMenu({ item: template, event });
    }

    private templateFor(row: Record<string, unknown>): DocumentTemplate | undefined {
        const id = row['id'];

        return 'string' === typeof id
            ? this.visibleTemplates().find(t => t.id === id)
            : undefined;
    }

    /**
     * E3 — `CmsItemInteractionsDirective.currentSelection` expects a
     * readonly array. Document stores a single selected id; derive a
     * single-element array so right-click on the already-selected
     * tile skips re-emission.
     */
    protected readonly currentSelectionArray = computed<readonly DocumentTemplate[]>(() => {
        const id = this.state.selectedId();
        if (id === null) {
            return [];
        }
        const match = this.visibleTemplates().find((t) => t.id === id);
        return match ? [match] : [];
    });

    /**
     * E6 — gates the empty-area dropzone. Active when the right panel is
     * NOT in instances mode (per ADR-092 §1: instances are generated,
     * not uploaded). Accepts only DOCX so non-DOCX files are silently
     * filtered by the shared directive before reaching the handler.
     */
    protected readonly dropzoneConfig = computed<CmsDropzoneConfig>(() => ({
        accept: [DOCX_MIME],
        multiple: true,
        disabled: this.state.rightPanelMode() === 'instances',
    }));

    /**
     * E6 — emitted when DOCX files are dropped on the folder-content
     * host. The page-level handler reuses the existing upload service
     * path (same as toolbar Upload), so no duplicated logic lives here.
     */
    @Output() readonly filesDroppedForUpload = new EventEmitter<File[]>();

    protected onFilesDropped(files: File[]): void {
        if (files.length === 0) return;
        this.filesDroppedForUpload.emit(files);
    }

    constructor() {
        effect(() => {
            // #1687 — the SPACE root, not `currentPath`. Templates live at
            // one root per space (`TemplateRootResolver` recognises only
            // `<spaceRoot>/.templates`), and this component only ever
            // mounts for the templates view. Keying on `currentPath` meant
            // a reload that restored a SUBFOLDER listed that subfolder's
            // non-existent `.templates` and rendered "No templates in this
            // folder" under a breadcrumb already anchored to the space.
            this.loadFolder(this.state.spaceRoot() ?? this.currentPath());
        });

        // Phase D: push the template count into the page footer so the
        // bottom status bar matches Media Library convention. Loaded
        // synchronously (no pagination on the templates listing), so
        // total == loaded always.
        effect(() => {
            const count = this.visibleTemplates().length;
            this.footer.update({
                count: count > 0
                    ? `All ${count} template${count === 1 ? '' : 's'} loaded`
                    : undefined,
            });
        });
    }

    ngOnDestroy(): void {
        this.footer.update({ count: undefined });
    }

    protected isSelected(id: string): boolean {
        return this.state.selectedId() === id;
    }

    /**
     * Phase E3 — bridge `CmsItemInteractionsDirective.selectionChanged`
     * into the existing single-id selection model. Single-mode emits
     * `[template]`; we read the first element. Right-click skips
     * re-emission when the template is already selected (per the
     * directive's `applyRightClick` contract).
     */
    protected onSelectionChanged(event: CmsSelectionChange<DocumentTemplate>): void {
        const item = event.selection[0];
        if (item) {
            this.state.selectTemplate(item.id);
        }
    }

    protected onActivate(template: DocumentTemplate): void {
        // Phase D hotfix #4: double-click → primary action (View).
        // Routes through `actionDispatched$` so the toolbar / context
        // menu / dblclick all converge on the same `case 'view-template'`
        // branch in the page handler.
        this.state.selectTemplate(template.id);
        this.state.dispatchAction('view-template');
    }

    protected tileTitle(template: DocumentTemplate): string {
        return template.native
            ? `${template.name} — single-click to select; native editor coming soon`
            : `${template.name} — double-click to view, single-click to select`;
    }

    /**
     * Right-click on a template tile/row. The directive's
     * `applyRightClick` already updated selection if needed; this
     * handler only owns the NaviGraph context-menu dispatch. Selection
     * write is a defensive no-op when already selected.
     */
    /**
     * Right-click on empty space in the file area (#1679).
     *
     * Bubbles up from the tiles/rows too, so bail when the event started on
     * one — that item's own handler owns it and would otherwise be replaced
     * by the background menu. Same guard Media Library uses (`.media-tile`).
     *
     * `_kind: 'background'` is the discriminator the Document
     * `ToolbarContributor` already gates its Upload / New Folder nodes on;
     * they were reachable only from the page header until now.
     */
    protected onBackgroundContextMenu(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        // A Details-grid ROW joins the tile/row selectors (#1710), or the
        // background menu would fire after — and replace — the template menu
        // the row handler just opened. The empty area BELOW the rows stays
        // background and still gets this menu.
        if (target.closest('.cms-folder-content__tile, .cms-folder-content__row, coolms-datagrid tbody tr')) {
            return;
        }

        const nodes = this.state.toolbarNodes();
        if (nodes.length === 0) {
            return;
        }
        event.preventDefault();
        this.contextMenu.openFromNodes(
            event,
            [...nodes],
            // `_view` mirrors the toolbar record (#1683): this component
            // only ever mounts for the template listing, so the
            // background menu is the templates-view background.
            { _kind: 'background', _selected: false, _surface: 'context', _view: 'templates' },
            (action) => this.state.dispatchAction(action),
        );
    }

    protected onContextMenu(payload: { item: DocumentTemplate; event: MouseEvent }): void {
        this.state.selectTemplate(payload.item.id);
        this.contextMenu.openFromNodes(
            payload.event,
            this.state.toolbarNodes(),
            {
                _kind: 'template',
                _native: payload.item.native,
                // Drives View-vs-Edit (#1678). Asked of the registry rather
                // than inferred from `_native`, so uninstalling the editor
                // honestly turns the label back into "View".
                _editable: FileEditorRegistry.hasEditorForMime(payload.item.sourceMimeType),
                _surface: 'context',
            },
            (action) => this.state.dispatchAction(action),
        );
    }

    protected iconClass(format: string): string {
        return this.formatInfo.iconClass(format);
    }

    protected iconColor(format: string): string {
        return this.formatInfo.iconColor(format);
    }

    protected formatLabel(format: string): string {
        return this.formatInfo.label(format);
    }

    /**
     * List both the folder and its `.templates/` subdirectory in
     * parallel and merge file entries from both. The `.templates`
     * dir may not exist (e.g., an empty user-created folder), so
     * its 404 is swallowed into an empty list.
     */
    /**
     * Monotonic request token (#1687). `loadFolder` has never cancelled a
     * previous call, so two overlapping loads raced and whichever RESPONSE
     * landed last won — including a stale one. It only became visible once
     * the effect could fire twice on mount (space root resolving after the
     * restored path), and it presented as an empty template listing over a
     * correct breadcrumb, with the right request in the network log.
     */
    private loadToken = 0;

    private loadFolder(path: string): void {
        const token = ++this.loadToken;
        this.loadingFolder.set(true);
        this.folderError.set(null);

        const folder$ = this.api.listDirectory(path).pipe(
            catchError(() => of<NodeDto[]>([])),
        );
        const templatesDir$ = this.api.listDirectory(`${path}/.templates`).pipe(
            catchError(() => of<NodeDto[]>([])),
        );

        forkJoin({ folder: folder$, templates: templatesDir$ })
            .pipe(
                map(({ folder, templates }) => [...folder, ...templates]),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: (nodes) => {
                    if (token !== this.loadToken) {
                        return;
                    }
                    this.folderNodes.set(nodes);
                    this.loadingFolder.set(false);
                },
                error: (err: Error) => {
                    if (token !== this.loadToken) {
                        return;
                    }
                    this.folderError.set(err.message ?? 'Failed to load folder.');
                    this.loadingFolder.set(false);
                },
            });
    }
}
