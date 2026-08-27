import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    computed,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
    FabricEngineAdapter,
    type ImageEditorEngine,
    type ShapeGeometry,
} from '@coolms/image-editor-angular';
import { ErrorHandlerService } from '@coolms/core-angular';
import { MediaService } from '../media/media.service';
import { CmsPageHeaderComponent, ToastService } from '@coolms/ui-angular';
import { ImageMapService } from './image-map.service';
import type { ImageMapDto, ImageMapRegionDto, UpdateRegionRequest } from './image-map.types';

type DrawMode = 'select' | 'rect' | 'circle' | 'polygon';

/** Page-side metadata for one canvas shape (keyed by engine layer id). */
interface RegionMeta {
    /** Wire code. Immutable once persisted (`originalCode` set). */
    code: string;
    label: string;
    subjectType: string;
    subjectRef: string;
    sortOrder: number;
    /** Set when the shape mirrors a persisted region; undefined = new. */
    originalCode?: string;
}

const REGION_STYLE = { fill: 'rgba(37, 99, 235, 0.20)', stroke: '#2563eb', strokeWidth: 2 };

/**
 * ImageMap region authoring (`/admin/image-maps/:slug/regions`) — the
 * Fabric.js surface over `@coolms/image-editor-angular`'s engine (NOT the pixel
 * editor shell/host: regions are vector geometry saved through the #1525
 * region API; the raster is never exported, so drawings are never baked
 * into the image). The engine's annotation seams (`addShapeAt`,
 * `getShapeGeometry`, `getImageBounds`, the `scenePointer` event) carry
 * the draw-by-drag loop; normalization to the 0..1 map frame happens
 * here against `getImageBounds()` (canvas space = image natural pixels,
 * so the frame divide is exact; circle radius normalizes against WIDTH
 * per the Region contract).
 *
 * Save is a diff against the loaded map: new shapes POST, moved/edited
 * shapes PATCH (geometry as a `shape`+`points` unit per #1525), removed
 * codes DELETE — then the map is re-fetched and the canvas rebuilt.
 */
