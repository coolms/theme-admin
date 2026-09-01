import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DataGridComponent, DataGridData, DynamicRecordListComponent } from '@coolms/ui-angular';
import { Store } from '@ngxs/store';
import { DomainExplorerStateService } from './domain-explorer-state.service';
import { AppConfigState, CmsLoaderComponent } from '@coolms/core-angular';
/**
 * Main detail panel slot for the Domain Explorer.
 * Registered as 'DomainExplorerDetail' in ComponentRegistry.
 * Injects DomainExplorerStateService from the host component's injector.
 *
 * Toolbar bridge: writes toolbarLeftActions / toolbarBreadcrumb on the shared
 * state service whenever activeRuntimeType changes. The host page component
 * reads those signals and projects <app-page-toolbar> into the layout.
 */
@Component({
    selector: 'app-domain-explorer-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, DataGridComponent, DynamicRecordListComponent],
    template: `
        <!-- -- Sticky breadcrumb band (above all content) ------------------ -->
        @if (st.toolbarBreadcrumb()) {
            <nav class="de-breadcrumb-band">
                <span class="crumb crumb--phpname">
                    {{ st.toolbarBreadcrumb() }}
                </span>
                @if (st.activeEntity(); as entity) {
                    @if (entity.dynamicAlias) {
                        <span class="crumb-badge crumb-badge--alias">
                            {{ entity.dynamicAlias }}
                        </span>
                    }
                    @if (entity.isAggregate) {
                        <span class="crumb-badge crumb-badge--aggregate">
                            <i class="bi bi-box"></i> Aggregate
                        </span>
                    }
                    @if (entity.isDynamic) {
                        <span class="crumb-badge crumb-badge--dynamic">
                            <i class="bi bi-lightning-fill"></i> Dynamic
                        </span>
                    }
                    @if (entity.isEmbeddable) {
                        <span class="crumb-badge crumb-badge--embeddable">
                            <i class="bi bi-braces"></i> Embeddable
                        </span>
                    }
                }
            </nav>
        }

        @if (showDynamicTypes() && st.activeRuntimeType()) {
        @if (st.activeRuntimeType(); as rt) {

            <!-- -- Compact meta row ---------------------------------------- -->
            <div class="de-detail-meta-row">
                @if (rt.categoryTree) {
                    <span class="de-alias-pill">
                        tree: <strong>{{ rt.categoryTree }}</strong>
                    </span>
                }
            </div>

            <!-- -- Main content area: records list OR field structure -------- -->
            <div class="de-fields-scroll">
                @if (st.viewMode() === 'records') {
                    <app-dynamic-record-list
                        [typeAlias]="rt.slug"
                        [embedded]="true"
                        (createRequested)="st.openAddRecord()"
                        (rowSelected)="onRecordSelected($event)"
                        (recordRowContextMenu)="onRecordRowCtx($event)"
                        (recordBgContextMenu)="onRecordBgCtx($event)"
                        (switchToStructure)="st.viewMode.set('structure')" />
                } @else {
                @if (st.schemaLoading()) {
                    <div class="de-spinner-row">
                        <cms-loader [inline]="true" />
                    </div>
                } @else {
                    <coolms-datagrid
                        [embedded]="true"
                        gridId="domain_explorer:type_fields"
                        [configBaseUrl]="configBaseUrl()"
                        [externalData]="fieldGridData()"
                        (rowSelected)="onFieldSelected($event)"
                        (rowActionTriggered)="onFieldAction($event)"
                        (rowContextMenu)="onFieldRowCtx($event)"
                        (backgroundContextMenu)="onFieldBackgroundCtx($event)">
                    </coolms-datagrid>
                }

                <!-- CHILD TYPES ------------------------------------------- -->
                @if (!st.schemaLoading() && st.childTypes().length > 0) {
                    <table class="domain-field-table de-child-types-table">
                        <thead>
                            <tr class="domain-field-section-header">
                                <th colspan="4">Child types</th>
                            </tr>
                        </thead>
                        <tbody>
                            @for (child of st.childTypes(); track child.id) {
                                <tr class="domain-field-row">
                                    <td>
                                        <i class="bi bi-grid-3x3-gap-fill text-muted"></i>
                                        <span class="font-mono">{{ child.slug }}</span>
                                    </td>
                                    <td class="text-muted" style="font-size:.8rem;">
                                        {{ child.label }}
                                    </td>
                                    <td>
                                        <span class="de-module__count de-module__count--records">
                                            {{ child.recordCount }}
                                        </span>
                                    </td>
                                    <td class="de-field-actions">
                                        <button class="de-field-btn"
                                                title="View"
                                                (click)="st.selectRuntimeType(child)">
                                            <i class="bi bi-arrow-right"></i>
                                        </button>
                                    </td>
                                </tr>
                            }
                        </tbody>
                    </table>
                }
                } <!-- end @else (structure view) -->
            </div>

        } <!-- end @if (st.activeRuntimeType()) -->
        } @else if (showEntities() && st.activeEntity()) {
        @if (st.activeEntity(); as entity) {

            <!-- -- Main content: records OR field DataGrid ------------ -->
            <div class="de-fields-scroll">
                @if (st.viewMode() === 'records') {
                    @if (entity.isDynamic && entity.dynamicOrigin === 'runtime' && entity.dynamicAlias) {
                        <!-- Dynamic entity (runtime origin) in records mode: DynamicRecordListComponent
                             queries /api/v1/dynamic-entity/{alias}/records. 'managed' types are
                             excluded — they appear in the Entities section with their own recordsUrl. -->
                        <app-dynamic-record-list
                            [typeAlias]="entity.dynamicAlias!"
                            [embedded]="true"
                            (createRequested)="st.openAddRecord()"
                            (rowSelected)="onRecordSelected($event)"
                            (recordRowContextMenu)="onRecordRowCtx($event)"
                            (recordBgContextMenu)="onRecordBgCtx($event)"
                            (switchToStructure)="st.viewMode.set('structure')" />
                    } @else if (entity.recordsUrl) {
                        <!-- PHP entity (static or managed-dynamic) with an explicit flat GET
                             collection endpoint. Grid config comes from the server via
                             StaticEntityDataGridConfigProvider for 'entity:{aliasOrClassName}'. -->
                        @if (!st.entityRecordsData() || !entityRecordsGridId()) {
                            <div class="de-spinner-row">
                                <cms-loader [inline]="true" />
                            </div>
                        } @else {
                            <coolms-datagrid
                                [embedded]="true"
                                [gridId]="entityRecordsGridId()!"
                                [configBaseUrl]="configBaseUrl()"
                                [externalData]="st.entityRecordsData()"
                                (rowSelected)="onRecordSelected($event)"
                                (rowContextMenu)="onRecordRowCtx($event)"
                                (backgroundContextMenu)="onRecordBgCtx($event)"
                                (loadMore)="st.onEntityRecordsLoadMore($event)">
                            </coolms-datagrid>
                        }
                    }
                } @else if (entity.isDynamic && st.viewMode() === 'structure') {
                    <!-- Dynamic entity: show allFields() from loaded schema -->
                    @if (st.schemaLoading()) {
                        <div class="de-spinner-row">
                            <cms-loader [inline]="true" />
                        </div>
                    } @else if (fieldGridData()) {
                        <coolms-datagrid
                            [embedded]="true"
                            gridId="domain_explorer:type_fields"
                            [configBaseUrl]="configBaseUrl()"
                            [externalData]="fieldGridData()"
                            (rowSelected)="onFieldSelected($event)"
                            (rowActionTriggered)="onFieldAction($event)"
                            (rowContextMenu)="onFieldRowCtx($event)"
                            (dropReorder)="onEntityFieldReorder($event)"
                            (backgroundContextMenu)="onFieldBackgroundCtx($event)" />
                    }
                } @else {
                    <!-- Static entity: show entity.fields from domain list -->
                    @if (entityFieldGridData()) {
                        <coolms-datagrid
                            [embedded]="true"
                            gridId="domain_explorer:entity_fields"
                            [configBaseUrl]="configBaseUrl()"
                            [externalData]="entityFieldGridData()"
                            (rowSelected)="onEntityFieldSelected($event)"
                            (rowContextMenu)="onEntityFieldRowCtx($event)"
                            (backgroundContextMenu)="onEntityFieldBgCtx($event)"
                            (dropReorder)="onEntityFieldReorder($event)">
                        </coolms-datagrid>
                    }
                }
            </div>

        } <!-- end @if (st.activeEntity()) -->
        } @else if (!st.loading()) {
            <div class="de-placeholder">
                @if (showDynamicTypes() && !showEntities()) {
                    <i class="bi bi-grid-3x3-gap-fill de-placeholder__icon"></i>
                    <p>Select a type from the left panel.</p>
                } @else {
                    <i class="bi bi-diagram-3 de-placeholder__icon"></i>
                    <p>Select an entity from the left panel.</p>
                }
            </div>
        }
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }

        /* -- Sticky breadcrumb band (above content/grid) -----------------
           Matches the accordion section header height; same pattern as the
           VFS / Media / Documents explorers (#246/#247). */
        .de-breadcrumb-band {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 28px;
            padding: 6px 8px;
            background: var(--cms-surface-alt, var(--cms-surface));
            border-bottom: 1px solid var(--cms-border-light);
            position: sticky;
            top: 0;
            z-index: 2;
            font-family: var(--cms-font-mono, monospace);
            overflow: hidden;
        }
        .crumb {
            font-size: .8125rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .crumb--phpname {
            font-family: var(--cms-font-mono, monospace);
            font-size: .85rem;
            color: var(--cms-text-muted);
        }
        .crumb-badge {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            font-size: .72rem;
            padding: 2px 7px;
            border-radius: var(--cms-radius-lg, 10px);
            font-weight: 500;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .crumb-badge--alias {
            background: var(--cms-surface-muted, #f3f4f6);
            color: var(--cms-text-muted);
            font-family: var(--cms-font-mono, monospace);
        }
        .crumb-badge--aggregate  { background: var(--cms-info-subtle); color: var(--cms-primary-hover); }
        .crumb-badge--dynamic    { background: var(--cms-warning-subtle); color: var(--cms-warning-text); }
        .crumb-badge--embeddable { background: var(--cms-surface-muted); color: var(--cms-text-body); }

        /* -- Detail header (entity view) ---------------------------------- */
        .de-detail-header {
            padding: 14px 20px 12px;
            border-bottom: 1px solid var(--cms-border-color);
            flex-shrink: 0;
        }
        .de-detail-title-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 4px;
        }
        .de-detail-name { font-size: 1.1rem; font-weight: 600; }
        .de-detail-label {
            font-size: .8rem;
            color: var(--cms-text-muted);
            font-weight: 400;
        }
        .de-badge-row { display: flex; gap: 6px; flex-wrap: wrap; }
        .de-classname {
            font-size: .75rem;
            color: var(--cms-text-muted);
            font-family: var(--cms-font-mono, monospace);
        }

        /* -- Meta row ----------------------------------------------------- */
        .de-detail-meta-row {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            padding: 6px 20px;
            border-bottom: 1px solid var(--cms-border-color);
            flex-shrink: 0;
        }
        .de-detail-meta-row:empty { display: none; }
        .de-alias-pill {
            font-size: .75rem;
            padding: 2px 8px;
            border-radius: var(--cms-radius-sm, 4px);
            background: var(--cms-surface-muted, #f3f4f6);
            color: var(--cms-text-muted);
        }

        /* -- Placeholder -------------------------------------------------- */
        .de-placeholder {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--cms-text-muted);
            gap: 12px;
        }
        .de-placeholder__icon { font-size: 3rem; opacity: .3; }
        .de-placeholder p { font-size: .9rem; margin: 0; }

        /* -- Domain badges ------------------------------------------------ */
        .domain-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: var(--cms-radius-lg, 10px);
            font-size: .75rem;
            font-weight: 500;
        }
        .domain-badge--aggregate  { background: var(--cms-info-subtle); color: var(--cms-info-text); }
        .domain-badge--dynamic    { background: var(--cms-warning-subtle); color: var(--cms-warning-text); }
        .domain-badge--embeddable { background: var(--cms-success-light); color: var(--cms-success-text); }
        .domain-badge--runtime    { background: var(--cms-meta-subtle); color: var(--cms-meta); }

        /* -- Fields scroll area ------------------------------------------- */
        .de-fields-scroll {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            min-height: 0;
        }
        .de-fields-scroll coolms-datagrid {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow: hidden;
        }
        .de-fields-scroll app-dynamic-record-list {
            flex: 1;
            min-height: 0;
        }

        .de-spinner-row {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }

        /* -- Child types table -------------------------------------------- */
        .de-child-types-table {
            width: 100%;
            border-collapse: collapse;
            font-size: .875rem;
            border-top: 1px solid var(--cms-border-color);
        }

        .domain-field-table {
            width: 100%;
            border-collapse: collapse;
            font-size: .875rem;
        }
        .domain-field-table__head th {
            padding: 6px 10px;
            font-size: .7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .05em;
            color: var(--cms-text-muted);
            border-bottom: 1px solid var(--cms-border-color);
            white-space: nowrap;
        }
        .domain-field-section-header td,
        .domain-field-section-header th {
            padding: 6px 10px;
            font-size: .7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .06em;
            color: var(--cms-text-muted);
            background: var(--cms-surface-muted, #f3f4f6);
            border-top: 1px solid var(--cms-border-color);
            border-bottom: 1px solid var(--cms-border-color);
        }
        .de-header-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .domain-field-row td {
            padding: 6px 10px;
            border-bottom: 1px solid var(--cms-border-color, rgba(0,0,0,.07));
            vertical-align: middle;
        }
        .domain-field-row:last-child td { border-bottom: none; }
        .domain-field-row--entity    td { color: var(--cms-text-muted); }
        .domain-field-row--inherited td { color: var(--cms-text-muted); }

        .de-empty-row {
            padding: 12px 10px !important;
            color: var(--cms-text-muted);
            font-size: .8rem;
            font-style: italic;
        }

        /* -- Right-side action column ------------------------------------- */
        .de-field-actions {
            width: 56px;
            white-space: nowrap;
            padding: 0 4px !important;
            text-align: right;
        }
        .de-field-btn {
            border: none;
            background: none;
            padding: 2px 4px;
            border-radius: var(--cms-radius-sm, 4px);
            cursor: pointer;
            color: var(--cms-text-muted, #848b96);
            font-size: .8rem;
            line-height: 1;
        }
        .de-field-btn:hover { background: var(--cms-hover-bg, #f3f4f6); color: var(--cms-text); }
        .de-field-btn--danger:hover { color: var(--cms-danger, #dc2626); }

        .de-mini-badge {
            display: inline-block;
            font-size: .65rem;
            font-weight: 600;
            padding: 1px 5px;
            border-radius: 3px;
            margin-left: 4px;
            vertical-align: middle;
        }
        .de-mini-badge--id       { background: var(--cms-info-subtle); color: var(--cms-info-text); }
        .de-mini-badge--embedded { background: var(--cms-success-light); color: var(--cms-success-text); }

        .de-module__count {
            font-size: .7rem;
            font-weight: 400;
            color: var(--cms-text-muted);
            background: var(--cms-surface-muted, #f3f4f6);
            border-radius: var(--cms-radius-md, 8px);
            padding: 1px 6px;
        }
        .de-module__count--records { background: var(--cms-info-subtle); color: var(--cms-info-text); }

        /* Utilities */
        .font-mono   { font-family: var(--cms-font-mono, monospace); }
        .text-muted  { color: var(--cms-text-muted) !important; }
        .py-3        { padding-top: 12px; padding-bottom: 12px; }
        .text-center { text-align: center; }
        .me-1        { margin-right: 4px; }

        /* -- Inheritance hints on field DataGrid rows ----------------------
           Driven by [attr.data-has-override] / [attr.title] which the field
           grid's row data carries (hasOverride + _rowTitle). ::ng-deep is
           required to reach into the encapsulated <coolms-datagrid> child.

           runtime → inherited unchanged: italic + muted.
           parent  → overrides parent's field of the same name.
           db / file → overrides a static PHP / config field.
        ────────────────────────────────────────────────────────────────── */
        :host ::ng-deep tr[data-has-override="runtime"] td.data-cell {
            font-style: italic;
            color: var(--cms-text-muted);
        }

        /* Shared badge styling for overridden rows. Renders inline after the
           first data cell's content via ::after — works for both draggable
           (drag-handle is td:nth-child(1)) and non-draggable layouts because
           td.data-cell:first-of-type always anchors on the first <td>, while
           the sibling-combinator rule covers the draggable case. */
        :host ::ng-deep tr[data-has-override="parent"] td.data-cell:first-child::after,
        :host ::ng-deep tr[data-has-override="parent"] td.drag-handle + td.data-cell::after {
            content: 'overridden';
            display: inline-block;
            margin-left: 6px;
            padding: 1px 6px;
            border-radius: var(--cms-radius-sm);
            background: var(--cms-accent-light);
            color: var(--cms-accent-text);
            font-size: .65rem;
            font-weight: 600;
            font-style: normal;
            letter-spacing: .04em;
            text-transform: uppercase;
            vertical-align: middle;
        }
        :host ::ng-deep tr[data-has-override="db"]   td.data-cell:first-child::after,
        :host ::ng-deep tr[data-has-override="db"]   td.drag-handle + td.data-cell::after,
        :host ::ng-deep tr[data-has-override="file"] td.data-cell:first-child::after,
        :host ::ng-deep tr[data-has-override="file"] td.drag-handle + td.data-cell::after {
            content: 'modified';
            display: inline-block;
            margin-left: 6px;
            padding: 1px 6px;
            border-radius: var(--cms-radius-sm);
            background: var(--cms-info-light);
            color: var(--cms-info-text);
            font-size: .65rem;
            font-weight: 600;
            font-style: normal;
            letter-spacing: .04em;
            text-transform: uppercase;
            vertical-align: middle;
        }
    `],
})
export class DomainExplorerDetailComponent {
    readonly st            = inject(DomainExplorerStateService);
    private readonly store = inject(Store);

