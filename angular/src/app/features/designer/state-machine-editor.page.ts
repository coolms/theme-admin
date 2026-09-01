
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
    StateMachineEditor,
    StateMachinePropertyPanel,
    AddPlaceCommand,
    AddTransitionCommand,
    RemovePlaceCommand,
    RemoveTransitionCommand,
    DEFAULT_PLACE_SIZE,
    emptyStateMachineModel,
    type StateMachineModel,
} from '@coolms/designer/state-machine';

import { CmsPageHeaderComponent, ErrorBannerComponent, LoadingComponent, ToastService, UnsavedChangesService } from '@coolms/ui-angular';
import { DesignerActionFooterComponent } from './shared/designer-action-footer.component';
import { errorMessage } from './shared/error-message';
import { DesignerService } from './designer.service';
import { DesignerI18nService } from './designer-i18n.service';

/**
 * M3.5.e — State Machine designer page. Hosts the vanilla-TS
 * {@link StateMachineEditor} (from `@coolms/designer/state-machine`)
 * inside the shared editor shell, wired to the M3.5.e VFS-backed
 * draft + deploy API via {@link DesignerService}. Mirrors the BPMN-Lite
 * designer page but is simpler: the SM editor ships selection +
 * property panel + click-to-select + auto-layout internally, so there's
 * no palette / connect-mode / move-controller / keyboard-controller
 * wiring here.
 *
 * Route: `/admin/designer/state/:key`. A fresh key opens a blank
 * machine (the backend draft GET returns a starter model); Save persists
 * the editor's model JSON; Deploy versions it.
 */
