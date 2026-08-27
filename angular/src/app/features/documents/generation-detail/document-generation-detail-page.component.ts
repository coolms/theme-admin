
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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EMPTY, Subject, firstValueFrom, of } from 'rxjs';
import { catchError, switchMap, takeWhile, tap } from 'rxjs/operators';

import {
    ApiService,
    type DocumentGenerationDto,
    type DocumentInstanceDto,
} from '../../../api/api.service';
import { Dialog } from '@angular/cdk/dialog';
import { ViewerModalComponent, ViewerModalData } from '@coolms/document-viewer-angular';
import {
    CmsPageHeaderComponent,
    ConfirmDialogService,
    NOTIFICATION_STREAM,
    ToastService,
} from '@coolms/ui-angular';
import { WordTemplateService } from '../word/word-template.service';
import { DocumentInstanceService } from '@coolms/document-angular';

import { GenerationStatusCardComponent } from './generation-status-card.component';
import {
    InstanceGridComponent,
    type InstanceFilterTab,
} from './instance-grid.component';

const TERMINAL_STATUSES = new Set(['completed', 'partially_failed', 'failed']);
const INSTANCE_PAGE_LIMIT = 200;

/**
 * Routed page for `/documents/generations/:id`. Composes:
 *
 *   - `GenerationStatusCardComponent` -- header with progress + retry
 *   - Configuration card -- read-only echo of audience + variables
 *   - `InstanceGridComponent` -- virtual-scrolled per-instance table
 *
 * Polling driver: `NOTIFICATION_STREAM.watch('document.generation.{id}')`.
 * Each tick refreshes the generation header and, when not in a terminal
 * state, the instance page. `takeWhile(..., true)` stops polling after
 * the first terminal emission so idle tabs do not hammer the backend.
 *
 * Status filter is currently client-side over the loaded page -- the
 * spec calls for server-side filtering when the audience exceeds the
 * page limit; the grid component already accepts both axes so the
 * server-side filter param is added in `loadInstances` when the active
 * tab is something other than All.
 */
