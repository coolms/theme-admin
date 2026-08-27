import {
    ChangeDetectionStrategy, Component, computed, effect, inject, signal, ViewChild,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { MediaPickerComponent } from './media-picker.component';
import { MediaPickerEmit, MediaPickerOptions, MediaPickerSelection } from './media-picker.types';
import { MediaAssetDto } from './media.types';
import { MediaService } from './media.service';
import { kindForMime, MediaAlign, MediaKind } from './dtmpl/dtmpl-media-node';
import { GalleryType } from './dtmpl/dtmpl-media-gallery-node';
import { AuthState } from '@coolms/core-angular';
const LS_INSERT_MODE    = 'mediaPicker.insertMode.';
const LS_GALLERY_CONFIG = 'mediaPicker.galleryConfig.';
const LS_SINGLE_CONFIG  = 'mediaPicker.singleConfig.';

/** Two insertion intents the host adapts the picker for. */
type HostMode = 'single' | 'gallery';

type SingleSize = 'small' | 'medium' | 'large' | 'print' | 'original';

interface SingleConfig {
    size:    SingleSize;
    align:   MediaAlign | null;
    width:   number | null;
    height:  number | null;
    caption: string;
}

interface GalleryConfig {
    galleryType: GalleryType;
    cols:        number;
    limit:       number;
    depth:       number;
    align:       MediaAlign | null;
}

const GALLERY_CONFIG_DEFAULTS: GalleryConfig = {
    galleryType: 'grid',
    cols:        3,
    limit:       20,
    depth:       1,
    align:       null,
};

const SINGLE_CONFIG_DEFAULTS: SingleConfig = {
    size:    'medium',
    align:   null,
    width:   null,
    height:  null,
    caption: '',
};

export interface MediaPickerHostData {
    readonly options: MediaPickerOptions;
    /**
     * Initial host mode seeded by the action handler. `media.openPicker`
     * passes 'single'; `media.openGalleryPicker` passes 'gallery'. The
     * user can still flip modes inside the dialog via the tab toggle.
     */
    readonly initialMode?: HostMode;
}

/** Result returned to the page editor when the user confirms a pick. */
export type MediaPickerHostResult =
    | {
        readonly type:       'widget';
        readonly uuid:       string;
        readonly size:       SingleSize;
        readonly kind:       MediaKind;
        readonly mime:       string;
        readonly previewUrl: string | null;
        readonly alt:        string | null;
        readonly width:      number | null;
        readonly height:     number | null;
        readonly align:      MediaAlign | null;
        readonly caption:    string | null;
    }
    | {
        readonly type: 'plain';
        readonly html: string;
    }
    | {
        readonly type:         'gallery';
        readonly collectionId: string;
        readonly name:         string;
        readonly galleryType:  GalleryType;
        readonly cols:         number;
        readonly limit:        number;
        readonly depth:        number;
        readonly align:        MediaAlign | null;
    };

/**
 * Hosts MediaPickerComponent inside a CDK Dialog and adapts its emit to the
 * shape the editor's "insert media" command expects: either a single asset
 * (uuid+size+kind+previewUrl), a plain HTML5 snippet, or — when the Gallery
 * tab is active — a `{collectionId, name, galleryType, cols, limit, depth}`
 * payload (the collection path is resolved to its Node UUID) routed to the
 * MediaGalleryWidget Tiptap node.
 *
 * Mode toggle ("Single asset" / "Gallery") rewrites the inner picker's
 * `bindTarget` ('asset' vs 'collection') so folder rows become selectable in
 * gallery mode while assets stay nav-only. Gallery params are sticky in
 * localStorage per user.
 */
@Component({
    selector: 'app-media-picker-host',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, MediaPickerComponent],
    template: `
        <div class="picker-host">
            <div class="cms-dialog-header">
                <span><i class="bi bi-image me-1"></i> Insert media</span>
                <button class="cms-dialog-close" type="button" (click)="cancel()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <!-- Mode toggle: single asset vs gallery. -->
            <div class="picker-host__modes" role="tablist">
                <button type="button"
                        class="picker-host__mode"
                        role="tab"
                        [attr.aria-selected]="hostMode() === 'single'"
                        [class.picker-host__mode--active]="hostMode() === 'single'"
                        (click)="setHostMode('single')">
                    <i class="bi bi-image"></i> Single asset
                </button>
                <button type="button"
                        class="picker-host__mode"
                        role="tab"
                        [attr.aria-selected]="hostMode() === 'gallery'"
                        [class.picker-host__mode--active]="hostMode() === 'gallery'"
                        (click)="setHostMode('gallery')">
                    <i class="bi bi-grid-3x3-gap-fill"></i> Gallery
                </button>
            </div>

            <!-- Mode-specific config row. Both single + gallery rows live in
                 the same min-height container so toggling modes doesn't shift
                 the picker grid below. -->
            <div class="picker-host__config">
                @if (hostMode() === 'gallery') {
                    <label class="picker-host__field">
                        <span>Layout</span>
                        <div class="picker-host__seg">
                            @for (t of galleryTypes; track t) {
                                <button type="button"
                                        class="picker-host__seg-btn"
                                        [class.picker-host__seg-btn--active]="galleryConfig().galleryType === t"
                                        (click)="setGalleryParam('galleryType', t)">
                                    {{ t }}
                                </button>
                            }
                        </div>
                    </label>
                    <label class="picker-host__field" [class.picker-host__field--dim]="galleryConfig().galleryType !== 'grid'">
                        <span>Cols</span>
                        <input type="number" min="1" max="6" class="form-control form-control-sm"
                               [disabled]="galleryConfig().galleryType !== 'grid'"
                               [ngModel]="galleryConfig().cols"
                               (ngModelChange)="setGalleryParam('cols', $event)" />
                    </label>
                    <label class="picker-host__field">
                        <span>Limit</span>
                        <input type="number" min="1" max="100" class="form-control form-control-sm"
                               [ngModel]="galleryConfig().limit"
                               (ngModelChange)="setGalleryParam('limit', $event)" />
                    </label>
                    <label class="picker-host__field">
                        <span>Depth</span>
                        <input type="number" min="1" max="10" class="form-control form-control-sm"
                               [ngModel]="galleryConfig().depth"
                               (ngModelChange)="setGalleryParam('depth', $event)" />
                    </label>
                    <label class="picker-host__field">
                        <span>Align</span>
                        <div class="picker-host__seg">
                            @for (a of alignChoices; track a.value) {
                                <button type="button"
                                        class="picker-host__seg-btn"
                                        [class.picker-host__seg-btn--active]="galleryConfig().align === a.value"
                                        (click)="setGalleryParam('align', a.value)">
                                    {{ a.label }}
                                </button>
                            }
                        </div>
                    </label>
                } @else {
                    <label class="picker-host__field">
                        <span>Size</span>
                        <select class="form-select form-select-sm"
                                [ngModel]="singleConfig().size"
                                (ngModelChange)="setSingleParam('size', $event)">
                            @for (s of singleSizes; track s) {
                                <option [value]="s">{{ s }}</option>
                            }
                        </select>
                    </label>
                    <label class="picker-host__field">
                        <span>Align</span>
                        <div class="picker-host__seg">
                            @for (a of alignChoices; track a.value) {
                                <button type="button"
                                        class="picker-host__seg-btn"
                                        [class.picker-host__seg-btn--active]="singleConfig().align === a.value"
                                        (click)="setSingleParam('align', a.value)">
                                    {{ a.label }}
                                </button>
                            }
                        </div>
                    </label>
                    <label class="picker-host__field">
                        <span>Width</span>
                        <input type="number" min="1" max="4096" class="form-control form-control-sm"
                               [ngModel]="singleConfig().width"
                               (ngModelChange)="setSingleParam('width', $event)" />
                    </label>
                    <label class="picker-host__field">
                        <span>Height</span>
                        <input type="number" min="1" max="4096" class="form-control form-control-sm"
                               [ngModel]="singleConfig().height"
                               (ngModelChange)="setSingleParam('height', $event)" />
                    </label>
                    <label class="picker-host__field picker-host__field--wide">
                        <span>Caption</span>
                        <input type="text" class="form-control form-control-sm"
                               placeholder="Optional caption"
                               [ngModel]="singleConfig().caption"
                               (ngModelChange)="setSingleParam('caption', $event)" />
                    </label>
                }
            </div>

            <div class="picker-host__body">
                <app-media-picker
                    [options]="pickerOptions()"
                    [value]="value()"
                    [cardinality]="'one'"
                    [mode]="'embedded'"
                    [enableInsertModeToggle]="hostMode() !== 'gallery'"
                    [enableCreateCollection]="hostMode() === 'gallery'"
                    (valueChange)="onPicked($event)" />
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            width: min(90vw, 800px);
            height: min(80vh, 720px);
            min-height: 480px;
            overflow: hidden;
        }
        .picker-host {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            background: var(--cms-surface);
            border-radius: var(--cms-radius-lg);
        }
        .picker-host__body {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }
        .picker-host__body > app-media-picker {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }

        /* Mode toggle (Single asset / Gallery) */
        .picker-host__modes {
            display: flex;
            border-bottom: 1px solid var(--cms-border);
            flex-shrink: 0;
        }
        .picker-host__mode {
            flex: 1;
            padding: 8px 12px;
            background: var(--cms-surface);
            border: none;
            border-right: 1px solid var(--cms-border);
            color: var(--cms-text-secondary);
            font-size: .8125rem;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: background .1s, color .1s;

            &:last-child { border-right: none; }
            &:hover:not(.picker-host__mode--active) {
                background: var(--cms-border-light);
                color: var(--cms-text);
            }
        }
        .picker-host__mode--active {
            background: var(--cms-accent-light);
            color: var(--cms-accent-text);
            font-weight: 600;
        }

        /* Always-show config row (single OR gallery contents) */
        .picker-host__config {
            display: flex;
            gap: 12px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--cms-border);
            background: var(--cms-bg);
            flex-shrink: 0;
            flex-wrap: wrap;
            align-items: end;
            /* Both modes carry 5 fields with identical sizing rules below,
               so wrapping behaviour matches and the rows are the same
               natural height. A small floor catches the rare case where
               one row's content collapses (e.g., during HMR transient). */
            min-height: 64px;
            box-sizing: border-box;
        }
        .picker-host__field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: .6875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .04em;
            color: var(--cms-text-muted);
            margin: 0;

            input[type="number"] { width: 72px; }
            input[type="text"]   { width: 220px; }
            select               { width: 110px; }
        }
        .picker-host__field--dim { opacity: .55; }
        /* Caption is the only "long-form" field; set a fixed width so single
           and gallery mode rows occupy the same vertical space (no jump on
           toggle). Inside the input, native horizontal scroll handles overflow. */
        .picker-host__field--wide input[type="text"] { width: 220px; }

        /* Layout segmented buttons */
        .picker-host__seg {
            display: inline-flex;
            border: 1px solid var(--cms-btn-border);
            border-radius: var(--cms-radius-sm);
            overflow: hidden;
        }
        .picker-host__seg-btn {
            padding: 4px 10px;
            background: var(--cms-surface);
            border: none;
            border-left: 1px solid var(--cms-btn-border);
            color: var(--cms-text-secondary);
            font-size: .75rem;
            cursor: pointer;
            text-transform: capitalize;
            transition: background .1s, color .1s;

            &:first-child { border-left: none; }
            &:hover:not(.picker-host__seg-btn--active) {
                background: var(--cms-border-light);
                color: var(--cms-text);
            }
        }
        .picker-host__seg-btn--active {
            background: var(--cms-accent-light);
            color: var(--cms-accent-text);
            font-weight: 600;
        }
    `],
})
export class MediaPickerHostComponent {
    readonly data: MediaPickerHostData = inject(DIALOG_DATA);
    private readonly dialogRef         = inject<DialogRef<MediaPickerHostResult | null>>(DialogRef);
    private readonly svc               = inject(MediaService);
    private readonly store             = inject(Store);

