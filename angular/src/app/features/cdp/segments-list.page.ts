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
import { Dialog } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { filter } from 'rxjs';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    PageTitleService,
    ToastService,
    type DataGridData,
} from '@coolms/ui-angular';
import { CdpService } from './cdp.service';
import { SegmentDto } from './cdp.types';
import {
    SegmentEditorDialogComponent,
    type SegmentEditorDialogData,
} from './segment-editor-dialog.component';

/** Projected grid row (id = the durable segment key). */
interface SegmentRow {
    id: string;
    name: string;
    key: string;
    rule: string;
    enabled: boolean;
}

/**
 * Track E Phase 3 (CDP core, #1150) — audience-Segment list (`/admin/cdp/segments`).
 *
 * Platform list-page shell (`<cms-list-page>` + `<coolms-datagrid>` driven by the
 * `analytics:segments` config YAML) — matches Cockpit / Webhooks / Schedules
 * exactly: sortable columns, per-column filter row, column visibility, the row
 * count in the FOOTER (bottom-left), and platform toolbar buttons. Create / Edit
 * open the {@link SegmentEditorDialogComponent} modal; "View members" jumps to the
 * Subject explorer filtered to that segment; Delete removes after a confirm.
 *
 * `loadingMode: client`: loads the segment set once and the grid filters / sorts
 * / paginates in memory (the audience set is small).
 */
@Component({
    selector: 'coolms-cdp-segments',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="Segments"
            icon="diagram-3"
            subtitle="Audience segments over the CDP subject store"
            toolbarTreeSlug="navi.toolbar.analytics.segments"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="analytics:segments"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowSelected)="selectedRow.set($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class SegmentsListPageComponent implements OnInit {
    private readonly api        = inject(CdpService);
    private readonly store      = inject(Store);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly router     = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    private readonly rows = signal<SegmentRow[]>([]);
    private readonly loaded = signal(false);
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** The raw DTOs kept alongside the projected rows, so a selection (id = key) resolves back. */
    private originals: SegmentDto[] = [];

    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    readonly gridData = computed((): DataGridData => {
        const rows = this.rows();
        return {
            items: rows as unknown as Array<Record<string, unknown>>,
            totalItems: rows.length,
            page: 1,
            limit: rows.length,
            totalPages: 1,
            hasMore: false,
        };
    });

    /** Footer row-count strip (bottom-left) — mirrors the other cms-list-page consumers. */
    readonly footerLabel = computed(() => {
        if (!this.loaded()) {
            return '';
        }
        const n = this.rows().length;
        return `${n} segment${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Customer Data — Segments');
        this.load();
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openEditor(null); return; }
        if (id === 'reload') { this.load(); return; }

        const segment = this.selected();
        if (!segment) {
            return;
        }
        if (id === 'edit')    { this.openEditor(segment); }
        if (id === 'members') { void this.router.navigate(['/cdp/subjects'], { queryParams: { segment: segment.key } }); }
        if (id === 'delete')  { this.confirmDelete(segment); }
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action !== 'open') {
            return;
        }
        const segment = this.find(event.row);
        if (segment) {
            this.openEditor(segment);
        }
    }

    private openEditor(segment: SegmentDto | null): void {
        const data: SegmentEditorDialogData = { segment: segment ?? undefined };
        this.dialog.open<SegmentDto | null>(SegmentEditorDialogComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((s): s is SegmentDto => s != null),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(saved => {
            this.toast.success(`Segment "${saved.name}" ${segment ? 'updated' : 'created'}`);
            this.load();
        });
    }

    private confirmDelete(segment: SegmentDto): void {
        this.confirmSvc.open({
            title:        `Delete "${segment.name}"?`,
            message:      'Subjects keep their events; only this audience rule is removed.',
            confirmLabel: 'Delete',
            danger:       true,
        }).pipe(
            filter(Boolean),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            this.api.deleteSegment(segment.key).pipe(
                takeUntilDestroyed(this.destroyRef),
            ).subscribe({
                next: () => { this.toast.success(`Segment "${segment.name}" deleted`); this.load(); },
                error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
            });
        });
    }

    private load(): void {
        this.api.listSegments().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => {
                this.originals = rows;
                this.rows.set(rows.map(s => this.toRow(s)));
                this.selectedRow.set(null);
                this.loaded.set(true);
            },
            error: (e: unknown) => {
                this.loaded.set(true);
                this.toast.error(this.errors.humanize(e));
            },
        });
    }

    private toRow(s: SegmentDto): SegmentRow {
        return { id: s.key, name: s.name, key: s.key, rule: s.rule, enabled: s.enabled };
    }

    /** Resolve the selected grid row (id = key) back to its DTO. */
    private selected(): SegmentDto | undefined {
        const row = this.selectedRow();
        return row ? this.find(row) : undefined;
    }

    private find(row: Record<string, unknown>): SegmentDto | undefined {
        const key = row['id'] as string | undefined;
        return this.originals.find(x => x.key === key);
    }
}