@Component({
    selector: 'app-document-generation-detail-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
    RouterLink,
    CmsPageHeaderComponent,
    GenerationStatusCardComponent,
    InstanceGridComponent
],
    template: `
        <cms-page-header
            title="Generation detail"
            icon="file-earmark-bar-graph"
        />

        <div class="cms-gen-detail">
            <nav class="cms-gen-detail__crumbs" aria-label="Breadcrumb">
                <a routerLink="/documents" class="crumb">Documents</a>
                <span class="crumb-sep">›</span>
                <a routerLink="/documents/generations" class="crumb">Generations</a>
                <span class="crumb-sep">›</span>
                <span class="crumb crumb--active">{{ generationId() }}</span>
            </nav>

            @let gen = generation();
            @if (loading() && !gen) {
                <div class="cms-gen-detail__pending">Loading generation…</div>
            } @else if (loadError()) {
                <div class="cms-gen-detail__error" role="alert">{{ loadError() }}</div>
            } @else if (gen) {
                <cms-generation-status-card
                    [generation]="gen"
                    [templateName]="templateName()"
                    [retryBusy]="retryBusy()"
                    (retry)="onRetry()"
                />

                <section class="cms-gen-detail__config" aria-label="Configuration">
                    <h3 class="cms-gen-detail__config-title">Configuration</h3>
                    <dl>
                        <dt>Mode</dt>
                        <dd>{{ gen.mode }}</dd>

                        <dt>Output folder</dt>
                        <dd><code>{{ gen.outputBasePath || '—' }}</code></dd>

                        <dt>Filename pattern</dt>
                        <dd><code>{{ gen.filenamePattern || '—' }}</code></dd>

                        @if (audienceEntries().length > 0) {
                            <dt>Audience</dt>
                            <dd>
                                @for (entry of audienceEntries(); track entry.key) {
                                    <div><code>{{ entry.key }}</code> = {{ entry.value }}</div>
                                }
                            </dd>
                        }

                        @if (plainVariableEntries().length > 0) {
                            <dt>Variables</dt>
                            <dd>
                                @for (entry of plainVariableEntries(); track entry.key) {
                                    <div><code>{{ entry.key }}</code> = {{ entry.value }}</div>
                                }
                            </dd>
                        }
                    </dl>
                </section>

                <cms-instance-grid
                    [items]="filteredInstances()"
                    [loading]="instancesLoading()"
                    [activeTab]="activeTab()"
                    [totals]="instanceTotals()"
                    (viewRequested)="openInstance($event)"
                    (tabChanged)="onTabChange($event)"
                />
            }
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        .cms-gen-detail {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            /* Vertical only -- the shell's own main element already supplies the
               horizontal gutter, and adding our own put this page's content
               20px further in than every other page. */
            padding: 1rem 0;
            min-height: 0;
            flex: 1;
            overflow: auto;
            background: var(--cms-bg);
        }

        .cms-gen-detail__crumbs {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: .85rem;
            color: var(--cms-text-secondary);
        }
        .crumb {
            color: var(--cms-text-secondary);
            text-decoration: none;
            padding: 2px 4px;
            border-radius: var(--cms-radius-sm);
        }
        .crumb:hover { color: var(--cms-text); background: var(--cms-border-light); }
        .crumb--active {
            color: var(--cms-text);
            font-weight: 600;
        }
        .crumb-sep { color: var(--cms-text-muted); }

        .cms-gen-detail__pending,
        .cms-gen-detail__error {
            padding: 2rem;
            text-align: center;
            color: var(--cms-text-secondary);
        }
        .cms-gen-detail__error { color: var(--cms-danger); }

        .cms-gen-detail__config {
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            padding: 1rem 1.25rem;
        }
        .cms-gen-detail__config-title {
            margin: 0 0 .75rem;
            font-size: .9rem;
            color: var(--cms-text-secondary);
            font-weight: 600;
        }
        .cms-gen-detail__config dl {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: .35rem 1rem;
            margin: 0;
            font-size: .85rem;
        }
        .cms-gen-detail__config dt {
            color: var(--cms-text-secondary);
            font-weight: 600;
        }
        .cms-gen-detail__config dd { margin: 0; color: var(--cms-text); }
        .cms-gen-detail__config code {
            font-family: monospace;
            font-size: .8rem;
            color: var(--cms-text);
            background: var(--cms-border-light);
            padding: 1px 4px;
            border-radius: 3px;
        }
    `],
})
export class DocumentGenerationDetailPageComponent implements OnInit {
    private readonly route = inject(ActivatedRoute);
    private readonly api = inject(ApiService);
    private readonly templates = inject(WordTemplateService);
    private readonly instancesSvc = inject(DocumentInstanceService);
    private readonly toast = inject(ToastService);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly dialog = inject(Dialog);
    private readonly stream = inject(NOTIFICATION_STREAM);
    private readonly destroyRef = inject(DestroyRef);

    protected readonly generationId = signal<string>('');
    protected readonly generation = signal<DocumentGenerationDto | null>(null);
    protected readonly templateName = signal<string | null>(null);
    protected readonly loading = signal<boolean>(true);
    protected readonly loadError = signal<string | null>(null);

    protected readonly instances = signal<readonly DocumentInstanceDto[]>([]);
    protected readonly instancesLoading = signal<boolean>(false);
    protected readonly activeTab = signal<InstanceFilterTab>('all');

    protected readonly retryBusy = signal<boolean>(false);

    private readonly refreshInstances$ = new Subject<void>();

    protected readonly audienceEntries = computed(() => this.flattenRecord(this.generation()?.audienceCriteria));
    protected readonly plainVariableEntries = computed(() => this.flattenRecord(this.generation()?.plainVariables));

    protected readonly filteredInstances = computed(() => {
        const tab = this.activeTab();
        const rows = this.instances();
        if (tab === 'all') {
            return rows;
        }
        return rows.filter(r => this.tabMatches(tab, r.status));
    });

    protected readonly instanceTotals = computed(() => {
        const gen = this.generation();
        if (!gen) {
            return { all: 0, failed: 0, pending: 0, done: 0 };
        }
        const pending = Math.max(0, gen.totalCount - gen.completedCount - gen.failedCount);
        return {
            all: gen.totalCount,
            failed: gen.failedCount,
            pending,
            done: gen.completedCount,
        };
    });

