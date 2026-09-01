import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    OnInit,
    computed,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import { refreshDocumentFonts } from '@coolms/editor-angular';
import {
    CmsListPageComponent,
    DataGridComponent,
    PageTitleService,
    ToastService,
    type DataGridData,
} from '@coolms/ui-angular';
import {
    DocumentFontService,
    type CatalogueFamilyDto,
    type DocumentFontFamilyDto,
} from './document-font.service';

/**
 * Installed document fonts (/admin/content/document-fonts, ).
 *
 * The operator surface over the font store: what is installed, install another,
 * remove one. The families the platform SHIPS are not here and cannot be — they
 * are built into the renderer's image, and an install may not shadow one of
 * them (the editor would measure the upload and the renderer would print the
 * image's copy).
 *
 * ##  The upload form has ONE field
 *
 * A file, and nothing else. The family and the face are read from the font's
 * own tables on the server, so four uploads assemble one family without anybody
 * typing "bold" — and a field naming the family would be stating something the
 * bytes could contradict. What it turned out to be is REPORTED back in the
 * toast.
 *
 * ## The catalogue
 *
 * "Browse Google Fonts" opens a panel over the same page. The list comes from
 * the server, which reduces 1,942 families to name, category and the faces this
 * platform can hold, and marks the ones already here so the panel does not
 * offer something that would be refused a moment later.
 *
 *  An unreachable catalogue is a LINE IN THE PANEL, not an error toast. An
 * installation with no outbound network still installs fonts by upload, and a
 * red toast would say the page is broken when it is not.
 *
 * ##  An install refreshes the editor's registry
 *
 * `document-fonts.ts` memoises the merged registry for the life of the page. An
 * author who installs a font and then opens a document in the same session
 * would not see it in the toolbar without this.
 */