    readonly value = signal<string | null>(null);
    /** Seeded from `data.initialMode` so handlers can pre-select gallery mode. */
    readonly hostMode = signal<HostMode>(this.data.initialMode ?? 'single');
    readonly galleryConfig = signal<GalleryConfig>(this.readGalleryConfig());
    readonly singleConfig  = signal<SingleConfig>(this.readSingleConfig());

    @ViewChild(MediaPickerComponent) picker?: MediaPickerComponent;
    /**
     * Once the user types in Width or Height, the auto-fill effect stops
     * overwriting them — even if a different asset is later selected. The
     * flag is local to this dialog instance, so closing + reopening the
     * picker resets it (each open starts with a clean auto-fill state).
     */
    private userTouchedDimensions = false;
    /** Last asset whose dimensions we filled in — gates re-fill so the same
     *  pick doesn't loop, but a *different* pick still flows through. */
    private lastAutoFilledAssetId: string | null = null;

    /** Layout options surfaced as segmented buttons in gallery mode. */
    readonly galleryTypes: ReadonlyArray<GalleryType> = ['grid', 'slider', 'list'];
    /** Sizes the picker can request via the existing `display: 'preset:NAME'` axis. */
    readonly singleSizes: ReadonlyArray<SingleSize> = ['small', 'medium', 'large', 'print', 'original'];
    /** Align segmented choices. `null` = no align param. */
    readonly alignChoices: ReadonlyArray<{ value: MediaAlign | null; label: string }> = [
        { value: 'left',   label: 'Left'   },
        { value: 'center', label: 'Center' },
        { value: 'right',  label: 'Right'  },
        { value: null,     label: 'None'   },
    ];

