
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    HostListener,
    OnDestroy,
    ViewChild,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { createEditor, XRefs, type Editor } from '@coolms/designer';
import {
    BpmnLiteEditor,
    BpmnLiteKeyboardController,
    BpmnLitePropertyPanel,
    BpmnLiteSelectionController,
    ConnectMode,
    ConnectHandleController,
    MoveElementController,
    Palette,
    PanMode,
    bpmnLiteJsonToModel,
    bpmnLiteModelToJson,
    BpmnLiteParseError,
    emptyBpmnLiteModel,
} from '@coolms/designer/bpmn-lite';

import { CmsPageHeaderComponent, ErrorBannerComponent, LoadingComponent, ToastService, UnsavedChangesService } from '@coolms/ui-angular';
import { contributorSourceVersion, isContributorSource409 } from './shared/contributor-source';
import { DesignerActionFooterComponent } from './shared/designer-action-footer.component';
import { errorMessage } from './shared/error-message';
import { DesignerService } from './designer.service';
import { DesignerI18nService } from './designer-i18n.service';

/**
 * FE -- BPMN-Lite designer page mounted at
 * `/admin/designer/bpmn/:key`.
 *
 * **Closes the authoring -> deploy loop end-to-end.**
 * Mounts the `BpmnLiteEditor` ( paint, flows,
 * palette, connect mode, property panel,
 * JSON serializer) inside the editor shell + wires
 * Save/Deploy buttons to the backend endpoints via
 * {@link DesignerService}.
 *
 * **Lifecycle**:
 *  1. `ngAfterViewInit` mounts the shell + the BpmnLiteEditor + the
 * Palette into `editor.sidebar.paletteHost` + the
 *     property panel into `editor.sidebar.propertyHost` + the
 *     selection controller. Connect mode is constructed lazily on
 *     the first toggle click.
 *  2. Fetches the draft via `getWorkflowDraft(key)`. If body is
 *     non-empty, parses with `bpmnLiteJsonToModel` and seeds
 *     via `editor.load(model)`. Empty body OR parse error -> empty
 *     model + toast (so the editor mounts cleanly even when the
 *     backend has a half-written body).
 *  3. Toolbar **Save** -> `bpmnLiteModelToJson(editor.state)` ->
 *     `saveWorkflowDraft(key, body)`. Updates the `lastModifiedAt`
 *     signal for the indicator.
 *  4. Toolbar **Deploy** -> Save first, then
 *     `deployWorkflow(key)`. Surfaces the new version number in a
 *     toast.
 *  5. **Esc** keyboard binding exits connect mode (matching the
 *     standard BPMN modeler convention).
 *  6. `ngOnDestroy` -> dispose order: connect mode, selection
 *     controller, palette, property panel, BpmnLiteEditor, shell
 *     editor. Each is null-guarded so partial-mount teardown is
 *     safe.
 *
 * **Connect mode toggle**: Connect mode is a modal state.
 * The page exposes a button in its own toolbar row (the shell
 * toolbar already carries Save/Deploy/Undo/Redo; the connect
 * button lives in a page-level button group so it can show
 * pressed-state when active). The button's `aria-pressed`
 * reflects `connectMode.active`.
 *
 * **Deferred (+)**:
 *  - Decision-key / handler-key autocomplete in the property panel
 *    -- needs M2.j handler catalog + decision list piping
 *    into the XRefs registry.
 *  - Structured violation rendering: the deploy processor
 *    maps `DefinitionValidationException` to a 400 with the message
 *    string; will plumb the structured violation list +
 *    surface it in an inline error panel.
 *  - Dirty-state tracking with beforeunload guard.
 *  - Auto-save on idle.
 *  - Collaborative-edit warning via the M2.k Centrifugo realtime
 *    bus when another author opens the same draft.
 */
