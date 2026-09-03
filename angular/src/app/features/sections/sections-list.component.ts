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
import { ApiService, SiteSectionDto } from '../../api/api.service';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';
import { SectionFormComponent } from './section-form.component';
import { SiteWizardComponent } from './site-wizard.component';
import { ApplyNginxChanges } from './section.actions';

@Component({
    selector: 'coolms-admin-sections-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Site Sections"
            icon="layout-text-sidebar"
            toolbarTreeSlug="navi.toolbar.section.sections"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <!-- Grid config fetched from /api/v1/datagrids/section:sections (no externalConfig).
                 All sections are loaded at once via (loadMore) (no server-side pagination). -->
            <coolms-datagrid
                gridId="section:sections"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowActionTriggered)="onRowAction($event)"
                (rowSelected)="onRowSelected($event)"
                (loadMore)="onLoadMore($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class SectionsListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly api        = inject(ApiService);
    private readonly store      = inject(Store);
    private readonly dialog     = inject(Dialog);
    private readonly router     = inject(Router);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc    = inject(PageTitleService);
    private readonly destroyRef  = inject(DestroyRef);

    /**
     * Slug of the catch-all/default SiteSection. Kept in lockstep with
     * the backend `CreateSiteSectionProcessor::RESERVED_SLUGS` and the
     * `DeleteSiteSectionProcessor::DEFAULT_SLUG` guard.
     */
    private static readonly DEFAULT_SLUG = 'default';

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    readonly sections = signal<SiteSectionDto[]>([]);
    readonly hasMore  = signal(true);

    /** Flips true after the first load so the footer count stays blank until then. */
    readonly loaded = signal(false);
    readonly footerLabel = computed(() =>
        this.loaded() ? `${this.sections().length} section${this.sections().length === 1 ? '' : 's'}` : '',
    );

    /** Currently selected datagrid row (null when nothing is selected). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /**
     * Context passed to the toolbar for showWhen evaluation.
     * `_isDefaultRow` lets the toolbar YAML hide row-level actions (Delete)
     * when the catch-all "default" section is selected.
     */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const row = this.selectedRow();
        return {
            _selected:     row !== null,
            _isDefaultRow: row !== null && row['slug'] === SectionsListComponent.DEFAULT_SLUG,
        };
    });

    /**
     * Adds a derived `_isDefault` flag to each row so the datagrid can
     * decorate (badge / lock icon) the catch-all section and the toolbar's
     * row-level actions can be hidden via the `_isDefaultRow` showWhen.
     */
    readonly gridData = computed((): DataGridData => ({
        items: this.sections().map(s => ({
            ...s,
            slug:        s.slug ?? '',
            _isDefault:  s.slug === SectionsListComponent.DEFAULT_SLUG,
        })),
        totalItems: this.sections().length,
        page:       1,
        limit:      50,
        totalPages: 1,
        hasMore:    this.hasMore(),
    }));

    ngOnInit(): void {
        this.titleSvc.set('Sections');
    }

    /**
     * Single entry point for all data loading (initial, scroll, sort, filter, reload).
     * Sections are loaded all at once (getSections() fetches the full collection).
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        // All sections fetched in one request; skip append calls.
        if (!event.reset && event.offset > 0) return;

        const epoch = ++this._loadEpoch;

        this.api.getSections().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: sections => {
                if (epoch !== this._loadEpoch && event.reset) return; // stale reset
                this.sections.set(sections);
                this.hasMore.set(false); // all loaded at once
                this.loaded.set(true);
            },
            error: () => this.toast.error('Failed to load sections'),
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const section = this.sections().find(s => s.id === (event.row['id'] as string));
        if (!section) return;
        if (event.action === 'open')   this.openDetail(section);
        if (event.action === 'edit')   this.openEdit(section);
        if (event.action === 'delete') this.confirmDelete(section);
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openCreate(); return; }
        if (id === 'apply')  { this.applyNginxChanges(); return; }
        if (id === 'reload') { this.grid?.reload(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const section = this.sections().find(s => s.id === (row['id'] as string));
        if (!section) return;
        if (id === 'open')   this.openDetail(section);
        if (id === 'edit')   this.openEdit(section);
        if (id === 'delete') this.confirmDelete(section);
    }

    /**
     * Layer 3d.1 — navigates to the Site Detail page
     * (`/admin/sections/:slug`). Read-only composition view; edit
     * settings + delete site live on the detail page itself.
     */
    private openDetail(section: SiteSectionDto): void {
        if (!section.slug) return;
        void this.router.navigate(['/sections', section.slug]);
    }

    /**
     * H9 — Apply CTA. Dispatches the NgXS action which calls
     * `POST /api/v1/sections/_apply`. Renders the result as a sticky toast
     * showing the reload command the operator must run (nginx is NOT
     * auto-reloaded -- safest contract for multi-host setups).
     */
    private applyNginxChanges(): void {
        this.store.dispatch(new ApplyNginxChanges()).subscribe({
            next: () => {
                const result = this.store.selectSnapshot(state => state.sections?.lastApplyResult ?? null);
                if (!result) {
                    this.toast.success('Applied nginx changes.');
                    return;
                }
                // A REMOVAL IS A CHANGE. It used to be invisible here --
                // the response did not carry it, and the count only added up
                // what was written -- so a run that deleted a server block
                // reported "No nginx changes" while nginx still held it until
                // a reload nobody was told to run.
                const removed = result.removed?.length ?? 0;
                const written = result.created.length + result.updated.length;
                const parts: string[] = [];
                if (written > 0) parts.push(`wrote ${written}`);
                if (removed > 0) parts.push(`removed ${removed}`);
                const summary = 0 === parts.length
                    ? 'No nginx changes — all configs already up to date.'
                    : `Applied: ${parts.join(', ')}. Run: ${result.reloadCommand}`;
                this.toast.success(summary, 'nginx vhost generator');
                // A skip with no reason reads as a failure. The backend states
                // one per slug; showing it turns "skipped: coolms-docs" into
                // "served by its host's vhost", which is the correct answer.
                const reasons = result.skippedReasons ?? {};
                const explained = Object.entries(reasons);
                if (explained.length > 0) {
                    this.toast.info(
                        explained.map(([slug, why]) => `${slug}: ${why}`).join(' · '),
                        'No vhost of their own',
                    );
                }
            },
            error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
        });
    }

    /**
     * Add site -- the wizard, not the flat form.
     *
     * Creating a site touches a slug, an address, a precedence number, a stack,
     * a theme and an nginx vhost, and the flat form asked for the first four
     * with no order and skipped the last two entirely. The wizard dispatches the
     * SAME actions this page already used, so it is a face on the operation
     * rather than a second one; {@link SectionFormComponent} stays for edit,
     * where the operator already knows what they are changing.
     */
    private openCreate(): void {
        this.dialog.open(SiteWizardComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private openEdit(section: SiteSectionDto): void {
        this.dialog.open(SectionFormComponent, {
            data: section,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.grid.reload());
    }

    private confirmDelete(section: SiteSectionDto): void {
        if (!section.id) return;
        // FE guard mirrors the backend `DeleteSiteSectionProcessor` guard:
        // the catch-all `default` section cannot be deleted. Surface a
        // friendly error and skip the confirm dialog entirely.
        if (section.slug === SectionsListComponent.DEFAULT_SLUG) {
            this.toast.error('The default catch-all section cannot be deleted.');
            return;
        }
        this.confirmSvc.confirmDelete(section.label).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteSection(section.id!)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Section deleted'); this.grid.reload(); },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    /** Monotonically-increasing load counter; stale reset responses are discarded. */
    private _loadEpoch = 0;
}