    /**
     * Picker options are mode-aware: gallery mode flips bindTarget to
     * 'collection' so folders become selectable, and forces accept='*' since
     * the picker filter doesn't apply to folder picks. Single-asset mode
     * inherits whatever the caller passed in.
     */
    readonly pickerOptions = computed<MediaPickerOptions>(() => {
        if (this.hostMode() === 'gallery') {
            return {
                ...this.data.options,
                bindTarget: 'collection',
                bindValue:  'path',
                accept:     '*',
                // Gallery selection is folder-only; recently-used / hover
                // preview are noisy here — keep them off for clarity.
                recentlyUsed: false,
                hoverPreview: false,
            };
        }
        // Single-mode: thread the user-chosen Size through to the picker's
        // display axis so chip + grid thumbs match the size that will be
        // requested at render time.
        return {
            ...this.data.options,
            display: this.singleConfig().size === 'original' ? 'original' : `preset:${this.singleConfig().size}`,
        };
    });

    /** Map picker `display` to the dtmpl widget `size=` axis. */
    readonly resolveSize = computed<Extract<MediaPickerHostResult, { type: 'widget' }>['size']>(() => {
        const d = this.data.options.display;
        if (typeof d === 'string' && d.startsWith('preset:')) {
            const name = d.slice('preset:'.length);
            return this.coerceSize(name);
        }
        if (d === 'original') return 'original';
        return 'medium';
    });