    readonly showDynamicTypes = input<boolean>(false);
    readonly showEntities     = input<boolean>(true);

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /**
     * Resolve the human label of the active runtime type's parent. Used to
     * build per-row tooltips for inherited / overridden fields. Returns ''
     * when there is no parent (root type) or no active runtime type.
     */
    readonly activeParentLabel = computed<string>(() => {
        const rt = this.st.activeRuntimeType();
        if (!rt) return '';
        const all = this.st.runtimeTypes();
        const parent = rt.parentId
            ? all.find(t => t.id === rt.parentId)
            : (rt.parentAlias ? all.find(t => t.slug === rt.parentAlias) : undefined);
        if (!parent) return '';
        return parent.label || parent.name || parent.slug;
    });

    /**
     * Per-row tooltip text driven by `hasOverride`. Mirrors the badge mapping
     * in the prompt so DataGrid's `[attr.title]` binding produces a hover
     * hint on inherited/overridden rows.
     */
    private rowTitleFor(field: { name: string; hasOverride?: string | null }, parentLabel: string): string | null {
        switch (field.hasOverride) {
            case 'runtime':
                return parentLabel ? `Inherited from ${parentLabel}` : 'Inherited field';
            case 'parent':
                return parentLabel
                    ? `Overrides ${parentLabel}.${field.name}`
                    : `Overrides parent.${field.name}`;
            case 'db':   return 'Modified PHP field';
            case 'file': return 'Modified config field';
            default:     return null;
        }
    }

