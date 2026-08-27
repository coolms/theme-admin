import {
    inject,
    Injectable,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, AuthState, ErrorHandlerService, NaviGraphNode } from '@coolms/core-angular';
import {
    DeleteNodeDialogComponent,
    DeleteNodeDialogData,
    DeleteNodeDialogResult,
    FileEditorRegistry,
    NativeDialogService,
    VfsFileKind,
    VfsNodeDto,
} from '@coolms/ui-angular';
import { VfsPageStateService } from './vfs-page-state.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsChmodDialogComponent, ChmodPayload } from './dialogs/vfs-chmod-dialog.component';
import { VfsChownDialogComponent, ChownPayload } from './dialogs/vfs-chown-dialog.component';
import { VfsResourceMetaDialogComponent } from './dialogs/vfs-resource-meta-dialog.component';
import { validateFilename } from './validators/filename.validator';

@Injectable()
export class VfsActionsService {
    private readonly http           = inject(HttpClient);
    private readonly store          = inject(Store);
    private readonly state          = inject(VfsPageStateService);
    private readonly errors         = inject(ErrorHandlerService);
    private readonly nativeDialog   = inject(NativeDialogService);
    private readonly dialog         = inject(Dialog);
    private readonly editorRegistry = inject(FileEditorRegistry);
    private readonly clipboard      = inject(VfsClipboardService);

    execute(action: NaviGraphNode, target: VfsNodeDto | null): void {
        // Guard destructive operations on system nodes before dispatching.
        const actionKey      = action.meta['action'] as string;
        const isDestructive  = actionKey === 'VfsRename' || actionKey === 'VfsDelete';
        if (isDestructive && target?.isSystem) {
            void this.nativeDialog.confirm({
                title:        'System Node',
                message:      `"${target.name}" is a system node and cannot be modified or deleted.`,
                confirmLabel: 'OK',
                cancelLabel:  '',
            });
            return;
        }

        switch (actionKey) {
            case 'VfsNewFolder':     void this.newFolder();                                     break;
            case 'VfsNewFile':       void this.newFile();                                       break;
            case 'VfsRename':        if (target) void this.rename(target);                      break;
            case 'VfsDelete':        if (target) void this.confirmDelete(target);               break;
            case 'VfsDownload':      if (target) this.download(target);                         break;
            case 'VfsChmod':         if (target) void this.chmod(target);                       break;
            case 'VfsChown':         if (target) void this.chown(target);                       break;
            case 'VfsToggleHidden':  if (target) void this.toggleHidden(target);                break;
            case 'VfsCut':           if (target) this.clipboard.cut([target]);                  break;
            case 'VfsCopy':          if (target) this.clipboard.copy([target]);                 break;
            // Legacy entry — kept so anything seeded against the old action
            // still dispatches. `VfsOpenEditor` is the canonical generic
            // action going forward (it's what the new NaviGraph YAML emits).
            case 'VfsEditResource':
                if (!target || !target.permissions.read) break;
                if (target.type === 'resource') {
                    this.dialog.open(VfsResourceMetaDialogComponent, { data: { node: target } });
                } else {
                    this.editorRegistry.openFor(target);
                }
                break;
            case 'VfsOpenEditor':
                if (!target || !target.permissions.read) break;
                if (target.type === 'resource') {
                    // Resources still use the dedicated meta dialog regardless of registry
                    this.dialog.open(VfsResourceMetaDialogComponent, { data: { node: target } });
                } else {
                    this.editorRegistry.openFor(target);
                }
                break;
            case 'VfsOpenAsFolder': {
                if (!target) break;
                const path = target.path.startsWith('/') ? target.path : '/' + target.path;
                this.state.navigateTo(path);
                break;
            }
            case 'VfsPaste':
                void this.clipboard.paste(this.state.currentPath());
                break;
            case 'VfsProperties':
                if (target) this.openProperties(target);
                break;
        }
    }

