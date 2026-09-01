
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    ViewChild,
    DestroyRef,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { createEditor, type Editor } from '@coolms/designer';
import { DmnTableEditor, DmnXmlParseError } from '@coolms/designer/dmn-table';

/**
 * Is this the recoverable "decision has no rules yet" shape?
 *
 * Branches on the TYPED code, never the message text — the wording is
 * a UI detail and would silently stop matching if it were reworded.
 */
function isMissingDecisionTable(err: unknown): boolean {
    return (
        err instanceof DmnXmlParseError &&
        err.code === 'MISSING_DECISION_TABLE'
    );
}

/**
 * Is this simply a decision that has not been authored yet?
 *
 * A freshly created key's draft is an empty `<definitions/>` stub with
 * no `<decision>` inside, so the table parser rejects it. That is the
 * NORMAL first-open state, not a failure.
 */
function isNewDecisionBody(err: unknown): boolean {
    return (
        err instanceof DmnXmlParseError && err.code === 'MISSING_DECISION'
    );
}

import { CmsPageHeaderComponent, ErrorBannerComponent, LoadingComponent, ToastService, UnsavedChangesService } from '@coolms/ui-angular';
import { DesignerActionFooterComponent } from './shared/designer-action-footer.component';
import { errorMessage } from './shared/error-message';
import { DesignerService } from './designer.service';
import { DesignerI18nService } from './designer-i18n.service';

/**
 * FE -- DMN decision-table editor page.
 *
 * **Vertical slice closure.** Wires the
 * `@coolms/designer` package (-g) to the backend
 * `DecisionDraftController` ( backend) via the
 * {@link DesignerService}. The full edit-loop:
 *
 *   1. `ngAfterViewInit` waits for the host `<div #host>` to be in
 *      the DOM, then calls `createEditor(host, {surface:'dmn-table'})`
 *      and constructs the {@link DmnTableEditor} on top of
 *      `editor.body` + `editor.commands` (the shared command stack
 *      so toolbar undo/redo + table mutations stay coherent).
 *   2. GETs the draft XML and seeds the editor via `editor.fromXml()`.
 *      Empty body -> the editor starts with the table package's
 *      `emptyDecisionTable()` default. Malformed XML surfaces as a
 *      toast; the editor stays empty so the user can re-author from
 *      scratch.
 *   3. Toolbar **Save** action -> `tableEditor.toXml()` ->
 *      `designerService.saveDraft()`. Returns once the PUT lands;
 *      a toast confirms.
 *   4. Toolbar **Deploy** action -> Save first (so the backend reads
 *      the freshest bytes), then POST deploy. Success surfaces the
 *      new version number in the toast; 422 (parser/validator)
 *      surfaces the backend error message in a danger toast.
 *   5. `ngOnDestroy` -> `tableEditor.dispose()` + `editor.destroy()`.
 *
 * **Route shape.** `/admin/designer/dmn/:key`. The key is read from
 * `paramMap` -- no live editing of the key URL parameter (the editor
 * is built around one key for its full lifetime). A user editing a
 * different decision navigates to the new URL, which re-mounts.
 *
 * **No reactive change detection.** The editor's DOM lives outside
 * Angular's view tree (vanilla TS package), so we don't fight the
 * change-detection cycle. The page surfaces only the status banner
 * + the host container; `signal()` carries the load state for the
 * spinner.
 */