    readonly fieldGridData = computed((): DataGridData | null => {
        if (!this.st.activeRuntimeType() && !this.st.activeEntity()?.isDynamic) return null;
        const fields = this.st.allFields();
        const parentLabel = this.activeParentLabel();
        const items = fields.map(f => ({
            id:             f.id ?? f.name,
            name:           f.name,
            type:           f.type,
            label:          f.label,
            isRequired:     f.isRequired,
            source:         f.source,
            locked:         f.locked,
            hasOverride:    f.hasOverride ?? null,
            overrideAction: f.overrideAction ?? null,
            sortOrder:      f.sortOrder ?? 0,
            _rowTitle:      this.rowTitleFor(f, parentLabel),
        }));
        return {
            items,
            totalItems: items.length,
            page:       1,
            limit:      500,
            totalPages: 1,
        };
    });

    onFieldSelected(row: Record<string, unknown> | null): void {
        this.st.selectedField.set(row);
    }

    onFieldBackgroundCtx(event: MouseEvent): void {
        this.st.openBackgroundCtxMenu(event);
    }

    onRecordSelected(row: Record<string, unknown> | null): void {
        this.st.selectedRecord.set(row);
    }

    /** Right-click on a record row: the grid emits rowSelected before rowContextMenu,
     *  so selectedRecord is already populated by onRecordSelected by the time we run. */
    onRecordRowCtx(event: MouseEvent): void {
        const row = this.st.selectedRecord();
        if (row) this.st.openRecordCtxMenu(event, row);
    }

