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
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    PageTitleService,
    ToastService,
    type DataGridData,
} from '@coolms/ui-angular';
import { FormService } from './form.service';
import type { FormDefinitionDto } from './form.types';

/**
 * Form Builder list page (`/admin/forms`,.3).
 *
 * Lists every registered form (`GET /forms`) as a DataGrid; each row carries
 * the read-only `source` discriminator (shipped / db / file) so the operator
 * can see whether editing rewrites a user copy or mints a DB override.
 *
 * Self-contained: renders its own `<cms-page-header>` (New Form + Reload) and
 * an `<coolms-datagrid>` whose YAML-declared row actions (Edit / Delete) handle
 * per-row operations — no layout-slot wrapper or navi toolbar tree needed
 * (mirrors the self-rendered header on the sibling form-builder page).
 *
 * `loadingMode: client`: `/forms` returns the whole catalogue in one shot, so
 * we load it once, project each row to `{ id, name, fieldCount, source }`, and
 * let the grid filter / sort / paginate in memory. `name` is the backend's
 * friendly label (`formOptions.title` else a humanized id) — the primary column;
 * `id` stays visible as the canonical identifier.
 */
@Component({
    selector: 'coolms-admin-forms-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="Forms"
            icon="ui-checks-grid"
            toolbarTreeSlug="navi.toolbar.form.list"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="form:list"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowSelected)="selectedRow.set($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class FormsListPageComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly forms      = inject(FormService);
    private readonly store      = inject(Store);
    private readonly router     = inject(Router);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /** All forms, projected to grid rows. */
    private readonly rows = signal<Array<{ id: string; name: string; fieldCount: number; source: string }>>([]);

    /** Selected grid row — drives the toolbar's selection-gated Edit/Delete (navi showWhen). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /**
     * showWhen context for the `navi.toolbar.form.list` tree: `_selected`
     * gates the row actions; `_isShipped` hides Delete on a module-shipped
     * form (no override to remove).
     */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const row = this.selectedRow();
        return {
            _selected:  row !== null,
            _isShipped: row?.['source'] === 'shipped',
        };
    });

    readonly gridData = computed((): DataGridData => {
        const rows = this.rows();
        return {
            items:      rows,
            totalItems: rows.length,
            page:       1,
            limit:      rows.length,
            totalPages: 1,
            hasMore:    false,
        };
    });

    /**
     * Footer row-count strip — mirrors the other cms-list-page consumers
     * (Definitions / Cockpit / NaviNodes). Blank until the first load so the
     * footer stays hidden (cms-list-page only renders it when set).
     */
    readonly footerLabel = computed(() => {
        const n = this.rows().length;
        return n === 0 ? '' : `${n} form${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Forms');
        this.load();
    }

    private load(): void {
        this.forms.listForms().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: forms => this.rows.set(forms.map(f => this.toRow(f))),
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    private toRow(f: FormDefinitionDto): { id: string; name: string; fieldCount: number; source: string } {
        return {
            id:         f.id,
            name:       f.name ?? f.id,
            fieldCount: Object.keys(f.fields ?? {}).length,
            source:     f.source ?? 'shipped',
        };
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { void this.router.navigate(['/forms', 'new']); return; }
        if (id === 'reload') { this.load(); return; }
        // Selection-gated toolbar actions (Edit / Delete) operate on the selected row —
        // same handlers as the right-click context menu.
        const row = this.selectedRow();
        const formId = row?.['id'] as string | undefined;
        if (!formId) return;
        if (id === 'open')   void this.router.navigate(['/forms', formId]);
        if (id === 'delete') this.confirmDelete(formId, row?.['source'] as string | undefined);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const id = event.row['id'] as string | undefined;
        if (!id) return;
        if (event.action === 'open')   void this.router.navigate(['/forms', id]);
        if (event.action === 'delete') this.confirmDelete(id, event.row['source'] as string);
    }

    private confirmDelete(id: string, source: string | undefined): void {
        if (source === 'shipped') {
            this.toast.error('A module-shipped form has no override to delete. Edit it to create one first.');
            return;
        }
        this.confirmSvc.confirmDelete(id).pipe(
            filter(Boolean),
            switchMap(() => this.forms.deleteForm(id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success(`Form "${id}" deleted`); this.load(); },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }
}
