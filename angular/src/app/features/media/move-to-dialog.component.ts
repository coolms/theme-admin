import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
    signal,
    ViewChild,
    ElementRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { catchError, of } from 'rxjs';
import { MediaService } from './media.service';
import { MediaAssetDto } from './media.types';
import { ApiService } from '../../api/api.service';

interface DirItem {
    path:  string;
    name:  string;
    depth: number;
}

@Component({
    selector: 'app-move-to-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgClass],
    template: `
        <div class="cms-dialog" style="min-width: 380px; max-width: 460px">

            <!-- Header -->
            <div class="cms-dialog-header">
                <i class="bi" [ngClass]="'bi-' + (data.icon ?? 'folder-symlink-fill')" style="color: var(--cms-accent)"></i>
                <span style="flex:1">Move to collection</span>
                <button type="button" class="cms-dialog-close" (click)="dialogRef.close(null)" title="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="cms-dialog-body">

                <div class="move-subtitle">
                    Moving: <strong>{{ data.asset.originalFilename }}</strong>
                </div>

                <!-- Directory tree -->
                <div class="move-tree">

                    <!-- Root -->
                    <div class="move-item"
                         [class.move-item--selected]="selected() === '/media'"
                         (click)="selected.set('/media')">
                        <i class="bi bi-folder-fill move-item-icon"></i>
                        <span>All media (root)</span>
                    </div>

                    @for (dir of dirs(); track dir.path) {
                        <div class="move-item"
                             [style.padding-left.px]="12 + dir.depth * 16"
                             [class.move-item--selected]="selected() === dir.path"
                             [class.move-item--current]="dir.path === currentDir()"
                             (click)="dir.path !== currentDir() && selected.set(dir.path)">
                            <i class="bi move-item-icon"
                               [ngClass]="dir.path === currentDir() ? 'bi-folder2-open' : 'bi-folder-fill'"></i>
                            <span>{{ dir.name }}</span>
                            @if (dir.path === currentDir()) {
                                <span class="move-item-current">(current)</span>
                            }
                        </div>
                    }
                </div>

                <!-- Selected path preview -->
                <div class="move-preview">
                    <span class="move-preview-label">Move to:</span>
                    <code class="move-preview-path">{{ selected() }}/{{ data.asset.originalFilename }}</code>
                </div>

                <!-- New collection shortcut -->
                @if (!showNew()) {
                    <button type="button" class="move-new-btn" (click)="showNew.set(true)">
                        <i class="bi bi-plus-lg"></i> New collection here
                    </button>
                } @else {
                    <div class="move-new-form">
                        <input #newName type="text" class="cms-input"
                               placeholder="Collection name…"
                               (keydown.enter)="createAndSelect(newName.value)"
                               (keydown.escape)="showNew.set(false)" />
                        <button class="cms-btn cms-btn-primary cms-btn-sm"
                                (click)="createAndSelect(newName.value)">
                            <i class="bi bi-check-lg"></i>
                        </button>
                        <button class="cms-btn cms-btn-sm"
                                (click)="showNew.set(false)">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                }

            </div>

            <!-- Footer -->
            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn"
                        (click)="dialogRef.close(null)">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="!selected() || selected() === currentDir() || moving()"
                        (click)="move()">
                    {{ moving() ? 'Moving…' : 'Move here' }}
                </button>
            </div>
        </div>
    `,
    styles: [`
        .move-subtitle {
            font-size: .8125rem;
            color: var(--cms-text-muted);
            margin-bottom: 10px;
        }
        .move-tree {
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            overflow: auto;
            max-height: 280px;
            margin-bottom: 10px;
        }
        .move-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 12px;
            cursor: pointer;
            border-bottom: 1px solid var(--cms-border-light);
            font-size: .875rem;
            color: var(--cms-text);
            transition: background .1s;
            &:last-child { border-bottom: none; }
            &:hover:not(.move-item--current) { background: var(--cms-border-light); }
        }
        .move-item--selected {
            background: var(--cms-accent-light) !important;
            font-weight: 600;
            color: var(--cms-accent-text);
        }
        .move-item--current { color: var(--cms-text-muted); cursor: default; }
        .move-item-icon {
            color: var(--cms-accent);
            font-size: .9rem;
            flex-shrink: 0;
        }
        .move-item--current .move-item-icon { color: var(--cms-text-muted); }
        .move-item-current {
            margin-left: auto;
            font-size: .7rem;
            color: var(--cms-text-muted);
        }

        .move-preview {
            display: flex;
            align-items: baseline;
            gap: 6px;
            background: var(--cms-border-light);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            padding: 6px 10px;
            font-size: .8125rem;
            margin-bottom: 10px;
        }
        .move-preview-label { color: var(--cms-text-muted); flex-shrink: 0; }
        .move-preview-path  { font-size: .75rem; color: var(--cms-accent); word-break: break-all; }

        .move-new-btn {
            border: none;
            background: none;
            color: var(--cms-accent);
            font-size: .8125rem;
            cursor: pointer;
            padding: 0;
            display: flex;
            align-items: center;
            gap: 4px;
            &:hover { text-decoration: underline; }
        }
        .move-new-form {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        .move-new-form .cms-input { flex: 1; }
    `],
})
export class MoveToDialogComponent implements OnInit {
    readonly dialogRef  = inject(DialogRef<string | null>);
    readonly data       = inject<{ asset: MediaAssetDto; currentDir: string; icon?: string }>(DIALOG_DATA);
    private readonly svc        = inject(MediaService);
    private readonly api        = inject(ApiService);
    readonly destroyRef = inject(DestroyRef);

    dirs     = signal<DirItem[]>([]);
    selected = signal('/media');
    moving   = signal(false);
    showNew  = signal(false);

    currentDir = computed(() => this.data.currentDir);

    ngOnInit(): void {
        this.loadDirs();
        this.selected.set(this.data.currentDir);
    }

    private loadDirs(): void {
        this.svc.listCollections('/media', 10).pipe(
            catchError(() => of([])),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(flat => this.dirs.set(flat));
    }

    createAndSelect(name: string): void {
        if (!name.trim()) return;
        const newPath = this.selected() + '/' + name.trim();
        this.api.mkdir(newPath).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            this.showNew.set(false);
            this.loadDirs();
            this.selected.set(newPath);
        });
    }

    move(): void {
        const targetDir = this.selected();
        if (!targetDir || targetDir === this.currentDir()) return;
        this.moving.set(true);
        this.svc.move(this.data.asset.id, targetDir).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => this.dialogRef.close(targetDir),
            error: () => this.moving.set(false),
        });
    }
}