    /** Right-click on the records-grid background. */
    onRecordBgCtx(event: MouseEvent): void {
        this.st.openBackgroundCtxMenu(event);
    }

    readonly entityFieldGridData = computed((): DataGridData | null => {
        const entity = this.st.activeEntity();
        if (!entity?.fields?.length) return null;
        const items = entity.fields
            .filter(f => !f.name.includes('.'))
            .map(f => ({
                id:             f.name,
                name:           f.name,
                type:           f.type,
                label:          f.label ?? '',
                nullable:       f.nullable ? 'yes' : '',
                source:         f.source ?? (f.isEmbedded ? 'embedded' : 'entity'),
                hasOverride:    f.hasOverride ?? null,
                overrideAction: f.overrideAction ?? null,
                locked:         false,
                sortOrder:      f.sortOrder ?? 0,
                _rowTitle:      this.rowTitleFor(f, ''),
            }))
            .sort((a, b) => a.sortOrder - b.sortOrder);
        return {
            items,
            totalItems: items.length,
            page:       1,
            limit:      500,
            totalPages: 1,
        };
    });

    /**
     * Resolves the gridId for the static/managed-dynamic records grid.
     * Shape 'entity:{aliasOrClassName}' -- StaticEntityDataGridConfigProvider
     * serves column config and filter knobs from EntityClassMetadata.
     *
     * Returns null for runtime-dynamic types (they use DynamicRecordListComponent
     * with 'dynamic:{alias}') or when no recordsUrl is present.
     */
    readonly entityRecordsGridId = computed((): string | null => {
        const entity = this.st.activeEntity();
        if (!entity?.recordsUrl || entity.dynamicOrigin === 'runtime') return null;
        const ident = entity.dynamicAlias ?? entity.className;
        return `entity:${ident}`;
    });

