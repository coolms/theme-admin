import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { filter } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    DataGridComponent,
    PageTitleService,
    ToastService,
    type DataGridData,
} from '@coolms/ui-angular';
import { BackupService, BackupBundleDto, CreateBackupResult } from './backup.service';
import { BackupCreateDialogComponent } from './backup-create-dialog.component';
import { RestorePreviewDialogComponent } from './restore-preview-dialog.component';

/**
 * Backup admin page (/admin/backups, ).
 *
 * The read/create surface over the per-module backup seam: the on-disk bundles
 * under `var/backups/` (name, when, tiers, module + record counts, size), a
 * "Create backup" toolbar action (tier picker), and a per-bundle "Preview
 * restore" that opens the DRY-RUN plan. All three ops are non-destructive —
 * download / upload / apply-restore are out of scope (apply stays on the CLI).
 * The whole surface is gated server-side by the `root:backup 0o770` VFS node
 * (backup-group members only).
 *
 * **Platform list shell**: `<cms-list-page>` +
 * `<coolms-datagrid gridId="backup:bundles">` + the
 * `navi.toolbar.backup.bundles` toolbar tree. It previously hand-rolled a
 * `<table>` with ~90 lines of its own CSS and a hard-coded `headerActions`
 * array, so it had none of the platform's list affordances: no sorting, no
 * column chooser, no selection, no right-click context menu, no keyboard
 * navigation.
 *
 * `loadingMode: client` is deliberate and correct here, unlike the grids fixed
 * in /: bundles are operator-created files returned in full by the
 * endpoint, so there is nothing to paginate and no filter that could search a
 * subset.
 */
@Component({
    selector: 'coolms-admin-backups',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="Backups"
            icon="hdd-stack"
            subtitle="On-disk backup bundles — create a new one or preview a restore"
            toolbarTreeSlug="navi.toolbar.backup.bundles"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="backup:bundles"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowSelected)="selectedRow.set($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class BackupsListPageComponent implements OnInit {
    private readonly api = inject(BackupService);
    private readonly store = inject(Store);
    private readonly toast = inject(ToastService);
    private readonly titleSvc = inject(PageTitleService);
    private readonly dialog = inject(Dialog);
    private readonly destroyRef = inject(DestroyRef);

    readonly bundles = signal<BackupBundleDto[]>([]);
    readonly loading = signal(true);
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /** `_selected` gates the toolbar's Preview-restore action. */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    /**
     * Grid payload — the whole bundle list in one shot.
     *
     * `id` is the bundle NAME: datagrid selection is keyed on `row['id']`, so
     * without it every row shares key `''` — clicking highlights but never
     * selects, and the toolbar's `_selected` gating never fires. Bundle names
     * are unique on disk, so they are a sound key.
     */
    readonly gridData = computed((): DataGridData => {
        const rows = this.bundles().map(b => ({
            id:        b.name,
            name:      b.name,
            createdAt: b.createdAt,
            // string[] -> a readable cell; the grid renders scalar values.
            tiers:     b.tiers.join(', '),
            modules:   b.contributors.length,
            records:   b.records,
            size:      formatSize(b.sizeBytes),
            sizeBytes: b.sizeBytes,
        }));

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
        if (this.loading()) return '';
        const n = this.bundles().length;
        return n === 0 ? '' : `${n} bundle${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Backups');
        this.load();
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openCreate(); return; }
        if (id === 'reload') { this.load(); return; }
        if (id === 'preview') {
            const b = this.selectedBundle();
            if (b) this.openPreview(b);
        }
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action !== 'preview') return;
        const b = this.bundles().find(x => x.name === event.row['id']);
        if (b) this.openPreview(b);
    }

    openCreate(): void {
        this.dialog.open<CreateBackupResult>(BackupCreateDialogComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((r): r is CreateBackupResult => r != null),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(res => {
            const records = res.report.reduce((sum, r) => sum + r.records, 0);
            this.toast.success(`Backup "${res.name}" created — ${records} record${records === 1 ? '' : 's'}`);
            this.load();
        });
    }

    openPreview(b: BackupBundleDto): void {
        this.dialog.open(RestorePreviewDialogComponent, {
            data: { name: b.name },
            backdropClass: 'cdk-overlay-dark-backdrop',
        });
    }

    private selectedBundle(): BackupBundleDto | null {
        const row = this.selectedRow();
        if (!row) return null;

        return this.bundles().find(x => x.name === row['id']) ?? null;
    }

    private load(): void {
        this.loading.set(true);
        this.selectedRow.set(null);
        this.api.listBundles().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => { this.bundles.set(rows); this.loading.set(false); },
            error: () => { this.loading.set(false); this.toast.error('Failed to load backups'); },
        });
    }
}

/** Bytes -> a compact human size (matches the CLI's feel, not exact SI). */
function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let n = bytes / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }

    return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}
