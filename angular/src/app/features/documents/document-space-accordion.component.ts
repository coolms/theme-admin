import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { Store } from '@ngxs/store';
import { AppConfigState, AuthState } from '@coolms/core-angular';
import {
    ContextMenuService,
    ExplorerAccordionComponent,
    SpaceDto,
    SpaceSelectionStore,
} from '@coolms/ui-angular';
import { DocumentFoldersTreeComponent } from './explorer/document-folders-tree.component';
import { DocumentPageStateService } from './explorer/document-page-state.service';

/** One site document handling can still be turned on for. */
interface AvailableSite {
    readonly site: string;
    readonly label: string;
}

/**
 * !! Both collection keys, because API Platform's JSON-LD collection key
 * changed from `hydra:member` to `member` and a client reading only one of them
 * sees an empty list rather than an error on the other.
 */
interface AvailableSitesResponse {
    readonly member?: AvailableSite[];
    readonly 'hydra:member'?: AvailableSite[];
}

/**
 * Document Library left-pane wrapper. Composes the generic
 * {@link ExplorerAccordionComponent} with the existing
 * {@link DocumentFoldersTreeComponent}; each accordion section
 * represents one "space" (Personal, Shared, per-site). Selecting a
 * space rebinds the folder tree to that space's `rootPath` and
 * reloads.
 *
 * Spaces are fetched once on init from `GET /api/v1/document/spaces`.
 * When the manifest URL is absent (legacy installs without the
 * endpoint), the accordion falls back to a Shared + Personal pair so
 * the existing two-root experience still works.
 *
 * **Fetch/sort/restore now lives in {@link SpaceSelectionStore}**; what
 * remains here is the module-specific wiring -- the state service
 * (`currentPath`/`selectFolder`), the projected tree, and the legacy
 * fallback, which needs the signed-in user's id and so cannot be shared.
 *
 * Registered as `DocumentSpaceAccordion` in {@link app.config} so the
 * Document Library layout (`document:library` -> `content.panel.left`)
 * picks it up without further config changes.
 */
@Component({
    selector: 'app-document-space-accordion',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ExplorerAccordionComponent, DocumentFoldersTreeComponent],
    providers: [SpaceSelectionStore],
    template: `
        <app-explorer-accordion
            persistKey="document:spaces"
            [spaces]="spaces()"
            [activeKey]="activeSpaceKey()"
            (spaceContextMenu)="onSpaceContextMenu($event)"
            (spaceChange)="onSpaceChange($event)">
            <cms-document-folders-tree
                [embedded]="true"
                [rootPath]="activeRootPath()">
            </cms-document-folders-tree>
        </app-explorer-accordion>

        @if (canAddSpace()) {
            <div class="cms-add-space">
                @if (!picking()) {
                    <button type="button" class="btn btn-sm btn-link cms-add-space__toggle"
                            (click)="openPicker()" [disabled]="busy()">
                        <i class="bi bi-plus-lg" aria-hidden="true"></i> Add space
                    </button>
                } @else {
                    <div class="cms-add-space__panel">
                        <div class="cms-add-space__head">
                            <span class="text-secondary small">Turn documents on for</span>
                            <button type="button" class="btn btn-sm btn-link p-0" (click)="closePicker()">
                                <i class="bi bi-x-lg" aria-hidden="true"></i>
                            </button>
                        </div>
                        @if (error()) {
                            <p class="cms-add-space__error small mb-2">{{ error() }}</p>
                        }
                        @for (site of available(); track site.site) {
                            <button type="button" class="btn btn-sm btn-light w-100 text-start mb-1"
                                    [disabled]="busy()" (click)="enable(site.site)">
                                {{ site.label }}
                            </button>
                        } @empty {
                            <!-- ⚠️ Says which of the two empty answers this is.
                                 "Nothing here" would read the same whether every
                                 site already has documents or the request failed. -->
                            <p class="text-secondary small mb-0">
                                {{ error() ? 'Could not load the site list.' : 'Every site already has documents.' }}
                            </p>
                        }
                    </div>
                }
            </div>
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
        app-explorer-accordion { flex: 1; min-height: 0; overflow-y: auto; }
        .cms-add-space { border-top: 1px solid var(--cms-border, #dee2e6); padding: 0.5rem; flex: 0 0 auto; }
        .cms-add-space__toggle { text-decoration: none; }
        .cms-add-space__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
        .cms-add-space__error { color: var(--cms-danger-text, #b02a37); }
    `],
})
export class DocumentSpaceAccordionComponent implements OnInit {
    readonly state = inject(DocumentPageStateService);

