
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  DestroyRef,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { createEditor, type Editor } from '@coolms/designer';
import {
    DmnDrdEditor,
    DmnDrdPropertyPanel,
    AddElementCommand,
    AddRequirementCommand,
    RemoveElementCommand,
    RemoveRequirementCommand,
    emptyDmnDrdModel,
    defaultSizeForKind,
    writeDrdXml,
    readDrdXml,
    type DmnDrdElementKind,
    type DmnDrdModel,
} from '@coolms/designer/dmn-drd';

import { CmsPageHeaderComponent, ErrorBannerComponent, LoadingComponent, ToastService, UnsavedChangesService } from '@coolms/ui-angular';
import { DesignerActionFooterComponent } from './shared/designer-action-footer.component';
import { errorMessage } from './shared/error-message';
import { DesignerService } from './designer.service';
import { DesignerI18nService } from './designer-i18n.service';

/**
 * Slice 5 — DMN DRD (Decision Requirements Diagram) designer page.
 * Hosts the vanilla-TS {@link DmnDrdEditor} (from
 * `@coolms/designer/dmn-drd`) inside the shared editor shell, wired to
 * the decision VFS draft via {@link DesignerService} (`getDraft` /
 * `saveDraft`, the same `/decisions/{key}/draft` XML endpoint the
 * table editor uses).
 *
 * Mirrors the BPMN-Lite + state-machine editor chrome: the
 * shell toolbar carries Undo-Redo / Fit-Zoom / Connect + this page's
 * create-tools (Decision / InputData / Delete / Auto-arrange, mounted into
 * the toolbar creation group via {@link paletteHost}); the primary
 * **Save / Deploy** actions + the status (connect hint + saved-at +
 * deploy-pending badge) live in the single bottom bar ({@link
 * DesignerActionFooterComponent}, Image-Editor chrome) — there is no
 * separate status strip above the canvas, matching the BPMN/state-machine
 * pages.
 *
 * Interaction: **add** Decision/InputData nodes, **connect** them with
 * InformationRequirement edges (click the required node, then the
 * requiring decision), **delete** (toolbar + Delete key), **auto-arrange**,
 * plus selection + property editing. Save serialises the model to DMN 1.3
 * DRD XML via {@link writeDrdXml}; load seeds it via {@link readDrdXml}.
 *
 * **Deploy** validates the DRD graph (backend `DmnDrdValidator`) + mints
 * an immutable `v{N}.dmn` version — save-then-deploy, mirroring the BPMN
 * and state-machine editors. The backend auto-provisions a fresh key on
 * first save. Route: `/admin/designer/decision/:key`.
 */
