import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    ViewChild,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';

import { createEditor, type Editor } from '@coolms/designer';
import {
    BpmnLiteEditor,
    autoLayoutBpmnLite,
    bpmnLiteJsonToModel,
} from '@coolms/designer/bpmn-lite';

import { DesignerI18nService } from '../designer/designer-i18n.service';
import type { CockpitTokenDto } from './cockpit.types';

/**
 * M4.h — read-only BPMN-Lite diagram with a live token overlay, embedded
 * in the cockpit instance-detail page.
 *
 * Reuses the BpmnLite designer's read-only viewer (`createEditor` with
 * `readOnly`/`hideToolbar`/`hideSidebar`) to paint the deployed process body,
 * then highlights the elements where execution tokens currently sit by
 * adding CSS classes onto the rendered `<g data-element-id="…">` nodes:
 *   - **active**  token -> green glow
 *   - **waiting** token -> amber glow
 *   - the **failed** element (from the M4.f failure capture) -> red glow
 *
 * The body is auto-laid-out on load (engine-authored bodies carry no diagram
 * coordinates), so the operator always gets a readable left-to-right diagram
 * regardless of how the definition was authored. Highlights re-apply
 * reactively whenever the token set changes (e.g. after a steering action
 * re-fetches the detail).
 */
@Component({
    selector: 'app-cockpit-diagram',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (renderError()) {
            <p class="diag-empty">Diagram unavailable for this instance.</p>
        }
        <div #host class="diag-host" [class.d-none]="renderError()"></div>
        @if (!renderError()) {
            <div class="diag-legend">
                <span class="lg"><span class="dot dot--active"></span> Active token</span>
                <span class="lg"><span class="dot dot--waiting"></span> Waiting</span>
                <span class="lg"><span class="dot dot--failed"></span> Failed</span>
            </div>
        }
    `,
    styles: [`
        :host { display: block; }
        .diag-host { position: relative; width: 100%; height: 360px; display: flex; min-height: 0; }
        .diag-empty { color: var(--cms-text-muted, #848b96); font-size: .85rem; margin: 0; padding: 8px 0; }
        .d-none { display: none !important; }

        .diag-legend {
            display: flex; gap: 16px; flex-wrap: wrap;
            padding: 8px 2px 0; font-size: .75rem; color: var(--cms-text-muted, #848b96);
        }
        .lg { display: inline-flex; align-items: center; gap: 5px; }
        .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
        .dot--active  { background: var(--cms-success); box-shadow: 0 0 4px var(--cms-success); }
        .dot--waiting { background: var(--cms-warning); box-shadow: 0 0 4px var(--cms-warning); }
        .dot--failed  { background: var(--cms-danger); box-shadow: 0 0 4px var(--cms-danger); }

        /* Token-position glow on the rendered designer nodes. ::ng-deep is
           required because the SVG is created imperatively by the designer,
           so it carries no Angular emulated-encapsulation attribute. */
        :host ::ng-deep [data-element-id].cockpit-tok-active  { filter: drop-shadow(0 0 5px var(--cms-success)); }
        :host ::ng-deep [data-element-id].cockpit-tok-waiting { filter: drop-shadow(0 0 5px var(--cms-warning)); }
        :host ::ng-deep [data-element-id].cockpit-tok-failed  { filter: drop-shadow(0 0 6px var(--cms-danger)); }
    `],
})
export class CockpitDiagramComponent implements AfterViewInit, OnDestroy {
    @ViewChild('host', { static: true })
    private readonly hostRef!: ElementRef<HTMLElement>;

    /** Raw deployed BPMN-Lite JSON body. */
    readonly body = input<string | null>(null);
    /** Live execution tokens (drives the active/waiting highlights). */
    readonly tokens = input<CockpitTokenDto[]>([]);
    /** Element id of the failed step (M4.f), highlighted red; null when not failed. */
    readonly failedElementId = input<string | null>(null);

    readonly renderError = signal(false);
    /** Set true once the diagram has painted, so the highlight effect can run. */
    private readonly ready = signal(false);

    private shell?: Editor;
    private bpmn?: BpmnLiteEditor;
    private readonly i18n = inject(DesignerI18nService);

    constructor() {
        // Re-apply highlights whenever the token set / failed element changes
        // (and once the diagram is mounted). Cheap DOM class toggling.
        effect(() => {
            this.tokens();
            this.failedElementId();
            if (this.ready()) this.applyHighlights();
        });
    }

    async ngAfterViewInit(): Promise<void> {
        const body = this.body();
        if (!body || body.trim() === '') {
            this.renderError.set(true);
            return;
        }

        // Before the paint: the hover titles are resolved as each element is
        // rendered, and a read-only diagram paints once.
        await this.i18n.ensureLoaded();

        try {
            this.shell = createEditor(this.hostRef.nativeElement, {
                surface: 'bpmn-lite',
                t: this.i18n.translate,
                readOnly: true,
                hideToolbar: true,
                hideSidebar: true,
            });
            this.bpmn = new BpmnLiteEditor({
                t: this.i18n.translate,
                host: this.shell.body,
                commands: this.shell.commands,
                svgGroup: this.shell.canvasGroup,
            });

            const model = bpmnLiteJsonToModel(body);
            // Always auto-layout: engine-authored bodies carry no diagram
            // coordinates, and a consistent left-to-right layout reads better
            // for an operational view than an author's hand-positions.
            const laidOut = autoLayoutBpmnLite(model.elements, model.flows);
            this.bpmn.load({ ...model, elements: laidOut });

            // Defer the fit past the synchronous repaint so the SVG has its
            // box (mirrors the designer page's queueMicrotask).
            queueMicrotask(() => {
                this.fitToContent();
                this.ready.set(true); // triggers the highlight effect
            });
        } catch {
            this.renderError.set(true);
        }
    }

    ngOnDestroy(): void {
        try {
            this.bpmn?.dispose();
        } catch {
            // ignore
        }
        try {
            this.shell?.destroy();
        } catch {
            // ignore
        }
    }

    private fitToContent(): void {
        if (!this.bpmn || !this.shell) return;
        const bbox = this.bpmn.contentBbox();
        if (bbox === null) return;
        const svg = this.shell.canvasGroup.ownerSVGElement;
        if (svg === null) return;
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        this.shell.viewport.fitToContent(bbox, { width: rect.width, height: rect.height }, { padding: 0.12 });
    }

    /**
     * Toggle the token-glow classes on the rendered element nodes. Clears all
     * prior glows first, then paints active/waiting from the live tokens and
     * the failed element last (so a failed step always reads red).
     */
    private applyHighlights(): void {
        const group = this.shell?.canvasGroup;
        if (!group) return;

        group.querySelectorAll('[data-element-id]').forEach((el) =>
            el.classList.remove('cockpit-tok-active', 'cockpit-tok-waiting', 'cockpit-tok-failed'),
        );

        for (const t of this.tokens()) {
            const cls =
                t.state === 'active' ? 'cockpit-tok-active'
                : t.state === 'waiting' ? 'cockpit-tok-waiting'
                : null;
            if (cls === null) continue;
            this.nodeFor(group, t.currentElementId)?.classList.add(cls);
        }

        const failed = this.failedElementId();
        if (failed) this.nodeFor(group, failed)?.classList.add('cockpit-tok-failed');
    }

    private nodeFor(group: SVGElement, elementId: string): Element | null {
        // Element ids are dotted slugs; CSS.escape guards any exotic chars.
        const sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(elementId) : elementId;
        return group.querySelector(`[data-element-id="${sel}"]`);
    }
}