@Component({
    selector: 'app-state-machine-editor-page',
    standalone: true,
    imports: [
    CmsPageHeaderComponent,
    DesignerActionFooterComponent,
    LoadingComponent,
    ErrorBannerComponent
],
    template: `
        <cms-page-header [title]="title()" />

        <div class="sm-editor-page">
            @if (isLoading()) {
                <div class="sm-editor-page__overlay">
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

            <div class="sm-editor-page__chrome">
                <div #host class="sm-editor-page__host"></div>
                <app-designer-action-footer
                    [savedAt]="lastSavedAt()"
                    [deployedVersion]="latestVersion()"
                    [connectHint]="connectActive() ? connectHint() : null"
                    draftLabel="State machine draft · not deployed"
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
            .sm-editor-page {
                position: relative;
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 0;
            }
            .sm-editor-page__chrome {
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 0;
            }
            .sm-editor-page__host {
                flex: 1;
                display: flex;
                min-height: 0;
            }
            .sm-editor-page__overlay {
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
export class StateMachineEditorPage implements AfterViewInit, OnDestroy {
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
     * freshly opened draft dirty before the user touched it (#2489).
     */
    readonly dirty = signal(false);

    private shellEditor?: Editor;
    private smEditor?: StateMachineEditor;
    private panel?: StateMachinePropertyPanel;
    private offSelectionAutoToggle?: () => void;
    /** Unsubscribe for the connect-mode selection listener. */
    private offConnectSelection?: () => void;
    /** Pending source state while connect-mode awaits the target. */
    private connectSource: string | null = null;
    /** True while two-click connect is armed (syncs the toolbar button). */
    readonly connectActive = signal<boolean>(false);
    /** Footer hint text shown while connecting. */
    readonly connectHint = signal<string>('');

    private definitionKey = '';

    readonly isLoading = signal<boolean>(true);
    readonly loadError = signal<string | null>(null);
    readonly title = signal<string>('State machine editor');
    readonly lastSavedAt = signal<string | null>(null);
    readonly latestVersion = signal<number>(0);

    async ngAfterViewInit(): Promise<void> {
        const key = this.route.snapshot.paramMap.get('key');
        if (key === null || key === '') {
            this.loadError.set('No state machine key in the URL.');
            this.isLoading.set(false);
            return;
        }
        this.definitionKey = key;
        this.title.set(`State machine: ${key}`);

        // Save / Deploy live in the page footer (Image-Editor chrome), so
        // they are NOT wired into the shell toolbar — only canvas tools
        // (undo/redo/zoom/fit) stay there.
        await this.i18n.ensureLoaded();
        this.shellEditor = createEditor(this.hostRef.nativeElement, {
            t: this.i18n.translate,
            surface: 'state-machine',
            onFit: () => this.fitToContent(),
            // Renders the Connect button in the shell toolbar's creation
            // group; the page owns the 2-click connect state, exactly as
            // the DRD page does.
            onToggleConnect: () => this.toggleConnect(),
        });

        // Two of the three guard layers wire up here; the third is
        // `canDeactivate` on this page's route.
        this.destroyRef.onDestroy(
            this.shellEditor.commands.onChange(() => this.dirty.set(true)),
        );
        this.destroyRef.onDestroy(this.unsaved.watch(this, () => this.dirty()));

        // The SM editor's command stack IS the shell's, so the shell
        // toolbar's undo/redo drive the same history the property panel
        // dispatches through.
        this.smEditor = new StateMachineEditor({
            t: this.i18n.translate,
            host: this.shellEditor.body,
            svgGroup: this.shellEditor.canvasGroup,
            commands: this.shellEditor.commands,
        });

        // Create-tools. Until these existed the editor could rename,
        // re-point, property-edit and PRUNE a machine but never BUILD
        // one — the blank canvas said "Add a place to start modelling"
        // with no way to do it, so new machines were VFS-JSON-only.
        this.mountToolbarTools();

        if (this.shellEditor.sidebar !== undefined) {
            const sidebar = this.shellEditor.sidebar;
            this.panel = new StateMachinePropertyPanel({
                host: sidebar.propertyHost,
                editor: this.smEditor,
            });
            // Two-click connect authors a transition: click the source
            // state, then the target.
            this.offConnectSelection = this.smEditor.selection.onChange(
                (target) => this.onSelectionForConnect(target),
            );
            // Expand the property rail when something is selected; slide
            // it back on empty-canvas (workflow scope still edits via the
            // panel, but the rail collapses to maximise canvas).
            this.offSelectionAutoToggle = this.smEditor.selection.onChange(
                (target) => sidebar.setCollapsed(target === null),
            );
            sidebar.setCollapsed(true);
        }

        // Canvas keyboard parity with the BPMN / DRD designers: Delete or
        // Backspace removes the selected place (cascading its transitions) or
        // transition; Esc clears the selection. Document-level for the page's
        // lifetime; torn down in ngOnDestroy.
        document.addEventListener('keydown', this.onKeyDown);

        await this.loadDraft(key);
    }

    /**
     * Mount the create-tools into the shell toolbar's creation group,
     * mirroring the DRD page so the two surfaces read the same.
     */
    private mountToolbarTools(): void {
        const toolbar = this.shellEditor?.toolbar;
        if (toolbar === undefined) return;
        const host = toolbar.paletteHost;
        this.makeToolbarButton(host, '+ State', undefined, () => this.addPlace());
        this.makeToolbarButton(host, 'Delete selected', 'bi-trash', () =>
            this.deleteSelected(),
        );
        this.makeToolbarButton(host, 'Auto-arrange', 'bi-diagram-3', () =>
            this.autoArrange(),
        );
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

    /**
     * Add a state. The FIRST one becomes the initial place (see
     * {@link AddPlaceCommand}) so a freshly built machine validates.
     * The id doubles as the Symfony place NAME, so it is selected
     * immediately for renaming in the property panel.
     */
    protected addPlace(): void {
        if (this.smEditor === undefined) return;
        const id = this.smEditor.suggestPlaceId();
        this.smEditor.commandStack.execute(
            new AddPlaceCommand(this.smEditor, {
                id,
                position: this.smEditor.suggestPlacePosition(),
                size: DEFAULT_PLACE_SIZE,
            }),
        );
        this.smEditor.selection.select({ kind: 'place', id });
        this.fitToContent();
    }

    /** Toggle two-click connect mode (source state → target state). */
    protected toggleConnect(): void {
        if (this.smEditor === undefined) return;
        const next = !this.connectActive();
        this.connectActive.set(next);
        this.shellEditor?.toolbar?.setConnectActive(next);
        if (next) {
            const sel = this.smEditor.selection.target;
            this.connectSource = sel?.kind === 'place' ? sel.id : null;
            this.connectHint.set(
                this.connectSource !== null
                    ? `Connecting from "${this.connectSource}" — click the target state.`
                    : 'Click the source state, then the target state.',
            );
        } else {
            this.connectSource = null;
            this.connectHint.set('');
        }
    }

    /**
     * Second half of the connect gesture. A transition needs a NAME (it
     * is the Symfony transition key), so the new edge is named after the
     * pair and selected for renaming — an unnamed transition would
     * serialize to a blank config key.
     */
    private onSelectionForConnect(
        target: { kind: 'place' | 'transition'; id: string } | null,
    ): void {
        if (!this.connectActive() || this.smEditor === undefined) return;
        if (target === null || target.kind !== 'place') return;
        const id = target.id;
        if (this.connectSource === null) {
            this.connectSource = id;
            this.connectHint.set(`Connecting from "${id}" — click the target state.`);
            return;
        }
        if (id === this.connectSource) return; // self-transition not authored here
        const transitionId = this.smEditor.suggestTransitionId();
        this.smEditor.commandStack.execute(
            new AddTransitionCommand(this.smEditor, {
                id: transitionId,
                name: `${this.connectSource}_to_${id}`,
                from: this.connectSource,
                to: id,
            }),
        );
        this.connectSource = null;
        this.connectHint.set('Click the source state, then the target state.');
        this.smEditor.selection.select({ kind: 'transition', id: transitionId });
        this.toast.success('Transition added.');
    }

    /** Re-run the column layout over the current machine. */
    protected autoArrange(): void {
        this.smEditor?.autoLayout();
        this.fitToContent();
    }

    private async loadDraft(key: string): Promise<void> {
        if (this.smEditor === undefined) return;
        this.isLoading.set(true);
        this.loadError.set(null);
        try {
            const payload = await firstValueFrom(
                this.designer.getStateMachineDraft(key),
            );
            this.latestVersion.set(payload.latestVersion);

            let model: StateMachineModel;
            try {
                model = JSON.parse(payload.body) as StateMachineModel;
            } catch {
                model = emptyStateMachineModel(key);
                this.toast.error('Draft body was not valid JSON; opened a blank machine.');
            }
            this.smEditor.load(model);
            // Defer the fit past the synchronous repaint so the canvas SVG
            // has received its initial size (getBoundingClientRect != 0×0).
            queueMicrotask(() => this.fitToContent());
        } catch (err) {
            this.loadError.set(`Failed to load draft: ${errorMessage(err)}`);
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
        if (this.smEditor === undefined || this.definitionKey === '') return;
        const body = JSON.stringify(this.smEditor.state);
        try {
            const result = await firstValueFrom(
                this.designer.saveStateMachineDraft(this.definitionKey, body),
            );
            this.latestVersion.set(result.latestVersion);
            this.lastSavedAt.set(new Date().toISOString());
            this.dirty.set(false);
            this.toast.success('Draft saved.');
        } catch (err) {
            this.toast.error(`Save failed: ${errorMessage(err)}`);
        }
    }

    protected async onDeploy(): Promise<void> {
        if (this.smEditor === undefined || this.definitionKey === '') return;
        // Save first — the deployer reads the persisted draft, not the
        // request body (mirrors the BPMN designer's save-then-deploy).
        const body = JSON.stringify(this.smEditor.state);
        try {
            await firstValueFrom(
                this.designer.saveStateMachineDraft(this.definitionKey, body),
            );
            const result = await firstValueFrom(
                this.designer.deployStateMachine(this.definitionKey),
            );
            this.latestVersion.set(result.version);
            this.lastSavedAt.set(new Date().toISOString());
            this.dirty.set(false);
            this.toast.success(
                `Deployed "${this.definitionKey}" v${result.version}.`,
            );
        } catch (err) {
            this.toast.error(`Deploy failed: ${errorMessage(err)}`);
        }
    }

    private fitToContent(): void {
        if (this.smEditor === undefined || this.shellEditor === undefined) return;
        const bbox = this.smEditor.contentBbox();
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
     * Delete the selected place (cascading its incident transitions) or the
     * selected transition, as one undoable command. Clears the selection
     * afterwards so the property rail collapses to workflow scope.
     */
    private deleteSelected(): void {
        if (this.smEditor === undefined) return;
        const target = this.smEditor.selection.target;
        if (target === null) return;
        if (target.kind === 'place') {
            this.smEditor.commandStack.execute(
                new RemovePlaceCommand(this.smEditor, target.id),
            );
        } else {
            this.smEditor.commandStack.execute(
                new RemoveTransitionCommand(this.smEditor, target.id),
            );
        }
        this.smEditor.selection.clear();
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (this.smEditor === undefined) return;
        // Esc clears the selection (the SM editor has no connect/transient mode).
        if (event.key === 'Escape') {
            this.smEditor.selection.clear();
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
        if (this.smEditor.selection.target === null) return;
        event.preventDefault();
        this.deleteSelected();
    };

    ngOnDestroy(): void {
        document.removeEventListener('keydown', this.onKeyDown);
        try {
            this.offConnectSelection?.();
            this.offSelectionAutoToggle?.();
        } catch {
            // ignore
        }
        try {
            this.panel?.dispose();
        } catch {
            // ignore
        }
        try {
            this.smEditor?.dispose();
        } finally {
            this.shellEditor?.destroy();
        }
    }
}