    /**
     * Open a rendered instance in the shared document viewer.
     *
     * NOT an <a href>: the download endpoint is Bearer-authenticated, so a
     * plain navigation arrives without the header and renders an Unauthorized
     * JSON page. The viewer modal fetches with auth -- the same path the
     * Documents library uses.
     */
    protected openInstance(row: DocumentInstanceDto): void {
        if (!row.generatedFileId) {
            return;
        }

        const mime = this.instancesSvc.inferMimeType({ outputFormat: row.outputFormat });
        if (!mime) {
            this.toast.info('No in-browser viewer for this format — use Download.');

            return;
        }

        const filename = row.name;
        const data: ViewerModalData = {
            // xlsx / pptx are shown as a PDF rendition; Download still hands
            // over the real file.
            fileUrl: this.instancesSvc.previewUrl(row.generatedFileId, row.outputFormat)
                ?? this.instancesSvc.getDownloadUrl(row.generatedFileId, { disposition: 'inline' }),
            downloadUrl: this.instancesSvc.getDownloadUrl(row.generatedFileId, {
                disposition: 'attachment',
                filename,
            }),
            mimeType: mime,
            filename,
            title: `${filename} — ${row.outputFormat.toUpperCase()}`,
        };

        this.dialog.open<void, ViewerModalData>(ViewerModalComponent, { data, hasBackdrop: true });
    }

    ngOnInit(): void {
        const idParam = this.route.snapshot.paramMap.get('id') ?? '';
        if (!idParam) {
            this.loadError.set('Missing generation id in URL.');
            this.loading.set(false);
            return;
        }
        this.generationId.set(idParam);

        const channel = `document.generation.${idParam}`;
        this.stream.watch(channel)
            .pipe(
                switchMap(() => this.api.getDocumentGeneration(idParam).pipe(
                    catchError((err: Error) => {
                        this.loadError.set(err.message ?? 'Failed to load generation.');
                        this.loading.set(false);
                        return EMPTY;
                    }),
                )),
                tap((gen: DocumentGenerationDto) => {
                    this.generation.set(gen);
                    this.loading.set(false);
                    this.loadError.set(null);
                    this.maybeLoadTemplateName(gen.templateId);
                    this.refreshInstances$.next();
                }),
                takeWhile((gen: DocumentGenerationDto) => !TERMINAL_STATUSES.has(gen.status), true),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe();

        this.refreshInstances$
            .pipe(
                switchMap(() => this.fetchInstancesNow$()),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe();
    }

    onRetry(): void {
        const gen = this.generation();
        if (!gen || gen.failedCount === 0) {
            return;
        }
        this.confirm
            .confirm(`Retry ${gen.failedCount} failed instance(s)?`, 'Failed instances will re-render. Successful ones are left alone.')
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(ok => {
                if (!ok) {
                    return;
                }
                this.dispatchRetry(gen.id);
            });
    }

    onTabChange(tab: InstanceFilterTab): void {
        this.activeTab.set(tab);
    }

    private dispatchRetry(generationId: string): void {
        this.retryBusy.set(true);
        this.api.retryFailedInstances(generationId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (gen) => {
                    this.retryBusy.set(false);
                    this.generation.set(gen);
                    this.toast.success('Retry started -- status will update.');
                    this.refreshInstances$.next();
                },
                error: (err: Error) => {
                    this.retryBusy.set(false);
                    this.toast.error(err.message ?? 'Retry failed.');
                },
            });
    }

    private async maybeLoadTemplateName(templateId: string): Promise<void> {
        if (!templateId || this.templateName() !== null) {
            return;
        }
        try {
            const tpl = await firstValueFrom(this.templates.get(templateId));
            this.templateName.set(tpl?.name ?? null);
        } catch {
            // Template lookup is decorative -- failure leaves the
            // status card showing the raw uuid, which is acceptable.
        }
    }

    private fetchInstancesNow$() {
        this.instancesLoading.set(true);
        return this.api
            .listDocumentInstances({
                generationId: this.generationId(),
                limit: INSTANCE_PAGE_LIMIT,
                page: 1,
                sortKey: 'generatedAt',
                sortDir: 'desc',
            })
            .pipe(
                tap(res => {
                    this.instances.set(res.items);
                    this.instancesLoading.set(false);
                }),
                catchError(() => {
                    this.instancesLoading.set(false);
                    return of(null);
                }),
            );
    }

    private tabMatches(tab: Exclude<InstanceFilterTab, 'all'>, status: string): boolean {
        if (tab === 'failed') {
            return status === 'failed';
        }
        if (tab === 'pending') {
            return status === 'pending';
        }
        return status === 'rendered';
    }

    private flattenRecord(rec: Record<string, unknown> | undefined): Array<{ key: string; value: string }> {
        if (!rec) {
            return [];
        }
        return Object.entries(rec).map(([key, value]) => ({
            key,
            value: this.stringifyValue(value),
        }));
    }

    private stringifyValue(value: unknown): string {
        if (value === null || value === undefined) {
            return '—';
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
}
