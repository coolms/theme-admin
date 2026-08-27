import { type ComponentRef, type Injector } from '@angular/core';
import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { type Editor } from '@tiptap/core';
import { type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { type MediaKind, previewSrcForKind } from './dtmpl-media-node';
import { MediaAltEditorComponent } from './media-alt-editor.component';

const HANDLE_CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
type HandleCorner = (typeof HANDLE_CORNERS)[number];

const MIN_WIDTH_PX = 50;

/**
 * ProseMirror NodeView for the `mediaWidget` Tiptap node. Wraps the marker
 * `<img>` in a `<span>` so we can layer four corner resize handles on top
 * without changing the parseable HTML shape (renderHTML still emits a flat
 * `<img>` for `editor.getHTML()`, so the dtmpl transform's regex is
 * unaffected).
 *
 * Selection state (driven by ProseMirror's selectNode/deselectNode hooks)
 * toggles a `--selected` class on the wrapper; CSS hides the handles when
 * the class is absent. Drag updates the inline style for live feedback,
 * then commits the final px width to the node's `width` attribute via a
 * single transaction so undo/redo behaves like one operation.
 *
 * Alt editor: when `selectNode()` fires AND a root Injector was supplied
 * (via `MediaWidget.configure({ injector })` from
 * `provideCoolmsEditorMedia()`), the NodeView opens a CDK Overlay anchored
 * to the node's wrapper with `MediaAltEditorComponent` inside. Save commits
 * the new alt text to the node attrs; cancel/deselect closes the overlay
 * without applying changes.
 */
export class MediaNodeView {
    readonly dom: HTMLElement;
    readonly contentDOM: HTMLElement | null = null;

    private node: ProseMirrorNode;
    private readonly img: HTMLImageElement;
    /** Optional <figcaption> child rendered when the node has a caption attr. */
    private figcaption: HTMLElement | null = null;

    /** Live alt-editor overlay; null when no overlay is attached. */
    private altOverlay: OverlayRef | null = null;
    /** Backing component ref for the alt-editor overlay; cleared when detached. */
    private altCompRef: ComponentRef<MediaAltEditorComponent> | null = null;

    constructor(
        node: ProseMirrorNode,
        private readonly editor: Editor,
        private readonly getPos: () => number | undefined,
        private readonly injector: Injector | null,
    ) {
        this.node = node;

        this.dom = document.createElement('span');
        this.dom.className = 'media-widget-wrapper';
        this.dom.style.display = 'inline-block';
        this.dom.style.position = 'relative';
        this.dom.style.lineHeight = '0';

        this.img = document.createElement('img');
        this.dom.appendChild(this.img);

        for (const corner of HANDLE_CORNERS) {
            const handle = document.createElement('span');
            handle.className = `media-widget-handle media-widget-handle--${corner}`;
            handle.dataset['corner'] = corner;
            handle.addEventListener('mousedown', (e) => this.onHandleDown(e, corner));
            this.dom.appendChild(handle);
        }

        this.applyAttrs();
    }

    /** Show / hide the inline figcaption based on the node's `caption` attr. */
    private syncCaption(): void {
        const caption = String((this.node.attrs as Record<string, unknown>)['caption'] ?? '');
        if (caption !== '') {
            if (!this.figcaption) {
                this.figcaption = document.createElement('span');
                this.figcaption.className = 'media-widget-wrapper__caption';
                this.dom.appendChild(this.figcaption);
            }
            this.figcaption.textContent = caption;
        } else if (this.figcaption) {
            this.figcaption.remove();
            this.figcaption = null;
        }
    }

    /** ProseMirror calls this whenever the underlying node's attrs change. */
    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.applyAttrs();
        return true;
    }

    selectNode(): void {
        this.dom.classList.add('media-widget-wrapper--selected');
        this.openAltEditor();
    }

    deselectNode(): void {
        this.dom.classList.remove('media-widget-wrapper--selected');
        this.closeAltEditor();
    }

    /**
     * Tell ProseMirror to ignore mouse events that originate on a resize
     * handle so its own click-to-select / drag-to-text-select logic doesn't
     * fight our drag handler.
     */
    stopEvent(event: Event): boolean {
        const target = event.target as HTMLElement | null;
        return target?.classList.contains('media-widget-handle') ?? false;
    }

    /**
     * Don't ask ProseMirror to re-render the NodeView when our internal DOM
     * changes (handles / inline style during drag) — those are pure decoration.
     */
    ignoreMutation(): boolean {
        return true;
    }

    destroy(): void {
        // Handles use closures captured per element; their listeners die with
        // the DOM nodes themselves when the wrapper is removed. The overlay
        // is detached explicitly so it can't outlive its anchor.
        this.closeAltEditor();
    }

    private applyAttrs(): void {
        const a = this.node.attrs as Record<string, unknown>;
        const kind = (a['kind'] as MediaKind | undefined) ?? 'image';
        const src  = previewSrcForKind(kind, a['previewUrl'] as string | null | undefined);

        // Mirror the data-* attribute set renderHTML produces, so the inline
        // DOM matches what `editor.getHTML()` emits and developer tools show
        // a consistent picture.
        this.img.setAttribute('data-widget', 'media');
        this.img.setAttribute('data-kind',   String(kind));
        if (a['uuid']) this.img.setAttribute('data-uuid', String(a['uuid'])); else this.img.removeAttribute('data-uuid');
        if (a['size']) this.img.setAttribute('data-size', String(a['size'])); else this.img.removeAttribute('data-size');
        this.img.setAttribute('src', src);
        this.img.setAttribute('alt', String(a['alt'] ?? ''));
        this.img.setAttribute('loading', 'lazy');

        const width = a['width'];
        if (typeof width === 'number' && width > 0) {
            this.img.setAttribute('width', String(width));
        } else {
            this.img.removeAttribute('width');
        }
        const height = a['height'];
        if (typeof height === 'number' && height > 0) {
            this.img.setAttribute('height', String(height));
        } else {
            this.img.removeAttribute('height');
        }

        // Compose the final class with the align utility token.
        const userCls = typeof a['class'] === 'string' ? (a['class']) : '';
        const baseCls = userCls.replace(/\bcms-media-align-(left|center|right)\b/g, '').trim();
        const align   = a['align'];
        const composed = align && (align === 'left' || align === 'center' || align === 'right')
            ? (baseCls ? `${baseCls} cms-media-align-${align}` : `cms-media-align-${align}`)
            : baseCls;
        if (composed !== '') {
            this.img.setAttribute('class', composed);
        } else {
            this.img.removeAttribute('class');
        }

        this.syncCaption();
    }

    private onHandleDown(event: MouseEvent, corner: HandleCorner): void {
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const startW = this.img.offsetWidth;
        const containerWidth = this.dom.parentElement?.clientWidth ?? Number.POSITIVE_INFINITY;

        const onMove = (ev: MouseEvent): void => {
            const delta = ev.clientX - startX;
            const sign  = corner.endsWith('e') ? 1 : -1;
            const next  = Math.min(containerWidth, Math.max(MIN_WIDTH_PX, startW + sign * delta));
            this.img.style.width  = `${next}px`;
            this.img.style.height = 'auto';
        };

        const onUp = (): void => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const finalWidth = this.img.offsetWidth;
            // Clear the live-drag inline style; the attribute path takes over.
            this.img.style.width  = '';
            this.img.style.height = '';
            const pos = this.getPos();
            if (pos === undefined) return;
            this.editor.chain().focus().command(({ tr }) => {
                tr.setNodeAttribute(pos, 'width', finalWidth);
                return true;
            }).run();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    /**
     * Open a CDK Overlay below the selected media node and mount the alt
     * editor inside. Skips silently when no Injector was passed (e.g. when
     * the extension was registered without provideCoolmsEditorMedia, as in
     * unit tests) — selection still works, just without the alt popup.
     */
    private openAltEditor(): void {
        if (!this.injector) return;
        if (this.altOverlay) return; // already open (re-select fires multiple times in some flows)

        const overlay = this.injector.get(Overlay);
        const positionStrategy = overlay.position()
            .flexibleConnectedTo(this.dom)
            .withPositions([
                { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
                { originX: 'start', originY: 'top',    overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
            ])
            .withFlexibleDimensions(false)
            .withPush(true);

        const overlayRef = overlay.create({
            positionStrategy,
            scrollStrategy: overlay.scrollStrategies.reposition(),
            hasBackdrop:    false,
            // Use a tight panel class so the overlay container doesn't add
            // extra padding around the floating editor.
            panelClass:     'media-alt-editor-overlay',
        });

        const portal = new ComponentPortal(MediaAltEditorComponent, null, this.injector);
        const compRef = overlayRef.attach(portal);
        compRef.setInput('initialValue', String((this.node.attrs as Record<string, unknown>)['alt'] ?? ''));

        compRef.instance.save.subscribe((value: string) => {
            this.commitAlt(value);
            this.closeAltEditor();
        });
        compRef.instance.cancel.subscribe(() => {
            this.closeAltEditor();
        });

        this.altOverlay = overlayRef;
        this.altCompRef = compRef;
    }

    /** Detach the alt-editor overlay if attached. Safe to call repeatedly. */
    private closeAltEditor(): void {
        if (!this.altOverlay) return;
        this.altOverlay.detach();
        this.altOverlay.dispose();
        this.altOverlay = null;
        this.altCompRef = null;
    }

    /** Apply the alt-editor's value to the node's `alt` attribute. */
    private commitAlt(value: string): void {
        const pos = this.getPos();
        if (pos === undefined) return;
        const next = value.trim() === '' ? null : value;
        this.editor.chain().focus().command(({ tr }) => {
            tr.setNodeAttribute(pos, 'alt', next);
            return true;
        }).run();
    }
}