@Component({
    selector: 'app-dmn-editor-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
    CmsPageHeaderComponent,
    DesignerActionFooterComponent,
    LoadingComponent,
    ErrorBannerComponent,
    RouterLink
],
    template: `
        @if (!embedded()) {
            <cms-page-header [title]="title()" />
        }

        <div class="dmn-editor-page" [class.dmn-editor-page--loading]="isLoading()">
            @if (isLoading()) {
                <div class="dmn-editor-page__overlay">
                    <app-loading label="Loading draft…" />
                </div>
            }
            @if (loadError()) {
                <app-error-banner [message]="loadError()!" [showRetry]="true" (retry)="retryLoad()" />
            }
            @if (noDecisionTable()) {
                <!--
                  A DRD document opened in the TABLE surface. Not an
                  error: point the author at the editor that CAN open it
                  rather than leaking a parser message.
                -->
                <div class="alert alert-info d-flex flex-wrap align-items-center gap-2 m-3"
                     role="status">
                    <i class="bi bi-diagram-3 me-1" aria-hidden="true"></i>
                    <span class="flex-grow-1">
                        <strong>{{ decisionKey }}</strong> has no decision table yet — it is a
                        decision requirements diagram.
                    </span>
                    <a class="cms-btn cms-btn-sm"
                       [routerLink]="['/designer/decision', decisionKey]">
                        Open requirements diagram
                    </a>
                </div>
            }
            <div class="dmn-editor-page__chrome">
                <div #host class="dmn-editor-page__host"></div>
                <app-designer-action-footer
                    [savedAt]="lastSavedAt()"
                    [deployedVersion]="latestVersion()"
                    draftLabel="Decision draft · not deployed"
                    [showCancel]="embedded()"
                    (save)="onSave()"
                    (deploy)="onDeploy()"
                    (cancel)="cancel.emit()" />
            </div>
        </div>
    `,
    styles: [`
        :host { display: flex; flex: 1; flex-direction: column; min-height: 0; }
        .dmn-editor-page { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; }
        .dmn-editor-page__chrome { flex: 1; display: flex; flex-direction: column; min-height: 0; }
        .dmn-editor-page__host { flex: 1; display: flex; min-height: 0; }
        .dmn-editor-page__overlay {
            position: absolute; inset: 0; display: grid; place-items: center;
            background: color-mix(in srgb, var(--cms-surface) 70%, transparent); z-index: 5; font: 500 14px/1.4 sans-serif;
        }
    `],
})
export class DmnEditorPage implements AfterViewInit, OnDestroy {
    @ViewChild('host', { static: true })
    private readonly hostRef!: ElementRef<HTMLElement>;

    private readonly route    = inject(ActivatedRoute);
    private readonly designer = inject(DesignerService);
    private readonly i18n = inject(DesignerI18nService);
    private readonly toast    = inject(ToastService);
    private readonly unsaved  = inject(UnsavedChangesService);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * Unsaved-work flag, PUBLIC so `unsavedChangesGuard` can read it off
     * the route component.
     */
    readonly dirty = signal(false);

    /**
     * Optional inputs for hosting this page inside the generic
     * {@link DesignerEditorDialogComponent} modal. `key` overrides the
     * route param (a modal has no route context); `embedded` hides the
     * `<cms-page-header>` (the modal supplies its own header chrome).
     */
    readonly key      = input<string | null>(null);
    readonly embedded = input<boolean>(false);
    /** Emitted by the footer Cancel button; the modal host binds it to close. */
    readonly cancel   = output<void>();

    private editor?: Editor;
    private tableEditor?: DmnTableEditor;
    /** `protected` so the no-table empty state can name the decision + link to its DRD. */
    protected decisionKey = '';

    readonly isLoading     = signal<boolean>(true);
    readonly loadError     = signal<string | null>(null);
    /**
     * True when the body parsed but carries no decision table — a DRD
     * document rather than a broken one. Rendered as a purposeful
     * empty state, not an error.
     */
    readonly noDecisionTable = signal<boolean>(false);
    readonly title         = signal<string>('Decision editor');
    readonly lastSavedAt   = signal<string | null>(null);
    readonly latestVersion = signal<number>(0);

    async ngAfterViewInit(): Promise<void> {
        const key = this.key() ?? this.route.snapshot.paramMap.get('key');
        if (!key) {
            this.loadError.set('No decision key in the URL.');
            this.isLoading.set(false);
            return;
        }
        this.decisionKey = key;
        this.title.set(`Decision: ${key}`);

        // Bind the editor lifecycle to the existing host DOM. The
        // page sets `surface: 'dmn-table'`; the shell mounts toolbar
        // + body + (hidden) canvas, and we mount the DMN table editor
        // into `editor.body` next.
        // Save / Deploy live in the page footer (Image-Editor chrome), not
        // the shell toolbar — DMN-table has no connect/fit, so the toolbar
        // is undo/redo/zoom only. `hideSidebar` because the decision-table
        // editor has no property panel (it mounts a spreadsheet into the
        // body); without this the shell renders an empty expanded sidebar.
        await this.i18n.ensureLoaded();
        this.editor = createEditor(this.hostRef.nativeElement, {
            t: this.i18n.translate,
            surface: 'dmn-table',
            hideSidebar: true,
        });
        this.tableEditor = new DmnTableEditor({
            t: this.i18n.translate,
            host:     this.editor.body,
            commands: this.editor.commands,
        });

        await this.loadDraft();

        //  Subscribed AFTER the draft is in. `fromXml()` goes through
        // `model.load()`, and whether that reaches the command stack is
        // not something this page should have to know -- starting the
        // watch here makes it irrelevant rather than load-bearing.
        this.destroyRef.onDestroy(
            this.editor.commands.onChange(() => this.dirty.set(true)),
        );
        this.destroyRef.onDestroy(this.unsaved.watch(this, () => this.dirty()));
    }

