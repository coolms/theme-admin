
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { ExplorerToolbarRowComponent } from '@coolms/ui-angular';
import { TEMPLATES_DIR } from '../shared/document-explorer.types';
import { DocumentPageStateService } from './document-page-state.service';
import { FolderContentComponent } from './folder-content.component';
import { InstancesBrowserComponent } from './instances-browser.component';

/**
 * F.14c-3 +.1a — main-panel router.
 *
 * Despite the legacy `DocumentGrid` slot key (kept because the backend
 * layout YAML still references it), this component dispatches by
 * `state.rightPanelMode()`:
 *
 *   `properties`  -> folder content tile/list view of templates
 *   `instances`   -> full-width instances file zone for the selected
 *                    template; the right detail slot collapses via
 *                    ExplorerLayout's `openOnSelect` gate (the page
 *                    reports `activeItem: null` in instances mode)
 *
 * Mode swaps replace what fills the main slot rather than overlaying
 * the right panel — keeps the "Show Instances" surface from being
 * cramped at 360px.
 */
@Component({
    selector: 'cms-document-grid',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
    ExplorerToolbarRowComponent,
    FolderContentComponent,
    InstancesBrowserComponent
],
    template: `
        <!-- Breadcrumb row — first child of the main slot, sits above the
             grid view (folder content OR instances browser). Anchored to
             the main slot's left edge so its position is stable as the
             toolbar above shifts with contextual actions. -->
        <app-explorer-toolbar-row
            [path]="breadcrumbPath()"
            [labelOverrides]="BREADCRUMB_LABELS"
            [navigableFrom]="spaceRoot()"
            (navigate)="onNavigate($event)" />

        <div class="document-grid-body">
            @if (showInstances()) {
                <cms-instances-browser
                    [template]="selectedTemplate()"
                    [pathScope]="state.instancesScopePath()" />
            } @else {
                <cms-folder-content (filesDroppedForUpload)="onFilesDropped($event)" />
            }
        </div>
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }
        /*
         * Flex context for whichever child is showing.
         *
         * The child rule below used to force display:block + height:100%,
         * which OUT-SPECIFIED the child's own :host{display:flex} — an
         * element selector plus a class beats :host — so cms-folder-content
         * was laid out as a block no matter what it asked for, and the
         * DataGrid inside it fell back to content height: a card ending
         * mid-pane with dead white beneath. Same defect fixed on Pages,
         * one level further up.
         *
         * Children now PARTICIPATE in the flex column instead of being
         * flattened, so each one decides its own inner layout.
         */
        .document-grid-body {
            flex: 1;
            min-height: 0;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .document-grid-body > * {
            flex: 1;
            min-height: 0;
        }
    `],
})
export class DocumentGridComponent {
    protected readonly state = inject(DocumentPageStateService);

    /**
     * — `.templates` is shown under its friendly name so the
     * breadcrumb reads `Root / Documents / Templates`. The directory
     * itself keeps its real name: it is the security gate
     * `TemplateRootResolver` matches on, not a naming convention.
     */
    protected readonly BREADCRUMB_LABELS: Readonly<Record<string, string>> = {
        [TEMPLATES_DIR]: 'Templates',
    };

    protected readonly selectedTemplate = this.state.selectedTemplate;

    protected readonly showInstances = computed(() => this.state.browseView() !== 'templates');

    /**
     * — the breadcrumb used to render `state.currentPath()` in
     * every mode, which made it claim `/docs` while the pane below
     * listed what actually lives in `/docs/.templates`. Now it states
     * the real location:
     *
     *   templates listing -> `<space>/.templates`        -> `… / Documents / Templates`
     *   space documents   -> `<space>`                   -> `… / Documents`
     *   one template's instances -> the TEMPLATE's path  -> `… / Documents / Templates / <template>`
     *
     * The instances chain is a REAL path, not a decoration: a template
     * IS a Node under `<space>/.templates/`, so the server resolves
     * every segment — including the template's own title — and each
     * ancestor is a working way out. Before this, that view showed
     * `… / Documents` with `Documents` as the LAST segment, so nothing
     * was clickable and the toolbar toggle was the only escape.
     */
    protected readonly breadcrumbPath = computed(() => {
        const path = this.state.currentPath().replace(/\/+$/, '');
        // Anchored to the SPACE root, not `currentPath` — templates live
        // at one root per space, so a subfolder has none.
        const templatesDir = `${this.spaceRoot().replace(/\/+$/, '')}/${TEMPLATES_DIR}`;

        switch (this.state.browseView()) {
            case 'documents':
                return path;
            case 'instances': {
                const tpl = this.state.selectedTemplate();
                // `path` is nullable on the wire; the slug reconstructs
                // the same location well enough to label the segment.
                return tpl?.path ?? `${templatesDir}/${tpl?.slug ?? ''}`;
            }
            default:
                return templatesDir;
        }
    });

    /**
     * The space `currentPath` lives in, or `currentPath` itself before
     * the spaces response lands. Everything above this is context the
     * Documents module cannot navigate to.
     */
    protected readonly spaceRoot = computed(() =>
        this.state.spaceRoot() ?? this.state.currentPath(),
    );

    /**
     * Breadcrumb clicks. Two segments are mode switches rather than
     * folder navigation, because both scopes live at the same VFS path
     * and only differ in what the pane is asking for.
     */
    protected onNavigate(target: string): void {
        const current = this.state.currentPath().replace(/\/+$/, '');
        if (target === `${this.spaceRoot().replace(/\/+$/, '')}/${TEMPLATES_DIR}`) {
            this.state.showTemplates();

            return;
        }
        if (target === current) {
            this.state.enterSpaceDocuments(current);

            return;
        }
        // Second line of defence behind `navigableFrom`: never accept a
        // target outside the active space. `selectFolder` would set it
        // verbatim, and `breadcrumbPath()` would then append
        // `.templates` to a path that is not a space — which is how
        // clicking `Root` produced `Root / Templates` over an empty
        // pane.
        const root = this.spaceRoot().replace(/\/+$/, '');
        if (target !== root && !target.startsWith(root + '/')) {
            return;
        }
        this.state.selectFolder(target);
    }

    /**
     * E6 — folder-content's empty-area dropzone bubbled DOCX files up.
     * Fan-out to the page through the state subject so the page-level
     * Upload service path (same as toolbar Upload) handles the actual
     * POST, refresh, and toast.
     */
    protected onFilesDropped(files: File[]): void {
        this.state.uploadFilesRequested$.next(files);
    }
}