@Component({
    selector: 'app-bpmn-editor-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
    CmsPageHeaderComponent,
    DesignerActionFooterComponent,
    LoadingComponent,
    ErrorBannerComponent
],
    template: `
        @if (!embedded()) {
            <cms-page-header [title]="title()" />
        }

        <div
            class="bpmn-editor-page"
            [class.bpmn-editor-page--loading]="isLoading()"
        >
            @if (isLoading()) {
                <div class="bpmn-editor-page__overlay">
                    <app-loading label="Loading draft…" />
                </div>
            }
            @if (loadError()) {
                <app-error-banner
                    [message]="loadError()!"
                    [showRetry]="true"
                    (retry)="retryLoad()"
                />
            }

            <!--
              Ship A Phase 5+ (FE polish) -- contributor-source banner.
              Renders when the draft GET returns 409 with
              X-CoolMS-Workflow-Source: contributor. The editor itself
              does NOT mount in this state; the user must fork-to-VFS
              first or click through to the read-only viewer.
            -->
            @if (contributorBanner(); as banner) {
                <div
                    class="bpmn-editor-page__contributor-banner"
                    role="alert"
                    aria-live="polite"
                >
                    <div class="bpmn-editor-page__contributor-banner-inner">
                        <h2 class="bpmn-editor-page__contributor-banner-title">
                            <span class="badge bg-info text-dark me-2"
                                >Shipped by module</span
                            >
                            {{ banner.title }}
                        </h2>
                        <p class="bpmn-editor-page__contributor-banner-body">
                            {{ banner.message }}
                        </p>
                        <div class="bpmn-editor-page__contributor-banner-actions">
                            @if (banner.viewVersion !== null) {
                                <!--
                                  Viewing a module-shipped workflow must not
                                  require forking it. The deployed body is
                                  already served read-only; a plain navigation
                                  re-mounts this page in the existing viewer
                                  mode (Save/Deploy/Connect suppressed).
                                -->
                                <button
                                    type="button"
                                    class="cms-btn cms-btn-primary"
                                    (click)="onViewReadOnly(banner.viewVersion!)"
                                >
                                    View v{{ banner.viewVersion }} (read-only)
                                </button>
                            }
                            <button
                                type="button"
                                class="cms-btn"
                                [disabled]="forkPending()"
                                (click)="onForkToVfs()"
                            >
                                {{ forkPending() ? 'Forking…' : 'Fork to VFS to edit' }}
                            </button>
                            <button
                                type="button"
                                class="cms-btn"
                                (click)="onLeaveBanner()"
                            >
                                {{ embedded() ? 'Close' : 'Back to dashboard' }}
                            </button>
                        </div>
                    </div>
                </div>
            }

            <div
                class="bpmn-editor-page__chrome"
                [class.d-none]="contributorBanner() !== null"
            >
                <div #host class="bpmn-editor-page__host"></div>
                <!--
                  UI-polish — the consolidated bottom bar (Image-Editor
                  chrome): status on the left (saved-at + Deployed-vN badge +
                  connect hint + the forked-from-module chip / Revert projected
                  into its slot), Cancel/Save/Deploy on the right. The separate
                  top status strip is retired so it no longer wastes a band
                  between the header and the canvas. In viewer mode
                  (version != null) the write actions are withheld, so the bar
                  shows status only.
                -->
                <app-designer-action-footer
                    [savedAt]="lastSavedAt()"
                    [deployedVersion]="latestVersion()"
                    [connectHint]="connectActive() ? 'Click a source element, then a target to connect.' : null"
                    draftLabel="Workflow draft · not deployed"
                    [showSave]="effectiveVersion() === null"
                    [showDeploy]="effectiveVersion() === null"
                    [showCancel]="embedded()"
                    (save)="onSave()"
                    (deploy)="onDeploy()"
                    (cancel)="cancel.emit()"
                >
                    <!--
                      Ship A Phase 5+ (FE polish) — forked-from-module
                      chip + Revert button. Visible only when the draft we
                      loaded sits atop a contributor row with moduleLock=true.
                    -->
                    @if (forkedFromModule()) {
                        <span
                            class="badge bg-warning text-dark"
                            title="This draft was forked from a module-shipped baseline. Subsequent module body upgrades are ignored until you revert."
                        >
                            Forked from module
                        </span>
                        <button
                            type="button"
                            class="cms-btn cms-btn-sm"
                            [disabled]="revertPending()"
                            (click)="onRevertToModule()"
                        >
                            {{ revertPending() ? 'Reverting…' : 'Revert to module' }}
                        </button>
                    }
                </app-designer-action-footer>
            </div>
        </div>
    `,
    styles: [
        `
            :host {
                display: flex;
                flex: 1;
                flex-direction: column;
                min-height: 0;
            }
            .bpmn-editor-page {
                position: relative;
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 0;
            }
            .bpmn-editor-page__chrome {
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 0;
            }
            .bpmn-editor-page__host {
                flex: 1;
                display: flex;
                min-height: 0;
            }
            .bpmn-editor-page__overlay {
                position: absolute;
                inset: 0;
                display: grid;
                place-items: center;
                background: color-mix(in srgb, var(--cms-surface) 70%, transparent);
                z-index: 5;
                font: 500 14px/1.4 sans-serif;
            }
            .bpmn-editor-page__contributor-banner {
                flex: 1;
                display: grid;
                place-items: center;
                padding: 24px;
            }
            .bpmn-editor-page__contributor-banner-inner {
                max-width: 640px;
                padding: 32px;
                border: 1px solid var(--cms-btn-border);
                border-radius: var(--cms-radius-md, 8px);
                background: var(--cms-surface-muted);
                box-shadow: var(--cms-shadow-sm, 0 1px 3px rgba(0,0,0,.08));
            }
            .bpmn-editor-page__contributor-banner-title {
                font: 600 18px/1.3 system-ui, sans-serif;
                margin: 0 0 12px;
                display: flex;
                align-items: center;
            }
            .bpmn-editor-page__contributor-banner-body {
                font: 14px/1.5 system-ui, sans-serif;
                color: var(--cms-text-body);
                margin: 0 0 20px;
            }
            .bpmn-editor-page__contributor-banner-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
        `,
    ],
})
export class BpmnEditorPage implements AfterViewInit, OnDestroy {
    @ViewChild('host', { static: true })
    private readonly hostRef!: ElementRef<HTMLElement>;