    /** GET the current draft XML + seed the editor. Re-runnable from the error-banner Retry. */
    private async loadDraft(): Promise<void> {
        if (this.tableEditor === undefined) return;
        this.isLoading.set(true);
        this.loadError.set(null);
        this.noDecisionTable.set(false);
        try {
            const xml = await firstValueFrom(this.designer.getDraft(this.decisionKey));
            if (xml.trim() !== '') {
                this.tableEditor.fromXml(xml);
            }
        } catch (err) {
            /**
             * A decision with NO `<decisionTable>` is not corruption —
             * it is a decision node in a requirements diagram that has
             * no rules yet, which is exactly what the DRD editor
             * authors. Showing the parser's message in a red banner told
             * authors their definition was broken and left them stuck,
             * because the Definitions list only ever opens the TABLE
             * surface. Branch on the typed code (never the message text)
             * and offer the requirements diagram instead.
             */
            if (isNewDecisionBody(err)) {
                /**
                 * A FRESH decision key. Its draft is stored as an empty
                 * `<definitions/>` stub, which has no `<decision>` — so
                 * every newly created decision used to open with a red
                 * "parse error" banner over a perfectly usable blank
                 * table. Nothing is wrong: start blank and let the
                 * author fill it in.
                 */
                this.loadError.set(null);
            } else if (isMissingDecisionTable(err)) {
                this.noDecisionTable.set(true);
            } else {
                // Banner ONLY — no toast. `ErrorBannerComponent` exists
                // precisely "instead of a blank panel + a transient toast
                // that scrolls away"; firing both showed the author the
                // same sentence twice, once in a place they cannot
                // dismiss and once in a place that vanishes.
                this.loadError.set(`Failed to load draft: ${errorMessage(err)}`);
            }
        } finally {
            this.isLoading.set(false);
        }
    }

    /** UI-polish — retry the initial draft load from the shared error banner. */
    protected retryLoad(): void {
        if (this.decisionKey === '') return;
        void this.loadDraft();
    }

    ngOnDestroy(): void {
        try {
            this.tableEditor?.dispose();
        } finally {
            this.editor?.destroy();
        }
    }

    /** Footer Save -> PUT current XML. */
    protected async onSave(): Promise<void> {
        if (!this.tableEditor) return;
        const xml = this.tableEditor.toXml();
        try {
            await firstValueFrom(this.designer.saveDraft(this.decisionKey, xml));
            this.lastSavedAt.set(new Date().toISOString());
            this.dirty.set(false);
            this.toast.success(`Saved draft for "${this.decisionKey}".`);
        } catch (err) {
            this.toast.error(`Save failed: ${errorMessage(err)}`);
            throw err;
        }
    }

    /**
     * Toolbar Deploy -> Save first (so the backend deploys the
     * freshest bytes), then POST deploy. Two HTTP round-trips by
     * design: the user wants to deploy what they see, and the
     * backend deployer reads from VFS not request body.
     */
    protected async onDeploy(): Promise<void> {
        if (!this.tableEditor) return;
        try {
            await this.onSave();
        } catch {
            // Save already raised a toast; abort deploy.
            return;
        }
        try {
            const result = await firstValueFrom(this.designer.deploy(this.decisionKey));
            this.latestVersion.set(result.version);
            this.toast.success(
                `Deployed "${this.decisionKey}" v${result.version}.`,
            );
        } catch (err) {
            this.toast.error(`Deploy failed: ${errorMessage(err)}`);
        }
    }
}