@Component({
    selector: 'app-decision-drd-editor-page',
    standalone: true,
    imports: [
    CmsPageHeaderComponent,
    DesignerActionFooterComponent,
    LoadingComponent,
    ErrorBannerComponent
],
    template: `
        <cms-page-header [title]="title()" />

        <div class="drd-editor-page">
            @if (isLoading()) {
                <div class="drd-editor-page__overlay">
                    <app-loading label="Loading draft…" />
                </div>
            }
            @if (loadError()) {
                <app-error-banner [message]="loadError()!" [showRetry]="true" (retry)="retryLoad()" />
            }

            <div class="drd-editor-page__chrome">
                <div #host class="drd-editor-page__host"></div>
                <app-designer-action-footer
                    [savedAt]="lastSavedAt()"
                    [deployedVersion]="latestVersion()"
                    [connectHint]="connectActive() ? connectHint() : null"
                    draftLabel="DMN draft · not deployed"
                    (save)="onSave()"
                    (deploy)="onDeploy()" />
            </div>
        </div>
    `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
            :host {
                display: flex;
                flex: 1;
                flex-direction: column;
                min-height: 0;
            }
            .drd-editor-page {
                position: relative;
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 0;
            }
            .drd-editor-page__chrome {
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 0;
            }
            .drd-editor-page__host {
                flex: 1;
                display: flex;
                min-height: 0;
            }
            .drd-editor-page__overlay {
                position: absolute;
                inset: 0;
                display: grid;
                place-items: center;
                background: color-mix(in srgb, var(--cms-surface) 70%, transparent);
                z-index: 5;
                font: 500 14px/1.4 sans-serif;
            }
        `,
    ],
})
export class DecisionDrdEditorPage implements AfterViewInit, OnDestroy {
    @ViewChild('host', { static: true })
    private readonly hostRef!: ElementRef<HTMLElement>;

    private readonly route = inject(ActivatedRoute);
    private readonly designer = inject(DesignerService);
    private readonly i18n = inject(DesignerI18nService);
    private readonly toast = inject(ToastService);
    private readonly unsaved = inject(UnsavedChangesService);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * Unsaved-work flag, PUBLIC so `unsavedChangesGuard` can read it off the
     * route component. Driven by the COMMAND STACK: `load()` emits a change
     * but pushes no command, so subscribing to the editor would mark a
     * freshly opened draft dirty before the user touched it.
     */
    readonly dirty = signal(false);

    private shellEditor?: Editor;
    private drdEditor?: DmnDrdEditor;
    private panel?: DmnDrdPropertyPanel;
    private offSelectionAutoToggle?: () => void;
    private offConnect?: () => void;

    private definitionKey = '';
    /** The pending source node while connect-mode awaits the requiring decision. */
    private connectSource: string | null = null;

    readonly isLoading = signal<boolean>(true);
    readonly loadError = signal<string | null>(null);
    readonly title = signal<string>('Decision requirements editor');
    readonly lastSavedAt = signal<string | null>(null);
    readonly latestVersion = signal<number>(0);
    readonly connectActive = signal<boolean>(false);
    readonly connectHint = signal<string>('');

    async ngAfterViewInit(): Promise<void> {
        const key = this.route.snapshot.paramMap.get('key');
        if (key === null || key === '') {
            this.loadError.set('No decision key in the URL.');
            this.isLoading.set(false);
            return;
        }
        this.definitionKey = key;
        this.title.set(`Decision requirements: ${key}`);

        await this.i18n.ensureLoaded();
        this.shellEditor = createEditor(this.hostRef.nativeElement, {
            t: this.i18n.translate,
            surface: 'dmn-drd',
            // Save / Deploy live in the page footer (Image-Editor chrome);
            // the toolbar keeps Connect + Fit + the create-tools palette.
            onFit: () => this.fitToContent(),
            // Renders the Connect button in the shell toolbar's creation
            // group (BPMN/state-machine parity); the page owns the 2-click
            // connect state machine + syncs the button via setConnectActive.
            onToggleConnect: () => this.toggleConnect(),
        });

        // Two of the three guard layers wire up here; the third is
        // `canDeactivate` on this page's route.
        this.destroyRef.onDestroy(
            this.shellEditor.commands.onChange(() => this.dirty.set(true)),
        );
        this.destroyRef.onDestroy(this.unsaved.watch(this, () => this.dirty()));

        this.drdEditor = new DmnDrdEditor({
            t: this.i18n.translate,
            host: this.shellEditor.body,
            svgGroup: this.shellEditor.canvasGroup,
            commands: this.shellEditor.commands,
        });

        // Mount the DRD create-tools into the shell toolbar's creation
        // group, right after the shell-rendered Connect button — the same
        // seam the BPMN-Lite Palette uses. They share the shell button
        // styling so the toolbar reads as one native row. Disposed with
        // the toolbar when the shell is destroyed (it owns the DOM).
        this.mountToolbarTools();

        if (this.shellEditor.sidebar !== undefined) {
            const sidebar = this.shellEditor.sidebar;
            this.panel = new DmnDrdPropertyPanel({
                t: this.i18n.translate,
                host: sidebar.propertyHost,
                editor: this.drdEditor,
            });
            this.offSelectionAutoToggle = this.drdEditor.selection.onChange(
                (target) => sidebar.setCollapsed(target === null),
            );
            sidebar.setCollapsed(true);
        }

        // Connect-mode advances on node selection (the editor's click ->
        // selection drives it); the property panel + auto-collapse share
        // the same selection stream harmlessly.
        this.offConnect = this.drdEditor.selection.onChange((target) =>
            this.onSelectionForConnect(target),
        );
        document.addEventListener('keydown', this.onKeyDown);

        await this.loadDraft(key);
    }

    // --- load / save ------------------------------------------------------

    private async loadDraft(key: string): Promise<void> {
        if (this.drdEditor === undefined) return;
        this.isLoading.set(true);
        this.loadError.set(null);
        try {
            const xml = await firstValueFrom(this.designer.getDraft(key));
            let model: DmnDrdModel;
            try {
                model = readDrdXml(xml);
            } catch {
                model = emptyDmnDrdModel(key);
            }
            this.drdEditor.load(model);
            queueMicrotask(() => this.fitToContent());
        } catch (err) {
            // A fresh decision key legitimately has no draft yet (404) —
            // mount a blank DRD. Surface only genuine failures.
            if (httpStatus(err) === 404) {
                this.drdEditor.load(emptyDmnDrdModel(key));
                queueMicrotask(() => this.fitToContent());
            } else {
                this.loadError.set(`Failed to load draft: ${errorMessage(err)}`);
            }
        } finally {
            this.isLoading.set(false);
        }
    }

    /** UI-polish — retry the initial draft load from the shared error banner. */
    protected retryLoad(): void {
        if (this.definitionKey === '') return;
        void this.loadDraft(this.definitionKey);
    }

    protected async onSave(): Promise<void> {
        if (this.drdEditor === undefined || this.definitionKey === '') return;
        const xml = writeDrdXml(this.drdEditor.state);
        try {
            await firstValueFrom(this.designer.saveDraft(this.definitionKey, xml));
            this.lastSavedAt.set(new Date().toISOString());
            this.dirty.set(false);
            this.toast.success('Draft saved.');
        } catch (err) {
            this.toast.error(`Save failed: ${errorMessage(err)}`);
        }
    }

    protected async onDeploy(): Promise<void> {
        if (this.drdEditor === undefined || this.definitionKey === '') return;
        // Save first — the deployer reads the persisted draft from VFS, not
        // the request body (mirrors the BPMN + state-machine designers).
        const xml = writeDrdXml(this.drdEditor.state);
        try {
            await firstValueFrom(this.designer.saveDraft(this.definitionKey, xml));
            this.lastSavedAt.set(new Date().toISOString());
            this.dirty.set(false);
            const result = await firstValueFrom(this.designer.deploy(this.definitionKey));
            this.latestVersion.set(result.version);
            this.toast.success(`Deployed "${this.definitionKey}" v${result.version}.`);
        } catch (err) {
            // A DRD validation failure surfaces as 422 with the validator's
            // message (dangling/self/cyclic requirement, id mismatch, …).
            this.toast.error(`Deploy failed: ${errorMessage(err)}`);
        }
    }

    // --- interactive authoring --------------------------------------------

    /**
     * Append the DRD create-tools to the shell toolbar's creation group
     * (`paletteHost`). Buttons carry the shell's own button classes so
     * they match the native Save/Undo/Zoom/Connect controls. No explicit
     * teardown: `shellEditor.destroy()` disposes the toolbar, which
     * removes its host element (and these children) from the DOM.
     */
    private mountToolbarTools(): void {
        const toolbar = this.shellEditor?.toolbar;
        if (toolbar === undefined) return;
        const host = toolbar.paletteHost;
        this.makeToolbarButton(host, '+ Decision', undefined, () => this.addNode('decision'));
        this.makeToolbarButton(host, '+ Input', undefined, () => this.addNode('inputData'));
        this.makeToolbarButton(host, 'Delete selected', 'bi-trash', () => this.deleteSelected());
        this.makeToolbarButton(host, 'Auto-arrange', 'bi-diagram-3', () => this.autoArrange());
    }

    /** Mint a shell-styled toolbar button (text, or an icon when `icon` is set). */
    private makeToolbarButton(
        host: HTMLElement,
        label: string,
        icon: string | undefined,
        onClick: () => void,
    ): void {
        const doc = host.ownerDocument;
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.classList.add('coolms-designer__toolbar-button');
        btn.setAttribute('aria-label', label);
        btn.title = label;
        if (icon !== undefined) {
            btn.classList.add('coolms-designer__toolbar-button--icon');
            const i = doc.createElement('i');
            i.classList.add('bi', icon);
            i.setAttribute('aria-hidden', 'true');
            btn.appendChild(i);
        } else {
            btn.textContent = label;
        }
        btn.addEventListener('click', onClick);
        host.appendChild(btn);
    }

    addNode(kind: DmnDrdElementKind): void {
        if (this.drdEditor === undefined) return;
        const els = this.drdEditor.state.elements;
        // Place to the right of the rightmost node so it never overlaps;
        // the user can Auto-arrange to tidy. Computed placement keeps undo
        // clean (no separate layout pass to reverse).
        const x = els.length === 0
            ? 48
            : Math.max(...els.map((e) => e.position.x + e.size.width)) + 48;
        const id = this.drdEditor.suggestElementId(kind);
        this.drdEditor.commandStack.execute(
            new AddElementCommand(this.drdEditor, {
                id,
                kind,
                name: '',
                position: { x, y: 48 },
                size: defaultSizeForKind(kind),
            }),
        );
        this.drdEditor.selection.select({ kind: 'element', id });
        this.fitToContent();
    }

    toggleConnect(): void {
        if (this.drdEditor === undefined) return;
        const next = !this.connectActive();
        this.connectActive.set(next);
        // Keep the shell toolbar's Connect button pressed-state in sync.
        this.shellEditor?.toolbar?.setConnectActive(next);
        if (next) {
            const sel = this.drdEditor.selection.target;
            this.connectSource = sel?.kind === 'element' ? sel.id : null;
            this.connectHint.set(
                this.connectSource !== null
                    ? `Connecting from "${this.connectSource}" — click the requiring decision.`
                    : 'Click the required node, then the requiring decision.',
            );
        } else {
            this.connectSource = null;
            this.connectHint.set('');
        }
    }

    private onSelectionForConnect(
        target: { kind: 'element' | 'requirement'; id: string } | null,
    ): void {
        if (!this.connectActive() || this.drdEditor === undefined) return;
        if (target === null || target.kind !== 'element') return;
        const id = target.id;
        if (this.connectSource === null) {
            this.connectSource = id;
            this.connectHint.set(`Connecting from "${id}" — click the requiring decision.`);
            return;
        }
        if (id === this.connectSource) return; // a node can't require itself
        this.drdEditor.commandStack.execute(
            new AddRequirementCommand(this.drdEditor, {
                id: this.drdEditor.suggestRequirementId(),
                from: this.connectSource,
                to: id,
            }),
        );
        this.connectSource = null;
        this.connectHint.set('Click the required node, then the requiring decision.');
        this.toast.success('Requirement added.');
    }

    deleteSelected(): void {
        if (this.drdEditor === undefined) return;
        const sel = this.drdEditor.selection.target;
        if (sel === null) return;
        if (sel.kind === 'element') {
            this.drdEditor.commandStack.execute(
                new RemoveElementCommand(this.drdEditor, sel.id),
            );
        } else {
            this.drdEditor.commandStack.execute(
                new RemoveRequirementCommand(this.drdEditor, sel.id),
            );
        }
    }

    autoArrange(): void {
        if (this.drdEditor === undefined) return;
        this.drdEditor.autoLayout();
        this.fitToContent();
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        // Escape leaves connect mode (mirrors the BPMN editor's Esc handler).
        if (event.key === 'Escape') {
            if (this.connectActive()) this.toggleConnect();
            return;
        }
        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
        const t = event.target as HTMLElement | null;
        if (
            t !== null &&
            (t.tagName === 'INPUT' ||
                t.tagName === 'TEXTAREA' ||
                t.tagName === 'SELECT' ||
                t.isContentEditable)
        ) {
            return; // typing in a property field — don't delete the node
        }
        if (this.drdEditor?.selection.target == null) return;
        event.preventDefault();
        this.deleteSelected();
    };

    private fitToContent(): void {
        if (this.drdEditor === undefined || this.shellEditor === undefined) return;
        const bbox = this.drdEditor.contentBbox();
        if (bbox === null) return;
        const svg = this.shellEditor.canvasGroup.ownerSVGElement;
        if (svg === null) return;
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        this.shellEditor.viewport.fitToContent(
            bbox,
            { width: rect.width, height: rect.height },
            { padding: 0.1 },
        );
    }

    ngOnDestroy(): void {
        document.removeEventListener('keydown', this.onKeyDown);
        try {
            this.offSelectionAutoToggle?.();
            this.offConnect?.();
        } catch {
            // ignore
        }
        try {
            this.panel?.dispose();
        } catch {
            // ignore
        }
        try {
            this.drdEditor?.dispose();
        } finally {
            this.shellEditor?.destroy();
        }
    }
}

/** The HTTP status of an unknown error, or 0 when not an HttpErrorResponse-shaped value. */
function httpStatus(err: unknown): number {
    if (err !== null && typeof err === 'object' && 'status' in err) {
        const status = (err as { status?: unknown }).status;
        if (typeof status === 'number') return status;
    }
    return 0;
}