    private readonly route = inject(ActivatedRoute);
    private readonly designer = inject(DesignerService);
    private readonly i18n = inject(DesignerI18nService);
    private readonly toast = inject(ToastService);
    private readonly unsaved = inject(UnsavedChangesService);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * Unsaved-work flag, PUBLIC because `unsavedChangesGuard` reads it off
     * the route component structurally.
     *
     *  Driven by the COMMAND STACK, not by `editor.onChange`. `load()`
     * emits a change event but pushes no command, so subscribing to the
     * editor would mark a freshly opened draft dirty before the user had
     * touched it -- a prompt on every exit, which trains people to click
     * through the one that matters.
     */
    readonly dirty = signal(false);

    /**
     * Optional inputs for hosting this page inside the generic
     * {@link DesignerEditorDialogComponent} modal. `key` overrides the
     * route param (a modal has no route context); `embedded` hides the
     * `<cms-page-header>` (the modal supplies its own header chrome).
     *
     * `version` switches the page into **read-only viewer mode**: when
     * non-null the page loads the pinned bytes of `v{N}` via
     * {@link DesignerService.getWorkflowVersion} (instead of the editable
     * draft) and mounts the editor display-only — no palette, no
     * move-controller, keyboard `readOnly`, and Save/Deploy/Connect/Hand
     * withheld from the shell toolbar (their `createEditor` callbacks are
     * omitted, so the buttons never render). This is the mode the File
     * Explorer uses for a `v{N}.bpmn.json` node; the routed page never
     * sets it (route deep-links are always editor mode).
     */
    readonly key      = input<string | null>(null);
    readonly embedded = input<boolean>(false);
    readonly version  = input<number | null>(null);
    /**
     * The version the page ACTUALLY mounted at: the `version` input, or
     * `?version=N` on the routed page.
     *
     * The template must bind to THIS, never the raw input — the
     * contributor "View read-only" path supplies the version via query
     * param, and binding `version()` left Save/Deploy on screen in a
     * viewer that had already disabled every canvas interaction.
     */
    readonly effectiveVersion = signal<number | null>(null);
    /** Emitted by the footer Cancel button; the modal host binds it to close. */
    readonly cancel   = output<void>();
    /**
     * Embedded only: "open this deployed version read-only". The host
     * re-renders this page with `[version]`, which recreates the
     * component in viewer mode without touching the browser location.
     */
    readonly viewReadOnly = output<number>();

    private shellEditor?: Editor;
    private bpmnEditor?: BpmnLiteEditor;
    private palette?: Palette;
    private panel?: BpmnLitePropertyPanel;
    private selectionController?: BpmnLiteSelectionController;
    private connect?: ConnectMode;
    private connectHandle?: ConnectHandleController;
    private pan?: PanMode;
    private moveController?: MoveElementController;
    private keyboard?: BpmnLiteKeyboardController;
    /**
     * F-8 redesign -- unsubscribe thunk for the auto-toggle that
     * mirrors selection state into the sidebar's collapsed state.
     */
    private offSelectionAutoToggle?: () => void;
    /**
     * -- XRefs registry handed to the property panel. The
     * page populates scopes `workflow.handlers` + `workflow.forms`
     * on mount + the panel's SELECT fields subscribe to it.
     */
    private xrefs?: XRefs;

    /** `protected` so the contributor banner can link to its read-only viewer. */
    protected definitionKey = '';

    readonly isLoading = signal<boolean>(true);
    readonly loadError = signal<string | null>(null);
    readonly title = signal<string>('Workflow editor');
    readonly lastSavedAt = signal<string | null>(null);
    /** Latest deployed version (in-session); > 0 -> the shared status bar's "Deployed vN" badge. */
    readonly latestVersion = signal<number>(0);
    readonly connectActive = signal<boolean>(false);
    readonly panActive = signal<boolean>(false);
    /**
     * Ship A Phase 5+ (FE polish) -- when non-null, the editor mount
     * is suppressed and the "shipped by module" banner is rendered
     * instead. Set by the 409 detection path in `ngAfterViewInit`.
     */
    readonly contributorBanner = signal<{
        title: string;
        message: string;
        /** Deployed version to open read-only, or null when none is deployed. */
        viewVersion: number | null;
    } | null>(null);
    /**
     * Open the module-shipped body read-only.
     *
     * **Embedded (modal): stays in the modal.** It asks the host to
     * re-render this page in viewer mode; the host swaps template
     * branches, so Angular destroys and recreates the component and
     * `ngAfterViewInit` runs again with a version — the mode decision
     * stays in ONE place instead of being duplicated into a re-init
     * path. The previous `location.assign()` reloaded the entire SPA to
     * accomplish a panel swap, which also destroyed the dialog the user
     * was working in.
     *
     * **Routed page: a full navigation, deliberately.** The router
     * REUSES this component when only query params change, so an in-app
     * navigation would update the URL and leave the banner on screen
     * (observed). A document load is what a deep link does anyway.
     */
    protected onViewReadOnly(version: number): void {
        if (this.embedded()) {
            this.viewReadOnly.emit(version);

            return;
        }
        window.location.assign(
            `/admin/designer/bpmn/${encodeURIComponent(this.definitionKey)}?version=${version}`,
        );
    }