    private coerceSize(name: string): Extract<MediaPickerHostResult, { type: 'widget' }>['size'] {
        const allowed = ['small', 'medium', 'large', 'print', 'original'] as const;
        return (allowed as ReadonlyArray<string>).includes(name)
            ? (name as typeof allowed[number])
            : 'medium';
    }

    constructor() {
        // Auto-fill Width / Height in Single mode from the picked asset's
        // natural dimensions. Runs whenever the picker's pending pick or its
        // resolved asset list changes, but bails when (a) the user has
        // manually touched the dimensions inputs or (b) Width/Height already
        // hold values (so re-clicking the same asset doesn't re-fill).
        effect(() => {
            if (this.hostMode() !== 'single') return;
            if (this.userTouchedDimensions) return;
            const picker = this.picker;
            if (!picker) return;

            const pending = picker.pending();
            const first = pending[0];
            if (!first || first.kind !== 'asset') return;

            // Same asset still pending — already filled, skip.
            if (this.lastAutoFilledAssetId === first.value) return;

            const asset = picker.assets().find(a => a.id === first.value);
            if (!asset?.dimensions) return;

            const cfg = this.singleConfig();
            this.singleConfig.set({
                ...cfg,
                width:  asset.dimensions.width,
                height: asset.dimensions.height,
            });
            this.lastAutoFilledAssetId = first.value;
        });
    }

    cancel(): void { this.dialogRef.close(null); }

    setHostMode(m: HostMode): void {
        this.hostMode.set(m);
        // Clear any in-flight value selection so the embedded picker resets
        // its chip when bindTarget flips.
        this.value.set(null);
    }