    private readonly store = inject(SpaceSelectionStore);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly ngxs = inject(Store);

    readonly spaces = this.store.spaces;
    readonly activeSpaceKey = this.store.activeKey;

    /** Add-space picker state. */
    readonly picking = signal(false);

    readonly busy = signal(false);

    readonly error = signal<string | null>(null);

    readonly available = signal<AvailableSite[]>([]);

    private readonly http = inject(HttpClient);

    /**
     * rootPath of the currently active space, for the embedded folders tree.
     *
     * The `?? '/docs'` is a *rendering* default only -- the tree input needs
     * some string during the moment before the spaces response lands. Do not
     * reuse it to drive the currentPath bridge below; see the note there.
     */
    readonly activeRootPath = computed(() => this.store.activeRootPath() ?? '/docs');

    constructor() {
        // Keep DocumentPageStateService.currentPath in sync with the
        // active space root so the main folder-content view reflects
        // the selection (mirrors Media's currentDir bridge).
        //
        // Reads the store's nullable root, NOT activeRootPath() above: a
        // default here would make this effect's first flush -- which
        // happens before any space is resolved -- treat the restored
        // currentPath as out of scope and reset it to `/docs`, so a
        // reload always bounced the user back to Shared. Unknown space
        // means leave the restored path alone.
        effect(() => {
            const root = this.store.activeRootPath();
            if (null === root) {
                return;
            }
            // -- publish the space root for the breadcrumb, which
            // needs it to tell context from destination. This store is
            // provided on THIS component, so the main-slot grid cannot
            // reach it directly.
            this.state.spaceRoot.set(root);

            untracked(() => {
                const current = this.state.currentPath();
                if (current !== root && !current.startsWith(root + '/')) {
                    this.state.selectFolder(root);

                    return;
                }
                // -- a RESTORED path below the space root belongs to
                // the Documents view, same rule as clicking the folder.
                // Without this a reload highlighted the subfolder in the
                // tree while the pane showed the space's templates: two
                // surfaces disagreeing about where the user is.
                if (current.startsWith(root + '/')) {
                    this.state.enterSpaceDocuments(current);
                }
            });
        });
    }

    ngOnInit(): void {
        this.store.load({
            url: this.ngxs.selectSnapshot(AppConfigState.manifest)?.document?.spacesUrl,
            fallback: () => this.legacyFallback(),
            currentPath: () => this.state.currentPath(),
        });
    }

    // -- Adding a space -----------------------------------------------
    //
    // !! THIS EXISTS BECAUSE THE VISIBILITY RULE SHIPPED WITHOUT IT. The
    // accordion lists only sites where document handling is enabled, which is
    // right -- a site running a blog should not be offered a library it will
    // never use. But enabling one was a console command, so this screen could
    // only ever LOSE entries. A filtered list with no way to add to it is worse
    // than the dead end it replaced: before, a space could be reached and led
    // nowhere; after, it could not be reached and there was nothing to press.

    /**
     * Only when the endpoints are in the manifest.
     *
     * !! Hidden rather than shown-and-broken on an older backend: a button that
     * cannot work is the thing this whole change is about removing.
     */
    canAddSpace(): boolean {
        return Boolean(this.enablementUrl()) && Boolean(this.availableUrl());
    }

    openPicker(): void {
        this.picking.set(true);
        this.error.set(null);
        this.loadAvailable();
    }

    closePicker(): void {
        this.picking.set(false);
    }

