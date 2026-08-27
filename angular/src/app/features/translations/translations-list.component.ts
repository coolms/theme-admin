import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
    signal,
    ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import { ApiService, type TranslationCatalogueDto } from '../../api/api.service';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    PageTitleService,
    ToastService,
    type DataGridData,
} from '@coolms/ui-angular';
import { TranslationCreateFormComponent } from './translation-create-form.component';

/**
 * F5.d -- Translations list slot (`TranslationsList`).
 *
 * Mounted inside `<cms-list-layout layoutId="i18n:translations-list">` --
 * the layout shell renders `cms-page-header` + `cms-page-footer`, this
 * slot owns the toolbar + the datagrid + drill-down behaviour. Title +
 * icon come from `config/modules/i18n/layout/i18n-translations-list.yaml`.
 *
 * **Toolbar** -- bound to `navi.toolbar.i18n.translations`. Reload always
 * visible; row-level Edit + Revert visible when a row is selected (Revert
 * additionally gated on `_hasOverride`).
 *
 * **DataGrid** -- `gridId=i18n:translations`, served by the backend
 * datagrid config endpoint. Loading mode is `client`: the FE fetches all
 * catalogues on mount and renders in-memory. Sort by domain then locale
 * is applied client-side for stable order.
 *
 * **Drill-down** -- row action `open` (or row click) routes to
 * `/admin/i18n/translations/{id}` where `id` is the composite
 * `{domain}:{locale}` slug.
 */
@Component({
    selector: 'coolms-admin-translations-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Translations"
            icon="translate"
            toolbarTreeSlug="navi.toolbar.i18n.translations"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="i18n:translations"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowActionTriggered)="onRowAction($event)"
                (rowSelected)="onRowSelected($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [`:host { display: flex; flex-direction: column; flex: 1; min-height: 0; }`],
})
export class TranslationsListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly api         = inject(ApiService);
    private readonly store       = inject(Store);
    private readonly router      = inject(Router);
    private readonly dialog      = inject(Dialog);
    private readonly errors      = inject(ErrorHandlerService);
    private readonly toast       = inject(ToastService);
    private readonly confirmSvc  = inject(ConfirmDialogService);
    private readonly titleSvc    = inject(PageTitleService);
    private readonly destroyRef  = inject(DestroyRef);

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    readonly rows        = signal<TranslationCatalogueDto[]>([]);
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** Footer-bar count, set after each catalogue load. Blank until then. */
    readonly footerLabel = signal<string>('');

    /**
     * Toolbar context for `showWhen` evaluation. `_selected` gates the
     * row-action group; `_hasOverride` additionally gates Revert so the
     * action is hidden when the selected catalogue is baseline-only.
     */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const row = this.selectedRow();
        return {
            _selected:    row !== null,
            _hasOverride: row !== null && row['hasOverride'] === true,
        };
    });

    /**
     * Grid payload. The list is small (<100 rows in realistic deploys)
     * so we render everything in-memory + project a derived `state`
     * column for the badge cell ("VFS override" vs "Baseline").
     */
    readonly gridData = computed((): DataGridData => {
        const items = this.rows().map(r => ({
            ...r,
            state: r.hasOverride ? 'VFS override' : 'Baseline',
        })) as unknown as Array<Record<string, unknown>>;
        return {
            items,
            totalItems: items.length,
            page:       1,
            limit:      items.length,
            totalPages: 1,
            hasMore:    false,
        };
    });

    ngOnInit(): void {
        this.titleSvc.set('Translations');
        this.loadCatalogues();
    }

    private loadCatalogues(): void {
        this.api.listTranslationCatalogues()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: rows => {
                    // Stable sort: domain asc, then locale asc.
                    const sorted = [...rows].sort((a, b) =>
                        a.domain.localeCompare(b.domain) || a.locale.localeCompare(b.locale),
                    );
                    this.rows.set(sorted);
                    this.footerLabel.set(
                        `${sorted.length} catalogue${sorted.length === 1 ? '' : 's'}`,
                    );
                },
                error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
            });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const id = String(event.row['id'] ?? '');
        if (!id) return;
        if (event.action === 'open')   { this.router.navigate(['/i18n/translations', id]); return; }
        if (event.action === 'revert') { this.confirmRevert(event.row); return; }
    }

    onToolbarAction(id: string): void {
        if (id === 'reload') { this.reload();        return; }
        if (id === 'create') { this.openCreateDialog(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const rowId = String(row['id'] ?? '');
        if (!rowId) return;
        if (id === 'open')   { this.router.navigate(['/i18n/translations', rowId]); return; }
        if (id === 'revert') { this.confirmRevert(row); return; }
    }

    /**
     * Opens the "+ New translation" dialog. The form (fields,
     * dataSources, validation, submit copy) is defined in
     * `config/modules/i18n/forms/i18n_translation_create.yaml` and
     * rendered by `<app-dynamic-form>`; the wrapper just collects
     * the picked (domain, locale) and routes to the editor. The
     * relaxed item provider serves an empty descriptor + default-
     * locale baseline keys so the editor is immediately authorable
     * for a brand-new pair.
     */
    private openCreateDialog(): void {
        this.dialog.open<string | null>(
            TranslationCreateFormComponent,
            { backdropClass: 'cdk-overlay-dark-backdrop' },
        ).closed
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(id => {
                if (typeof id === 'string' && id !== '') {
                    this.router.navigate(['/i18n/translations', id]);
                }
            });
    }

    private reload(): void {
        this.loadCatalogues();
        this.grid?.reload();
    }

    private confirmRevert(row: Record<string, unknown>): void {
        const id     = String(row['id'] ?? '');
        const domain = String(row['domain'] ?? '');
        const locale = String(row['locale'] ?? '');
        if (!id) return;

        this.confirmSvc.open({
            title:        'Revert to baseline',
            message:      `Delete the VFS override for ${domain}:${locale}? `
                       +  'This restores the on-disk baseline messages and cannot be undone.',
            confirmLabel: 'Revert',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteTranslationCatalogue(id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success(`Reverted ${domain}:${locale} to baseline.`);
                this.reload();
            },
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }
}