    private openProperties(node: VfsNodeDto): void {
        this.state.selectNode(node);
        this.state.activeItem.set(node);
        // Right-panel decoupling: panel visibility is now an
        // explicit signal. Properties is the canonical open path —
        // selection alone no longer auto-opens the panel.
        this.state.panelOpen.set(true);
    }

    async newFolder(): Promise<void> {
        const name = await this.nativeDialog.input({
            title:        'New Folder',
            label:        'Folder name',
            placeholder:  'e.g. my-folder',
            confirmLabel: 'Create',
            required:     true,
            validator:    validateFilename,
        });
        if (!name) return;

        const currentPath = this.state.currentPath();
        const path        = currentPath.replace(/\/$/, '') + '/' + name;
        const url         = `${this.baseUrl()}/vfs/directories`;

        this.http.post(url, { path }).subscribe({
            next:  () => this.reload(),
            error: err => { if (this.isAuthenticated()) void this.showError(err); },
        });
    }

    /**
     * The kinds installed modules can create, fetched once (#2056).
     *
     * Cached as the PROMISE, not the result: New File can be clicked twice
     * before the first response lands, and caching the result would fire a
     * second request that the second dialog would then wait on.
     *
     * A failure resolves to an empty list rather than rejecting — the menu
     * degrades to a plain empty file, which is what this action did before any
     * module could contribute to it. Blocking file creation on a metadata fetch
     * would be a worse answer than offering fewer options.
     */
    private fileKindsPromise?: Promise<VfsFileKind[]>;

    private fileKinds(): Promise<VfsFileKind[]> {
        this.fileKindsPromise ??= firstValueFrom(
            this.http.get<{ kinds: VfsFileKind[] }>(`${this.baseUrl()}/vfs/file-kinds`),
        )
            .then(res => res.kinds ?? [])
            .catch(() => []);

        return this.fileKindsPromise;
    }

    async newFile(): Promise<void> {
        const kinds = await this.fileKinds();

        // No module offers anything: keep the plain prompt rather than a select
        // the operator can only agree with — and keep its filename validator,
        // which is correct for a path and wrong for a title.
        if (0 === kinds.length) {
            await this.createEmptyFile();

            return;
        }

        const result = await this.nativeDialog.inputWithSelect({
            title:       'New File',
            selectLabel: 'Type',
            choices: [
                { value: '', label: 'Empty file' },
                ...kinds.map(k => ({ value: k.id, label: k.label })),
            ],
            initialChoice: '',
            label:         'Name',
            placeholder:   'e.g. readme.md',
            confirmLabel:  'Create',
            required:      true,
            // Deliberately NO validator. The dialog has one field serving two
            // meanings: a FILENAME for an empty file, and a human TITLE for a
            // module kind, which the server slugs with national
            // transliteration. Applying `validateFilename` to both would refuse
            // "Договор аренды" — a perfectly good document name — so the empty
            // file branch validates below instead.
        });
        if (null === result || '' === result.value.trim()) return;

        const kind = kinds.find(k => k.id === result.choice);
        if (undefined === kind) {
            await this.createEmptyFile(result.value.trim());

            return;
        }

        // The MODULE creates it, at its own endpoint, with its own slugging,
        // seeding, mime stamping and conflict handling. VFS only knew the menu.
        this.http.post(kind.endpoint, {
            ...kind.payload,
            [kind.nameField]:   result.value.trim(),
            // `|| '/'` because the ROOT is the one path where stripping the
            // trailing slash empties the string, and the folder travels ALONE
            // here rather than being concatenated with a filename the way the
            // other create actions do — so an empty one is refused by the
            // module with "the folderPath field is required" instead of
            // quietly becoming a relative path. Caught in the browser at the
            // VFS root; no unit test would have stood there.
            [kind.folderField]: this.state.currentPath().replace(/\/+$/, '') || '/',
        }, {
            headers: { 'Content-Type': 'application/ld+json', Accept: 'application/json' },
        }).subscribe({
            next: (created: { path?: string }) => {
                this.reload();
                void this.openCreated(created.path);
            },
            error: err => { if (this.isAuthenticated()) void this.showError(err); },
        });
    }

