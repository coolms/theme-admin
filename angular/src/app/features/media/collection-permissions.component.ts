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
import { MediaService } from './media.service';

@Component({
    selector: 'app-collection-permissions',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, NgClass, FormsModule, UserSearchSelectComponent],
    template: `
        <div style="min-width: 440px; max-width: 500px">

            <!-- Header -->
            <div class="cms-dialog-header">
                <i class="bi" [ngClass]="'bi-' + (data.icon ?? 'lock')" style="color: var(--cms-accent)"></i>
                <span style="flex:1">Permissions — <code style="font-size:.85em">{{ path() }}</code></span>
                <button type="button" class="cms-dialog-close" (click)="dialogRef.close()" title="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="cms-dialog-body" style="display: flex; flex-direction: column; gap: 20px">

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

                        <!-- Owner -->
                        <div class="perm-row">
                            <div class="perm-who">
                                <div class="perm-avatar perm-avatar--key">
                                    <i class="bi bi-key-fill"></i>
                                </div>
                                <div>
                                    <div class="perm-name">{{ owner() }}</div>
                                    <div class="perm-sub">Owner · Full control</div>
                                </div>
                            </div>
                            <span class="perm-mode-chip">rwx</span>
                        </div>

                        <!-- Group -->
                        <div class="perm-row">
                            <div class="perm-who">
                                <div class="perm-avatar perm-avatar--group">
                                    <i class="bi bi-people-fill"></i>
                                </div>
                                <div class="perm-name">Group</div>
                            </div>
                            <div class="perm-controls">
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
                                <div class="perm-name">Everyone else</div>
                            </div>
                            <div class="cms-select-wrap"
                                 style="width: auto"
                                 [style.opacity]="activePreset() !== '' && activePreset() !== 'public' ? '.45' : null"
                                 [style.cursor]="activePreset() !== '' && activePreset() !== 'public' ? 'not-allowed' : null"
                                 [style.pointer-events]="activePreset() !== '' && activePreset() !== 'public' ? 'none' : null">
                                <select class="cms-select-native"
                                        [value]="othersAccess()"
                                        [disabled]="activePreset() !== '' && activePreset() !== 'public'"
                                        (change)="othersAccess.set($any($event.target).value); activePreset.set('')">
                                    <option value="r">Can view</option>
                                    <option value="">No access</option>
                                </select>
                                <span class="cms-select-arrow"><i class="bi bi-chevron-down"></i></span>
                            </div>
                        </div>
                    </div>

                    <!-- Mode preview -->
                    <div class="perm-mode-preview">
                        <span class="perm-mode-label">Dir:</span>
                        <span class="perm-mode-chip">{{ modeString(dirMode()) }}</span>
                        <span class="perm-mode-label" style="margin-left:8px">Cache:</span>
                        <span class="perm-mode-chip">{{ modeString(cacheMode()) }}</span>
                        <span class="perm-mode-octal">({{ '0' + cacheMode().toString(8) }})</span>
                    </div>
                </div>

                <!-- Apply to -->
                <div>
                    <div class="perm-section-label">Apply to</div>
                    <div class="perm-variants">
                        <label class="perm-variant-row">
                            <span class="cms-checkbox cms-checkbox--checked">
                                <i class="bi bi-check"></i>
                            </span>
                            <span class="perm-variant-name">This collection directory</span>
                        </label>
                        <label class="perm-variant-row"
                               (click)="applyToFiles.set(!applyToFiles())">
                            <span class="cms-checkbox"
                                  [class.cms-checkbox--checked]="applyToFiles()">
                                @if (applyToFiles()) { <i class="bi bi-check"></i> }
                            </span>
                            <span class="perm-variant-name">All files inside</span>
                        </label>
                        <label class="perm-variant-row"
                               (click)="applyToCache.set(!applyToCache())">
                            <span class="cms-checkbox"
                                  [class.cms-checkbox--checked]="applyToCache()">
                                @if (applyToCache()) { <i class="bi bi-check"></i> }
                            </span>
                            <span class="perm-variant-name">
                                Thumbnails (.cache/) —
                                <span class="perm-mode-chip">{{ modeString(cacheMode()) }}</span>
                            </span>
                        </label>
                        <label class="perm-variant-row"
                               (click)="applyRecursive.set(!applyRecursive())">
                            <span class="cms-checkbox"
                                  [class.cms-checkbox--checked]="applyRecursive()">
                                @if (applyRecursive()) { <i class="bi bi-check"></i> }
                            </span>
                            <span class="perm-variant-name">Subcollections (recursive)</span>
                        </label>
                    </div>
                </div>

            </div>

            <!-- Footer -->
            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn"
                        (click)="dialogRef.close()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="applying() || !canManage()"
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
            overflow: clip;
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
        .perm-avatar--key   { background: #fef9c3; color: #a16207; }
        .perm-avatar--group { background: var(--cms-meta-subtle); color: var(--cms-meta); }
        .perm-avatar--globe { background: var(--cms-success-subtle); color: #15803d; }
        .perm-name  { font-size: .8125rem; font-weight: 500; color: var(--cms-text); }
        .perm-sub   { font-size: .7rem; color: var(--cms-text-muted); }
        .perm-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .perm-no-access { font-size: .8125rem; color: var(--cms-text-muted); }
        .perm-group-select { display: flex; align-items: center; gap: 4px; width: 190px; }
        .perm-group-trigger { flex: 1; min-width: 0; }
        .perm-clear-btn {
            flex-shrink: 0; width: 24px; height: 24px;
            background: none; border: none; cursor: pointer;
            color: var(--cms-text-muted);
            display: flex; align-items: center; justify-content: center;
            border-radius: 50%; transition: color .1s, background .1s;
            .bi { font-size: .6875rem; }
            &:hover { color: var(--cms-text); background: var(--cms-border-light); }
        }
        .perm-access-slot { width: 100px; flex-shrink: 0; display: flex; align-items: center; }
        .perm-mode-preview {
            display: flex; align-items: center; gap: 8px;
            margin-top: 8px; font-size: .8125rem; color: var(--cms-text-secondary);
        }
        .perm-mode-label  { color: var(--cms-text-muted); }
        .perm-mode-chip {
            background: var(--cms-border-light); border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm); padding: 1px 6px;
            font-family: monospace; font-size: .8rem; color: var(--cms-text);
        }
        .perm-mode-octal { font-size: .8rem; color: var(--cms-text-muted); }
        .perm-variants { display: flex; flex-direction: column; gap: 6px; }
        .perm-variant-row {
            display: flex; align-items: center; gap: 8px;
            cursor: pointer; padding: 4px 6px; border-radius: var(--cms-radius-sm);
            transition: background .1s; user-select: none;
            font-size: .8125rem; color: var(--cms-text);
            &:hover { background: var(--cms-border-light); }
        }
        .perm-variant-name { flex: 1; }
    `],
})
export class CollectionPermissionsComponent implements OnInit {
    readonly dialogRef  = inject(DialogRef);
    readonly data       = inject<{ path: string; icon?: string }>(DIALOG_DATA);
    readonly svc        = inject(MediaService);
    readonly store      = inject(Store);
    readonly http       = inject(HttpClient);
    readonly destroyRef = inject(DestroyRef);

    groupsApiUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.auth?.groupsApi ?? ''
    );

    path           = signal(this.data.path);
    /** Real owner display name (the creator), loaded from the info endpoint. */
    owner          = signal('…');
    /** Whether the caller may change permissions (owner OR ROLE_MEDIA_LIBRARY). */
    canManage      = signal(true);
    selectedGroup  = signal('');
    groupAccess    = signal<'r' | 'rw'>('rw');
    othersAccess   = signal<'r' | ''>('r');
    applyToFiles   = signal(true);
    applyToCache   = signal(true);
    applyRecursive = signal(false);
    applying       = signal(false);

    /** Remembers the last non-empty group so it can be restored when switching back from a no-group preset. */
    private readonly lastGroup = signal<string>('');

    // Group gets EDIT (rw) on the non-secret presets: collections are
    // group-writable so media_library members (incl. the creator) can manage
    // them — matching the backend CollectionPreset (setgid + group-write).
    presets = [
        { key: 'public',  label: 'Public',   groupAccess: 'rw', othersAccess: 'r'  },
        { key: 'members', label: 'Members',  groupAccess: 'rw', othersAccess: ''   },
        { key: 'private', label: 'Private',  groupAccess: 'rw', othersAccess: ''   },
        { key: 'secret',  label: 'Secret',   groupAccess: '',   othersAccess: ''   },
    ];

    /** The current preset name as stored in node.extras.preset, loaded via getCollectionInfo(). */
    activePreset = signal<string>('public');

    // setgid (0o2000) keeps the media_library group inherited by children, the
    // same as the backend CollectionPreset — every mode the dialog writes
    // carries it so an Apply never strips group inheritance.
    private static readonly SETGID = 0o2000;

    dirMode = computed((): number => {
        const ownerBits  = 7;
        const groupBits  = !this.selectedGroup()  ? 0 : this.groupAccess() === 'rw' ? 7 : 5;
        const othersBits = this.othersAccess() === 'r' ? 5 : 0;
        return CollectionPermissionsComponent.SETGID | (ownerBits << 6) | (groupBits << 3) | othersBits;
    });

    cacheMode = computed((): number => {
        // _variants/ stays group-writable (rwx) so the creator + the privileged
        // thumbnail handler can both manage thumbnails. Others get read only for
        // public/members (free-preview model); private/secret hide thumbnails.
        const othersBits = (this.othersAccess() === 'r' || this.activePreset() === 'members') ? 5 : 0;
        return CollectionPermissionsComponent.SETGID | (7 << 6) | (7 << 3) | othersBits;
    });

    isActivePreset(preset: typeof this.presets[0]): boolean {
        return this.activePreset() === preset.key;
    }

    applyPreset(preset: typeof this.presets[0]): void {
        this.activePreset.set(preset.key);
        this.groupAccess.set((preset.groupAccess as 'r' | 'rw') || 'r');
        this.othersAccess.set(preset.othersAccess as 'r' | '');
        // Secret is owner-only (0o700) — no group access at all.
        // Save the current group first so it can be restored when switching back to a
        // group-aware preset (e.g. Secret → Private → Members).
        if (preset.key === 'secret') {
            if (this.selectedGroup()) this.lastGroup.set(this.selectedGroup());
            this.selectedGroup.set('');
        } else if (preset.groupAccess) {
            // Restore the saved group when switching to a preset that uses group access.
            if (!this.selectedGroup() && this.lastGroup()) {
                this.selectedGroup.set(this.lastGroup());
            }
        }
    }

    ngOnInit(): void {
        // Load the current preset from node.extras.preset via the collection-info endpoint.
        this.svc.getCollectionInfo(this.path()).pipe(
            catchError(() => of(null)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(info => {
            if (!info) return;
            // Real owner (the creator) + whether the caller may manage perms.
            this.owner.set(info.owner ?? 'unknown');
            if (info.ownerIsMe) this.owner.set('You');
            this.canManage.set(info.canManage ?? true);
            if (!info.preset) return;
            // Direct assignment — no transformation. activePreset always reflects
            // the exact value stored in node.extras.preset, even for future keys.
            this.activePreset.set(info.preset);
            // Update the mode-bit controls only when a known preset matches.
            const matched = this.presets.find(p => p.key === info.preset);
            if (matched) {
                this.groupAccess.set((matched.groupAccess as 'r' | 'rw') || 'r');
                this.othersAccess.set(matched.othersAccess as 'r' | '');
            }
        });

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
        });
    }

    apply(): void {
        this.applying.set(true);
        this.svc.applyCollectionPermissions({
            path:           this.path(),
            mode:           this.dirMode(),
            applyToFiles:   this.applyToFiles(),
            applyRecursive: this.applyRecursive(),
            applyToCache:   this.applyToCache(),
            cacheMode:      this.cacheMode(),
        }).pipe(
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
}