@Component({
    selector: 'coolms-admin-image-map-regions',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsPageHeaderComponent, FormsModule],
    template: `
        <cms-page-header [title]="headerTitle()">
            <div header-actions class="header-actions">
                <button type="button" class="cms-btn" (click)="back()">Back to list</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="saving() || loading()"
                        (click)="save()">
                    {{ saving() ? 'Saving…' : 'Save regions' }}
                </button>
            </div>
        </cms-page-header>

        <div class="regions-toolbar">
            <button type="button" class="cms-btn" [class.cms-btn-active]="mode() === 'select'"
                    title="Select / move" (click)="setMode('select')">
                <i class="bi bi-cursor"></i> Select
            </button>
            <button type="button" class="cms-btn" [class.cms-btn-active]="mode() === 'rect'"
                    title="Draw rectangle (drag)" (click)="setMode('rect')">
                <i class="bi bi-square"></i> Rect
            </button>
            <button type="button" class="cms-btn" [class.cms-btn-active]="mode() === 'circle'"
                    title="Draw circle (drag from center)" (click)="setMode('circle')">
                <i class="bi bi-circle"></i> Circle
            </button>
            <button type="button" class="cms-btn" [class.cms-btn-active]="mode() === 'polygon'"
                    title="Draw polygon (click vertices, double-click to close, Esc cancels)"
                    (click)="setMode('polygon')">
                <i class="bi bi-pentagon"></i> Polygon
            </button>
            <span class="toolbar-sep"></span>
            <button type="button" class="cms-btn" [class.cms-btn-active]="vertexEditing() !== null"
                    [disabled]="!selectedIsPolygon() && vertexEditing() === null"
                    title="Edit polygon vertices (drag points; double-click the outline to add, a vertex to remove; Esc exits)"
                    (click)="toggleVertexEdit()">
                <i class="bi bi-bezier2"></i> Vertices
            </button>
            @if (vertexEditing() !== null) {
                <button type="button" class="cms-btn" [class.cms-btn-active]="vertexSnap()"
                        title="Snap polygon vertices to a 1% grid on save (aligns edges to clean fractions)"
                        (click)="toggleVertexSnap()">
                    <i class="bi bi-grid-3x3"></i> Snap
                </button>
            }
            <button type="button" class="cms-btn cms-btn-danger"
                    [disabled]="selectedLayerId() === null"
                    title="Remove selected region (Delete)"
                    (click)="removeSelected()">
                <i class="bi bi-trash"></i> Remove
            </button>
            <span class="toolbar-sep"></span>
            <button type="button" class="cms-btn" [class.cms-btn-active]="statusPreview()"
                    [disabled]="loading() || loadError() !== null"
                    title="Preview live busy/free status of subject-bound regions (right now)"
                    (click)="toggleStatusPreview()">
                <i class="bi bi-circle-half"></i> Status
            </button>
            @if (mode() === 'polygon' && polygonDraft().length > 0) {
                <span class="draw-hint">{{ polygonDraft().length }} vertices — double-click to close, Esc to cancel</span>
            }
        </div>

        <div class="regions-body">
            <div class="canvas-wrap" #canvasWrap tabindex="0" (keydown)="onKeydown($event)">
                @if (loading()) {
                    <div class="canvas-overlay-msg">Loading map…</div>
                }
                @if (loadError(); as err) {
                    <div class="canvas-overlay-msg error">{{ err }}</div>
                }
                <svg class="draw-preview" aria-hidden="true">
                    @if (previewRect(); as r) {
                        <rect [attr.x]="r.x" [attr.y]="r.y" [attr.width]="r.width" [attr.height]="r.height"></rect>
                    }
                    @if (previewCircle(); as c) {
                        <circle [attr.cx]="c.cx" [attr.cy]="c.cy" [attr.r]="c.r"></circle>
                    }
                    @if (previewPolyline(); as pts) {
                        <polyline [attr.points]="pts"></polyline>
                    }
                </svg>
            </div>

            <aside class="region-panel">
                <h3 class="panel-title">Region</h3>
                @if (selectedMeta(); as meta) {
                    <div class="field">
                        <label class="cms-label" for="rg-code">Code</label>
                        <input id="rg-code" class="cms-input" [ngModel]="meta.code"
                               (ngModelChange)="patchMeta('code', $event)"
                               [disabled]="meta.originalCode !== undefined" autocomplete="off">
                        @if (meta.originalCode !== undefined) {
                            <div class="cms-field-hint">Immutable once saved — the handle consumers bind to.</div>
                        }
                    </div>
                    <div class="field">
                        <label class="cms-label" for="rg-label">Label</label>
                        <input id="rg-label" class="cms-input" [ngModel]="meta.label"
                               (ngModelChange)="patchMeta('label', $event)" autocomplete="off">
                    </div>
                    <div class="field">
                        <label class="cms-label" for="rg-stype">Subject type</label>
                        <input id="rg-stype" class="cms-input" [ngModel]="meta.subjectType"
                               (ngModelChange)="patchMeta('subjectType', $event)"
                               placeholder="horeca.table" autocomplete="off">
                    </div>
                    <div class="field">
                        <label class="cms-label" for="rg-sref">Subject ref (UUID)</label>
                        <input id="rg-sref" class="cms-input" [ngModel]="meta.subjectRef"
                               (ngModelChange)="patchMeta('subjectRef', $event)" autocomplete="off">
                        <div class="cms-field-hint">Both subject fields or neither.</div>
                    </div>
                    <div class="field">
                        <label class="cms-label" for="rg-sort">Sort order</label>
                        <input id="rg-sort" class="cms-input" type="number" [ngModel]="meta.sortOrder"
                               (ngModelChange)="patchMeta('sortOrder', $event)">
                    </div>
                } @else {
                    <p class="panel-empty">Select a region on the canvas — or pick a draw tool and drag on the image.</p>
                }
                <h3 class="panel-title">All regions ({{ regionCount() }})</h3>
                <ul class="region-list">
                    @for (entry of regionEntries(); track entry.layerId) {
                        <li [class.selected]="entry.layerId === selectedLayerId()"
                            (click)="selectRegion(entry.layerId)">
                            <span class="code">{{ entry.meta.code }}</span>
                            <span class="label">{{ entry.meta.label }}</span>
                        </li>
                    }
                </ul>
            </aside>
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .regions-toolbar {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 16px; border-bottom: 1px solid var(--cms-border-color, #e5e7eb);
            background: var(--cms-surface, #fff);
        }
        /* The active-tool state is the kit's cms-btn-active, applied by the
           markup above. The local .active rule this replaces painted
           --cms-primary-soft (a token nothing defines, so always its #dbeafe
           fallback) over a hard-coded blue border: a pale blue box that, on the
           dark theme, carried light text at 1.24:1 — the SELECTED tool was the
           one you could not read (#2042). NO BACKTICKS IN HERE. */
        .toolbar-sep { width: 1px; height: 24px; background: var(--cms-border-color, #e5e7eb); }
        .draw-hint { font-size: 12px; color: var(--cms-text-muted, #6b7280); }
        .regions-body { display: flex; flex: 1; min-height: 0; }
        .canvas-wrap {
            position: relative; flex: 1; min-width: 0; overflow: hidden; outline: none;
            background:
                repeating-conic-gradient(var(--cms-surface-muted) 0% 25%, var(--cms-surface) 0% 50%) 50% / 24px 24px;
        }
        .canvas-overlay-msg {
            position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
            font-size: 14px; color: var(--cms-text-muted, #6b7280); z-index: 3;
        }
        .canvas-overlay-msg.error { color: var(--cms-danger-text); }
        .draw-preview {
            position: absolute; inset: 0; width: 100%; height: 100%;
            pointer-events: none; z-index: 2;
        }
        .draw-preview rect, .draw-preview circle, .draw-preview polyline {
            fill: rgba(37, 99, 235, 0.12); stroke: #2563eb; stroke-width: 1.5; stroke-dasharray: 4 3;
        }
        .draw-preview polyline { fill: none; }
        .region-panel {
            width: 300px; flex: none; overflow-y: auto;
            border-left: 1px solid var(--cms-border-color, #e5e7eb);
            padding: 12px 16px; background: var(--cms-surface, #fff);
        }
        .panel-title { font-size: 13px; font-weight: 600; margin: 8px 0; }
        .panel-empty { font-size: 12px; color: var(--cms-text-muted, #6b7280); }
        .field { margin-bottom: 10px; }
        .region-list { list-style: none; margin: 0; padding: 0; }
        .region-list li {
            display: flex; gap: 8px; padding: 4px 6px; border-radius: 4px;
            font-size: 12px; cursor: pointer;
        }
        .region-list li:hover { background: var(--cms-hover, #f3f4f6); }
        .region-list li.selected { background: var(--cms-primary-soft, #dbeafe); }
        .region-list .code { font-weight: 600; }
        .region-list .label { color: var(--cms-text-muted, #6b7280); }
    `],
})
export class ImageMapRegionsPageComponent implements AfterViewInit, OnDestroy {
    private readonly api    = inject(ImageMapService);
    private readonly media  = inject(MediaService);
    private readonly route  = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly toast  = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);

    private readonly canvasWrap = viewChild.required<ElementRef<HTMLElement>>('canvasWrap');

    private engine: ImageEditorEngine | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private map: ImageMapDto | null = null;
    /** Layer id → page-side region metadata. THE authoring model. */
    private readonly metaByLayer = new Map<string, RegionMeta>();
    /** Bumped whenever metaByLayer mutates so computed() views refresh. */
    private readonly metaVersion = signal(0);

    readonly loading   = signal(true);
    readonly saving    = signal(false);
    readonly loadError = signal<string | null>(null);
    readonly mode      = signal<DrawMode>('select');
    readonly selectedLayerId = signal<string | null>(null);
    /** Layer id currently in per-vertex edit mode, or null. */
    readonly vertexEditing = signal<string | null>(null);
    /** Whether vertex drags snap to a 1% grid (only meaningful in vertex-edit). */
    readonly vertexSnap = signal(false);
    /** Whether the live busy/free status tint preview is showing. */
    readonly statusPreview = signal(false);

    // Draw-in-progress state (scene coords) + screen-space previews.
    private dragStart: { x: number; y: number } | null = null;
    readonly polygonDraft   = signal<{ x: number; y: number }[]>([]);
    readonly previewRect     = signal<{ x: number; y: number; width: number; height: number } | null>(null);
    readonly previewCircle   = signal<{ cx: number; cy: number; r: number } | null>(null);
    readonly previewPolyline = signal<string | null>(null);

    readonly headerTitle = computed(() =>
        this.mapTitle() === '' ? 'Regions' : `Regions — ${this.mapTitle()}`);
    private readonly mapTitle = signal('');

    readonly regionEntries = computed(() => {
        this.metaVersion();
        return [...this.metaByLayer.entries()]
            .map(([layerId, meta]) => ({ layerId, meta }))
            .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder || a.meta.code.localeCompare(b.meta.code));
    });
    readonly regionCount = computed(() => this.regionEntries().length);
    readonly selectedMeta = computed(() => {
        this.metaVersion();
        const id = this.selectedLayerId();
        return id === null ? null : this.metaByLayer.get(id) ?? null;
    });

    async ngAfterViewInit(): Promise<void> {
        const slug = this.route.snapshot.paramMap.get('slug') ?? '';
        try {
            const map = await firstValueFrom(this.api.getImageMap(slug));
            this.map = map;
            this.mapTitle.set(map.title);

            const asset = await firstValueFrom(this.media.get(map.imageRef));
            if (!asset.originalUrl) {
                throw new Error('The map’s imageRef does not resolve to a viewable media asset.');
            }

            const container = this.canvasWrap().nativeElement;
            const engine = await FabricEngineAdapter.create({ container });
            this.engine = engine;
            engine.setCanvasDimensions({ width: container.clientWidth, height: container.clientHeight });
            await engine.loadImage(asset.originalUrl, map.slug);
            engine.setZoom(engine.getFitZoom({ width: container.clientWidth, height: container.clientHeight }));

            engine.on('activeObjectChanged', ({ id }) => {
                // Selecting away from the polygon under vertex edit ends
                // the edit (entering it re-selects the SAME id — no-op).
                const editing = this.vertexEditing();
                if (editing !== null && id !== editing) this.stopVertexEdit();
                this.selectedLayerId.set(id !== null && this.metaByLayer.has(id) ? id : null);
            });
            engine.on('scenePointer', e => this.onScenePointer(e.phase, e.x, e.y));

            this.resizeObserver = new ResizeObserver(() => {
                if (this.engine === null) return;
                this.engine.setCanvasDimensions({ width: container.clientWidth, height: container.clientHeight });
                this.engine.setZoom(this.engine.getFitZoom({ width: container.clientWidth, height: container.clientHeight }));
            });
            this.resizeObserver.observe(container);

            this.renderRegions(map.regions);
            this.loading.set(false);
        } catch (e: unknown) {
            this.loading.set(false);
            this.loadError.set(this.errors.humanize(e));
        }
    }

    ngOnDestroy(): void {
        this.resizeObserver?.disconnect();
        this.engine?.destroy();
        this.engine = null;
    }

    back(): void {
        void this.router.navigate(['/image-maps']);
    }

    setMode(mode: DrawMode): void {
        if (mode !== 'select') this.stopVertexEdit();
        this.mode.set(mode);
        this.cancelDraft();
        const engine = this.engine;
        if (engine === null) return;
        engine.setSelectionEnabled(mode === 'select');
        engine.setCursor(mode === 'select' ? 'default' : 'crosshair');
    }

    selectRegion(layerId: string): void {
        this.setMode('select');
        this.engine?.selectLayer(layerId);
    }

    /** Whether the current selection is a polygon (vertex-editable). */
    selectedIsPolygon(): boolean {
        const id = this.selectedLayerId();
        return id !== null && this.engine?.getShapeGeometry(id)?.kind === 'polygon';
    }

    toggleVertexEdit(): void {
        if (this.vertexEditing() !== null) {
            this.stopVertexEdit();
            return;
        }
        const id = this.selectedLayerId();
        if (id === null || this.engine === null) return;
        this.setMode('select');
        if (this.engine.setVertexEditing(id, true)) this.vertexEditing.set(id);
    }

    /**
     * Toggle grid-snap. When on, {@link save}'s normalization quantizes
     * every region coordinate to a 1%-of-frame grid — so a hand-drawn
     * polygon commits with clean, aligned edges (right-angle rooms /
     * aligned rows). Applied at the normalize boundary (the grid is
     * DEFINED in the 0..1 frame), so it is exact regardless of zoom.
     */
    toggleVertexSnap(): void {
        this.vertexSnap.set(!this.vertexSnap());
    }

    /**
     * Preview each subject-bound region's LIVE busy/free status by tinting it
     * (red = busy, green = free) — the same class map the public overlay bakes
     * in, fetched on demand. The tint is transient style only (never touches the
     * saved geometry); toggling off restores default fills. Unbound regions or
     * ones no provider resolves keep the default fill.
     */
    async toggleStatusPreview(): Promise<void> {
        const on = !this.statusPreview();
        this.statusPreview.set(on);
        const engine = this.engine;
        const map = this.map;
        if (engine === null || map === null) return;

        if (!on) {
            for (const [layerId] of this.metaByLayer) engine.setLayerFill(layerId, null);
            return;
        }
        try {
            const status = await firstValueFrom(this.api.getRegionStatus(map.slug, true));
            for (const [layerId, meta] of this.metaByLayer) {
                engine.setLayerFill(layerId, this.statusFill(status[meta.code] ?? ''));
            }
        } catch (e: unknown) {
            this.statusPreview.set(false);
            this.toast.error(this.errors.humanize(e));
        }
    }

    /** The tint for a status css class, or null (default fill) when unknown. */
    private statusFill(cls: string): string | null {
        if (cls === 'is-busy') return 'rgba(220, 38, 38, 0.38)';
        if (cls === 'is-free') return 'rgba(22, 163, 74, 0.32)';
        return null;
    }

    private stopVertexEdit(): void {
        const id = this.vertexEditing();
        if (id === null) return;
        // Clear the signal FIRST — setVertexEditing re-fires
        // activeObjectChanged, and the handler must not re-enter.
        this.vertexEditing.set(null);
        this.engine?.setVertexEditing(id, false);
        // Leaving vertex-edit resets snap so the toggle never lingers "on"
        // invisibly (the Snap button only shows during vertex-edit).
        this.vertexSnap.set(false);
    }

    removeSelected(): void {
        this.stopVertexEdit();
        const id = this.selectedLayerId();
        if (id === null || this.engine === null) return;
        this.engine.removeLayer(id);
        this.metaByLayer.delete(id);
        this.selectedLayerId.set(null);
        this.metaVersion.update(v => v + 1);
    }

    onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            if (this.vertexEditing() !== null) {
                this.stopVertexEdit();
                return;
            }
            this.cancelDraft();
            this.setMode('select');
        } else if (event.key === 'Delete' && this.mode() === 'select') {
            this.removeSelected();
        }
    }

    patchMeta<K extends keyof RegionMeta>(key: K, value: RegionMeta[K]): void {
        const id = this.selectedLayerId();
        const meta = id === null ? null : this.metaByLayer.get(id);
        if (!meta) return;
        this.metaByLayer.set(id!, { ...meta, [key]: value });
        this.metaVersion.update(v => v + 1);
    }

    // --- draw interactions -------------------------------------------------

    private onScenePointer(phase: 'down' | 'move' | 'up' | 'dblclick', x: number, y: number): void {
        // Vertex edit (runs in 'select' mode): a double-click ON a vertex
        // handle REMOVES it; a double-click on the outline elsewhere ADDS a
        // collinear one. removeVertexAt returns false when the click is not
        // on a handle (or the 3-vertex floor is hit), so we fall through to
        // addVertexAt. Handled here BEFORE the select-mode early-return below.
        const editingId = this.vertexEditing();
        if (phase === 'dblclick' && editingId !== null) {
            if (this.engine && !this.engine.removeVertexAt(editingId, x, y)) {
                this.engine.addVertexAt(editingId, x, y);
            }
            return;
        }

        const mode = this.mode();
        if (mode === 'select' || this.engine === null) return;

        if (mode === 'polygon') {
            if (phase === 'up') {
                this.polygonDraft.update(pts => [...pts, { x, y }]);
                this.refreshPolylinePreview(x, y);
            } else if (phase === 'move' && this.polygonDraft().length > 0) {
                this.refreshPolylinePreview(x, y);
            } else if (phase === 'dblclick') {
                this.finishPolygon();
            }
            return;
        }

        if (phase === 'down') {
            this.dragStart = { x, y };
        } else if (phase === 'move' && this.dragStart !== null) {
            this.refreshDragPreview(mode, this.dragStart, { x, y });
        } else if (phase === 'up' && this.dragStart !== null) {
            const start = this.dragStart;
            this.dragStart = null;
            this.previewRect.set(null);
            this.previewCircle.set(null);
            this.commitDrag(mode, start, { x, y });
        }
    }

    private commitDrag(mode: 'rect' | 'circle', a: { x: number; y: number }, b: { x: number; y: number }): void {
        const engine = this.engine;
        if (engine === null) return;
        if (mode === 'rect') {
            const rect = {
                x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
                width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
            };
            if (rect.width < 4 || rect.height < 4) return;
            const layerId = engine.addShapeAt(
                { kind: 'rect', rect },
                { ...REGION_STYLE, name: this.nextCode(), lockRotation: true },
            );
            this.registerNew(layerId);
        } else {
            const r = Math.hypot(b.x - a.x, b.y - a.y);
            if (r < 4) return;
            const layerId = engine.addShapeAt(
                { kind: 'ellipse', center: a, rx: r, ry: r },
                { ...REGION_STYLE, name: this.nextCode(), lockRotation: true, lockNonUniformScaling: true },
            );
            this.registerNew(layerId);
        }
        this.setMode('select');
    }

    private finishPolygon(): void {
        // The closing double-click fires regular clicks first, appending
        // the final vertex again (twice) — collapse consecutive
        // duplicates so degenerate points never reach the geometry.
        const pts = this.polygonDraft().filter((p, i, all) =>
            i === 0 || Math.abs(p.x - all[i - 1].x) > 1 || Math.abs(p.y - all[i - 1].y) > 1);
        this.cancelDraft();
        if (pts.length < 3 || this.engine === null) return;
        const layerId = this.engine.addShapeAt(
            { kind: 'polygon', points: pts },
            { ...REGION_STYLE, name: this.nextCode(), lockRotation: true },
        );
        this.registerNew(layerId);
        this.setMode('select');
    }

    private registerNew(layerId: string): void {
        const code = this.nextCode();
        this.metaByLayer.set(layerId, {
            code,
            label: code,
            subjectType: '',
            subjectRef: '',
            sortOrder: (this.maxSortOrder() + 10),
        });
        this.metaVersion.update(v => v + 1);
        this.selectedLayerId.set(layerId);
    }

    private nextCode(): string {
        const taken = new Set([...this.metaByLayer.values()].map(m => m.code));
        let n = this.metaByLayer.size + 1;
        while (taken.has(`zone-${n}`)) n++;
        return `zone-${n}`;
    }

    private maxSortOrder(): number {
        let max = 0;
        for (const m of this.metaByLayer.values()) max = Math.max(max, m.sortOrder);
        return max;
    }

    private cancelDraft(): void {
        this.dragStart = null;
        this.polygonDraft.set([]);
        this.previewRect.set(null);
        this.previewCircle.set(null);
        this.previewPolyline.set(null);
    }

    // Scene → screen for the SVG previews (screen = scene * zoom + pan).
    private toScreen(p: { x: number; y: number }): { x: number; y: number } {
        const engine = this.engine!;
        const zoom = engine.getZoom();
        const pan = engine.getPanOffset();
        return { x: p.x * zoom + pan.x, y: p.y * zoom + pan.y };
    }

    private refreshDragPreview(mode: 'rect' | 'circle', a: { x: number; y: number }, b: { x: number; y: number }): void {
        if (mode === 'rect') {
            const p1 = this.toScreen(a);
            const p2 = this.toScreen(b);
            this.previewRect.set({
                x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
                width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y),
            });
        } else {
            const c = this.toScreen(a);
            const e = this.toScreen(b);
            this.previewCircle.set({ cx: c.x, cy: c.y, r: Math.hypot(e.x - c.x, e.y - c.y) });
        }
    }

    private refreshPolylinePreview(cursorX: number, cursorY: number): void {
        const pts = [...this.polygonDraft(), { x: cursorX, y: cursorY }].map(p => this.toScreen(p));
        this.previewPolyline.set(pts.map(p => `${p.x},${p.y}`).join(' '));
    }

    // --- load / normalize round trip ----------------------------------------

    private renderRegions(regions: ImageMapRegionDto[]): void {
        const engine = this.engine;
        const bounds = engine?.getImageBounds();
        if (engine === null || !bounds) return;
        this.metaByLayer.clear();

        for (const region of regions) {
            const geometry = this.denormalize(region, bounds);
            if (geometry === null) continue;
            const layerId = engine.addShapeAt(geometry, {
                ...REGION_STYLE,
                name: region.code,
                lockRotation: true,
                lockNonUniformScaling: region.shape === 'circle',
            });
            this.metaByLayer.set(layerId, {
                code:         region.code,
                label:        region.label,
                subjectType:  region.subjectType ?? '',
                subjectRef:   region.subjectRef ?? '',
                sortOrder:    region.sortOrder,
                originalCode: region.code,
            });
        }
        engine.selectLayer(null);
        this.selectedLayerId.set(null);
        this.metaVersion.update(v => v + 1);
    }

    private denormalize(
        region: ImageMapRegionDto,
        b: { x: number; y: number; width: number; height: number },
    ): ShapeGeometry | null {
        const p = region.points;
        switch (region.shape) {
            case 'rect':
                return p.length === 4 ? { kind: 'rect', rect: {
                    x: b.x + p[0] * b.width, y: b.y + p[1] * b.height,
                    width: p[2] * b.width, height: p[3] * b.height,
                } } : null;
            case 'circle':
                // r is normalized against WIDTH (the Region contract).
                return p.length === 3 ? { kind: 'ellipse',
                    center: { x: b.x + p[0] * b.width, y: b.y + p[1] * b.height },
                    rx: p[2] * b.width, ry: p[2] * b.width,
                } : null;
            case 'polygon': {
                if (p.length < 6 || p.length % 2 !== 0) return null;
                const points: { x: number; y: number }[] = [];
                for (let i = 0; i < p.length; i += 2) {
                    points.push({ x: b.x + p[i] * b.width, y: b.y + p[i + 1] * b.height });
                }
                return { kind: 'polygon', points };
            }
        }
    }

    private normalize(
        geometry: ShapeGeometry,
        b: { x: number; y: number; width: number; height: number },
        snap = false,
    ): { shape: 'rect' | 'circle' | 'polygon'; points: number[] } {
        const cl = (v: number) => Math.min(1, Math.max(0, v));
        switch (geometry.kind) {
            case 'rect': {
                const x = cl((geometry.rect.x - b.x) / b.width);
                const y = cl((geometry.rect.y - b.y) / b.height);
                const w = Math.min(1 - x, Math.max(0.001, geometry.rect.width / b.width));
                const h = Math.min(1 - y, Math.max(0.001, geometry.rect.height / b.height));
                return { shape: 'rect', points: [x, y, w, h].map(v => this.round(v)) };
            }
            case 'ellipse': {
                // Circle contract: single radius normalized against WIDTH.
                // Interactive scaling keeps rx==ry (lockNonUniformScaling);
                // average defensively in case of drift.
                const r = Math.max(0.001, ((geometry.rx + geometry.ry) / 2) / b.width);
                return { shape: 'circle', points: [
                    cl((geometry.center.x - b.x) / b.width),
                    cl((geometry.center.y - b.y) / b.height),
                    this.round(r),
                ].map(v => this.round(v)) };
            }
            case 'polygon': {
                // Grid-snap (when on) quantizes each vertex to a 1%-of-frame
                // grid — the grid is DEFINED in this 0..1 frame, so it is
                // exact regardless of canvas zoom. Only polygons snap (the
                // feature is vertex-scoped; rect/circle keep full precision
                // so a sub-1% shape can't collapse to a zero dimension).
                const q = (v: number) => snap ? Math.round(v * 100) / 100 : this.round(v);
                return { shape: 'polygon', points: geometry.points.flatMap(p => [
                    q(cl((p.x - b.x) / b.width)),
                    q(cl((p.y - b.y) / b.height)),
                ]) };
            }
        }
    }

    private round(v: number): number {
        return Math.round(v * 10000) / 10000;
    }

    // --- save (diff → region API) --------------------------------------------

    async save(): Promise<void> {
        // Capture the grid-snap intent BEFORE stopVertexEdit() clears it.
        const snap = this.vertexSnap();
        this.stopVertexEdit();
        const engine = this.engine;
        const map = this.map;
        const bounds = engine?.getImageBounds();
        if (engine === null || map === null || !bounds || this.saving()) return;

        // Validate metadata before touching the API.
        const codeRe = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
        const seen = new Set<string>();
        for (const [, meta] of this.metaByLayer) {
            if (!codeRe.test(meta.code)) {
                this.toast.error(`Region code "${meta.code}" is invalid.`);
                return;
            }
            if (seen.has(meta.code)) {
                this.toast.error(`Duplicate region code "${meta.code}".`);
                return;
            }
            seen.add(meta.code);
            const hasType = meta.subjectType.trim() !== '';
            const hasRef  = meta.subjectRef.trim() !== '';
            if (hasType !== hasRef) {
                this.toast.error(`Region "${meta.code}": subject type and ref go together (both or neither).`);
                return;
            }
        }

        this.saving.set(true);
        try {
            const originalByCode = new Map(map.regions.map(r => [r.code, r]));
            const survivingOriginals = new Set<string>();

            for (const [layerId, meta] of this.metaByLayer) {
                const geometry = engine.getShapeGeometry(layerId);
                if (geometry === null) continue;
                const { shape, points } = this.normalize(geometry, bounds, snap);

                if (meta.originalCode === undefined) {
                    await firstValueFrom(this.api.addRegion(map.slug, {
                        code: meta.code, shape, points,
                        label: meta.label.trim() === '' ? undefined : meta.label.trim(),
                        subjectType: meta.subjectType.trim() === '' ? undefined : meta.subjectType.trim(),
                        subjectRef: meta.subjectRef.trim() === '' ? undefined : meta.subjectRef.trim(),
                        sortOrder: meta.sortOrder,
                    }));
                    continue;
                }

                survivingOriginals.add(meta.originalCode);
                const original = originalByCode.get(meta.originalCode);
                if (!original) continue;

                const patch: UpdateRegionRequest = {};
                if (shape !== original.shape || !this.pointsEqual(points, original.points)) {
                    patch.shape = shape;
                    patch.points = points;
                }
                if (meta.label !== original.label) patch.label = meta.label;
                if (meta.sortOrder !== original.sortOrder) patch.sortOrder = meta.sortOrder;
                const origType = original.subjectType ?? '';
                const origRef  = original.subjectRef ?? '';
                if (meta.subjectType.trim() !== origType || meta.subjectRef.trim() !== origRef) {
                    if (meta.subjectType.trim() === '') {
                        // Explicit empty-string subjectType clears the binding (#1525).
                        patch.subjectType = '';
                    } else {
                        patch.subjectType = meta.subjectType.trim();
                        patch.subjectRef  = meta.subjectRef.trim();
                    }
                }
                if (Object.keys(patch).length > 0) {
                    await firstValueFrom(this.api.updateRegion(map.slug, meta.originalCode, patch));
                }
            }

            for (const region of map.regions) {
                if (!survivingOriginals.has(region.code)) {
                    await firstValueFrom(this.api.deleteRegion(map.slug, region.code));
                }
            }

            const fresh = await firstValueFrom(this.api.getImageMap(map.slug));
            this.map = fresh;
            // reset() wipes the layers AND the viewport — re-fit before
            // re-rendering so the rebuilt canvas stays framed.
            await engine.reset();
            const container = this.canvasWrap().nativeElement;
            engine.setZoom(engine.getFitZoom({ width: container.clientWidth, height: container.clientHeight }));
            this.renderRegions(fresh.regions);
            // The rebuild resets fills, so a lingering status-preview toggle
            // would be out of sync with the (now default-filled) canvas.
            this.statusPreview.set(false);
            this.toast.success(`Regions saved (${fresh.regions.length} on "${fresh.slug}")`);
        } catch (e: unknown) {
            this.toast.error(this.errors.humanize(e));
        } finally {
            this.saving.set(false);
        }
    }

    private pointsEqual(a: number[], b: number[]): boolean {
        if (a.length !== b.length) return false;
        return a.every((v, i) => Math.abs(v - b[i]) < 0.0005);
    }
}