    /**
     * Leave the banner.
     *
     * The two hosts need opposite things and the banner had only the
     * routed one: inside the modal a `routerLink` navigated the
     * BACKGROUND page (landing on whatever `/` resolves to) and left the
     * dialog wide open over it.
     */
    protected onLeaveBanner(): void {
        if (this.embedded()) {
            this.cancel.emit();

            return;
        }
        window.location.assign('/admin/');
    }

    /**
     * `?version=N` on the routed page -> read-only viewer. Returns null
     * for an absent/garbage value so the page falls back to editor mode.
     */
    private readVersionQueryParam(): number | null {
        const raw = this.route.snapshot.queryParamMap.get('version');
        if (raw === null) {
            return null;
        }
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    /** Disables the Fork button while the POST is in flight. */
    readonly forkPending = signal<boolean>(false);
    /** Disables the Revert button while the POST is in flight. */
    readonly revertPending = signal<boolean>(false);
    /**
     * Ship A Phase 5+ (FE polish) -- true when the loaded draft sits
     * atop a contributor-source row with `moduleLock=true`. Drives
     * the "Forked from module" chip + Revert button in the toolbar.
     */
    readonly forkedFromModule = signal<boolean>(false);

    async ngAfterViewInit(): Promise<void> {
        const key = this.key() ?? this.route.snapshot.paramMap.get('key');
        if (!key) {
            this.loadError.set('No workflow key in the URL.');
            this.isLoading.set(false);
            return;
        }
        this.definitionKey = key;

        /**
         * Viewer mode: the `version` input pins the page to a deployed
         * version, loaded read-only (File Explorer -> `v{N}.bpmn.json`,
         * and the modal). Null = editor mode.
         *
         * The routed page also honours `?version=N`, which is how the
         * "shipped by module" banner opens a module workflow read-only
         * WITHOUT forking it. Read explicitly from the snapshot because
         * this app does not enable `withComponentInputBinding()`, so
         * query params do NOT populate `input()`s.
         */
        const versionNumber = this.version() ?? this.readVersionQueryParam();
        // Publish it so the TEMPLATE (Save/Deploy visibility) agrees with
        // the mount decision, whichever source supplied the version.
        this.effectiveVersion.set(versionNumber);
        const isViewer = versionNumber !== null;
        this.title.set(
            isViewer
                ? `Workflow: ${key} — v${versionNumber} (read-only)`
                : `Workflow: ${key}`,
        );

        // Mount the shell. The shell creates the toolbar (Save + Deploy
        // right-aligned, undo/redo + zoom + palette + mode-toggle
        // buttons left-aligned) + canvas + sidebar. The page's chrome
        // is intentionally identical to the modal dialog's editor
        // chrome — only the host (route vs. CDK dialog) differs.
        // `onFit`, `onToggleConnect`, `onToggleHand` mirror the dialog
        // wiring (F-6 / F-7.4): Connect + Hand + Fit live in the shell
        // action bar so the page stays canvas-maximum without an
        // extra row of page-level chrome.
        await this.i18n.ensureLoaded();
        this.shellEditor = createEditor(this.hostRef.nativeElement, {
            t: this.i18n.translate,
            surface: 'bpmn-lite',
            // Save / Deploy are NOT wired into the shell toolbar — they
            // live in the page footer (Image-Editor chrome). Fit is wired
            // in both modes (a read-only viewer benefits from re-fit too).
            // Connect / Hand are editor-only: omitting their callbacks in
            // viewer mode makes the shell Toolbar suppress those buttons,
            // so a pinned version is display-only with no write affordances.
            onFit: () => this.fitToContent(),
            ...(isViewer
                ? {}
                : {
                      onToggleConnect: () => this.toggleConnect(),
                      onToggleHand: () => this.togglePan(),
                  }),
        });

        // Mount the BpmnLiteEditor inside the shell. The banner mounts
        // into `shell.body`; the SVG element paints into the shell's
        // canvas viewport group; the command stack is the shell's so
        // toolbar undo/redo stays coherent with editor mutations.
        this.bpmnEditor = new BpmnLiteEditor({
            t: this.i18n.translate,
            host: this.shellEditor.body,
            commands: this.shellEditor.commands,
            svgGroup: this.shellEditor.canvasGroup,
        });

        // All three guard layers for this page: the command stack marks it
        // dirty, the registry covers a tab close, and the route's
        // canDeactivate covers in-SPA navigation.
        this.destroyRef.onDestroy(
            this.shellEditor.commands.onChange(() => this.dirty.set(true)),
        );
        this.destroyRef.onDestroy(this.unsaved.watch(this, () => this.dirty()));

        // -- the XRefs registry is constructed first so the
        // property panel subscribes to live scope updates from the
        // moment it mounts; the page then kicks off the async
        // populate (handler + form catalogs) in parallel with the
        // draft load. If the picker dropdown is opened before the
        // catalog HTTP completes, it renders an empty options list
        // + auto-refreshes once `registerLookup()` fires the
        // change emit.
        this.xrefs = new XRefs();

        // F-8 redesign -- the Palette mounts into the Toolbar's
        // `paletteHost` (creation subgroup) so Connect + element
        // palette items cluster as create-tools in the action bar
        // (Figma / Camunda Modeler convention). The Sidebar is now
        // property-panel-only + auto-toggles based on selection.
        if (!isViewer && this.shellEditor.toolbar !== undefined) {
            this.palette = new Palette({
                host: this.shellEditor.toolbar.paletteHost,
                editor: this.bpmnEditor,
            });
        }
        if (this.shellEditor.sidebar !== undefined) {
            this.panel = new BpmnLitePropertyPanel({
                t: this.i18n.translate,
                host: this.shellEditor.sidebar.propertyHost,
                editor: this.bpmnEditor,
                xrefs: this.xrefs,
                // A viewer has every canvas gesture suppressed already;
                // leaving the property fields typable told the author
                // they could change something this surface will never
                // save.
                readOnly: isViewer,
            });
        }

        // -- populate XRefs in the background so the editor
        // mounts on a hot path even when the catalog endpoints lag.
        // Errors are non-fatal: a missing handler catalog just leaves
        // the dropdown empty + raises a toast; it doesn't block
        // authoring (the user can still hand-type a key + save).
        void this.populateXRefs();

        // Click-to-select wiring: pointerdown on a painted element /
        // flow `<g>` selects it via the editor's selection state. The
        // panel + the highlight pass both subscribe to the same
        // selection.
        this.selectionController = new BpmnLiteSelectionController({
            editor: this.bpmnEditor,
        });

        //-7.1 — drag-to-move on existing canvas elements.
        // The isConnectActive / isPanActive gates flip OFF the move
        // gesture whenever ConnectMode or PanMode is active, keeping
        // the three pointer paths (connect / pan / move) mutually
        // exclusive without the controllers cross-referencing each
        // other.
        // Drag-to-move is editor-only; a read-only viewer must not let
        // the diagram be rearranged (the edits couldn't be persisted).
        if (!isViewer) {
            this.moveController = new MoveElementController({
                editor: this.bpmnEditor,
                isConnectActive: () => this.connectActive(),
                isPanActive: () => this.panActive(),
            });

            // Hover connect-handle — the always-on, Camunda-style
            // connect affordance. Hovering an element surfaces a small
            // arrow puck at its right edge; dragging it to a target
            // draws a sequence flow, no modal toggle needed. Suppressed
            // while the hand-tool owns the canvas or the modal Connect
            // mode is armed (a redundant second connect path). Grabbing
            // the element BODY still moves it — the handle is a distinct
            // target, so move + connect never collide.
            this.connectHandle = new ConnectHandleController({
                editor: this.bpmnEditor,
                isSuppressed: () =>
                    this.panActive() || this.connectActive(),
            });
        }

        //-4 / F-5 — keyboard shortcuts (Delete to remove
        // selection; arrow-key pan + +/-/0 zoom hotkeys). Mirrors
        // the dialog wiring with `readOnly: false` because the
        // standalone page is always in editor mode.
        // `readOnly: isViewer` suppresses the Delete/Backspace bindings
        // in viewer mode while keeping arrow-pan + zoom navigation.
        this.keyboard = new BpmnLiteKeyboardController({
            editor: this.bpmnEditor,
            commands: this.shellEditor.commands,
            viewport: this.shellEditor.viewport,
            readOnly: isViewer,
        });

        // F-8 redesign -- auto-toggle the sidebar based on selection
        // state. Selecting an element/flow expands the property
        // panel; clicking empty canvas (selection -> null) slides it
        // back off. Matches Figma's right-rail behaviour. The
        // sidebar starts collapsed (F-8 default).
        if (this.shellEditor.sidebar !== undefined) {
            const sidebar = this.shellEditor.sidebar;
            this.offSelectionAutoToggle =
                this.bpmnEditor.selection.onChange((target) => {
                    sidebar.setCollapsed(target === null);
                });
        }

        // Connect mode is constructed lazily on first toggle (saves
        // the listener attach when the user never enters it).

        if (isViewer && versionNumber !== null) {
            await this.loadVersion(key, versionNumber);
        } else {
            await this.loadDraft(key);
        }
    }

    /**
     * Ship A Phase 5+ (FE polish) -- extracted from `ngAfterViewInit`
     * so the post-fork flow can re-invoke it without re-mounting the
     * shell / palette / panel chrome.
     *
     * Three paths:
     *  1. **200 OK** -- normal draft load; seeds the editor model +
     *     stamps the `lastSavedAt` indicator + reads `latestVersionSource`
     *     + `moduleLock` to decide whether to surface the
     *     "Forked from module" chip.
     *  2. **HTTP 409 + `X-CoolMS-Workflow-Source: contributor`** --
     *     the typed `ContributorSourceHasNoDraftException` from the
     *     backend. Switch into the contributor banner state; the
     *     editor stays hidden until Fork-to-VFS lands.
     *  3. **Other error** -- generic load failure; renders the
     *     legacy `loadError` alert. Pre-existing behaviour.
     */
    private async loadDraft(key: string): Promise<void> {
        if (!this.bpmnEditor) return;

        this.isLoading.set(true);
        this.loadError.set(null);
        this.contributorBanner.set(null);
        this.forkedFromModule.set(false);

        try {
            const payload = await firstValueFrom(
                this.designer.getWorkflowDraft(key),
            );
            this.lastSavedAt.set(payload.lastModifiedAt);

            // Phase 5+ -- the forked-from-module chip is keyed off the
            // latest version row's (source, moduleLock) tuple, both
            // surfaced on the draft resource.
            this.forkedFromModule.set(
                payload.latestVersionSource === 'contributor'
                    && payload.moduleLock === true,
            );

            this.loadBody(payload.body, key);
        } catch (err) {
            if (isContributorSource409(err)) {
                // Ship A Phase 5+ -- the backend signalled a
                // contributor-source definition with no editable
                // draft. Render the banner; the editor stays unmounted
                // until the user forks or navigates away.
                const shippedVersion = contributorSourceVersion(err);
                this.contributorBanner.set({
                    title: this.definitionKey,
                    message: shippedVersion !== null
                        ? 'This workflow is shipped by a module, so it has no '
                            + 'editable draft. You can view the deployed body '
                            + 'read-only, or fork it to VFS to take local '
                            + 'ownership and edit.'
                        : 'This workflow is shipped by a module. Its body lives '
                            + 'in the module\'s bundled resource — there is no '
                            + 'editable draft. Fork to VFS to take local '
                            + 'ownership and start editing.',
                    // Drives the read-only "View" action. Viewing a
                    // module's workflow should never require forking it.
                    viewVersion: shippedVersion,
                });
            } else {
                // Banner ONLY — see the note in `loadVersion`. The inline
                // banner is the durable surface AND carries Retry; a
                // duplicate toast just says the same thing twice.
                this.loadError.set(`Failed to load draft: ${errorMessage(err)}`);
            }
        } finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Viewer-mode load (slice-3 unification, was the bespoke
     * `bpmn-editor-dialog`'s viewer path). Fetches the pinned bytes of a
     * deployed `v{N}` via {@link DesignerService.getWorkflowVersion} and
     * seeds the editor read-only. No contributor / fork / revert logic —
     * a deployed version is immutable by construction. The "Deployed vN"
     * badge is surfaced by stamping `latestVersion`.
     */
    private async loadVersion(key: string, version: number): Promise<void> {
        if (!this.bpmnEditor) return;
        this.isLoading.set(true);
        this.loadError.set(null);
        this.contributorBanner.set(null);
        this.forkedFromModule.set(false);
        try {
            const payload = await firstValueFrom(
                this.designer.getWorkflowVersion(key, version),
            );
            this.lastSavedAt.set(payload.deployedAt);
            this.latestVersion.set(version);
            this.loadBody(payload.body, key);
        } catch (err) {
            /**
             * Banner ONLY, no toast. `ErrorBannerComponent` was built
             * "instead of a blank panel + a transient toast that scrolls
             * away" — emitting both showed the same sentence twice and
             * was what the designer's error UI got flagged for. Toasts
             * stay for ACTIONS the user just triggered (Save / Deploy /
             * Fork), where there is no inline surface to carry them.
             */
            this.loadError.set(
                `Failed to load version v${version}: ${errorMessage(err)}`,
            );
        } finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Seed the editor from a fetched JSON body, tolerating a malformed
     * body by falling back to an empty model + a toast (so the editor
     * always mounts cleanly even atop half-written bytes). Shared by the
     * draft + version load paths. `queueMicrotask` defers the fit past
     * `load()`'s synchronous repaint so the canvas SVG has its size
     * before `getBoundingClientRect()` runs.
     */
    private loadBody(body: string, key: string): void {
        if (!this.bpmnEditor) return;
        if (body.trim() === '') {
            this.bpmnEditor.load(emptyBpmnLiteModel(key));
            this.fitToContent();
            return;
        }
        try {
            const model = bpmnLiteJsonToModel(body);
            this.bpmnEditor.load(model);
            queueMicrotask(() => this.fitToContent());
        } catch (parseErr: unknown) {
            this.bpmnEditor.load(emptyBpmnLiteModel(key));
            this.fitToContent();
            const msg =
                parseErr instanceof BpmnLiteParseError
                    ? parseErr.message
                    : errorMessage(parseErr);
            this.toast.error(`Failed to parse body: ${msg}`);
        }
    }

    /**
     * UI-polish — retry handler for the shared `<app-error-banner>` shown
     * on a failed initial load. Re-runs the correct load path (the pinned
     * version in viewer mode, else the editable draft). No-op until the
     * definition key is known (the malformed-route case).
     */
    protected retryLoad(): void {
        const key = this.definitionKey;
        if (key === '') return;
        // Effective, not the raw input — a `?version=` viewer must retry
        // the VERSION load, not fall through to the draft (which 409s for
        // a contributor-source definition and would re-show the banner).
        const v = this.effectiveVersion();
        if (v !== null) {
            void this.loadVersion(key, v);
        } else {
            void this.loadDraft(key);
        }
    }

    /**
     * Ship A Phase 5+ (FE polish) -- Fork-to-VFS click handler.
     * POSTs the lifecycle action + on success reloads the draft (now
     * editable). The backend returns the freshly-minted draft body
     * in the same response, but reusing `loadDraft` keeps the
     * editor-mount path consistent with the normal opening flow.
     */
    async onForkToVfs(): Promise<void> {
        if (this.forkPending() || !this.definitionKey) return;
        this.forkPending.set(true);
        try {
            await firstValueFrom(
                this.designer.forkWorkflowToVfs(this.definitionKey),
            );
            this.toast.success(
                `Forked "${this.definitionKey}" to VFS — draft ready to edit.`,
            );
            await this.loadDraft(this.definitionKey);
        } catch (err) {
            this.toast.error(`Fork failed: ${errorMessage(err)}`);
        } finally {
            this.forkPending.set(false);
        }
    }

    /**
     * Ship A Phase 5+ (FE polish) -- Revert-to-module click handler.
     * POSTs the lifecycle action + navigates the user back to the
     * contributor-banner state (the canonical body is now the
     * module's again, so the draft they were editing is orphan
     * history). Confirms before firing because revert discards
     * lifecycle state that won't come back without a fresh fork.
     */
    async onRevertToModule(): Promise<void> {
        if (this.revertPending() || !this.definitionKey) return;
        const ok = window.confirm(
            `Revert "${this.definitionKey}" to the module-shipped baseline?`
            + '\n\n'
            + 'The local draft will be orphaned (kept in history but no '
            + 'longer active). Subsequent module body upgrades will '
            + 'resume drift detection. You can fork again at any time.',
        );
        if (!ok) return;

        this.revertPending.set(true);
        try {
            await firstValueFrom(
                this.designer.revertWorkflowToModule(this.definitionKey),
            );
            this.toast.success(
                `Reverted "${this.definitionKey}" to module baseline.`,
            );
            // Reload the draft -- which will now 409 + render the
            // contributor banner, mirroring the cold-open path for
            // an unforked contributor-source definition.
            await this.loadDraft(this.definitionKey);
        } catch (err) {
            this.toast.error(`Revert failed: ${errorMessage(err)}`);
        } finally {
            this.revertPending.set(false);
        }
    }

    ngOnDestroy(): void {
        // F-8 -- drop selection auto-toggle subscription first so a
        // teardown-driven selection clear can't fire setCollapsed on
        // a half-torn-down sidebar.
        try {
            this.offSelectionAutoToggle?.();
        } catch {
            // ignore
        }
        try {
            this.keyboard?.dispose();
        } catch {
            // ignore
        }
        try {
            this.pan?.dispose();
        } catch {
            // ignore
        }
        try {
            this.connect?.dispose();
        } catch {
            // ignore
        }
        try {
            this.connectHandle?.dispose();
        } catch {
            // ignore
        }
        try {
            this.moveController?.dispose();
        } catch {
            // ignore
        }
        try {
            this.selectionController?.dispose();
        } catch {
            // ignore
        }
        try {
            this.palette?.dispose();
        } catch {
            // ignore
        }
        try {
            this.panel?.dispose();
        } catch {
            // ignore
        }
        try {
            this.bpmnEditor?.dispose();
        } catch {
            // ignore
        }
        try {
            // Dispose XRefs AFTER the panel so the panel's field
            // unsubscribe sequencing stays clean (the field
            // renderers' `destroy()` calls already ran).
            this.xrefs?.dispose();
        } finally {
            this.shellEditor?.destroy();
        }
    }

    /**
     * -- fetch + register the XRefs scopes the
     * property panel's variant-specific SELECT fields consume:
     *  - `'workflow.handlers'` <- `GET /api/v1/workflow/handlers`
     *  - `'workflow.forms'`    <- `GET /api/v1/forms`
     *
     * Each fetch runs independently so a slow / failing form
     * catalog doesn't block the handler catalog (or vice versa).
     * Errors raise a toast + leave the scope empty -- the field
     * renderer gracefully degrades to an empty dropdown so the
     * author can still hand-type a value + save the draft.
     */
    private async populateXRefs(): Promise<void> {
        if (this.xrefs === undefined) return;
        const xrefs = this.xrefs;

        const handlersTask = firstValueFrom(this.designer.listWorkflowHandlers())
            .then((response) => {
                xrefs.registerLookup(
                    'workflow.handlers',
                    response.member.map((row) => ({
                        id: row.key,
                        label: row.label,
                        ...(row.description !== undefined
                            ? { description: row.description }
                            : {}),
                    })),
                );
            })
            .catch((err: unknown) => {
                this.toast.error(
                    `Failed to load handler catalog: ${errorMessage(err)}`,
                );
            });

        const formsTask = firstValueFrom(this.designer.listForms())
            .then((response) => {
                xrefs.registerLookup(
                    'workflow.forms',
                    response.member.map((row) => ({
                        id: row.id,
                        label: row.name ?? row.id,
                        description: row.id,
                    })),
                );
            })
            .catch((err: unknown) => {
                this.toast.error(
                    `Failed to load form catalog: ${errorMessage(err)}`,
                );
            });

        await Promise.all([handlersTask, formsTask]);
    }

    /**
     * Toggle the connect mode. First click constructs the
     * controller + enters; subsequent clicks toggle enter/exit.
     *-4 — mutually exclusive with PanMode: entering Connect
     * forces Pan to exit, so the three pointer paths (connect / pan /
     * move) stay mutually exclusive without the controllers having
     * to know about each other.
     */
    toggleConnect(): void {
        if (!this.bpmnEditor) return;
        if (this.connect === undefined) {
            this.connect = new ConnectMode({ editor: this.bpmnEditor });
        }
        if (this.connect.active) {
            this.connect.exit();
            this.connectActive.set(false);
        } else {
            this.exitPan();
            this.connect.enter();
            this.connectActive.set(true);
        }
        this.syncToolbarModeButtons();
    }

    /**
     *-4 / F-6 — toggle the hand-tool (pan) mode. Mirrors
     * {@link toggleConnect} but for {@link PanMode}: lazy-mount on
     * first toggle, mutually exclusive with Connect, surfaces in the
     * action-bar Toolbar via the `bi-hand-index` button.
     */
    togglePan(): void {
        if (!this.bpmnEditor || !this.shellEditor) return;
        if (this.pan === undefined) {
            this.pan = new PanMode({
                editor: this.bpmnEditor,
                viewport: this.shellEditor.viewport,
            });
        }
        if (this.pan.active) {
            this.pan.exit();
            this.panActive.set(false);
        } else {
            this.exitConnect();
            this.pan.enter();
            this.panActive.set(true);
        }
        this.syncToolbarModeButtons();
    }

    /** Internal — exit Connect mode if active. Used by the mode-exclusivity guards. */
    private exitConnect(): void {
        if (this.connect !== undefined && this.connect.active) {
            this.connect.exit();
            this.connectActive.set(false);
        }
    }

    /** Internal — exit Pan mode if active. Used by the mode-exclusivity guards. */
    private exitPan(): void {
        if (this.pan !== undefined && this.pan.active) {
            this.pan.exit();
            this.panActive.set(false);
        }
    }

    /**
     *-6 — push the page's mode-active signals through to the
     * shell Toolbar so the action-bar Connect + Hand buttons show
     * their pressed state. Called from every mode-toggle path
     * (toggleConnect / togglePan / onEscape).
     */
    private syncToolbarModeButtons(): void {
        this.shellEditor?.toolbar?.setConnectActive(this.connectActive());
        this.shellEditor?.toolbar?.setHandActive(this.panActive());
    }

    /**
     *-7.4 — fit the loaded model into the canvas viewport
     * with a 10% padding margin. Mirrors the dialog implementation:
     * computes the model's element bounding box + reads the canvas
     * SVG's DOM dimensions, then asks the viewport to atomically set
     * zoom + pan so the bbox is centred. No-op when the model has
     * no elements (empty scaffolds open at identity zoom) OR when
     * the canvas hasn't received its layout yet
     * (`getBoundingClientRect()` returning 0×0). Called from the
     * `onFit` shell callback + once after `loadDraft`/`loadBody`.
     */
    private fitToContent(): void {
        if (this.bpmnEditor === undefined) return;
        if (this.shellEditor === undefined) return;
        const bbox = this.bpmnEditor.contentBbox();
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

    /**
     * Esc exits any active mode (Connect or Pan) so the user has a
     * single muscle memory for "back to default select mode" regardless
     * of which mode they're in. Standard BPMN modeler convention.
     */
    @HostListener('document:keydown.escape')
    onEscape(): void {
        this.exitConnect();
        this.exitPan();
        this.syncToolbarModeButtons();
    }

    /** Footer Save -> serialize current model + PUT to the draft endpoint. */
    protected async onSave(): Promise<void> {
        if (!this.bpmnEditor) return;
        const body = bpmnLiteModelToJson(this.bpmnEditor.state);
        try {
            const result = await firstValueFrom(
                this.designer.saveWorkflowDraft(this.definitionKey, body),
            );
            this.lastSavedAt.set(result.lastModifiedAt);
            // Saved IS the clean point. The undo history is deliberately
            // left intact -- clearing the stack to reset the flag would
            // cost the user every undo they had earned.
            this.dirty.set(false);
            this.toast.success(`Saved draft for "${this.definitionKey}".`);
        } catch (err) {
            this.toast.error(`Save failed: ${errorMessage(err)}`);
            throw err;
        }
    }

    /**
     * Footer Deploy -> Save first (so the backend reads the freshest
     * bytes), then POST deploy. Two HTTP round-trips by design: the
     * user wants to deploy what they see + the backend deployer
     * reads from VFS not request body.
     */
    protected async onDeploy(): Promise<void> {
        if (!this.bpmnEditor) return;
        try {
            await this.onSave();
        } catch {
            // Save already raised a toast; abort deploy.
            return;
        }
        try {
            const result = await firstValueFrom(
                this.designer.deployWorkflow(this.definitionKey),
            );
            this.latestVersion.set(result.version);
            this.toast.success(
                `Deployed "${this.definitionKey}" v${result.version}.`,
            );
        } catch (err) {
            this.toast.error(`Deploy failed: ${errorMessage(err)}`);
        }
    }
}
