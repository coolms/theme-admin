import {
    ChangeDetectionStrategy, Component, computed, DestroyRef, effect,
    ElementRef, inject, input, OnDestroy, output, signal, TemplateRef, untracked, ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CmsDropzoneConfig, CmsDropzoneDirective } from '@coolms/ui-angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { Store } from '@ngxs/store';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { MediaService } from './media.service';
import { MediaAssetDto } from './media.types';
import {
    MediaPickerEmit, MediaPickerMode, MediaPickerOptions, MediaPickerSelection, MediaPickerZone,
} from './media-picker.types';
import { AuthState, CmsLoaderComponent } from '@coolms/core-angular';
interface PendingPick {
    readonly kind:  'asset' | 'collection';
    readonly value: string;
}

interface CollectionEntry {
    readonly path:     string;
    readonly name:     string;
    readonly depth:    number;
    /** Pre-flight UX hint; server still enforces. Defaults to true on old responses. */
    readonly canWrite: boolean;
}

type ActiveTab = 'library' | 'upload';
/** The render context the panel template runs in. Drives footer affordances. */
type PanelMode = 'dropdown' | 'modal' | 'embedded';

const LS_LAST_UPLOAD = 'mediaPicker.lastUploadCollection.';
const LS_RECENT      = 'mediaPicker.recentlyUsed.';
const LS_INSERT_MODE = 'mediaPicker.insertMode.';
const RECENT_LIMIT   = 8;
const HOVER_DELAY_MS = 300;
const MAX_VISIBLE_CHIPS = 10;

/**
 * Per-user 'Insert as' preference for embedded mode (Tiptap host).
 *   - 'widget' (default): emit a MediaWidget Tiptap node.
 *   - 'plain':            emit raw HTML5 (img/video/audio/a). Bypasses the
 *                         backend renderer; author trades platform features
 *                         (permission filtering, focal point, lazy wrapper)
 *                         for direct authoring control.
 */
type InsertMode = 'widget' | 'plain';

/**
 * Media picker (Prompts 1–3).
 *
 * Adaptive UI:
 *   - Default: CDK Overlay dropdown attached to the trigger button.
 *   - "Open browser" escalates to a CDK Dialog rendering the same #panel
 *     template, so signals (zone / search / pending picks / current path)
 *     are shared across both surfaces without state copying.
 *
 * Library tab supports folder navigation (breadcrumb + mixed grid), an
 * optional Recent row backed by per-user localStorage LRU, and an optional
 * hover-preview popup. Upload tab posts to /api/v1/media/upload sequentially
 * for multi-file drops.
 *
 * Bind contract:
 *   options.cardinality (read off relation.cardinality, not options): 'one' | 'many'
 *     - 'one'  -> emits string | {kind, value} | null
 *     - 'many' -> emits string[] | {kind, value}[] | null
 *   options.bindTarget  ('asset' default | 'collection' | 'either')
 *   options.bindValue   ('uuid' default | 'path')
 *   options.display     ('thumb' default | 'original' | 'preset:<name>')
 *   options.accept      MIME glob (server-side single prefix; client-side comma list)
 *   options.recentlyUsed (false default) - 'Recent' row from localStorage LRU
 *   options.hoverPreview (false default) - delayed popup with larger image
 */