    setGalleryParam<K extends keyof GalleryConfig>(key: K, value: GalleryConfig[K]): void {
        const next = { ...this.galleryConfig(), [key]: value };
        this.galleryConfig.set(next);
        this.persistGalleryConfig(next);
    }

    setSingleParam<K extends keyof SingleConfig>(key: K, value: SingleConfig[K]): void {
        // Manual edits to Width/Height lock the auto-fill effect so future
        // asset clicks don't clobber the user's intent.
        if (key === 'width' || key === 'height') {
            this.userTouchedDimensions = true;
        }
        const next = { ...this.singleConfig(), [key]: value };
        this.singleConfig.set(next);
        this.persistSingleConfig(next);
    }

    /**
     * `valueChange` fires the moment the picker confirms. Branching is mode-
     * driven: gallery mode produces a path-based emit; single mode preserves
     * the existing widget/plain-HTML routing per insertMode preference.
     */
    onPicked(emit: MediaPickerEmit): void {
        if (emit === null) { this.dialogRef.close(null); return; }

        if (this.hostMode() === 'gallery') {
            // Picker emits the collection PATH as a string when
            // bindTarget='collection'. The gallery widget stores the collection's
            // UUID (the path form 500s in the DTMPL lexer), so resolve path → Node
            // id here before closing. The folder name (last path segment) rides
            // along as the placeholder-card label.
            const path = typeof emit === 'string' ? emit : null;
            if (!path) { this.dialogRef.close(null); return; }
            const cfg = this.galleryConfig();
            const name = path.split('/').filter(Boolean).pop() ?? path;
            this.svc.statCollectionId(path).subscribe(collectionId => {
                if (!collectionId) { this.dialogRef.close(null); return; }
                this.dialogRef.close({
                    type:         'gallery',
                    collectionId,
                    name,
                    galleryType:  cfg.galleryType,
                    cols:         cfg.cols,
                    limit:        cfg.limit,
                    depth:        cfg.depth,
                    align:        cfg.align,
                });
            });
            return;
        }

        const uuid = typeof emit === 'string' ? emit : null;
        if (!uuid) { this.dialogRef.close(null); return; } // unexpected emit shape
        const cfg = this.singleConfig();
        const size = cfg.size;
        const insertMode = this.readInsertMode();

        this.svc.get(uuid).subscribe({
            next: (a: MediaAssetDto) => {
                const kind       = kindForMime(a.mimeType);
                const previewUrl = this.urlForSize(a, size);
                if (insertMode === 'plain') {
                    this.dialogRef.close({ type: 'plain', html: this.buildPlainHtml(a, kind, cfg) });
                    return;
                }
                this.dialogRef.close({
                    type: 'widget',
                    uuid,
                    size,
                    kind,
                    mime:    a.mimeType,
                    previewUrl,
                    alt:     null,
                    width:   cfg.width,
                    height:  cfg.height,
                    align:   cfg.align,
                    caption: cfg.caption.trim() === '' ? null : cfg.caption.trim(),
                });
            },
            error: () => this.dialogRef.close({
                type: 'widget',
                uuid,
                size,
                kind: 'image',
                mime: '',
                previewUrl: null,
                alt:     null,
                width:   cfg.width,
                height:  cfg.height,
                align:   cfg.align,
                caption: cfg.caption.trim() === '' ? null : cfg.caption.trim(),
            }),
        });
    }

    private buildPlainHtml(a: MediaAssetDto, kind: MediaKind, cfg: SingleConfig): string {
        const src      = a.originalUrl ?? a.thumbnailUrl ?? '';
        const filename = this.escapeAttr(a.originalFilename);
        const safeSrc  = this.escapeAttr(src);
        const widthAttr  = cfg.width  ? ` width="${cfg.width}"`   : '';
        const heightAttr = cfg.height ? ` height="${cfg.height}"` : '';
        const classAttr  = cfg.align  ? ` class="cms-media-align-${cfg.align}"` : '';
        const caption    = cfg.caption.trim();

        const inner = (() => {
            switch (kind) {
                case 'image': return `<img src="${safeSrc}" alt="${filename}"${classAttr}${widthAttr}${heightAttr}>`;
                case 'video': return `<video src="${safeSrc}"${classAttr}${widthAttr}${heightAttr} controls></video>`;
                case 'audio': return `<audio src="${safeSrc}"${classAttr} controls></audio>`;
                case 'file':  return `<a href="${safeSrc}"${classAttr}>${filename}</a>`;
            }
        })();

        // Caption + figure wrapping skipped for download links (semantics).
        if (caption !== '' && kind !== 'file') {
            return `<figure>${inner}<figcaption>${this.escapeAttr(caption)}</figcaption></figure>`;
        }
        return inner;
    }

