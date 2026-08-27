import { Dialog } from '@angular/cdk/dialog';
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
import { ImageMapFormDialogComponent, type ImageMapFormDialogData } from './image-map-form-dialog.component';
import { ImageMapService } from './image-map.service';
import type { ImageMapDto } from './image-map.types';

/**
 * ImageMap list page (`/admin/image-maps`) — the spatial-substrate admin
 * (ledger #1521–#1525 backend). `loadingMode: client`: maps are few, so the
 * page loads the whole catalogue via `GET /image-maps` and feeds the grid
 * through [externalData]; create/edit run in a modal dialog (the platform's
 * BE-config-datagrid + modal-editor convention). Region authoring is a later
 * slice (Fabric.js surface reusing the Image Editor).
 */
@Component({
    selector: 'coolms-admin-image-maps-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="Image Maps"
            icon="map"
            toolbarTreeSlug="navi.toolbar.imagemap.list"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="imagemap:list"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowSelected)="selectedRow.set($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class ImageMapsListPageComponent implements OnInit {
    private readonly api        = inject(ImageMapService);
    private readonly router     = inject(Router);
    private readonly store      = inject(Store);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /** Whole catalogue, keyed by slug — rows project from it, the dialog seeds from it. */
    private readonly maps = signal<ImageMapDto[]>([]);

    /** Selected grid row — drives the toolbar's selection-gated Edit/Delete (navi showWhen). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    readonly gridData = computed((): DataGridData => {
        const rows = this.maps().map(m => this.toRow(m));
        return {
            items:      rows,
            totalItems: rows.length,
            page:       1,
            limit:      rows.length,
            totalPages: 1,
            hasMore:    false,
        };
    });

    readonly footerLabel = computed(() => {
        const n = this.maps().length;
        return n === 0 ? '' : `${n} image map${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Image Maps');
        this.load();
    }

    private load(): void {
        this.api.listImageMaps().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  maps => this.maps.set(maps),
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    private toRow(m: ImageMapDto): Record<string, unknown> {
        return {
            // the grid keys row selection on `id` (empty-string key when
            // missing breaks the selection → toolbar `_selected` chain)
            id:            m.id,
            slug:          m.slug,
            title:         m.title,
            intrinsicSize: `${m.intrinsicWidth} × ${m.intrinsicHeight}`,
            regionCount:   m.regions.length,
            enabled:       m.enabled ? 'Yes' : 'No',
        };
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openDialog(); return; }
        if (id === 'reload') { this.load(); return; }
        const slug = this.selectedRow()?.['slug'] as string | undefined;
        if (!slug) return;
        if (id === 'open')    this.openDialog(slug);
        if (id === 'regions') this.openRegions(slug);
        if (id === 'delete')  this.confirmDelete(slug);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const slug = event.row['slug'] as string | undefined;
        if (!slug) return;
        if (event.action === 'open')    this.openDialog(slug);
        if (event.action === 'regions') this.openRegions(slug);
        if (event.action === 'delete')  this.confirmDelete(slug);
    }

    private openRegions(slug: string): void {
        void this.router.navigate(['/image-maps', slug, 'regions']);
    }

    private openDialog(slug?: string): void {
        const map = slug ? this.maps().find(m => m.slug === slug) : undefined;
        const data: ImageMapFormDialogData = { map };
        this.dialog.open<ImageMapDto>(ImageMapFormDialogComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((r): r is ImageMapDto => r != null),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(saved => {
            this.toast.success(map ? `Image map "${saved.slug}" updated` : `Image map "${saved.slug}" created`);
            this.load();
        });
    }

    private confirmDelete(slug: string): void {
        this.confirmSvc.confirmDelete(slug).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteImageMap(slug)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success(`Image map "${slug}" deleted`); this.selectedRow.set(null); this.load(); },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }
}