    /**
     * Open a just-created file in whatever editor its format registered.
     *
     * A brand-new document is empty, so the only useful next step is writing
     * it — the same reasoning the Documents explorer applies after its own
     * create. The NODE is re-fetched rather than assembled from the create
     * response: `FileEditorRegistry.openFor()` takes a `VfsNodeDto` and keys on
     * its mime and permissions, and a hand-built stand-in would be a second
     * source of truth for both.
     *
     * Failures are SWALLOWED. The file exists and the listing already shows it,
     * so an error here would report a problem the operator does not have — they
     * can open it themselves. Only the convenience is lost.
     */
    private async openCreated(path?: string): Promise<void> {
        if (undefined === path || '' === path) return;

        try {
            const node = await firstValueFrom(this.http.get<VfsNodeDto>(
                `${this.baseUrl()}/vfs/files`,
                { params: { path } },
            ));
            if (node.permissions?.read) {
                this.editorRegistry.openFor(node);
            }
        } catch {
            // Created and listed; opening is a convenience, not the outcome.
        }
    }

    /** The original New File: a blank node at a path the operator spells out. */
    private async createEmptyFile(typed?: string): Promise<void> {
        const name = typed ?? await this.nativeDialog.input({
            title:        'New File',
            label:        'File name',
            placeholder:  'e.g. readme.md',
            confirmLabel: 'Create',
            required:     true,
            validator:    validateFilename,
        });
        if (!name) return;

        // Validated HERE when the name came from the type-picking dialog, which
        // cannot run the filename rule without also imposing it on titles.
        const invalid = validateFilename(name);
        if (null !== invalid) {
            void this.showError(new Error(invalid));

            return;
        }

        const currentPath = this.state.currentPath();
        const path        = currentPath.replace(/\/$/, '') + '/' + name;
        const url         = `${this.baseUrl()}/vfs/files`;

        this.http.post(url, { path, content: '', mode: '0644' }).subscribe({
            next:  () => this.reload(),
            error: err => { if (this.isAuthenticated()) void this.showError(err); },
        });
    }

    async rename(node: VfsNodeDto): Promise<void> {
        const newName = await this.nativeDialog.input({
            title:        'Rename',
            label:        'New name',
            initialValue: node.name,
            confirmLabel: 'Rename',
            required:     true,
            validator:    validateFilename,
        });
        if (!newName || newName === node.name) return;

        const parentPath = node.path.substring(0, node.path.lastIndexOf('/')) || '/';
        const target     = parentPath.replace(/\/$/, '') + '/' + newName;
        const url        = `${this.baseUrl()}/vfs/files/move`;

        this.http.post(url, { source: node.path, target }).subscribe({
            next:  () => this.reload(),
            error: err => { if (this.isAuthenticated()) void this.showError(err); },
        });
    }

    async confirmDelete(node: VfsNodeDto): Promise<void> {
        const isDir = node.type === 'directory';

        const ref = this.dialog.open<DeleteNodeDialogResult | null, DeleteNodeDialogData>(
            DeleteNodeDialogComponent,
            {
                data: {
                    name:           node.name,
                    message:        isDir
                        ? 'This action cannot be undone. All contents will be permanently deleted.'
                        : 'This action cannot be undone.',
                    showRecursive:  isDir,
                    recursiveLabel: 'Delete all contents recursively',
                } satisfies DeleteNodeDialogData,
            },
        );

        const result = await firstValueFrom(ref.closed);
        if (result) this.delete(node, result.recursive);
    }

    download(node: VfsNodeDto): void {
        const url   = `${this.baseUrl()}/vfs/files/download?path=${encodeURIComponent(node.path)}`;
        const token = this.store.selectSnapshot(AuthState.accessToken);

        this.http.get(url, {
            responseType: 'blob',
            headers: { Authorization: `Bearer ${token ?? ''}` },
        }).subscribe(blob => {
            const a    = document.createElement('a');
            a.href     = URL.createObjectURL(blob);
            a.download = node.name;
            a.click();
            URL.revokeObjectURL(a.href);
        });
    }

