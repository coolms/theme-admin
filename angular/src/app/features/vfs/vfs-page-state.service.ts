import { DestroyRef, computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { AppConfigState, ErrorHandlerService, NaviGraphNode } from '@coolms/core-angular';
import { VfsHomeLabelService } from './vfs-home-label.service';
import { UploadItem, VfsDirectoryPage, VfsNodeDto, VfsViewMode } from '@coolms/ui-angular';

/**
 * Scoped shared state for the VFS File Manager page.
 *
 * Provided in VfsManagerComponent's `providers` array so every slot component
 * loaded under the page's DI tree (VfsTree, VfsGrid, VfsFileDetail) can inject
 * it without any prop-drilling.
 *
 * Replaces VfsManagerState (NGXS) — all directory loading, selection, view mode,
 * and upload tracking now live here as plain Angular signals.
 */
@Injectable()
export class VfsPageStateService {
    private readonly http       = inject(HttpClient);
    private readonly store      = inject(Store);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly homeLabels = inject(VfsHomeLabelService);

    // ── Navigation & directory state ──────────────────────────────────────────

    readonly currentPath   = signal<string>('/');
    readonly nodes         = signal<VfsNodeDto[]>([]);
    readonly loading       = signal<boolean>(false);
    readonly error         = signal<string | null>(null);

    // ── Pagination ────────────────────────────────────────────────────────────

    /** Whether there are more items beyond the currently loaded set. */
    readonly hasMore    = signal<boolean>(false);
    /** Opaque cursor token for the next page; null when there is no next page. */
    readonly nextCursor = signal<string | null>(null);

    // ── Selection & view ──────────────────────────────────────────────────────

    readonly selectedNodes = signal<VfsNodeDto[]>([]);
    readonly viewMode      = signal<VfsViewMode>('grid');
    readonly showHidden    = signal<boolean>(false);

    /** Active node shown in the right detail panel (replaces DrawerService). */
    readonly activeItem    = signal<VfsNodeDto | null>(null);

    /**
     * Right-panel decoupling: panel visibility is now an explicit
     * signal rather than implicit on selection. Open via the
     * Properties action (toolbar or context menu), close via the
     * panel's Close X / ESC. Mirrors Document Library's
     * `propertiesPanelOpen` pattern post-Phase D hotfix #3.
     */
    readonly panelOpen     = signal<boolean>(false);

    /**
     * NaviGraph node whose meta drives the right-panel header. Reads
     * the `VfsProperties` action node from `vfsToolbarNodes` so the
     * panel's icon + title come from the same source of truth that
     * builds the toolbar / context menu buttons.
     */
    readonly panelNode = computed<NaviGraphNode | null>(() => {
        if (!this.panelOpen()) return null;
        return this.vfsToolbarNodes().find((n) => n.meta?.['action'] === 'VfsProperties') ?? null;
    });

    // ── Upload tracking ───────────────────────────────────────────────────────

    readonly uploads       = signal<UploadItem[]>([]);

    /**
     * NaviGraph nodes for `navi.toolbar.vfs`, set once by VfsManagerComponent
     * on init. Consumed by both the toolbar and the canonical context menu so
     * the tree fetch happens once per page mount.
     */
    readonly vfsToolbarNodes = signal<readonly NaviGraphNode[]>([]);

    /**
     * Incremented after every successful loadPage() response.
     * VfsTreeComponent subscribes (skip initial 0) to refresh its own children.
     */
    readonly reloadTrigger = signal(0);

    // ── Action subjects ────────────────────────────────────────────────────────

    /** Toolbar or drop-zone triggers a file-input click. */
    readonly uploadRequested$ = new Subject<void>();

    /** Files dropped on the grid drop-zone. */
    readonly filesDropped$    = new Subject<File[]>();

    // ── Navigation ────────────────────────────────────────────────────────────

    navigateTo(path: string): void {
        this.currentPath.set(path);
        this.selectedNodes.set([]);
        this.loadDirectory(path);
    }

    /**
     * Open `directory` and select the child called `name` once the
     * listing lands.
     *
     * `?path=` is a DIRECTORY contract: the list endpoint answers
     * "'…/x.docx' is not a directory" when handed a file, so a deep link
     * that knows a FILE — a notification announcing a generated document
     * (#1668) — passes the folder in `path` and the file name in
     * `select`. Selection has to wait for the HTTP response because the
     * node objects only exist once the page is loaded.
     */
    revealInDirectory(directory: string, name: string): void {
        // AFTER navigateTo: loadDirectory clears any pending reveal, so a
        // stale name can never select something in a folder the user
        // navigates to later.
        this.navigateTo(directory);
        this.pendingReveal = name;
    }

    /** Re-load the current directory (call after create/delete/rename/upload). */
    reload(): void {
        this.loadDirectory(this.currentPath());
    }

    /**
     * Append the next page of items to the current node list.
     * No-op when already loading, no cursor is available, or there is no next page.
     */
    loadMore(): void {
        const cursor = this.nextCursor();
        if (!cursor || !this.hasMore() || this.loading()) return;
        this.loadPage(this.currentPath(), cursor);
    }

    private loadDirectory(path: string): void {
        // Reset pagination state on every new directory navigation
        this.hasMore.set(false);
        this.nextCursor.set(null);
        this.pendingReveal = null;
        this.loadPage(path);
    }

    /**
     * File name a deep link asked us to select, pending the listing that
     * will contain it. Not a signal: nothing renders it, and it must not
     * participate in change detection.
     */
    private pendingReveal: string | null = null;

    /**
     * Select the pending deep-link target if this page carried it.
     *
     * Directories page at 100 entries, so the target may legitimately be
     * on a later page — keep waiting while more can arrive, and drop the
     * request once the listing is exhausted rather than letting a name
     * that was never here linger.
     */
    private consumePendingReveal(page: readonly VfsNodeDto[]): void {
        if (this.pendingReveal === null) return;

        const match = page.find(n => n.name === this.pendingReveal);
        if (match) {
            this.pendingReveal = null;
            this.selectedNodes.set([match]);
            return;
        }
        if (!this.hasMore()) this.pendingReveal = null;
    }

    private loadPage(path: string, cursor?: string): void {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const baseUrl  = manifest?.apiBase ?? '';

        // Guard: skip when manifest hasn't been loaded yet (auth failure on bootstrap).
        if (!baseUrl) {
            this.loading.set(false);
            this.error.set(null);
            return;
        }

        this.loading.set(true);
        this.error.set(null);

        const showHidden = this.showHidden();
        let url = `${baseUrl}/vfs/directories/list?path=${encodeURIComponent(path)}&showHidden=${showHidden}&limit=100`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

        this.http.get<VfsDirectoryPage>(url, {
            headers: { Accept: 'application/ld+json' },
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: r => {
                const raw   = Array.isArray(r.member) ? r.member : [];
                const sorted = [...raw].sort((a, b) => {
                    if (a.type === 'directory' && b.type !== 'directory') return -1;
                    if (a.type !== 'directory' && b.type === 'directory') return 1;
                    return a.name.localeCompare(b.name);
                });

                if (cursor) {
                    // Append new page at the end, preserving sort within the new items
                    this.nodes.update(prev => [...prev, ...sorted]);
                } else {
                    this.nodes.set(sorted);
                }

                this.hasMore.set(r.hasMore ?? false);
                this.nextCursor.set(r.nextCursor ?? null);
                this.homeLabels.register(sorted);
                this.consumePendingReveal(sorted);
                this.loading.set(false);
                this.reloadTrigger.update(v => v + 1);
            },
            error: err => {
                this.error.set(this.errors.humanize(err));
                this.loading.set(false);
            },
        });
    }

    // ── Selection ─────────────────────────────────────────────────────────────

    selectNode(node: VfsNodeDto): void {
        this.selectedNodes.set([node]);
    }

    setSelection(nodes: VfsNodeDto[]): void {
        this.selectedNodes.set(nodes);
    }

    clearSelection(): void {
        this.selectedNodes.set([]);
    }

    // ── View mode ─────────────────────────────────────────────────────────────

    setViewMode(mode: VfsViewMode): void {
        this.viewMode.set(mode);
    }

    toggleShowHidden(): void {
        this.showHidden.update(v => !v);
        this.loadDirectory(this.currentPath());
    }

    // ── Upload tracking ───────────────────────────────────────────────────────

    startUpload(item: UploadItem): void {
        this.uploads.update(arr => [...arr, item]);
    }

    updateUpload(id: string, progress: number, status: UploadItem['status'], error?: string): void {
        this.uploads.update(arr =>
            arr.map(u => u.id === id ? { ...u, progress, status, error } : u),
        );
    }

    clearUploads(): void {
        this.uploads.set([]);
    }
}
