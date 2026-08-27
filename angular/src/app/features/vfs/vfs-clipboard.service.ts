import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import { NativeDialogService, VfsNodeDto } from '@coolms/ui-angular';
import { VfsPageStateService } from './vfs-page-state.service';
import { ConflictResult, VfsConflictDialogComponent } from './dialogs/vfs-conflict-dialog.component';

export type ClipboardMode = 'cut' | 'copy';

export interface ClipboardEntry {
    readonly mode:  ClipboardMode;
    readonly nodes: VfsNodeDto[];
}

@Injectable()
export class VfsClipboardService {
    private readonly store    = inject(Store);
    private readonly state    = inject(VfsPageStateService);
    private readonly http     = inject(HttpClient);
    private readonly errors    = inject(ErrorHandlerService);
    private readonly dialog    = inject(NativeDialogService);
    private readonly cdkDialog = inject(Dialog);

    clipboard = signal<ClipboardEntry | null>(null);

    hasCut  = computed(() => this.clipboard()?.mode === 'cut');
    hasCopy = computed(() => this.clipboard()?.mode === 'copy');
    hasAny  = computed(() => this.clipboard() !== null);

    /** Persisted conflict decision when user checks "Apply to all". Reset per paste(). */
    private lastConflictDecision: ConflictResult | null = null;

    cut(nodes: VfsNodeDto[]): void {
        this.clipboard.set({ mode: 'cut', nodes });
    }

    copy(nodes: VfsNodeDto[]): void {
        this.clipboard.set({ mode: 'copy', nodes });
    }

    clear(): void {
        this.clipboard.set(null);
    }

    /**
     * Paste clipboard contents into the target directory.
     * Resolves conflicts via VfsConflictDialogComponent.
     */
    async paste(targetDirPath: string): Promise<void> {
        const entry = this.clipboard();
        if (!entry) return;

        this.lastConflictDecision = null; // reset per paste operation

        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const base     = manifest?.apiBase ?? '';

        for (const node of entry.nodes) {
            const targetPath = this.buildTargetPath(node, targetDirPath);
            await this.executeTransfer(entry.mode, node.path, targetPath, base);
        }

        // After cut: clear clipboard
        if (entry.mode === 'cut') {
            this.clear();
        }

        // Reload current directory
        this.state.reload();
    }

    /**
     * Direct move (from DnD) — no clipboard involved.
     */
    async move(sourcePath: string, targetDirPath: string): Promise<void> {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const base     = manifest?.apiBase ?? '';
        const node     = { path: sourcePath, name: sourcePath.split('/').at(-1) ?? '' };
        const target   = this.buildTargetPath(node, targetDirPath);
        await this.executeTransfer('cut', sourcePath, target, base);
        this.state.reload();
    }

    /**
     * Direct copy (from DnD with Ctrl held).
     */
    async copyTo(sourcePath: string, targetDirPath: string): Promise<void> {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const base     = manifest?.apiBase ?? '';
        const node     = { path: sourcePath, name: sourcePath.split('/').at(-1) ?? '' };
        const target   = this.buildTargetPath(node, targetDirPath);
        await this.executeTransfer('copy', sourcePath, target, base);
        this.state.reload();
    }

    private buildTargetPath(
        node: { path: string; name: string },
        targetDirPath: string,
    ): string {
        const name = node.path.split('/').at(-1) ?? node.name;
        return targetDirPath.replace(/\/$/, '') + '/' + name;
    }

    private async executeTransfer(
        mode: ClipboardMode,
        source: string,
        target: string,
        base: string,
    ): Promise<void> {
        const endpoint = mode === 'cut'
            ? `${base}/vfs/files/move`
            : `${base}/vfs/files/copy`;

        return new Promise(resolve => {
            this.http.post(endpoint, { source, target }).subscribe({
                next:  () => resolve(),
                error: async err => {
                    if ((err as { status?: number }).status === 409) {
                        const resolution = await this.resolveConflict(source);
                        if (!resolution || resolution.action === 'skip') {
                            resolve();
                            return;
                        }
                        if (resolution.action === 'overwrite') {
                            this.http.post(endpoint, { source, target, force: true })
                                .subscribe({ next: () => resolve(), error: () => resolve() });
                        } else if (resolution.action === 'rename' && resolution.pattern) {
                            const newTarget = this.applyPattern(resolution.pattern, target, source);
                            // Retry with new target — may recurse if the new name also conflicts
                            await this.executeTransfer(mode, source, newTarget, base);
                            resolve();
                        }
                    } else {
                        void this.dialog.confirm({
                            title:        'Error',
                            message:      this.errors.humanize(err),
                            confirmLabel: 'OK',
                        });
                        resolve();
                    }
                },
            });
        });
    }

    /**
     * Show the conflict resolution dialog (or reuse last "apply to all" decision).
     */
    private async resolveConflict(source: string): Promise<ConflictResult | null> {
        // Reuse decision if user chose "apply to all"
        if (this.lastConflictDecision?.applyToAll) {
            return this.lastConflictDecision;
        }

        // A3: opened via CDK Dialog so it renders the platform <app-modal> chrome.
        const ref = this.cdkDialog.open<ConflictResult | null>(VfsConflictDialogComponent, {
            data: { sourcePath: source },
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        // Apply → ConflictResult; Cancel/X/backdrop/Esc → null|undefined (treated as skip).
        const resolution = (await firstValueFrom(ref.closed)) ?? null;
        if (resolution?.applyToAll) {
            this.lastConflictDecision = resolution;
        }
        return resolution;
    }

    /**
     * Apply a rename pattern to produce a new target path.
     * Substitutes {const:basename}, {const:counter}, {const:date}, {const:random}.
     */
    private applyPattern(pattern: string, originalTarget: string, source: string): string {
        const dir      = originalTarget.substring(0, originalTarget.lastIndexOf('/'));
        const filename = source.split('/').at(-1) ?? '';
        const ext      = filename.includes('.') ? '.' + filename.split('.').at(-1) : '';
        const basename = filename.replace(/\.[^.]+$/, '');
        const counter  = Math.floor(Math.random() * 900) + 100;

        const rendered = pattern
            .replaceAll('{const:basename}', basename)
            .replaceAll('{const:counter}',  String(counter))
            .replaceAll('{const:date}',     new Date().toISOString().split('T')[0])
            .replaceAll('{const:random}',   Math.random().toString(36).substring(2, 6));

        // Append extension if the rendered name doesn't already end with it
        const newName = rendered.endsWith(ext) ? rendered : rendered + ext;
        return dir + '/' + newName;
    }
}