    enable(site: string): void {
        const url = this.enablementUrl();
        if (!url || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.error.set(null);
        this.http.post(url, { site, enabled: true }).subscribe({
            next: () => {
                this.busy.set(false);
                this.picking.set(false);
                // !! Re-read the list from the server rather than appending
                // locally. The space's label, root path and writability are the
                // backend's answer, and a locally-invented row would differ from
                // what the next reload shows.
                this.store.load({
                    url: this.ngxs.selectSnapshot(AppConfigState.manifest)?.document?.spacesUrl,
                    fallback: () => this.legacyFallback(),
                    currentPath: () => this.state.currentPath(),
                });
            },
            error: (err: HttpErrorResponse) => {
                this.busy.set(false);
                // The server's own message: provisioning can fail for reasons
                // only it knows (permissions, a missing parent), and "could not
                // enable" would hide every one of them.
                this.error.set(this.messageFrom(err));
            },
        });
    }

    private loadAvailable(): void {
        const url = this.availableUrl();
        if (!url) {
            return;
        }

        this.busy.set(true);
        this.http.get<AvailableSitesResponse>(url).subscribe({
            next: (res) => {
                this.busy.set(false);
                this.available.set(res.member ?? res['hydra:member'] ?? []);
            },
            error: (err: HttpErrorResponse) => {
                this.busy.set(false);
                this.available.set([]);
                this.error.set(this.messageFrom(err));
            },
        });
    }

    private availableUrl(): string | undefined {
        return this.ngxs.selectSnapshot(AppConfigState.manifest)?.document?.spacesAvailableUrl;
    }

    private enablementUrl(): string | undefined {
        return this.ngxs.selectSnapshot(AppConfigState.manifest)?.document?.spaceEnablementUrl;
    }

    private messageFrom(err: HttpErrorResponse): string {
        const body = err.error as { detail?: string; 'hydra:description'?: string } | null;

        return body?.detail ?? body?.['hydra:description'] ?? err.message;
    }

    /**
     * Right-click on a space header.
     *
     * A space IS a folder -- its `rootPath` -- so it reuses the folder record
     * the folders tree already emits (`_kind: 'folder'` + `path`), which
     * means "Upload here" works on a space with no new NaviGraph node.
     *
     *  Opening the menu does NOT switch space, and that is a correction
     *: it used to, and a right-click that navigates is a right-click
     * that moved the floor -- dismissing the menu left the operator in a space
     * they never asked for. The reason the switch existed is still true, so it
     * happens at ACTION time instead: everything that reaches `dispatchAction`
     * reads the ACTIVE space, and running it against another one would file a
     * document in the wrong place silently.
     *
     * The two path-carrying actions need no switch at all -- they name the
     * folder they act on, which is the shape every action here should have.
     */
    onSpaceContextMenu(payload: { space: SpaceDto; event: MouseEvent }): void {
        const nodes = this.state.toolbarNodes();
        if (nodes.length === 0) {
            return;
        }
        payload.event.preventDefault();
        payload.event.stopPropagation();

        this.contextMenu.openFromNodes(
            payload.event,
            [...nodes],
            { _kind: 'folder', _surface: 'context', path: payload.space.rootPath },
            (action) => {
                if ('upload-here' === action) {
                    this.state.uploadToFolderRequested$.next(payload.space.rootPath);
                    return;
                }
                // -- new subfolder directly under the space root.
                if ('new-folder-here' === action) {
                    this.state.newFolderInRequested$.next(payload.space.rootPath);
                    return;
                }
                //  HERE, not when the menu opened. Everything reaching
                // this line acts on the ACTIVE space, so it has to be this
                // one -- but a right-click that navigated meant dismissing the
                // menu left the operator in a space they never asked for.
                if (payload.space.key !== this.activeSpaceKey()) {
                    this.onSpaceChange(payload.space.key);
                }
                this.state.dispatchAction(action);
            },
        );
    }

    onSpaceChange(key: string): void {
        const next = this.store.select(key);
        if (!next) return;
        // -- publish the NEW root BEFORE navigating. `selectFolder`
        // decides templates-vs-documents by comparing the target against
        // `spaceRoot`, and with the old root still in place a space switch
        // looked like a subfolder click and dropped the user into the
        // Documents view instead of that space's Templates.
        this.state.spaceRoot.set(next.rootPath);
        this.state.selectFolder(next.rootPath);
    }

    /**
     * Legacy fallback when the manifest doesn't expose `spacesUrl` --
     * surfaces the pre-H4 Shared + My Documents pair so the accordion
     * is still useful without the backend endpoint.
     */
    private legacyFallback(): SpaceDto[] {
        const u = this.ngxs.selectSnapshot(AuthState.currentUser);
        const out: SpaceDto[] = [
            { key: 'shared', label: 'Shared', rootPath: '/docs', badge: null, isWritable: true, priority: 20 },
        ];
        if (u?.id) {
            out.unshift({
                key: 'personal', label: 'Personal', rootPath: `/home/${u.id}/docs`,
                badge: null, isWritable: true, priority: 10,
            });
        }
        return out;
    }
}
