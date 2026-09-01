import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { catchError, of } from 'rxjs';
import { AppConfigState, AuthState } from '@coolms/core-angular';
import { UserSearchSelectComponent } from '@coolms/ui-angular';
import { CollectionInfo, MediaService } from './media.service';
import { MediaAssetDto } from './media.types';

@Component({
    selector: 'app-media-permissions',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FormsModule, UserSearchSelectComponent, NgClass],
    template: `
        <div style="min-width: 440px; max-width: 500px">

            <!-- Header -->
            <div class="cms-dialog-header">
                <i class="bi" [ngClass]="'bi-' + (data.icon ?? 'lock')" style="color: var(--cms-accent)"></i>
                <span style="flex:1">Permissions — {{ asset().originalFilename }}</span>
                <button type="button" class="cms-dialog-close" (click)="dialogRef.close()" title="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="cms-dialog-body" style="display: flex; flex-direction: column; gap: 20px">

                <!-- Parent collection context -->
                @if (parentCollection()) {
                    <div class="perm-collection-info">
                        <i class="bi bi-folder-fill" style="color: var(--cms-accent); flex-shrink: 0"></i>
                        <div>
                            <div class="perm-collection-path">{{ parentCollection()!.path }}</div>
                            <div class="perm-collection-meta">
                                {{ collectionPresetLabel() }} ·
                                <code>dir={{ modeString(parentCollection()!.dirMode ?? 0) }}</code>
                                <code>cache={{ modeString(parentCollection()!.cacheMode ?? 0) }}</code>
                            </div>
                        </div>
                    </div>
                }

                <!-- Quick presets -->
                <div>
                    <div class="perm-section-label">Quick presets</div>
                    <div class="perm-presets">
                        @for (preset of presets; track preset.label) {
                            <button type="button"
                                    class="cms-btn cms-btn-sm"
                                    [class.cms-btn-active]="isActivePreset(preset)"
                                    (click)="applyPreset(preset)">
                                {{ preset.label }}
                            </button>
                        }
                    </div>
                </div>

                <!-- Access control rows -->
                <div>
                    <div class="perm-section-label">Access control</div>
                    <div class="perm-acl">

                        <!-- Owner — the uploading user (creator-owned), read-only -->
                        <div class="perm-row">
                            <div class="perm-who">
                                <div class="perm-avatar perm-avatar--key">
                                    <i class="bi bi-key-fill"></i>
                                </div>
                                <div>
                                    <div class="perm-name">{{ asset().owner || '—' }}</div>
                                    <div class="perm-sub">Owner · Full control</div>
                                </div>
                            </div>
                            <span class="perm-mode-chip">rw-</span>
                        </div>

                        <!-- Group — search-based selector with inline clear -->
                        <div class="perm-row">
                            <div class="perm-who">
                                <div class="perm-avatar perm-avatar--group">
                                    <i class="bi bi-people-fill"></i>
                                </div>
                                <div class="perm-name">Group</div>
                            </div>
                            <div class="perm-controls">
                                <!-- Trigger + clear always in flow; clear is invisible (not absent) when no group -->
                                <div class="perm-group-select">
                                    <div class="perm-group-trigger">
                                        <app-user-search-select
                                            [apiUrl]="groupsApiUrl()"
                                            [value]="selectedGroup()"
                                            entityLabel="group"
                                            placeholder="— None —"
                                            (valueChange)="selectedGroup.set($event)" />
                                    </div>
                                    <button type="button"
                                            class="perm-clear-btn"
                                            title="Clear group"
                                            [style.visibility]="selectedGroup() ? 'visible' : 'hidden'"
                                            (click)="selectedGroup.set('')">
                                        <i class="bi bi-x-lg"></i>
                                    </button>
                                </div>
                                <!-- Access level — always same width slot; shows select or muted label -->
                                <div class="perm-access-slot">
                                    @if (selectedGroup()) {
                                        <div class="cms-select-wrap">
                                            <select class="cms-select-native"
                                                    [value]="groupAccess()"
                                                    (change)="groupAccess.set($any($event.target).value)">
                                                <option value="r">Can view</option>
                                                <option value="rw">Can edit</option>
                                            </select>
                                            <span class="cms-select-arrow"><i class="bi bi-chevron-down"></i></span>
                                        </div>
                                    } @else {
                                        <span class="perm-no-access">No access</span>
                                    }
                                </div>
                            </div>
                        </div>

                        <!-- Others -->
                        <div class="perm-row">
                            <div class="perm-who">
                                <div class="perm-avatar perm-avatar--globe">
                                    <i class="bi bi-globe"></i>
                                </div>
                                <div class="perm-name">Others</div>
                            </div>
                            <div class="cms-select-wrap"
                                 style="width: auto"
                                 [style.opacity]="activePresetKey() !== '' && activePresetKey() !== 'public' ? '.45' : null"
                                 [style.cursor]="activePresetKey() !== '' && activePresetKey() !== 'public' ? 'not-allowed' : null"
                                 [style.pointer-events]="activePresetKey() !== '' && activePresetKey() !== 'public' ? 'none' : null">
                                <select class="cms-select-native"
                                        [value]="othersAccess()"
                                        [disabled]="activePresetKey() !== '' && activePresetKey() !== 'public'"
                                        (change)="othersAccess.set($any($event.target).value); activePresetKey.set('')">
                                    <option value="r">Can view</option>
                                    <option value="">No access</option>
                                </select>
                                <span class="cms-select-arrow"><i class="bi bi-chevron-down"></i></span>
                            </div>
                        </div>
                    </div>

                    <!-- Mode preview -->
                    <div class="perm-mode-preview">
                        <span class="perm-mode-label">Mode:</span>
                        <span class="perm-mode-chip">{{ modeString(computedMode()) }}</span>
                        <span class="perm-mode-octal">({{ '0' + computedMode().toString(8) }})</span>
                    </div>
                </div>

                <!-- Apply to variants -->
                <div>
                    <div class="perm-section-label">Apply to</div>
                    <div class="perm-variants">
                        @for (variant of variantList(); track variant.name) {
                            <label class="perm-variant-row"
                                   (click)="toggleVariant(variant.name, !selectedVariants().includes(variant.name))">
                                <span class="cms-checkbox"
                                      [class.cms-checkbox--checked]="selectedVariants().includes(variant.name)">
                                    @if (selectedVariants().includes(variant.name)) {
                                        <i class="bi bi-check"></i>
                                    }
                                </span>
                                <span class="perm-variant-name">{{ variant.label }}</span>
                                <span class="perm-mode-chip">{{ variant.modeStr }}</span>
                            </label>
                        }
                    </div>
                </div>

            </div>

            <!-- Footer -->
            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn"
                        (click)="dialogRef.close()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="applying()"
                        (click)="apply()">
                    <i class="bi bi-check-lg"></i>
                    {{ applying() ? 'Applying…' : 'Apply' }}
                </button>
            </div>
        </div>
    `,
    styles: [`
        .perm-section-label {
            font-size: .6875rem; font-weight: 700; letter-spacing: .08em;
            text-transform: uppercase; color: var(--cms-text-muted);
            margin-bottom: 8px;
        }
        .perm-presets { display: flex; gap: 6px; flex-wrap: wrap; }
        .perm-acl {
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            overflow: clip; /* clips layout overflow but NOT fixed-position children */
        }
        .perm-row {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px; padding: 10px 14px;
            border-bottom: 1px solid var(--cms-border);
            &:last-child { border-bottom: none; }
        }
        .perm-who { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
        .perm-avatar {
            width: 28px; height: 28px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: .8125rem; flex-shrink: 0;
        }
        .perm-avatar--key   { background: var(--cms-warning-subtle); color: var(--cms-warning-text); }
        .perm-avatar--group { background: var(--cms-meta-subtle); color: var(--cms-meta); }
        .perm-avatar--globe { background: var(--cms-success-subtle); color: var(--cms-success-text); }
        .perm-name  { font-size: .8125rem; font-weight: 500; color: var(--cms-text); }
        .perm-sub   { font-size: .7rem; color: var(--cms-text-muted); }
        .perm-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .perm-no-access { font-size: .8125rem; color: var(--cms-text-muted); }
        .perm-group-select {
            display: flex;
            align-items: center;
            gap: 4px;
            width: 190px;
        }
        .perm-group-trigger { flex: 1; min-width: 0; }
        .perm-clear-btn {
            flex-shrink: 0;
            width: 24px; height: 24px;
            background: none; border: none; cursor: pointer;
            color: var(--cms-text-muted);
            display: flex; align-items: center; justify-content: center;
            border-radius: 50%;
            transition: color .1s, background .1s;
            .bi { font-size: .6875rem; }
            &:hover { color: var(--cms-text); background: var(--cms-border-light); }
        }
        .perm-access-slot {
            width: 100px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
        }
        .perm-mode-preview {
            display: flex; align-items: center; gap: 8px;
            margin-top: 8px; font-size: .8125rem; color: var(--cms-text-secondary);
        }
        .perm-mode-label  { color: var(--cms-text-muted); }
        .perm-mode-chip {
            background: var(--cms-border-light);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            padding: 1px 6px;
            font-family: var(--cms-font-mono, monospace);
            font-size: .8rem;
            color: var(--cms-text);
        }
        .perm-mode-octal  { font-size: .8rem; color: var(--cms-text-muted); }
        .perm-variants    { display: flex; flex-direction: column; gap: 6px; }
        .perm-variant-row {
            display: flex; align-items: center; gap: 8px;
            cursor: pointer; padding: 4px 6px; border-radius: var(--cms-radius-sm);
            transition: background .1s; user-select: none;
            font-size: .8125rem; color: var(--cms-text);
            &:hover { background: var(--cms-border-light); }
        }
        .perm-variant-name { flex: 1; }
        .perm-collection-info {
            display: flex; gap: 10px; align-items: flex-start;
            background: var(--cms-border-light);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            padding: 10px 12px;
        }
        .perm-collection-path { font-size: .8125rem; font-weight: 500; color: var(--cms-text); }
        .perm-collection-meta {
            font-size: .75rem; color: var(--cms-text-muted); margin-top: 2px;
            code { font-size: .7rem; background: var(--cms-surface); border: 1px solid var(--cms-border);
                   border-radius: 3px; padding: 0 4px; margin: 0 1px; }
        }
    `],
})
export class MediaPermissionsComponent implements OnInit {
    readonly dialogRef  = inject(DialogRef);
    readonly data       = inject<{ asset: MediaAssetDto; icon?: string }>(DIALOG_DATA);
    readonly svc        = inject(MediaService);
    readonly store      = inject(Store);
    readonly http       = inject(HttpClient);
    readonly destroyRef = inject(DestroyRef);

    groupsApiUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.auth?.groupsApi ?? ''
    );

    asset            = signal(this.data.asset);
    parentCollection = signal<CollectionInfo | null>(null);

    // Presets control mode bits only — group is selected separately via the search selector
    presets = [
        { key: 'public',  label: 'Public',   icon: '🌍', groupAccess: 'r',  othersAccess: 'r'  },
        { key: 'members', label: 'Members',  icon: '🔒', groupAccess: 'r',  othersAccess: ''   },
        { key: 'private', label: 'Private',  icon: '🔑', groupAccess: '',   othersAccess: ''   },
    ];

    /** Key of the last explicitly clicked preset; '' = none / custom. Never auto-set from asset data. */
    readonly activePresetKey = signal<string>('');

    selectedGroup    = signal('');
    groupAccess      = signal<'r' | 'rw'>('r');
    othersAccess     = signal<'r' | ''>('r');

    /** Remembers the last non-empty group so it can be restored when switching back from Private. */
    private readonly lastGroup = signal<string>('');
    applying         = signal(false);

    selectedVariants = signal<string[]>(['original', ...Object.keys(this.data.asset.variants)]);

    computedMode = computed((): number => {
        const ownerBits  = 6; // rw- always for the owner (the uploading user)
        const groupBits  = !this.selectedGroup()  ? 0
                         : this.groupAccess() === 'rw' ? 6 : 4;
        const othersBits = this.othersAccess() === 'r' ? 4 : 0;
        return (ownerBits << 6) | (groupBits << 3) | othersBits;
    });

    variantList = computed(() => {
        const asset   = this.asset();
        const mode    = this.computedMode();
        const entries = [
            { name: 'original', label: `Original (${this.formatSize(asset.fileSize)})`, modeStr: this.modeString(mode) },
        ];
        for (const name of Object.keys(asset.variants)) {
            entries.push({ name, label: name.charAt(0).toUpperCase() + name.slice(1), modeStr: this.modeString(mode) });
        }
        return entries;
    });

    ngOnInit(): void {
        const vfsPath    = (this.asset() as any).vfsPath as string | undefined;
        const parentPath = vfsPath ? vfsPath.split('/').slice(0, -1).join('/') || null : null;

        if (parentPath && parentPath !== '/media' && parentPath !== '/') {
            this.svc.getCollectionInfo(parentPath).pipe(
                catchError(() => of(null)),
                takeUntilDestroyed(this.destroyRef),
            ).subscribe(info => {
                if (info) this.parentCollection.set(info);
            });
        }

        // Pre-select the media_library group by default
        this.autoSelectMediaLibraryGroup();

        // Highlight the stored preset only when it matches a known preset key.
        // 'custom' and any other unrecognised values are ignored here; the inference
        // in autoSelectMediaLibraryGroup() will pick up the correct preset from the
        // current access-flag state instead.
        const stored  = this.asset().permissionPreset;
        const matched = stored ? this.presets.find(p => p.key === stored) : null;
        if (matched) {
            this.activePresetKey.set(matched.key);
            this.groupAccess.set((matched.groupAccess as 'r' | 'rw') || 'r');
            this.othersAccess.set(matched.othersAccess as 'r' | '');
        }
    }

    private autoSelectMediaLibraryGroup(): void {
        const apiUrl = this.groupsApiUrl();
        if (!apiUrl) return;
        const token = this.store.selectSnapshot(AuthState.accessToken);
        this.http.get<Record<string, unknown>>(apiUrl + '?limit=50', {
            headers: { Accept: 'application/ld+json', Authorization: `Bearer ${token ?? ''}` },
        }).pipe(
            catchError(() => of(null)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(res => {
            if (!res) return;
            const members = (res['member'] ?? res['hydra:member'] ?? []) as Array<{ id: string; name?: string }>;
            const mediaLib = members.find(g => g.name === 'media_library');
            if (mediaLib?.id) this.selectedGroup.set(mediaLib.id);

            // If no preset was stored on the asset, infer it from the current access-flag
            // state now that selectedGroup is resolved.  We compare groupAccess and
            // othersAccess; for presets that require a group (public/members) we only
            // match when a group is actually selected, avoiding a false Private match.
            if (!this.activePresetKey()) {
                const ga = this.selectedGroup() ? this.groupAccess() : '';
                const oa = this.othersAccess();
                const inferred = this.presets.find(p => p.groupAccess === ga && p.othersAccess === oa);
                if (inferred) this.activePresetKey.set(inferred.key);
            }
        });
    }

    collectionPresetLabel(): string {
        const preset = this.parentCollection()?.preset;
        const labels: Record<string, string> = {
            public: 'Public', members: 'Members only', private: 'Private', secret: 'Secret',
        };
        return preset ? (labels[preset] ?? preset) : 'Custom';
    }

    isActivePreset(preset: typeof this.presets[0]): boolean {
        return this.activePresetKey() === preset.key;
    }

    applyPreset(preset: typeof this.presets[0]): void {
        this.activePresetKey.set(preset.key);
        this.groupAccess.set((preset.groupAccess as 'r' | 'rw') || 'r');
        this.othersAccess.set(preset.othersAccess as 'r' | '');

        if (preset.key === 'private') {
            // Save the current group before clearing so it can be restored later.
            if (this.selectedGroup()) this.lastGroup.set(this.selectedGroup());
            this.selectedGroup.set('');
        } else if (preset.groupAccess) {
            // Restore the saved group when switching to a preset that uses group access.
            if (!this.selectedGroup() && this.lastGroup()) {
                this.selectedGroup.set(this.lastGroup());
            }
        }
    }

    toggleVariant(name: string, checked: boolean): void {
        this.selectedVariants.update(list =>
            checked ? [...list, name] : list.filter(v => v !== name)
        );
    }

    apply(): void {
        this.applying.set(true);

        // When the user clicked a named preset button, send { preset } so the backend
        // stores the preset key in extras['permission_preset'] and the button highlights
        // correctly the next time the dialog opens.
        // For manual/custom mode changes send { custom: { variantName: modeInt } }.
        const presetKey = this.activePresetKey();
        const isNamedPreset = !!presetKey && this.presets.some(p => p.key === presetKey);

        const req: import('./media.types').MediaPermissionsRequest = isNamedPreset
            ? { preset: presetKey }
            : (() => {
                const mode   = this.computedMode();
                const custom: Record<string, number> = {};
                for (const name of this.selectedVariants()) custom[name] = mode;
                return { custom };
            })();

        this.svc.applyPermissions(this.asset().id, req).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.applying.set(false); this.dialogRef.close('applied'); },
            error: () => this.applying.set(false),
        });
    }

    modeString(mode: number): string {
        const r = (v: number) => (v & 4 ? 'r' : '-') + (v & 2 ? 'w' : '-') + (v & 1 ? 'x' : '-');
        return r(mode >> 6) + r((mode >> 3) & 7) + r(mode & 7);
    }

    formatSize(bytes: number): string {
        return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
    }
}