@Component({
    selector: 'app-media-picker',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, CommonModule, OverlayModule, CmsDropzoneDirective],
    template: `
        @if (mode() === 'embedded') {
            <!-- Render the panel directly into the host's layout. The host
                 owns sizing/scroll boundaries; the picker just fills space. -->
            <ng-container *ngTemplateOutlet="panel; context: { $implicit: 'embedded' }"></ng-container>
        } @else {
            <button cdkOverlayOrigin
                    #triggerOrigin="cdkOverlayOrigin"
                    type="button"
                    class="form-select text-start w-100 d-flex align-items-center gap-1 flex-wrap"
                    [class.text-muted]="selected().length === 0"
                    [disabled]="disabled()"
                    (click)="toggleDropdown()">
            @if (selected().length === 0) {
                <span>{{ placeholder }}</span>
            } @else {
                @for (s of visibleChips(); track $index; let i = $index) {
                    <span class="media-picker-chip">
                        @if (s.kind === 'collection') {
                            <i class="bi bi-folder-fill vfs-icon--directory media-picker-chip__icon"></i>
                        } @else if (chipUrl(s)) {
                            <img [src]="chipUrl(s)!" alt="" class="media-picker-chip__img" />
                        } @else {
                            <i class="bi bi-file-earmark-image media-picker-chip__icon"></i>
                        }
                        <span class="media-picker-chip__name">{{ s.filename }}</span>
                        <button type="button" class="btn-close media-picker-chip__close" aria-label="Remove"
                                (click)="onChipRemove($event, i)"></button>
                    </span>
                }
                @if (overflowCount() > 0) {
                    <span class="badge bg-secondary">+{{ overflowCount() }} more</span>
                }
            }
        </button>

            <ng-template cdkConnectedOverlay
                         [cdkConnectedOverlayOrigin]="triggerOrigin"
                         [cdkConnectedOverlayOpen]="dropdownOpen()"
                         [cdkConnectedOverlayPositions]="overlayPositions"
                         [cdkConnectedOverlayPush]="true"
                         [cdkConnectedOverlayViewportMargin]="16"
                         [cdkConnectedOverlayHasBackdrop]="false"
                         (overlayOutsideClick)="closeDropdown()"
                         (detach)="closeDropdown()">
                <div class="media-picker-panel"
                     [style.--mp-trigger-width.px]="triggerWidth()">
                    <ng-container *ngTemplateOutlet="panel; context: { $implicit: 'dropdown' }"></ng-container>
                </div>
            </ng-template>
        }

        <!-- Hover preview overlay -->
        <ng-template cdkConnectedOverlay
                     [cdkConnectedOverlayOrigin]="hoverOriginRef!"
                     [cdkConnectedOverlayOpen]="hoverAsset() !== null && hoverOriginRef !== null"
                     [cdkConnectedOverlayPositions]="hoverPositions"
                     [cdkConnectedOverlayHasBackdrop]="false">
            @if (hoverAsset(); as a) {
                <div class="media-picker-hover">
                    @if (gridUrl(a)) {
                        <img [src]="gridUrl(a)!" alt="" class="media-picker-hover__img" />
                    }
                    <div class="media-picker-hover__name">{{ a.originalFilename }}</div>
                    @if (a.dimensions) {
                        <div class="media-picker-hover__dim">
                            {{ a.dimensions.width }}×{{ a.dimensions.height }}
                        </div>
                    }
                </div>
            }
        </ng-template>

        <ng-template #panel let-mode>
            <div class="media-picker-body"
                 [class.media-picker-body--modal]="mode === 'modal'">
                <!-- Tab row: zones + Upload -->
                <div class="media-picker-tabs" role="tablist">
                    <button type="button" class="media-picker-tab"
                            [class.media-picker-tab--active]="activeTab() === 'library' && zone() === 'shared'"
                            (click)="setLibraryZone('shared')">
                        <i class="bi bi-globe me-1"></i> Shared
                    </button>
                    <button type="button" class="media-picker-tab"
                            [class.media-picker-tab--active]="activeTab() === 'library' && zone() === 'private'"
                            (click)="setLibraryZone('private')">
                        <i class="bi bi-person me-1"></i> My files
                    </button>
                    <button type="button" class="media-picker-tab"
                            [class.media-picker-tab--active]="activeTab() === 'upload'"
                            (click)="setActiveTab('upload')">
                        <i class="bi bi-cloud-upload me-1"></i> Upload
                    </button>
                </div>

                @if (activeTab() === 'library') {
                    <!-- Breadcrumb + search -->
                    <div class="media-picker-toolbar">
                        <div class="media-picker-crumbs">
                            @for (seg of breadcrumb(); track $index; let last = $last) {
                                <button type="button" class="media-picker-crumb"
                                        [class.media-picker-crumb--active]="last"
                                        [disabled]="last"
                                        (click)="navigateTo(seg.path)">{{ seg.label }}</button>
                                @if (!last) { <span class="media-picker-crumb-sep">/</span> }
                            }
                        </div>
                        <input type="text"
                               class="form-control form-control-sm"
                               placeholder="Search files…"
                               [value]="searchInput()"
                               (input)="onSearchInput($any($event.target).value)" />

                        @if (enableCreateCollection() && !creatingCollection()) {
                            <button type="button"
                                    class="cms-btn cms-btn-sm media-picker-create-btn"
                                    (click)="openCreateCollectionForm()">
                                <i class="bi bi-folder-plus me-1"></i> New Collection
                            </button>
                        }

                        @if (creatingCollection()) {
                            <div class="media-picker-create-form">
                                <div class="media-picker-create-row">
                                    <label class="media-picker-create-field media-picker-create-field--wide">
                                        <span>Name</span>
                                        <input type="text"
                                               class="form-control form-control-sm"
                                               placeholder="my-collection"
                                               [value]="newCollectionName()"
                                               (input)="newCollectionName.set($any($event.target).value)"
                                               (keydown.enter)="submitCreateCollection()"
                                               (keydown.escape)="cancelCreateCollection()" />
                                    </label>
                                    <label class="media-picker-create-field">
                                        <span>Preset</span>
                                        <select class="form-select form-select-sm"
                                                [value]="newCollectionPreset()"
                                                (change)="newCollectionPreset.set($any($event.target).value)">
                                            <option value="public">Public</option>
                                            <option value="members">Members</option>
                                            <option value="private">Private</option>
                                        </select>
                                    </label>
                                </div>
                                <div class="media-picker-create-row media-picker-create-row--meta">
                                    <span class="media-picker-create-parent">
                                        Parent: <code>{{ currentPath() }}</code>
                                    </span>
                                    @if (createCollectionError(); as err) {
                                        <span class="media-picker-create-err">{{ err }}</span>
                                    } @else if (nameValidation().error) {
                                        <span class="media-picker-create-err">{{ nameValidation().error }}</span>
                                    }
                                    <span class="media-picker-create-spacer"></span>
                                    <button type="button" class="cms-btn cms-btn-sm"
                                            [disabled]="creatingInFlight()"
                                            (click)="cancelCreateCollection()">Cancel</button>
                                    <button type="button" class="cms-btn cms-btn-sm cms-btn-primary"
                                            [disabled]="!nameValidation().ok || creatingInFlight()"
                                            (click)="submitCreateCollection()">
                                        @if (creatingInFlight()) { Creating… } @else { Create }
                                    </button>
                                </div>
                            </div>
                        }
                    </div>

                    <!-- Recent row + main grid -->
                    <div class="media-picker-grid-wrapper">
                        @if (recentList().length > 0) {
                            <div class="media-picker-recent">
                                <div class="media-picker-recent__label">Recent</div>
                                <div class="media-picker-recent__row">
                                    @for (a of recentList(); track a.id) {
                                        <button type="button"
                                                class="media-picker-card media-picker-card--recent"
                                                [class.media-picker-card--selected]="isAssetSelected(a)"
                                                [title]="a.originalFilename"
                                                (mouseenter)="onAssetHover($event, a)"
                                                (mouseleave)="onAssetHoverLeave()"
                                                (click)="onAssetClick(a)">
                                            @if (gridUrl(a)) {
                                                <img [src]="gridUrl(a)!" alt=""
                                                     class="media-picker-card__img" />
                                            } @else {
                                                <div class="media-picker-card__placeholder">
                                                    <i class="bi bi-file-earmark"></i>
                                                </div>
                                            }
                                        </button>
                                    }
                                </div>
                            </div>
                        }

                        @if (loading()) {
                            <div class="media-picker-empty">
                                <cms-loader [inline]="true" />
                                Loading…
                            </div>
                        } @else if (error()) {
                            <div class="media-picker-empty">
                                <p class="media-picker-empty__error">{{ error() }}</p>
                                <button type="button" class="cms-btn cms-btn-sm cms-btn-ghost"
                                        (click)="reload()">Retry</button>
                            </div>
                        } @else if (subfolders().length === 0 && assets().length === 0) {
                            <div class="media-picker-empty">
                                <i class="bi bi-inbox media-picker-empty__icon"></i>
                                <div>Nothing here yet.</div>
                            </div>
                        } @else {
                            <div class="media-picker-grid"
                                 [class.media-picker-grid--modal]="mode === 'modal'">
                                @for (f of subfolders(); track f.path) {
                                    <button type="button"
                                            class="media-picker-card"
                                            [class.media-picker-card--selected]="isFolderSelected(f)"
                                            [class.media-picker-card--dim]="!folderSelectable()"
                                            [title]="f.path"
                                            (click)="onFolderClick(f)"
                                            (dblclick)="navigateTo(f.path)">
                                        <div class="media-picker-card__folder vfs-icon--directory">
                                            <i class="bi bi-folder-fill"></i>
                                        </div>
                                        <div class="media-picker-card__label">{{ f.name }}</div>
                                    </button>
                                }
                                @for (a of assets(); track a.id) {
                                    <button type="button"
                                            class="media-picker-card"
                                            [class.media-picker-card--selected]="isAssetSelected(a)"
                                            [class.media-picker-card--dim]="!assetSelectable()"
                                            [disabled]="!assetSelectable()"
                                            [title]="a.originalFilename"
                                            (mouseenter)="onAssetHover($event, a)"
                                            (mouseleave)="onAssetHoverLeave()"
                                            (click)="onAssetClick(a)">
                                        @if (gridUrl(a)) {
                                            <img [src]="gridUrl(a)!" alt=""
                                                 class="media-picker-card__img" />
                                        } @else {
                                            <div class="media-picker-card__placeholder">
                                                <i class="bi bi-file-earmark"></i>
                                            </div>
                                        }
                                        <div class="media-picker-card__label">{{ a.originalFilename }}</div>
                                    </button>
                                }
                            </div>
                        }
                    </div>
                } @else {
                    <!-- Upload tab -->
                    <div class="media-picker-upload">
                        <label class="media-picker-upload__label">Destination</label>
                        <select class="form-select form-select-sm"
                                [value]="uploadDest()"
                                (change)="onUploadDestChange($any($event.target).value)">
                            @for (opt of uploadDestOptions(); track opt.path) {
                                <option [value]="opt.path"
                                        [disabled]="!opt.canWrite"
                                        [class.media-picker-upload__option--locked]="!opt.canWrite">
                                    {{ opt.canWrite ? opt.label : opt.label + ' (no permission)' }}
                                </option>
                            }
                        </select>

                        @if (!uploadDestCanWrite()) {
                            <p class="media-picker-upload__warning">
                                <i class="bi bi-exclamation-triangle me-1"></i>
                                You don't have permission to upload here. Choose another destination.
                            </p>
                        }

                        <label class="media-picker-dropzone"
                               [cmsDropzone]="dropzoneConfig()"
                               [class.media-picker-dropzone--disabled]="!uploadDestCanWrite()"
                               [attr.aria-disabled]="!uploadDestCanWrite() ? 'true' : null"
                               (filesDropped)="onFilesDropped($event)">
                            <i class="bi bi-cloud-arrow-up media-picker-dropzone__icon"></i>
                            <div>Drop files here or click to browse</div>
                            <input type="file" hidden
                                   [accept]="acceptForInput()"
                                   [multiple]="cardinality() === 'many'"
                                   [disabled]="!uploadDestCanWrite()"
                                   (change)="onFileInput($any($event.target).files)" />
                        </label>

                        @if (uploadProgress() !== null) {
                            <div class="media-picker-progress">
                                <div class="media-picker-progress__row">
                                    <span class="media-picker-progress__name">{{ uploadFilename() }}</span>
                                    <span>{{ uploadProgress() }}%</span>
                                </div>
                                <div class="media-picker-progress__bar">
                                    <div class="media-picker-progress__fill"
                                         [class.media-picker-progress__fill--err]="uploadError() !== null"
                                         [style.width.%]="uploadProgress()"></div>
                                </div>
                                @if (uploadError(); as err) {
                                    <p class="media-picker-progress__err">{{ err }}</p>
                                }
                            </div>
                        }
                    </div>
                }

                <!-- Footer -->
                <div class="media-picker-footer">
                    @if (mode === 'dropdown') {
                        <button type="button" class="cms-btn cms-btn-sm cms-btn-ghost"
                                (click)="openModal()">Open browser</button>
                    } @else if (mode === 'embedded' && enableInsertModeToggle()) {
                        <!-- Plain-HTML escape hatch only makes sense when inserting
                             into a rich-text editor (embedded host). Form fields
                             that store a uuid never see this toggle. The host
                             can also suppress it (e.g., gallery mode where Plain
                             HTML rendering of a collection is out of scope). -->
                        <div class="media-picker-insert-mode" role="group" aria-label="Insert mode">
                            <span class="media-picker-insert-mode__label">Insert as:</span>
                            <label class="media-picker-insert-mode__option">
                                <input type="radio" name="mp-insert-mode"
                                       [checked]="insertMode() === 'widget'"
                                       (change)="setInsertMode('widget')" />
                                <span>Widget</span>
                            </label>
                            <label class="media-picker-insert-mode__option">
                                <input type="radio" name="mp-insert-mode"
                                       [checked]="insertMode() === 'plain'"
                                       (change)="setInsertMode('plain')" />
                                <span>Plain HTML</span>
                            </label>
                        </div>
                    } @else {
                        <span></span>
                    }
                    <div class="d-flex gap-2">
                        <button type="button" class="cms-btn cms-btn-sm"
                                (click)="cancelFromMode(mode)">Cancel</button>
                        <button type="button" class="cms-btn cms-btn-sm cms-btn-primary"
                                [disabled]="pending().length === 0"
                                (click)="confirmFromMode(mode)">Confirm</button>
                    </div>
                </div>
            </div>
        </ng-template>
    `,
    styles: [`
        :host { display: block; }

        /* ── Trigger chips ── */
        .media-picker-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 0 4px;
            background: var(--cms-border-light);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            max-width: 100%;
        }
        .media-picker-chip__icon { flex-shrink: 0; }
        .media-picker-chip__img {
            width: 18px;
            height: 18px;
            object-fit: cover;
            border-radius: 2px;
            flex-shrink: 0;
        }
        .media-picker-chip__name {
            font-size: .75rem;
            color: var(--cms-text);
            max-width: 140px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .media-picker-chip__close { font-size: .55rem; }

        /* ── Outer dropdown panel: fixed dimensions, smart-positioning friendly */
        .media-picker-panel {
            display: flex;
            flex-direction: column;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            box-shadow: var(--cms-shadow-md);
            /* Width: respect trigger but enforce comfortable minimum */
            width: max(480px, var(--mp-trigger-width, 480px));
            max-width: min(720px, calc(100vw - 32px));
            /* Height: fixed minimum so empty state has presence; bounded by viewport */
            min-height: 360px;
            max-height: min(560px, calc(100vh - 120px));
            overflow: hidden;
        }

        @media (max-width: 600px) {
            .media-picker-panel {
                width: calc(100vw - 16px);
                max-width: calc(100vw - 16px);
            }
        }

        /* ── Inner body: column flex; modal mode keeps a sensible floor ── */
        .media-picker-body {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
        }
        .media-picker-body--modal { min-height: 520px; }

        /* ── Tabs ── */
        .media-picker-tabs {
            display: flex;
            border-bottom: 1px solid var(--cms-border);
            flex-shrink: 0;
        }
        .media-picker-tab {
            flex: 1;
            padding: 8px 12px;
            background: var(--cms-surface);
            border: none;
            border-left: 1px solid var(--cms-border);
            color: var(--cms-text-secondary);
            font-size: .8125rem;
            cursor: pointer;
            transition: background .1s, color .1s;

            &:first-child { border-left: none; }
            &:hover:not(.media-picker-tab--active) {
                background: var(--cms-border-light);
                color: var(--cms-text);
            }
        }
        .media-picker-tab--active {
            background: var(--cms-accent-light);
            color: var(--cms-accent-text);
            font-weight: 600;
        }

        /* ── Toolbar (breadcrumb + search) ── */
        .media-picker-toolbar {
            padding: 8px;
            border-bottom: 1px solid var(--cms-border);
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        /* "+ New Collection" trigger button (Gallery mode). */
        .media-picker-create-btn {
            align-self: flex-start;
        }
        /* Inline create-collection form. Lives inside the toolbar so it
           feels like a branch off the breadcrumb / search row, not a
           separate dialog. */
        .media-picker-create-form {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 8px;
            background: var(--cms-bg);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
        }
        .media-picker-create-row {
            display: flex;
            gap: 8px;
            align-items: end;
            flex-wrap: wrap;
        }
        .media-picker-create-row--meta {
            font-size: .75rem;
            color: var(--cms-text-muted);
            align-items: center;
        }
        .media-picker-create-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: .6875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .04em;
            color: var(--cms-text-muted);
            margin: 0;
        }
        .media-picker-create-field--wide { flex: 1; min-width: 200px; input { width: 100%; } }
        .media-picker-create-parent code {
            font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
            color: var(--cms-text);
            background: var(--cms-surface);
            padding: 1px 5px;
            border-radius: var(--cms-radius-sm);
        }
        .media-picker-create-err {
            color: var(--cms-danger);
            font-size: .75rem;
            font-weight: 500;
        }
        .media-picker-create-spacer { flex: 1; }
        .media-picker-crumbs {
            display: flex;
            align-items: center;
            gap: 2px;
            flex-wrap: wrap;
            font-size: .75rem;
        }
        .media-picker-crumb {
            padding: 2px 6px;
            background: none;
            border: none;
            color: var(--cms-text-secondary);
            border-radius: var(--cms-radius-sm);
            cursor: pointer;
            font-size: .75rem;

            &:hover:not(:disabled) { background: var(--cms-border-light); color: var(--cms-text); }
            &:disabled { cursor: default; }
        }
        .media-picker-crumb--active {
            color: var(--cms-text);
            font-weight: 500;
        }
        .media-picker-crumb-sep {
            color: var(--cms-text-muted);
            font-size: .75rem;
            user-select: none;
        }

        /* ── Grid wrapper: fills available space, prevents collapse ── */
        .media-picker-grid-wrapper {
            flex: 1;
            min-height: 200px;
            overflow-y: auto;
            padding: 8px;
        }

        /* ── Empty / loading states: centered, occupies space ── */
        .media-picker-empty {
            min-height: 180px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            color: var(--cms-text-muted);
            padding: 32px 16px;
            font-size: .8125rem;
            text-align: center;
        }
        .media-picker-empty__icon {
            font-size: 2rem;
            color: var(--cms-text-muted);
            opacity: .6;
        }
        .media-picker-empty__error {
            color: var(--cms-danger);
            font-size: .8125rem;
            margin: 0;
        }

        /* ── Recent strip ── */
        .media-picker-recent {
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--cms-border-light);
        }
        .media-picker-recent__label {
            font-size: .6875rem;
            font-weight: 700;
            letter-spacing: .04em;
            text-transform: uppercase;
            color: var(--cms-text-muted);
            margin-bottom: 4px;
        }
        .media-picker-recent__row {
            display: flex;
            gap: 4px;
            overflow-x: auto;
            padding-bottom: 4px;
        }

        /* ── Asset / folder grid ── */
        .media-picker-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
            gap: 6px;
        }
        .media-picker-grid--modal {
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        }

        /* ── Cards (assets + folders + recent chips) ── */
        .media-picker-card {
            display: block;
            padding: 4px;
            background: var(--cms-surface);
            border-width: 1px;
            border-style: solid;
            border-color: var(--cms-border);
            border-radius: var(--cms-radius-sm);
            cursor: pointer;
            text-align: left;
            transition: border-color .1s, box-shadow .1s;

            &:disabled { cursor: not-allowed; }
        }
        .media-picker-card:hover:not(:disabled):not(.media-picker-card--selected):not(.media-picker-card--dim) {
            border-color: var(--cms-btn-hover-border);
        }
        .media-picker-card--recent {
            width: 60px;
            flex-shrink: 0;
        }
        .media-picker-card.media-picker-card--selected {
            border-width: 2px;
            border-color: var(--cms-accent);
            padding: 3px; /* compensate for thicker border */
        }
        .media-picker-card--dim { opacity: .5; }
        .media-picker-card__img {
            width: 100%;
            aspect-ratio: 1 / 1;
            object-fit: cover;
            display: block;
            border-radius: 2px;
        }
        .media-picker-card__placeholder {
            width: 100%;
            aspect-ratio: 1 / 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--cms-text-muted);
            background: var(--cms-bg);
            border-radius: 2px;
        }
        .media-picker-card__folder {
            width: 100%;
            aspect-ratio: 1 / 1;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
        }
        .media-picker-card__label {
            margin-top: 4px;
            font-size: .75rem;
            color: var(--cms-text);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* ── Upload tab ── */
        .media-picker-upload {
            padding: 12px;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .media-picker-upload__label {
            font-size: .75rem;
            font-weight: 500;
            color: var(--cms-text-secondary);
            margin: 0;
        }
        .media-picker-dropzone {
            flex: 1;
            min-height: 140px;
            padding: 16px;
            border: 2px dashed var(--cms-border);
            border-radius: var(--cms-radius);
            background: var(--cms-bg);
            color: var(--cms-text-muted);
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            transition: border-color .1s, background .1s;
            font-size: .8125rem;
            text-align: center;
        }
        .media-picker-dropzone.cms-dropzone--active {
            border-color: var(--cms-accent);
            background: var(--cms-accent-light);
            color: var(--cms-accent-text);
        }
        .media-picker-dropzone__icon {
            font-size: 2rem;
            color: var(--cms-text-secondary);
        }
        /* Forbidden destination: dropzone reads as a warning chip; pointer
           events killed so click-to-browse and drop are both no-ops. */
        .media-picker-dropzone--disabled {
            cursor: not-allowed;
            opacity: .6;
            border-color: var(--cms-warning);
            background: var(--cms-warning-light);
            color: var(--cms-warning);
            pointer-events: none;
        }

        /* Forbidden-destination warning message under the select. */
        .media-picker-upload__warning {
            margin: 0;
            padding: 6px 8px;
            border-radius: var(--cms-radius-sm);
            background: var(--cms-warning-light);
            color: var(--cms-warning);
            font-size: .75rem;
            display: flex;
            align-items: center;
        }

        /* Style hint for disabled options (browsers vary on native styling). */
        .media-picker-upload__option--locked { color: var(--cms-text-muted); }

        /* ── Upload progress ── */
        .media-picker-progress { display: flex; flex-direction: column; gap: 4px; }
        .media-picker-progress__row {
            display: flex;
            justify-content: space-between;
            font-size: .75rem;
            color: var(--cms-text-secondary);
        }
        .media-picker-progress__name {
            max-width: 60%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .media-picker-progress__bar {
            height: 6px;
            background: var(--cms-border-light);
            border-radius: 3px;
            overflow: hidden;
        }
        .media-picker-progress__fill {
            height: 100%;
            background: var(--cms-accent);
            transition: width .15s;
        }
        .media-picker-progress__fill--err { background: var(--cms-danger); }
        .media-picker-progress__err {
            color: var(--cms-danger);
            font-size: .75rem;
            margin: 4px 0 0;
        }

        /* ── Footer (Open browser / Cancel / Confirm) ── */
        .media-picker-footer {
            padding: 8px 12px;
            border-top: 1px solid var(--cms-border);
            background: var(--cms-bg);
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }

        /* ── 'Insert as' toggle (embedded mode only) ── */
        .media-picker-insert-mode {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: .75rem;
            color: var(--cms-text-secondary);
        }
        .media-picker-insert-mode__label { font-weight: 500; }
        .media-picker-insert-mode__option {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            user-select: none;

            input[type="radio"] {
                accent-color: var(--cms-accent);
                margin: 0;
            }
        }

        /* ── Hover preview popup ── */
        .media-picker-hover {
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            box-shadow: var(--cms-shadow-md);
            padding: 8px;
            text-align: center;
            max-width: 280px;
        }
        .media-picker-hover__img {
            max-width: 260px;
            max-height: 200px;
            object-fit: contain;
            display: block;
            margin: 0 auto;
        }
        .media-picker-hover__name {
            font-size: .75rem;
            color: var(--cms-text);
            margin-top: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .media-picker-hover__dim {
            font-size: .6875rem;
            color: var(--cms-text-muted);
        }
    `],
})
export class MediaPickerComponent implements OnDestroy {
    options     = input<MediaPickerOptions>({});
    /** Field value: scalar in single-cardinality, array in many. */
    value       = input<string | string[] | null>(null);
    disabled    = input<boolean>(false);
    /** Read off `relation.cardinality` by RelationFieldComponent. */
    cardinality = input<'one' | 'many'>('one');
    /**
     * 'inline' (default) renders trigger + dropdown.
     * 'embedded' renders only the panel — the host owns chrome and sizing.
     */
    mode        = input<MediaPickerMode>('inline');
    /**
     * Show the embedded-mode 'Insert as' (Widget / Plain HTML) toggle in the
     * footer. Defaults to true. The host suppresses it for use cases where
     * plain-HTML insertion doesn't apply (gallery mode is the current one).
     */
    enableInsertModeToggle = input<boolean>(true);
    /**
     * Show a "+ New Collection" button + inline create form in the Library
     * tab. Defaults to false; the host enables it in Gallery mode so the
     * user can create a new collection without leaving the picker.
     */
    enableCreateCollection = input<boolean>(false);