    chmod(node: VfsNodeDto): Promise<void> {
        // A3: opened via CDK Dialog so it renders the platform <app-modal> chrome.
        const ref = this.dialog.open<ChmodPayload | null>(VfsChmodDialogComponent, {
            data: {
                nodeName:    node.name,
                initialMode: node.mode,
                isDirectory: node.type === 'directory',
            },
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        return new Promise(resolve => {
            ref.closed.subscribe(payload => {
                if (!payload) { resolve(); return; }

                const url  = `${this.baseUrl()}/vfs/files/permissions`;
                const body = { ...payload, path: node.path };

                this.http.patch(url, body, {
                    headers: { 'Content-Type': 'application/merge-patch+json' },
                }).subscribe({
                    next:  () => { this.reload(); resolve(); },
                    error: err => {
                        if (this.isAuthenticated()) void this.showError(err);
                        resolve();
                    },
                });
            });
        });
    }

    chown(node: VfsNodeDto): Promise<void> {
        // A3: opened via CDK Dialog so it renders the platform <app-modal> chrome.
        const ref = this.dialog.open<ChownPayload | null>(VfsChownDialogComponent, {
            data: {
                nodeName:    node.name,
                initialUid:  node.uid,
                initialGid:  node.gid,
                isDirectory: node.type === 'directory',
            },
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        return new Promise(resolve => {
            ref.closed.subscribe(payload => {
                if (!payload) { resolve(); return; }

                const url  = `${this.baseUrl()}/vfs/files/owner`;
                const body = { ...payload, path: node.path };

                this.http.patch(url, body, {
                    headers: { 'Content-Type': 'application/merge-patch+json' },
                }).subscribe({
                    next:  () => { this.reload(); resolve(); },
                    error: err => {
                        if (this.isAuthenticated()) void this.showError(err);
                        resolve();
                    },
                });
            });
        });
    }

    async toggleHidden(node: VfsNodeDto): Promise<void> {
        const hide    = !node.isHidden;
        const verb    = hide ? 'Hide' : 'Show';
        const message = hide
            ? `Hide "${node.name}"? It will no longer appear in regular directory listings.`
            : `Show "${node.name}"? It will appear in regular directory listings.`;

        const confirmed = await this.nativeDialog.confirm({
            title:        `${verb} "${node.name}"`,
            message,
            confirmLabel: verb,
        });
        if (!confirmed) return;

        const url  = `${this.baseUrl()}/vfs/files/visibility`;
        const body = { path: node.path, hidden: hide };

        this.http.patch(url, body).subscribe({
            next:  () => this.reload(),
            error: err => { if (this.isAuthenticated()) void this.showError(err); },
        });
    }

    private delete(node: VfsNodeDto, recursive = false): void {
        const segment = node.type === 'directory' ? 'directories' : 'files';
        const params  = new URLSearchParams({ path: node.path });
        if (recursive && node.type === 'directory') params.set('recursive', 'true');
        const url = `${this.baseUrl()}/vfs/${segment}?${params.toString()}`;

        this.http.delete(url).subscribe({
            next:  () => this.reload(),
            error: err => { if (this.isAuthenticated()) void this.showError(err); },
        });
    }

    /** True when the user is still logged in (interceptor has not dispatched Logout yet). */
    private isAuthenticated(): boolean {
        return !!this.store.selectSnapshot(AuthState.accessToken);
    }

    private showError(err: unknown): Promise<boolean> {
        return this.nativeDialog.confirm({
            title:        'Error',
            message:      this.errors.humanize(err),
            confirmLabel: 'OK',
            cancelLabel:  '',
        });
    }

    private baseUrl(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '';
    }

    private reload(): void {
        this.state.reload();
    }
}