    onEntityFieldSelected(row: Record<string, unknown> | null): void {
        this.st.selectedField.set(row);
    }

    onEntityFieldReorder(event: { item: Record<string, unknown>; newIndex: number }): void {
        const name = String(event.item['name'] ?? '');

        const allData = this.fieldGridData() ?? this.entityFieldGridData();
        if (!allData) return;

        // Build the new order: remove dragged item, insert at newIndex
        const items = allData.items.map(i => String(i['name']));
        const withoutDragged = items.filter(n => n !== name);
        withoutDragged.splice(event.newIndex, 0, name);

        // Assign sequential sortOrder (10, 20, 30…) to every item in its new position
        const reorderPayload = withoutDragged.map((fieldName, idx) => ({
            name:      fieldName,
            sortOrder: (idx + 1) * 10,
        }));

        this.st.batchReorderFields(reorderPayload);
    }

    onEntityFieldBgCtx(event: MouseEvent): void {
        this.st.openBackgroundCtxMenu(event);
    }

    /** Row right-click on the type/dynamic-entity fieldGridConfig DataGrid. */
    onFieldRowCtx(event: MouseEvent): void {
        const field = this.st.selectedField();
        if (field) this.st.openFieldCtxMenu(event, field);
    }

    /** Row right-click on the static-entity entityFieldGridConfig DataGrid. */
    onEntityFieldRowCtx(event: MouseEvent): void {
        const field = this.st.selectedField();
        if (field) {
            this.st.openFieldCtxMenu(event, field);
        } else {
            this.st.openBackgroundCtxMenu(event);
        }
    }

    onFieldAction(event: { action: string; row: Record<string, unknown> }): void {
        const fieldName = event.row['name'] as string;
        const field = this.st.allFields().find(f => f.name === fieldName);
        if (!field || field.locked) return;
        if (event.action === 'edit') {
            const rt = this.st.activeRuntimeType();
            const isInherited = field.source !== 'runtime'
                || (field.entityAlias !== '' && field.entityAlias !== rt?.slug);
            if (isInherited) {
                this.st.openOverrideField(field);
            } else {
                this.st.openEditField(field);
            }
        } else if (event.action === 'delete' && field.source === 'runtime') {
            this.st.confirmDeleteField(field);
        }
    }

    typeBadgeClass(type: string): string {
        switch (type) {
            case 'relation': return 'cms-badge--info';
            case 'boolean':  return 'cms-badge--success';
            case 'number':
            case 'integer':  return 'cms-badge--warning';
            default:         return 'cms-badge--muted';
        }
    }
}