    valueChange = output<MediaPickerEmit>();

    placeholder = 'Select media…';

    /**
     * CDK tries each ConnectedPosition in order and uses the first that fits the
     * viewport. Below-trigger is the natural default; above-trigger kicks in
     * when there isn't room (trigger near viewport bottom). Combined with
     * `cdkConnectedOverlayPush=true` and a 16px viewport margin, this avoids
     * the overflow that hid the Confirm/Cancel buttons.
     */
    readonly overlayPositions: ConnectedPosition[] = [
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top',    offsetY: 4 },
        { originX: 'start', originY: 'top',    overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
    ];

    /** Below this viewport size we skip the dropdown and open the modal directly. */
    private static readonly MIN_DROPDOWN_VH = 400;
    private static readonly MIN_DROPDOWN_VW = 400;

    readonly hoverPositions: ConnectedPosition[] = [
        { originX: 'end',   originY: 'top',    overlayX: 'start', overlayY: 'top',    offsetX: 8 },
        { originX: 'start', originY: 'top',    overlayX: 'end',   overlayY: 'top',    offsetX: -8 },
        { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top',  offsetY: 8 },
    ];

    @ViewChild('triggerOrigin', { read: ElementRef, static: false })
    private readonly triggerRef?: ElementRef<HTMLElement>;

    @ViewChild('panel', { static: true })
    private readonly panelTpl!: TemplateRef<{ $implicit: PanelMode }>;

    private readonly svc        = inject(MediaService);
    private readonly dialog     = inject(Dialog);
    private readonly destroyRef = inject(DestroyRef);
    private readonly store      = inject(Store);

    // ── Library state ────────────────────────────────────────────────────────
    readonly dropdownOpen = signal(false);
    readonly zone         = signal<MediaPickerZone>('shared');
    readonly activeTab    = signal<ActiveTab>('library');
    readonly currentPath  = signal<string>('/media');
    readonly searchInput  = signal('');
    private readonly searchSubject   = new Subject<string>();
    private readonly debouncedSearch = signal('');
    readonly assets       = signal<MediaAssetDto[]>([]);
    readonly subfolders   = signal<CollectionEntry[]>([]);
    readonly loading      = signal(false);
    readonly error        = signal<string | null>(null);

    /** Picks made during the open session; promoted on Confirm. */
    readonly pending  = signal<PendingPick[]>([]);
    /** Currently-bound selections; drives the trigger chips. */
    readonly selected = signal<MediaPickerSelection[]>([]);

    /** Recent row data hydrated from localStorage on every panel open. */
    readonly recentList = signal<MediaAssetDto[]>([]);
    /** Available preset names from /api/v1/media/presets, fetched once. */
    private readonly presetNames = signal<string[]>([]);

    // Upload
    readonly uploadDest        = signal<string>('/media');
    readonly uploadCollections = signal<CollectionEntry[]>([]);
    readonly uploadProgress    = signal<number | null>(null);
    readonly uploadFilename    = signal<string>('');
    readonly uploadError       = signal<string | null>(null);

    // Create-collection form (Gallery mode only).
    readonly creatingCollection  = signal(false);
    readonly newCollectionName   = signal('');
    readonly newCollectionPreset = signal<'public' | 'members' | 'private'>('public');
    readonly createCollectionError = signal<string | null>(null);
    readonly creatingInFlight    = signal(false);
    /** Path of the collection just created — used to auto-select after upload. */
    private justCreatedPath: string | null = null;

    // Hover preview
    readonly hoverAsset = signal<MediaAssetDto | null>(null);
    /** Element used as the CDK overlay origin for the hover popup. */
    hoverOriginRef: ElementRef | null = null;
    private hoverTimer: ReturnType<typeof setTimeout> | null = null;

    private modalRef: DialogRef<MediaPickerEmit | null> | null = null;
    private readonly modalOpen = signal(false);
    /** Panel is "open" whenever any render path is showing it (embedded is always on). */
    private readonly panelOpen = computed(() =>
        this.mode() === 'embedded' || this.dropdownOpen() || this.modalOpen(),
    );

    /**
     * Embedded-mode-only 'Insert as' preference. Persisted per user so a user
     * who consistently prefers Plain HTML doesn't have to re-pick on every
     * insert. Hydrated lazily from localStorage; default is 'widget'.
     */
    readonly insertMode = signal<InsertMode>(this.readInsertMode());

    private readInsertMode(): InsertMode {
        try {
            const user = this.store.selectSnapshot(AuthState.currentUser);
            const userId = user?.id ?? user?.identifier ?? 'anon';
            const raw = localStorage.getItem(LS_INSERT_MODE + userId);
            return raw === 'plain' ? 'plain' : 'widget';
        } catch {
            return 'widget';
        }
    }

    setInsertMode(m: InsertMode): void {
        this.insertMode.set(m);
        try {
            const user = this.store.selectSnapshot(AuthState.currentUser);
            const userId = user?.id ?? user?.identifier ?? 'anon';
            localStorage.setItem(LS_INSERT_MODE + userId, m);
        } catch { /* ignore */ }
    }

    // ── Options-derived signals ──────────────────────────────────────────────
    readonly bindTarget       = computed(() => this.options().bindTarget ?? 'asset');
    readonly assetSelectable  = computed(() => this.bindTarget() !== 'collection');
    readonly folderSelectable = computed(() => this.bindTarget() === 'collection' || this.bindTarget() === 'either');

    readonly visibleChips = computed(() => this.selected().slice(0, MAX_VISIBLE_CHIPS));
    readonly overflowCount = computed(() => Math.max(0, this.selected().length - MAX_VISIBLE_CHIPS));

    /**
     * Validate the new-collection name against VFS naming rules. Returns the
     * trimmed value when valid, or an error string for inline display.
     */
    readonly nameValidation = computed<{ ok: boolean; trimmed: string; error: string | null }>(() => {
        const trimmed = this.newCollectionName().trim();
        if (trimmed === '')                 return { ok: false, trimmed, error: 'Name required' };
        if (trimmed.includes('/'))          return { ok: false, trimmed, error: 'Name cannot contain slashes' };
        if (/\s/.test(trimmed))             return { ok: false, trimmed, error: 'Name cannot contain whitespace' };
        if (trimmed.startsWith('.'))        return { ok: false, trimmed, error: 'Name cannot start with "."' };
        if (trimmed.startsWith('_'))        return { ok: false, trimmed, error: 'Name cannot start with "_"' };
        return { ok: true, trimmed, error: null };
    });

    readonly breadcrumb = computed<{ label: string; path: string }[]>(() => {
        const root = this.zoneRoot();
        const cur  = this.currentPath();
        const trail: { label: string; path: string }[] = [
            { label: this.zone() === 'shared' ? 'Shared' : 'My files', path: root },
        ];
        if (cur === root) return trail;
        const rest = cur.startsWith(root) ? cur.slice(root.length).replace(/^\//, '') : '';
        let acc = root;
        for (const seg of rest.split('/').filter(Boolean)) {
            acc = `${acc}/${seg}`;
            trail.push({ label: seg, path: acc });
        }
        return trail;
    });

    readonly uploadDestOptions = computed<{ path: string; label: string; canWrite: boolean }[]>(() => {
        const root = this.zoneRoot();
        // Root-of-zone is always treated as writable from the picker's perspective:
        // the actual gate is the server's preset check on POST. Subdirectories
        // carry their own `canWrite` from the API.
        const opts: { path: string; label: string; canWrite: boolean }[] = [
            { path: root, label: this.zone() === 'shared' ? 'Shared root' : 'Private root', canWrite: true },
        ];
        for (const c of this.uploadCollections()) {
            opts.push({
                path:     c.path,
                label:    c.path.replace(root, '').replace(/^\//, '') || c.name,
                canWrite: c.canWrite,
            });
        }
        return opts;
    });

    /** Whether the currently-selected upload destination is writable. */
    readonly uploadDestCanWrite = computed<boolean>(() => {
        const dest = this.uploadDest();
        const opt  = this.uploadDestOptions().find(o => o.path === dest);
        // Unknown destination (collections list still loading) defaults to true
        // so the dropzone stays interactive; the server is the source of truth.
        return opt?.canWrite ?? true;
    });

    constructor() {
        this.searchSubject.pipe(
            debounceTime(250),
            distinctUntilChanged(),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(q => this.debouncedSearch.set(q));

        // Reload library when zone / path / search change while panel open.
        effect(() => {
            this.zone(); this.debouncedSearch(); this.currentPath();
            if (!this.panelOpen() || this.activeTab() !== 'library') return;
            untracked(() => this.loadCurrentLevel());
        });

        // First library load when panel opens.
        effect(() => {
            if (!this.panelOpen() || this.activeTab() !== 'library') return;
            untracked(() => {
                if (this.assets().length === 0 && this.subfolders().length === 0) this.loadCurrentLevel();
                if ((this.options().recentlyUsed ?? false) && this.recentList().length === 0) this.hydrateRecent();
            });
        });

        // Upload tab collection list.
        effect(() => {
            this.zone(); this.activeTab();
            if (!this.panelOpen() || this.activeTab() !== 'upload') return;
            untracked(() => this.loadUploadCollections());
        });

        // Validate display:'preset:<name>' against the live config.
        effect(() => {
            const d = this.options().display;
            if (typeof d !== 'string' || !d.startsWith('preset:')) return;
            untracked(() => {
                if (this.presetNames().length > 0) {
                    this.warnIfPresetUnknown(d);
                    return;
                }
                this.svc.listPresets().pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe(names => {
                        this.presetNames.set(names);
                        this.warnIfPresetUnknown(d);
                    });
            });
        });

        // Hydrate chip(s) from the bound value.
        effect(() => {
            const v = this.value();
            const opts = this.options();
            untracked(() => this.hydrateFromValue(v, opts));
        });
    }

    ngOnDestroy(): void {
        if (this.hoverTimer !== null) clearTimeout(this.hoverTimer);
        this.modalRef?.close(null);
    }

    triggerWidth(): number {
        return this.triggerRef?.nativeElement.offsetWidth ?? 0;
    }

    // ── Dropdown / modal lifecycle ──────────────────────────────────────────

    toggleDropdown(): void {
        if (this.disabled()) return;
        if (this.dropdownOpen()) { this.closeDropdown(); return; }
        // Seed pending from current selection so it appears highlighted.
        this.pending.set(this.selected().map(s => ({
            kind: s.kind,
            value: s.kind === 'asset' ? s.uuid : (s.path ?? ''),
        })));
        // Tiny viewports cannot fit the dropdown's minimum dimensions; escalate
        // to modal so the picker still works (Bootstrap-style mobile UX).
        if (window.innerHeight < MediaPickerComponent.MIN_DROPDOWN_VH
            || window.innerWidth < MediaPickerComponent.MIN_DROPDOWN_VW) {
            this.openModal();
            return;
        }
        this.dropdownOpen.set(true);
    }

    closeDropdown(): void {
        if (this.dropdownOpen()) this.dropdownOpen.set(false);
        this.cancelHover();
    }

    openModal(): void {
        this.dropdownOpen.set(false);
        this.modalOpen.set(true);
        const ref = this.dialog.open<MediaPickerEmit | null>(this.panelTpl, {
            backdropClass: 'cdk-overlay-dark-backdrop',
            width: '760px',
            maxWidth: '95vw',
            templateContext: { $implicit: 'modal' as const },
        });
        this.modalRef = ref;
        ref.closed.subscribe(result => {
            this.modalRef = null;
            this.modalOpen.set(false);
            this.cancelHover();
            if (result !== undefined && result !== null) this.applyEmit(result);
        });
    }

    cancelFromMode(mode: PanelMode): void {
        this.pending.set([]);
        if (mode === 'modal') this.modalRef?.close(null);
        else if (mode === 'embedded') this.valueChange.emit(null);
        else this.closeDropdown();
    }

    confirmFromMode(mode: PanelMode): void {
        if (this.pending().length === 0) return;
        const emit = this.toEmit(this.pending());
        if (mode === 'modal') this.modalRef?.close(emit);
        else if (mode === 'embedded') {
            // Host owns dialog dismissal; emit the selection and let it act.
            this.applyEmit(emit);
        }
        else { this.applyEmit(emit); this.closeDropdown(); }
    }

    // ── Tabs / zones / navigation ───────────────────────────────────────────

    setLibraryZone(z: MediaPickerZone): void {
        this.activeTab.set('library');
        if (this.zone() === z && this.currentPath() === this.zoneRoot()) return;
        this.zone.set(z);
        this.currentPath.set(this.zoneRoot(z));
        this.searchInput.set(''); this.debouncedSearch.set('');
        if (this.options().recentlyUsed ?? false) this.hydrateRecent();
    }

    setActiveTab(tab: ActiveTab): void {
        this.activeTab.set(tab);
        if (tab === 'upload') {
            const saved = this.readLastUploadCollection();
            this.uploadDest.set(saved ?? this.currentPath());
        }
    }

    navigateTo(path: string): void {
        if (this.currentPath() === path) return;
        this.currentPath.set(path);
        this.searchInput.set(''); this.debouncedSearch.set('');
    }

    onSearchInput(v: string): void {
        this.searchInput.set(v);
        this.searchSubject.next(v);
    }

    // ── Selection ────────────────────────────────────────────────────────────

    onAssetClick(a: MediaAssetDto): void {
        if (!this.assetSelectable()) return;
        this.togglePending({ kind: 'asset', value: a.id });
    }

    onFolderClick(f: CollectionEntry): void {
        if (!this.folderSelectable()) { this.navigateTo(f.path); return; }
        this.togglePending({ kind: 'collection', value: f.path });
    }

    private togglePending(p: PendingPick): void {
        const cur = this.pending();
        const idx = cur.findIndex(x => x.kind === p.kind && x.value === p.value);
        if (this.cardinality() === 'many') {
            if (idx >= 0) this.pending.set(cur.filter((_, i) => i !== idx));
            else          this.pending.set([...cur, p]);
        } else {
            // Single: replace or toggle off if same.
            this.pending.set(idx >= 0 ? [] : [p]);
        }
    }

    isAssetSelected(a: MediaAssetDto): boolean {
        return this.pending().some(p => p.kind === 'asset' && p.value === a.id);
    }

    isFolderSelected(f: CollectionEntry): boolean {
        return this.pending().some(p => p.kind === 'collection' && p.value === f.path);
    }

    onChipRemove(event: Event, idx: number): void {
        event.stopPropagation();
        if (this.disabled()) return;
        const next = this.selected().filter((_, i) => i !== idx);
        this.selected.set(next);
        this.pending.set([]);
        this.valueChange.emit(this.toEmit(next.map(s => ({
            kind: s.kind,
            value: s.kind === 'asset' ? s.uuid : (s.path ?? ''),
        }))));
    }

    reload(): void { this.loadCurrentLevel(); }

    // ── Hover preview ───────────────────────────────────────────────────────

    onAssetHover(event: MouseEvent, a: MediaAssetDto): void {
        if (!(this.options().hoverPreview ?? false)) return;
        // Skip on coarse pointers (touch) — hover previews are pointer-only.
        if (window.matchMedia('(hover: none)').matches) return;
        if (this.hoverTimer !== null) clearTimeout(this.hoverTimer);
        const target = event.currentTarget as HTMLElement;
        this.hoverTimer = setTimeout(() => {
            this.hoverOriginRef = new ElementRef(target);
            this.hoverAsset.set(a);
        }, HOVER_DELAY_MS);
    }

    onAssetHoverLeave(): void { this.cancelHover(); }

    private cancelHover(): void {
        if (this.hoverTimer !== null) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }
        this.hoverAsset.set(null);
        this.hoverOriginRef = null;
    }

    // ── Upload ──────────────────────────────────────────────────────────────

    onUploadDestChange(path: string): void { this.uploadDest.set(path); }

    /** Pick the first writable destination after the collections list loads. */
    private ensureWritableDestination(): void {
        if (this.uploadDestCanWrite()) return;
        const firstWritable = this.uploadDestOptions().find(o => o.canWrite);
        if (firstWritable) this.uploadDest.set(firstWritable.path);
    }

    /**
     * Per-render dropzone config: gates on the permission state and
     * applies the picker's `accept` glob + `cardinality` so the shared
     * directive filters dropped files identically to the file input.
     */
    readonly dropzoneConfig = computed<CmsDropzoneConfig>(() => {
        const raw = (this.options().accept ?? '*').trim();
        const accept = raw === '' || raw === '*'
            ? undefined
            : raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
        return {
            accept,
            multiple: this.cardinality() === 'many',
            disabled: !this.uploadDestCanWrite(),
        };
    });

    onFilesDropped(files: File[]): void {
        // The directive already filtered by mime + cardinality. The
        // permission gate is enforced via `disabled` in the config, so
        // a non-writable destination never reaches this handler.
        if (files.length === 0) return;
        this.startUploadSequence(files);
    }
    onFileInput(files: FileList | null): void {
        if (!files || files.length === 0) return;
        const list = Array.from(files);
        if (this.cardinality() === 'one') this.startUploadSequence(list.slice(0, 1));
        else this.startUploadSequence(list);
    }

    private startUploadSequence(files: File[]): void {
        if (files.length === 0) return;
        const dest = this.uploadDest();
        const total = files.length;
        let idx = 0;
        const newIds: string[] = [];

        const next = (): void => {
            if (idx >= total) {
                // All done. Switch back to the Library tab and seed pending picks.
                // For collection-bind mode (Gallery host) the user is selecting a
                // *folder*, so seed pending with the destination collection
                // rather than the just-uploaded asset ids.
                try { localStorage.setItem(LS_LAST_UPLOAD + this.zone(), dest); } catch { /* ignore */ }
                if (this.bindTarget() === 'collection') {
                    this.pending.set([{ kind: 'collection' as const, value: dest }]);
                } else {
                    this.pending.set(newIds.map(id => ({ kind: 'asset' as const, value: id })));
                }
                this.currentPath.set(dest);
                this.activeTab.set('library');
                this.loadCurrentLevel();
                this.uploadProgress.set(null);
                this.justCreatedPath = null;
                return;
            }
            const file = files[idx];
            this.uploadFilename.set(total > 1 ? `${file.name} (${idx + 1} of ${total})` : file.name);
            this.uploadProgress.set(0);
            this.uploadError.set(null);
            this.svc.upload(file, dest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(p => {
                this.uploadProgress.set(p.progress);
                if (p.status === 'error') {
                    this.uploadError.set(p.error ?? 'Upload failed.');
                    return; // stop the sequence on error
                }
                if (p.status === 'done' && p.assetId) {
                    newIds.push(p.assetId);
                    idx++;
                    next();
                }
            });
        };
        next();
    }

    acceptForInput(): string {
        const a = this.options().accept ?? '*';
        return a === '*' ? '' : a;
    }

    // ── Create collection (Gallery-mode helper) ───────────────────────────

    openCreateCollectionForm(): void {
        this.creatingCollection.set(true);
        this.newCollectionName.set('');
        this.newCollectionPreset.set('public');
        this.createCollectionError.set(null);
    }

    cancelCreateCollection(): void {
        this.creatingCollection.set(false);
        this.createCollectionError.set(null);
        this.newCollectionName.set('');
    }

    submitCreateCollection(): void {
        const v = this.nameValidation();
        if (!v.ok || this.creatingInFlight()) return;

        const parent = this.currentPath().replace(/\/+$/, '');
        const fullPath = `${parent}/${v.trimmed}`;
        this.creatingInFlight.set(true);
        this.createCollectionError.set(null);

        this.svc.createCollection(fullPath, this.newCollectionPreset())
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.creatingInFlight.set(false);
                    this.creatingCollection.set(false);
                    this.justCreatedPath = fullPath;
                    // Refresh local state: navigate into the new collection
                    // and pre-select it as the upload destination.
                    this.currentPath.set(fullPath);
                    this.uploadDest.set(fullPath);
                    this.loadCurrentLevel();
                    this.loadUploadCollections();
                    this.activeTab.set('upload');
                },
                error: (err: { error?: { detail?: string }; message?: string; status?: number }) => {
                    this.creatingInFlight.set(false);
                    const detail = err?.error?.detail ?? err?.message ?? 'Failed to create collection.';
                    // 409 → already exists; surface a friendlier hint without
                    // hiding the server's detail message for other errors.
                    this.createCollectionError.set(
                        err?.status === 409 ? `Collection already exists: ${detail}` : detail,
                    );
                },
            });
    }

    // ── Display helpers ──────────────────────────────────────────────────────

    chipUrl(s: MediaPickerSelection): string | null {
        return this.resolveUrl(s.thumbUrl, s.origUrl, s.presetUrls);
    }

    gridUrl(a: MediaAssetDto): string | null {
        return this.resolveUrl(a.thumbnailUrl, a.originalUrl, a.presetUrls);
    }

    private resolveUrl(thumb: string | null, original: string | null, presets?: Readonly<Record<string, string>>): string | null {
        const d = this.options().display ?? 'thumb';
        if (typeof d === 'string' && d.startsWith('preset:')) {
            const name = d.slice('preset:'.length);
            const url = presets?.[name];
            if (url) return url;
            // Fall back to thumb when the preset isn't generated yet.
            return thumb ?? original;
        }
        return d === 'original' ? (original ?? thumb) : (thumb ?? original);
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private toEmit(picks: PendingPick[]): MediaPickerEmit {
        if (picks.length === 0) return null;
        const isMany   = this.cardinality() === 'many';
        const isEither = this.bindTarget() === 'either';
        const bv       = this.options().bindValue ?? 'uuid';

        const one = (p: PendingPick): string | { kind: 'asset' | 'collection'; value: string } => {
            if (isEither) return { kind: p.kind, value: p.value };
            if (p.kind === 'asset' && bv === 'path') {
                const a = this.assets().find(x => x.id === p.value);
                return a?.path ?? p.value;
            }
            return p.value;
        };

        if (isMany) {
            const arr = picks.map(one);
            return isEither
                ? (arr as ReadonlyArray<{ kind: 'asset' | 'collection'; value: string }>)
                : (arr as string[]);
        }
        return one(picks[0]);
    }

    private applyEmit(emit: MediaPickerEmit): void {
        const sel = this.emitToSelections(emit);
        this.selected.set(sel);
        this.pending.set([]);
        this.valueChange.emit(emit);
        // LRU update for asset picks
        if ((this.options().recentlyUsed ?? false)) this.updateRecent(sel);
    }

    private emitToSelections(emit: MediaPickerEmit): MediaPickerSelection[] {
        if (emit === null) return [];
        // Normalise to an array of (string | {kind,value}) regardless of whether
        // the picker emitted a scalar or an array of either flavour.
        const raw: ReadonlyArray<unknown> = Array.isArray(emit) ? emit : [emit];
        const flat: Array<string | { kind: 'asset' | 'collection'; value: string }> = [];
        for (const item of raw) {
            if (typeof item === 'string') {
                flat.push(item);
            } else if (item && typeof item === 'object'
                && 'kind' in item && 'value' in item
                && typeof (item as { value: unknown }).value === 'string'
            ) {
                const it = item as { kind: 'asset' | 'collection'; value: string };
                flat.push({ kind: it.kind, value: it.value });
            }
        }
        return flat.map(item => this.itemToSelection(item)).filter((s): s is MediaPickerSelection => s !== null);
    }

    private itemToSelection(item: string | { kind: 'asset' | 'collection'; value: string }): MediaPickerSelection | null {
        if (typeof item === 'string') {
            if (this.bindTarget() === 'collection') {
                return { kind: 'collection', uuid: '', path: item, filename: item.split('/').pop() ?? item, thumbUrl: null, origUrl: null };
            }
            const a = this.assets().find(x => x.id === item);
            return a ? this.assetToSelection(a) : { kind: 'asset', uuid: item, path: null, filename: item, thumbUrl: null, origUrl: null };
        }
        if (item.kind === 'collection') {
            return { kind: 'collection', uuid: '', path: item.value, filename: item.value.split('/').pop() ?? item.value, thumbUrl: null, origUrl: null };
        }
        const a = this.assets().find(x => x.id === item.value);
        return a ? this.assetToSelection(a) : { kind: 'asset', uuid: item.value, path: null, filename: item.value, thumbUrl: null, origUrl: null };
    }

    private assetToSelection(a: MediaAssetDto): MediaPickerSelection {
        return {
            kind:        'asset',
            uuid:        a.id,
            path:        a.path ?? null,
            filename:    a.originalFilename,
            thumbUrl:    a.thumbnailUrl,
            origUrl:     a.originalUrl,
            presetUrls:  a.presetUrls,
            // Natural dimensions flow through so the host's Single config row
            // can pre-fill width/height inputs from the chosen asset.
            dimensions:  a.dimensions
                ? { width: a.dimensions.width, height: a.dimensions.height }
                : null,
        };
    }

    private loadCurrentLevel(): void {
        this.loading.set(true);
        this.error.set(null);
        const accept = this.options().accept ?? '*';
        const mimePrefix = (accept !== '*' && !accept.includes(','))
            ? accept.replace(/\*$/, '')
            : '';
        const dir = this.currentPath();

        this.svc.listCollections(dir, 1)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: list => this.subfolders.set(list.filter(c => c.path !== dir)),
                error: () => this.subfolders.set([]),
            });

        this.svc.list({
            page:     1,
            limit:    50,
            search:   this.debouncedSearch().trim() || undefined,
            mimeType: mimePrefix || undefined,
            dir:      dir,
            // Hide assets that aren't fully processed — selecting a
            // pending / failed asset would hand the consumer a URL
            // that may still be re-pointed by the processing
            // pipeline. Cleaner than showing disabled tiles.
            status:   'ready',
        })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: r => {
                    let items = r.member;
                    if (accept !== '*' && accept.includes(',')) {
                        const allowed = accept.split(',').map(s => s.trim()).filter(Boolean);
                        items = items.filter(a => allowed.some(g =>
                            g.endsWith('*') ? a.mimeType.startsWith(g.slice(0, -1)) : a.mimeType === g,
                        ));
                    }
                    this.assets.set(items);
                    this.loading.set(false);
                },
                error: () => {
                    this.assets.set([]);
                    this.loading.set(false);
                    this.error.set('Failed to load media.');
                },
            });
    }

    private loadUploadCollections(): void {
        this.svc.listCollections(this.zoneRoot(), 5)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: list => {
                    this.uploadCollections.set(list);
                    // The last-used destination (from localStorage) may now be
                    // forbidden for this user — shift to the first writable
                    // option so the dropzone isn't stuck disabled on open.
                    this.ensureWritableDestination();
                },
                error: () => this.uploadCollections.set([]),
            });
    }

    private zoneRoot(z: MediaPickerZone = this.zone()): string {
        if (z === 'shared') return '/media';
        const user = this.store.selectSnapshot(AuthState.currentUser);
        const handle = user?.identifier ?? '';
        return handle ? `/home/${handle}/media` : '/media';
    }

    private hydrateFromValue(v: string | string[] | null, opts: MediaPickerOptions): void {
        if (v === null || (Array.isArray(v) && v.length === 0)) { this.selected.set([]); return; }
        const list: string[] = Array.isArray(v) ? v : [v];
        const bv = opts.bindValue ?? 'uuid';
        const out: MediaPickerSelection[] = [];
        let pending = list.length;

        const finish = (): void => { if (pending === 0) this.selected.set(out); };

        for (const raw of list) {
            // bindTarget: 'either' values may have been JSON-encoded by RelationFieldComponent.
            // Try to parse; if it yields a {kind,value} object, treat as collection/asset accordingly.
            let actual = raw;
            let kindOverride: 'asset' | 'collection' | null = null;
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && (parsed.kind === 'asset' || parsed.kind === 'collection') && typeof parsed.value === 'string') {
                    kindOverride = parsed.kind;
                    actual = parsed.value;
                }
            } catch { /* not JSON, treat as plain string */ }

            if (kindOverride === 'collection' || (kindOverride === null && this.bindTarget() === 'collection')) {
                out.push({ kind: 'collection', uuid: '', path: actual, filename: actual.split('/').pop() ?? actual, thumbUrl: null, origUrl: null });
                pending--; finish();
                continue;
            }

            if (bv === 'uuid') {
                this.svc.get(actual).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
                    next: a => { out.push(this.assetToSelection(a)); pending--; finish(); },
                    error: () => { pending--; finish(); },
                });
            } else {
                this.svc.lookupByPath(actual).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(a => {
                    if (a) out.push({ ...this.assetToSelection(a), path: actual });
                    else   out.push({ kind: 'asset', uuid: '', path: actual, filename: actual.split('/').pop() ?? actual, thumbUrl: null, origUrl: null });
                    pending--; finish();
                });
            }
        }
    }

    private hydrateRecent(): void {
        const accept = this.options().accept ?? '*';
        const ids = this.readRecentIds();
        if (ids.length === 0) { this.recentList.set([]); return; }
        // Resolve in parallel; preserve LRU order, drop entries that no longer resolve.
        const resolved: MediaAssetDto[] = new Array(ids.length).fill(null);
        let pending = ids.length;
        const finish = (): void => {
            if (pending !== 0) return;
            let items = resolved.filter((a): a is MediaAssetDto => a !== null);
            if (accept !== '*') {
                const list = accept.split(',').map(s => s.trim()).filter(Boolean);
                items = items.filter(a => list.some(g =>
                    g === '*' ? true
                    : g.endsWith('*') ? a.mimeType.startsWith(g.slice(0, -1))
                    : a.mimeType === g,
                ));
            }
            this.recentList.set(items);
        };
        ids.forEach((id, i) => {
            this.svc.get(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
                next: a => { resolved[i] = a; pending--; finish(); },
                error: () => { pending--; finish(); },
            });
        });
    }

    private readRecentIds(): string[] {
        try {
            const user = this.store.selectSnapshot(AuthState.currentUser);
            const userId = user?.id ?? user?.identifier ?? 'anon';
            const raw = localStorage.getItem(LS_RECENT + userId);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
        } catch {
            return [];
        }
    }

    private updateRecent(selections: MediaPickerSelection[]): void {
        try {
            const user = this.store.selectSnapshot(AuthState.currentUser);
            const userId = user?.id ?? user?.identifier ?? 'anon';
            const ids = selections.filter(s => s.kind === 'asset' && s.uuid).map(s => s.uuid);
            if (ids.length === 0) return;
            const existing = this.readRecentIds();
            const merged: string[] = [];
            for (const id of ids)        if (!merged.includes(id)) merged.push(id);
            for (const id of existing)   if (!merged.includes(id)) merged.push(id);
            const trimmed = merged.slice(0, RECENT_LIMIT);
            localStorage.setItem(LS_RECENT + userId, JSON.stringify(trimmed));
        } catch { /* ignore */ }
    }

    private readLastUploadCollection(): string | null {
        try { return localStorage.getItem(LS_LAST_UPLOAD + this.zone()); } catch { return null; }
    }

    private warnIfPresetUnknown(display: string): void {
        const name = display.slice('preset:'.length);
        if (this.presetNames().length > 0 && !this.presetNames().includes(name)) {
             
            console.warn(`MediaPicker: unknown preset "${name}"; falling back to thumb. Available: ${this.presetNames().join(', ')}`);
        }
    }
}