@Component({
    selector: 'coolms-admin-document-fonts',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="Document fonts"
            icon="fonts"
            subtitle="Fonts installed on this instance — the families the platform ships are always available and are not listed here"
            toolbarTreeSlug="navi.toolbar.document.fonts"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="document:fonts"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowSelected)="selectedRow.set($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>

        @if (browsing()) {
            <div class="catalogue-backdrop" (click)="browsing.set(false)"></div>
            <section class="catalogue" role="dialog" aria-label="Browse Google Fonts">
                <header>
                    <h2>Browse Google Fonts</h2>
                    <button type="button" class="close" (click)="browsing.set(false)">&times;</button>
                </header>
                <input
                    type="search"
                    placeholder="Search families"
                    [value]="catalogueQuery()"
                    (input)="onCatalogueQuery($event)" />
                @if (catalogueReason(); as reason) {
                    <p class="unavailable">{{ reason }}</p>
                }
                @if (catalogueLoading()) {
                    <p class="hint">Loading&hellip;</p>
                } @else {
                    <ul>
                        @for (entry of catalogue(); track entry.family) {
                            <li>
                                <span class="name">{{ entry.family }}</span>
                                <span class="meta">{{ entry.category }} &middot; {{ entry.faces.join(', ') }}</span>
                                @if (entry.installed) {
                                    <span class="already">Installed</span>
                                } @else {
                                    <button
                                        type="button"
                                        [disabled]="installing() === entry.family"
                                        (click)="installFromCatalogue(entry.family)">
                                        {{ installing() === entry.family ? 'Installing...' : 'Install' }}
                                    </button>
                                }
                            </li>
                        } @empty {
                            <li class="hint">Nothing matches that.</li>
                        }
                    </ul>
                }
            </section>
        }

        <!-- Off-screen rather than hidden: a display:none input cannot be
             opened by .click() in every browser, and a dialog around one file
             field would be a dialog around nothing. -->
        <input
            #picker
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf,application/font-sfnt"
            style="position:absolute;left:-9999px;width:1px;height:1px"
            (change)="onFileChosen($event)" />
    `,
    styles: [
        ':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }',
        // --cms-* is CHROME, not paper: this panel is admin furniture and has
        // to follow the theme, dark mode included.
        '.catalogue-backdrop { position: fixed; inset: 0; background: var(--cms-overlay-scrim); z-index: 40; }',
        '.catalogue { position: fixed; top: 10vh; left: 50%; transform: translateX(-50%);'
            + ' width: min(560px, 92vw); max-height: 74vh; overflow: auto; z-index: 41;'
            + ' background: var(--cms-surface); color: var(--cms-text);'
            + ' border: 1px solid var(--cms-border); border-radius: .5rem; padding: 1rem; }',
        '.catalogue header { display: flex; align-items: center; justify-content: space-between; }',
        '.catalogue h2 { font-size: 1rem; margin: 0 0 .5rem; }',
        '.catalogue .close { background: none; border: 0; color: inherit; font-size: 1.25rem; cursor: pointer; }',
        '.catalogue input[type=search] { width: 100%; padding: .4rem .6rem; margin-bottom: .75rem;'
            + ' background: var(--cms-input-bg, transparent); color: inherit;'
            + ' border: 1px solid var(--cms-border); border-radius: .25rem; }',
        '.catalogue ul { list-style: none; margin: 0; padding: 0; }',
        '.catalogue li { display: flex; align-items: center; gap: .5rem; padding: .4rem 0;'
            + ' border-bottom: 1px solid var(--cms-border); }',
        '.catalogue .name { font-weight: 600; }',
        '.catalogue .meta { flex: 1; opacity: .7; font-size: .85em; }',
        '.catalogue .already { opacity: .6; font-size: .85em; }',
        '.catalogue .hint, .catalogue .unavailable { opacity: .7; font-size: .9em; }',
    ],
})
export class DocumentFontsPageComponent implements OnInit {
    private readonly api = inject(DocumentFontService);
    private readonly store = inject(Store);
    private readonly toast = inject(ToastService);
    private readonly titleSvc = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');

    readonly families = signal<DocumentFontFamilyDto[]>([]);
    readonly loading = signal(true);
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    readonly browsing = signal(false);
    readonly catalogue = signal<readonly CatalogueFamilyDto[]>([]);
    readonly catalogueQuery = signal('');
    readonly catalogueLoading = signal(false);
    readonly catalogueReason = signal<string | null>(null);
    readonly installing = signal<string | null>(null);

    private catalogueTimer: ReturnType<typeof setTimeout> | null = null;

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    readonly gridData = computed((): DataGridData => {
        const rows = this.families().map(entry => {
            const bytes = entry.faces.reduce((sum, face) => sum + face.bytes, 0);

            return {
                // The FAMILY is the key: datagrid selection reads `row['id']`,
                // and without it every row shares '' and nothing selects.
                id:          entry.family,
                family:      entry.family,
                faces:       entry.faces.map(face => face.face).join(', '),
                files:       entry.faces.map(face => face.fileName).join(', '),
                size:        formatSize(bytes),
                sizeBytes:   bytes,
                // The whole family arrived when its FIRST face did.
                installedAt: entry.faces.map(face => face.installedAt).sort()[0] ?? '',
            };
        });

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
        const n = this.families().length;

        return n === 0 ? '' : `${n} famil${n === 1 ? 'y' : 'ies'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Document fonts');
        this.load();
    }

    onToolbarAction(id: string): void {
        if (id === 'install') { this.picker().nativeElement.click(); return; }
        if (id === 'browse') { this.browsing.set(true); this.loadCatalogue(); return; }
        if (id === 'reload') { this.load(); return; }
        if (id === 'remove') {
            const family = this.selectedRow()?.['id'];
            if (typeof family === 'string') this.remove(family);
        }
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action !== 'remove') return;
        const family = event.row['id'];
        if (typeof family === 'string') this.remove(family);
    }

    onFileChosen(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        // Cleared either way, so choosing the SAME file twice fires `change`
        // again — which is exactly what re-uploading a corrected face is.
        input.value = '';
        if (!file) return;

        this.api.install(file).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: installed => {
                // What it turned out to be, not what the file was called.
                this.toast.success(
                    `Installed ${installed.family} (${installed.face}) from ${installed.fileName}`,
                );
                refreshDocumentFonts();
                this.load();
            },
            error: (failure: { error?: { detail?: string } }) =>
                // The server's own reason: the wrong kind of file, a family the
                // platform already ships, a face too large to travel inside a
                // document. A generic toast here is a support ticket.
                this.toast.error(failure.error?.detail ?? 'The font could not be installed'),
        });
    }

    /**
     *  Debounced, and the timer is cleared before a new one is set.
     *
     * The catalogue is 1,942 families and the endpoint filters server-side, so
     * a request per keystroke is a request per keystroke -- and the answers can
     * arrive out of order, which shows the wrong list for the query on screen.
     */
    onCatalogueQuery(event: Event): void {
        this.catalogueQuery.set((event.target as HTMLInputElement).value);

        if (this.catalogueTimer !== null) clearTimeout(this.catalogueTimer);
        this.catalogueTimer = setTimeout(() => this.loadCatalogue(), 250);
    }

    installFromCatalogue(family: string): void {
        this.installing.set(family);
        this.api.installFromCatalogue(family).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: result => {
                this.installing.set(null);
                this.toast.success(
                    'Installed ' + result.installed.join(', ') + ' -- ' + result.faces + ' face(s)',
                );
                refreshDocumentFonts();
                this.load();
                this.loadCatalogue();
            },
            error: (failure: { error?: { detail?: string } }) => {
                this.installing.set(null);
                // The server's own reason -- "CoolMS already ships it" and
                // "already installed here" are different facts.
                this.toast.error(failure.error?.detail ?? 'The font could not be installed');
            },
        });
    }

    private loadCatalogue(): void {
        this.catalogueLoading.set(true);
        this.api.browseCatalogue(this.catalogueQuery()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: result => {
                this.catalogueLoading.set(false);
                this.catalogue.set(result.families);
                //  Not an error toast. An installation with no outbound
                // network still installs fonts by upload; saying so in the
                // panel is the truth, and a red toast would not be.
                this.catalogueReason.set(result.available ? null : (result.reason ?? 'The catalogue is not reachable.'));
            },
            error: () => {
                this.catalogueLoading.set(false);
                this.catalogue.set([]);
                this.catalogueReason.set('The catalogue is not reachable.');
            },
        });
    }

    private remove(family: string): void {
        this.api.remove(family).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: result => {
                this.toast.success(`Removed ${result.family} and its ${result.removed} face(s)`);
                refreshDocumentFonts();
                this.load();
            },
            error: () => this.toast.error(`Failed to remove ${family}`),
        });
    }

    private load(): void {
        this.loading.set(true);
        this.selectedRow.set(null);
        this.api.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: result => { this.families.set(result.families); this.loading.set(false); },
            error: () => { this.loading.set(false); this.toast.error('Failed to load installed fonts'); },
        });
    }
}

/** Bytes to a compact human size. Matches the backups page's feel. */
function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let n = bytes / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }

    return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}