    private escapeAttr(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    private readInsertMode(): 'widget' | 'plain' {
        try {
            const userId = this.userId();
            const raw = localStorage.getItem(LS_INSERT_MODE + userId);
            return raw === 'plain' ? 'plain' : 'widget';
        } catch {
            return 'widget';
        }
    }

    private readGalleryConfig(): GalleryConfig {
        try {
            const raw = localStorage.getItem(LS_GALLERY_CONFIG + this.userId());
            if (!raw) return { ...GALLERY_CONFIG_DEFAULTS };
            const parsed = JSON.parse(raw) as Partial<GalleryConfig>;
            return {
                galleryType: this.coerceGalleryType(parsed.galleryType),
                cols:        this.clamp(parsed.cols,  1, 6,   GALLERY_CONFIG_DEFAULTS.cols),
                limit:       this.clamp(parsed.limit, 1, 100, GALLERY_CONFIG_DEFAULTS.limit),
                depth:       this.clamp(parsed.depth, 1, 10,  GALLERY_CONFIG_DEFAULTS.depth),
                align:       this.coerceAlign(parsed.align),
            };
        } catch {
            return { ...GALLERY_CONFIG_DEFAULTS };
        }
    }

    private persistGalleryConfig(cfg: GalleryConfig): void {
        try {
            localStorage.setItem(LS_GALLERY_CONFIG + this.userId(), JSON.stringify(cfg));
        } catch { /* ignore quota / private mode */ }
    }

    private readSingleConfig(): SingleConfig {
        try {
            const raw = localStorage.getItem(LS_SINGLE_CONFIG + this.userId());
            if (!raw) return { ...SINGLE_CONFIG_DEFAULTS };
            const parsed = JSON.parse(raw) as Partial<SingleConfig>;
            return {
                size:    this.coerceSize(typeof parsed.size === 'string' ? parsed.size : 'medium'),
                align:   this.coerceAlign(parsed.align),
                width:   this.optClamp(parsed.width,  1, 4096),
                height:  this.optClamp(parsed.height, 1, 4096),
                caption: typeof parsed.caption === 'string' ? parsed.caption : '',
            };
        } catch {
            return { ...SINGLE_CONFIG_DEFAULTS };
        }
    }

    private persistSingleConfig(cfg: SingleConfig): void {
        try {
            localStorage.setItem(LS_SINGLE_CONFIG + this.userId(), JSON.stringify(cfg));
        } catch { /* ignore quota / private mode */ }
    }

    private coerceGalleryType(v: unknown): GalleryType {
        return v === 'slider' || v === 'list' ? v : 'grid';
    }

    private coerceAlign(v: unknown): MediaAlign | null {
        return v === 'left' || v === 'center' || v === 'right' ? v : null;
    }

    private optClamp(v: unknown, min: number, max: number): number | null {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.min(max, Math.max(min, Math.round(n)));
    }

    private clamp(v: unknown, min: number, max: number, fallback: number): number {
        const n = Number(v);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, Math.round(n)));
    }

    private userId(): string {
        const user = this.store.selectSnapshot(AuthState.currentUser);
        return user?.id ?? user?.identifier ?? 'anon';
    }

    private urlForSize(a: MediaAssetDto, size: 'small' | 'medium' | 'large' | 'print' | 'original'): string | null {
        if (size === 'original') return a.originalUrl ?? a.thumbnailUrl;
        return a.presetUrls?.[size] ?? a.thumbnailUrl ?? a.originalUrl;
    }
}

/**
 * Re-export of the wrapper around a single confirmed selection, kept here so
 * page-editor.component imports `MediaPickerSelection` only when it actually
 * needs the broader shape (currently it doesn't).
 */
export type { MediaPickerSelection };
