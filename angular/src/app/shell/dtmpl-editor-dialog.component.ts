import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, map, of, switchMap } from 'rxjs';
import { AuthoringContextDto, AuthoringContextService, CmsContextFrameComponent, ConfirmDialogService, ToastService, UnsavedChangesService, VfsNodeDto } from '@coolms/ui-angular';
import { CoolmsEditorComponent, type PageGeometry } from '@coolms/editor-angular';
import {
    DDOC_CUSTOM_SIZE,
    DDOC_DOCUMENT_MIME,
    DdocDocumentService,
    joinDdocSections,
    referencedFootnoteIds,
    sectionsDisagreeOnPaper,
    splitDdocSections,
    type DdocFootnoteEdits,
    type DdocPage,
    type DdocPaperCatalog,
    type DdocPaperSize,
    type DdocPayload,
    type DdocSectionEdit,
} from '../features/documents/shared/ddoc-document.service';
// Cross-layer import (shared/ ← features/), same shape as DtmplContentAdapter
// below: the paper of a document template is the Document module's fact, and
// this dialog is the one editor that mounts on those templates.
import {
    DocumentPageSizeService,
    type DocumentPageSizeDto,
    type DocumentPageSizeOption,
} from '../features/documents/word/document-page-size.service';
import { DocumentPreviewService } from '../features/documents/word/document-preview.service';
import { PdfViewerComponent } from '@coolms/pdf-angular';
// Cross-layer import (shared/ ← features/). DtmplContentAdapter is the only
// piece of the Content module we consume; it has no other content-module
// dependencies and is `providedIn: 'root'` so the cycle is graph-clean.
// TODO: hoist DtmplContentAdapter to shared/ once Document module also uses it.
import { DdocFootnotesPanelComponent } from '../features/documents/shared/ddoc-footnotes-panel.component';
import { DtmplContentAdapter } from '../features/content/dtmpl-content-adapter';
import { AppConfigState, CmsLoaderComponent, ErrorHandlerService } from '@coolms/core-angular';

/**
 * Generic body-editor for `.dtmpl` VFS files (variants and standalone).
 *
 * Uses the same `<coolms-editor>` bridge as PageEditor — the dtmpl ↔ HTML
 * translation lives in `DtmplContentAdapter`, so this dialog is a thin
 * read-content / show-editor / save-content shell with no widget knowledge.
 *
 * Resolution order in `FileEditorRegistry` puts the exact mime
 * (`text/x-dtmpl`) ahead of the `text/*` wildcard, so dbl-clicking a
 * `.dtmpl` file lands here instead of the CodeMirror editor.
 */
@Component({
    selector: 'app-dtmpl-editor-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CoolmsEditorComponent, CmsContextFrameComponent, PdfViewerComponent, FormsModule,
        CmsLoaderComponent, DdocFootnotesPanelComponent,
    ],
    template: `
        <div class="dtmpl-editor-dialog" [class.dtmpl-editor-dialog--fullscreen]="fullscreen()">
            <div class="dtmpl-editor-dialog__header">
                <span class="dtmpl-editor-dialog__title">
                    <i class="bi bi-file-earmark-code"></i>
                    {{ node.path }}
                </span>
                <div class="dtmpl-editor-dialog__actions">
                    @if (dirty()) {
                        <span class="dtmpl-editor-dialog__dirty">unsaved changes</span>
                    }
                    @if (documentPreview()) {
                        <!-- Downloads what is ON SCREEN, unsaved edits included:
                             it runs the same composer as the preview, so the
                             file matches what the author is looking at. -->
                        <button class="cms-btn cms-btn-sm"
                                [disabled]="downloading()"
                                title="Download as Word (.docx)"
                                (click)="downloadAs('docx')">
                            <i class="bi bi-file-earmark-word"></i>
                        </button>
                        <button class="cms-btn cms-btn-sm"
                                [disabled]="downloading()"
                                title="Download as PDF"
                                (click)="downloadAs('pdf')">
                            <i class="bi bi-file-earmark-pdf"></i>
                        </button>
                    }
                    <button class="cms-btn cms-btn-sm"
                            [class.cms-btn-primary]="preview()"
                            [title]="previewTitle()"
                            (click)="preview.set(!preview())">
                        <i class="bi bi-layout-split"></i>
                    </button>
                    <button class="cms-btn cms-btn-sm" title="Toggle fullscreen"
                            (click)="fullscreen.set(!fullscreen())">
                        <i class="bi"
                           [class.bi-fullscreen]="!fullscreen()"
                           [class.bi-fullscreen-exit]="fullscreen()"></i>
                    </button>
                    <button class="cms-btn cms-btn-sm" (click)="close()">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            </div>

            <div class="dtmpl-editor-dialog__body"
                 [class.dtmpl-editor-dialog__body--split]="preview()">
                @if (loading()) {
                    <!-- The SAME mark the canvas shows while it paginates. Two
                         different indicators back to back read as two separate
                         waits — fetch the bytes, then a jarring swap, then lay
                         them out — when it is one wait with two phases. Same
                         glyph throughout, only the caption changes. -->
                    <div class="dtmpl-editor-dialog__loading">
                        <cms-loader label="Opening the document" />
                    </div>
                } @else {
                    <div class="dtmpl-editor-dialog__pane">
                        <!-- A .ddoc needs no content adapter: the seam hands
                             over editor HTML already, and the projection back
                             to the model happens on the server. It DOES need
                             the units a stored document carries — underline, a
                             picture, a footnote reference, a section break —
                             or ProseMirror strips them on the way in. -->
                        <coolms-editor
                            [profile]="profileName()"
                            [pageGeometry]="sheet()"
                            [content]="editorContent()"
                            (contentChange)="onContentChange($event)"
                            [preserveDocumentFormatting]="isDdoc()"
                            [contentAdapter]="isDdoc() ? null : dtmplAdapter" />
                        <!-- Only a .ddoc has anywhere to keep a note's BODY: a
                             .dtmpl is a fragment of flow HTML with no map to
                             put one in. The insert button is gated to the same
                             surface for the same reason. -->
                        @if (isDdoc()) {
                            <app-ddoc-footnotes-panel
                                [footnotes]="ddocFootnotes()"
                                [referenced]="referencedNotes()"
                                (bodyChange)="onFootnoteBodyChange($event)"
                                (remove)="onFootnoteRemove($event)" />
                        }
                    </div>
                    @if (preview()) {
                        <!-- The pane shows the preview the FILE is for. A document
                             template becomes a .docx, so the site's stylesheets
                             would answer the wrong question there; everything else
                             is web content and the theme CSS is the whole point.
                             No backticks in here: this is a JS template literal. -->
                        <div class="dtmpl-editor-dialog__pane dtmpl-editor-dialog__pane--preview">
                            @if (documentPreview()) {
                                @if (pdfError()) {
                                    <div class="dtmpl-editor-dialog__preview-error">
                                        {{ pdfError() }}
                                    </div>
                                } @else if (pdfUrl()) {
                                    <cms-pdf-viewer [url]="pdfUrl()!" />
                                } @else {
                                    <div class="dtmpl-editor-dialog__preview-idle">
                                        Rendering document…
                                    </div>
                                }
                            } @else {
                                <!-- Isolated on purpose: theme CSS styles body,
                                     headings and links, and would restyle the admin
                                     around the editor if injected rather than
                                     framed (#1767). -->
                                <cms-context-frame
                                    [html]="previewHtml()"
                                    [css]="context().css"
                                    [maxWidth]="context().contentMaxWidth"
                                    title="Live preview" />
                            }
                        </div>
                    }
                }
            </div>

            <div class="dtmpl-editor-dialog__footer">
                <span class="dtmpl-editor-dialog__status">{{ statusText() }}</span>

                <!-- Paper lives in the status bar, the way a word processor
                     shows it: it describes the document rather than acting on
                     it, so it does not belong among the toolbar's verbs. Only
                     for documents and templates — a page has no paper. -->
                <!-- ⚠️ A .ddoc carries its paper INSIDE the file, which is the
                     whole reason the format exists, so the controls that patch
                     a Node's extras have nothing to act on here. These write
                     the FILE instead, on the next save, and every option they
                     show arrives from the server with its twips attached — the
                     browser converts no preset name into a measurement.
                     Applies to the whole document, the way Word's Page Setup
                     defaults to it. -->
                @if (isDdoc() && ddocPage()) {
                    <div class="dtmpl-editor-dialog__paper"
                         [title]="paperLabel() + ' — applies to the whole document'">
                        <label class="dtmpl-editor-dialog__paper-label" for="ddoc-page-size">Page</label>
                        <select id="ddoc-page-size"
                                class="cms-select cms-select-sm"
                                [ngModel]="ddocSize()"
                                (ngModelChange)="onDdocSize($event)">
                            @for (o of ddocPaper()?.sizes ?? []; track o.value) {
                                <option [value]="o.value">{{ o.label }}</option>
                            }
                        </select>
                        <select class="cms-select cms-select-sm"
                                aria-label="Orientation"
                                [ngModel]="ddocOrientation()"
                                (ngModelChange)="onDdocOrientation($event)">
                            @for (o of ddocPaper()?.orientations ?? []; track o.value) {
                                <option [value]="o.value">{{ o.label }}</option>
                            }
                        </select>
                        <select class="cms-select cms-select-sm"
                                aria-label="Margins"
                                [ngModel]="ddocMargins()"
                                (ngModelChange)="onDdocMargins($event)">
                            <!-- Only while the margins ARE nobody's preset. An
                                 empty entry left permanently in the list is a
                                 choice that undoes nothing. -->
                            @if ('' === ddocMargins()) {
                                <option value="">Custom margins</option>
                            }
                            @for (o of ddocPaper()?.margins ?? []; track o.value) {
                                <option [value]="o.value">{{ o.label }} margins</option>
                            }
                        </select>
                        <!-- The sections do not all share one paper, and these
                             selects describe the first. Said out loud, because
                             the next choice makes them uniform. -->
                        @if (ddocPaperMixed()) {
                            <span class="dtmpl-editor-dialog__status"
                                  title="This document's sections are on different paper. Choosing here puts them all on one.">Mixed</span>
                        }
                    </div>
                }
                @if (!isDdoc() && documentPreview() && paperPath()) {
                    <div class="dtmpl-editor-dialog__paper">
                        <label class="dtmpl-editor-dialog__paper-label" for="dtmpl-page-size">Page</label>
                        <select id="dtmpl-page-size"
                                class="cms-select cms-select-sm"
                                [disabled]="paperSaving()"
                                [ngModel]="pageSize()"
                                (ngModelChange)="onPaperChange($event, pageOrientation())">
                            <option value="">Default</option>
                            @for (o of pageSizeOptions(); track o.value) {
                                <option [value]="o.value">{{ o.label }}</option>
                            }
                        </select>
                        <select class="cms-select cms-select-sm"
                                aria-label="Orientation"
                                [disabled]="paperSaving()"
                                [ngModel]="pageOrientation()"
                                (ngModelChange)="onPaperChange(pageSize(), $event)">
                            <option value="">As the size defines</option>
                            @for (o of orientationOptions(); track o.value) {
                                <option [value]="o.value">{{ o.label }}</option>
                            }
                        </select>
                    </div>
                }

                <div class="d-flex gap-2">
                    <button class="cms-btn cms-btn-sm" (click)="close()">Cancel</button>
                    <button class="cms-btn cms-btn-primary cms-btn-sm"
                            [disabled]="saving() || !dirty()"
                            (click)="save()">
                        {{ saving() ? 'Saving…' : 'Save' }}
                    </button>
                </div>
            </div>
        </div>
    `,
    styles: [`
        /* Match PageEditor sizing verbatim (90vw/1200px, 90vh/860px) so both
         * dialogs feel like the same family. PageEditor renders fine inside
         * the cdk-dialog 'cms-editor-dialog' panel — mirroring its dimensions
         * + flex chain avoids the extra-vertical-scroll glitch we hit with
         * the smaller 85vh box. */
        .dtmpl-editor-dialog {
            display: flex; flex-direction: column;
            width: min(90vw, 1200px);
            height: min(90vh, 860px);
            background: var(--cms-surface);
            border-radius: var(--cms-radius-lg);
            overflow: hidden;
        }
        .dtmpl-editor-dialog--fullscreen {
            width: 100vw; height: 100vh;
            border-radius: 0;
        }
        .dtmpl-editor-dialog__header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 16px;
            border-bottom: 1px solid var(--cms-border);
            flex-shrink: 0;
        }
        .dtmpl-editor-dialog__title {
            font-size: .875rem; font-weight: 600;
            display: flex; align-items: center; gap: 8px;
            font-family: 'Courier New', monospace;
        }
        .dtmpl-editor-dialog__actions {
            display: flex; align-items: center; gap: 6px;
        }
        .dtmpl-editor-dialog__body {
            flex: 1; overflow: hidden;
            display: flex; flex-direction: column;
            min-height: 0;
        }
        /*
         * Split layout (#1768): TOOLBAR SPANS THE FULL WIDTH, and only the
         * writing area shares the row with the preview.
         *
         * Confining the toolbar to the left half wrapped it onto three rows
         * and ate a third of the editor's height — the buttons do not get
         * narrower, so a half-width toolbar just gets taller.
         *
         * A grid, plus display:contents on the wrappers between this body and
         * the editor's own toolbar/mount, so those two become grid items here
         * and can be placed independently. It reaches into the editor
         * component's internals, which is the cost; the alternative is a
         * toolbar this dialog cannot lay out at all.
         */
        .dtmpl-editor-dialog__body--split {
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: auto minmax(0, 1fr);
        }
        /* Both classes on purpose: the non-split rule below is
           .dtmpl-editor-dialog__body coolms-editor {display:flex}, the same
           specificity and LATER in the sheet, so it won the tie and the editor
           host never flattened — the grid then had no items to place and the
           toolbar stayed half-width. Doubling the class outranks it. */
        /* :not(--preview) is load-bearing: both panes carry the base class, so
           without it the preview pane flattened too and its iframe became the
           unplaced grid item — the pane measured 0 wide. Only the EDITOR side
           dissolves; the preview stays a real box. */
        .dtmpl-editor-dialog__body.dtmpl-editor-dialog__body--split
            .dtmpl-editor-dialog__pane:not(.dtmpl-editor-dialog__pane--preview),
        .dtmpl-editor-dialog__body.dtmpl-editor-dialog__body--split coolms-editor { display: contents; }

        .dtmpl-editor-dialog__pane {
            flex: 1; min-width: 0; min-height: 0;
            display: flex; flex-direction: column;
        }
        .dtmpl-editor-dialog__pane--preview {
            border-left: 1px solid var(--cms-border);
            background: var(--cms-surface-muted, #f3f4f6);
            overflow: hidden;
        }
        .dtmpl-editor-dialog__body--split .dtmpl-editor-dialog__pane--preview {
            grid-column: 2; grid-row: 2;
            min-height: 0;
        }
        .dtmpl-editor-dialog__body coolms-editor {
            flex: 1; min-height: 0;
            display: flex; flex-direction: column;
        }
        /*
         * The editor's own wrapper and its two parts, reached with ng-deep
         * because they belong to the editor component (#1768).
         *
         * The wrapper carries the editor's white card — background, 1px
         * border, 6px radius. display:contents drops all three, so the card
         * moves onto the writing area, which is what the border was framing.
         * Losing it silently would leave the editor looking like bare page.
         */
        :host ::ng-deep .dtmpl-editor-dialog__body--split .cms-editor { display: contents; }
        :host ::ng-deep .dtmpl-editor-dialog__body--split .cms-editor__toolbar {
            grid-column: 1 / -1; grid-row: 1;
        }
        :host ::ng-deep .dtmpl-editor-dialog__body--split .cms-editor__mount {
            grid-column: 1; grid-row: 2;
            min-height: 0; overflow: auto;
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 6px);
        }
        .dtmpl-editor-dialog__loading {
            flex: 1; display: flex; align-items: center; justify-content: center;
            color: var(--cms-text-muted); font-size: .875rem;
        }
        /* Document-preview pane states (#1773). The error is a BANNER, not a
         * toast: it belongs to a load, and it must sit next to the stale render
         * it is explaining rather than float away after a few seconds. */
        .dtmpl-editor-dialog__preview-idle,
        .dtmpl-editor-dialog__preview-error {
            flex: 1; display: flex; align-items: center; justify-content: center;
            padding: 16px; text-align: center; font-size: .875rem;
        }
        .dtmpl-editor-dialog__preview-idle { color: var(--cms-text-muted); }
        .dtmpl-editor-dialog__preview-error { color: var(--cms-danger, #dc2626); }
        /* The viewer is the whole pane; without this it collapses to its
         * intrinsic height inside the flex column. */
        .dtmpl-editor-dialog__pane--preview cms-pdf-viewer {
            flex: 1; min-height: 0; display: block;
        }
        /* Page setup, status-bar style (#1780). Sits between the status text
         * and the action buttons; the auto right margin keeps it left-aligned
         * next to the status rather than drifting toward Save.
         * NO BACKTICKS IN HERE: this is a JS template literal. */
        .dtmpl-editor-dialog__paper {
            display: flex; align-items: center; gap: 6px;
            margin-right: auto; margin-left: 16px;
        }
        .dtmpl-editor-dialog__paper-label {
            font-size: .8125rem; color: var(--cms-text-muted); margin: 0;
        }
        .dtmpl-editor-dialog__paper .cms-select {
            font-size: .8125rem; padding: 2px 6px; height: auto; width: auto;
        }
        .dtmpl-editor-dialog__footer {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 16px;
            border-top: 1px solid var(--cms-border);
            flex-shrink: 0;
            font-size: .8125rem;
        }
        .dtmpl-editor-dialog__dirty { color: var(--cms-warning-text); font-size: .75rem; }
        .dtmpl-editor-dialog__status { color: var(--cms-text-muted); }
    `],
})
export class DtmplEditorDialogComponent {
    private readonly dialogRef  = inject(DialogRef);
    private readonly data       = inject(DIALOG_DATA) as { node: VfsNodeDto };
    private readonly http       = inject(HttpClient);
    private readonly store      = inject(Store);
    private readonly toast      = inject(ToastService);
    private readonly confirm    = inject(ConfirmDialogService);
    private readonly unsaved    = inject(UnsavedChangesService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly pageSizes  = inject(DocumentPageSizeService);
    private readonly previews   = inject(DocumentPreviewService);
    private readonly ddocs      = inject(DdocDocumentService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly authoringContext = inject(AuthoringContextService);
    /** Wires dtmpl ↔ HTML for the bridge. Public so the template can bind it. */
    readonly dtmplAdapter       = inject(DtmplContentAdapter);

    readonly node = this.data.node;

    /** Current editor content (HTML, post-adapter). The adapter handles the
     *  dtmpl→HTML projection on input and HTML→dtmpl on save. */
    readonly editorContent = signal<string>('');
    readonly dirty         = signal(false);
    readonly saving        = signal(false);
    readonly loading       = signal(true);
    readonly fullscreen    = signal(false);

    /** Split live preview (#1767) — off by default; it costs a fetch and a frame. */
    readonly preview = signal(false);

    /** Theme stylesheets + content width for the preview frame. */
    readonly context = signal<AuthoringContextDto>({
        themeSlug: null, css: [], js: [], contentMaxWidth: null,
    });

    /**
     * DEBOUNCED editor HTML. The frame rewrites its whole document on change,
     * so feeding it every keystroke would rebuild the page mid-word; the user
     * asked for IDE-style live preview and accepted latency, which is what
     * this trades for.
     */
    readonly previewHtml = signal<string>('');

    /** Editor -> preview feed; debounced in the constructor. */
    private readonly previewFeed$ = new Subject<string>();
    readonly statusText    = computed(() =>
        this.loading() ? 'Loading…' : `${this.node.mimeType ?? 'text/x-dtmpl'}`
    );

    /**
     * Editor profile (#1770, extended in #1774).
     *
     * One dialog serves every `.dtmpl` in the VFS — it is registered against
     * the MIME type, not against a caller — so it has to work out for itself
     * whether this file is a DOCUMENT. Two signals, because documents arrive
     * two ways:
     *
     *   - a template always lives under its space's `.templates/`, which is a
     *     path the Document module owns and an admin-gated one;
     *   - an authored document (#1774) can be filed in any folder the operator
     *     makes, so path proves nothing — it carries an explicit `extras`
     *     marker stamped at creation instead.
     *
     * The split exists so the page-break button and the paged canvas appear
     * only where a page is a real thing. `document-builder` extends `admin`,
     * so the other surfaces lose nothing by staying on `admin`.
     */
    readonly profileName = computed<string>(() => {
        const isTemplate = (this.node.path ?? '').includes('/.templates/');
        // `extras` is absent on plenty of nodes and the flag is absent on every
        // node predating #1774 — read it as "true only when truly present".
        const isAuthoredDocument = true === this.node.extras?.['documentNative'];

        // A `.ddoc` needs no marker and no path convention: its MIME says it is
        // a paged document, which is the point of giving it one (ADR-159).
        return isTemplate || isAuthoredDocument || this.isDdoc() ? 'document-builder' : 'admin';
    });

    /**
     * Native document source, not a DTMPL fragment (#2290).
     *
     * The dialog is registered against both mimes because everything around
     * the content — the paged canvas, the split preview, the download, the
     * toolbar profile — is the same editor. Only the three things that touch
     * the FILE differ, and each branches on this.
     */
    readonly isDdoc = computed<boolean>(() => DDOC_DOCUMENT_MIME === (this.node.mimeType ?? ''));

    /**
     * The stored document, kept so a save can send back one section per
     * section the file has. Null until the first load lands.
     */
    private readonly ddocPayload = signal<DdocPayload | null>(null);

    /**
     * The paper the whole document is on, as the author has it NOW.
     *
     * Seeded from the first section and replaced by the controls below. Null
     * until the first load lands, and for everything that is not a `.ddoc`.
     */
    readonly ddocPage = signal<DdocPage | null>(null);

    /**
     * What the author may choose from, twips included.
     *
     * ⚠️ The only source of a measurement in this component. Every handler
     * below looks a row up and copies its numbers; none of them works out what
     * A4 is, or what rotating it does — that table lives once, on the server
     * (`PageSizeResolver`), and a second copy here is the drift the `.ddoc`
     * paper seam was shaped to avoid.
     */
    readonly ddocPaper = signal<DdocPaperCatalog | null>(null);

    /**
     * The three selects, held as SELECTIONS rather than derived back out of
     * the twips.
     *
     * Deriving them would mean matching numbers against the catalog on every
     * change — the same lookup the server already did once, and the first place
     * a rounding difference would show up as a select that jumps to Custom
     * after the author picked A4.
     */
    readonly ddocSize = signal<string>('');
    readonly ddocOrientation = signal<string>('');
    readonly ddocMargins = signal<string>('');

    /**
     * Whether a save should carry the paper at all.
     *
     * ⚠️ Absent means "unchanged" to the server's merge, so a save that only
     * touched the text must leave `page` out — that is what lets somebody
     * else's paper edit survive it.
     */
    private readonly ddocPaperDirty = signal(false);

    /**
     * The stored sections are not all on one paper.
     *
     * Cleared the moment the author chooses, because from then on the controls
     * describe one paper and a save writes it to every section.
     */
    readonly ddocPaperMixed = signal(false);

    /**
     * The document's notes, by id, as the author has them now.
     *
     * Seeded from the file and edited in the panel. Kept here rather than in
     * the panel because a save has to send them and the panel is not the thing
     * that talks to the server.
     */
    readonly ddocFootnotes = signal<Record<string, string>>({});

    /**
     * What a save should say about the notes — only what the author touched.
     *
     * ⚠️ Absent means unchanged to the merge, so sending every note back would
     * overwrite somebody else's edit to a note this author never opened.
     * `null` against an id DELETES it, the same gesture a header variant uses,
     * because `''` is a real empty note and the two must not be one thing.
     */
    private readonly ddocEditedNotes = signal<Record<string, string | null>>({});

    /** The note ids the body points at, in document order. */
    readonly referencedNotes = computed<readonly number[]>(
        () => (this.isDdoc() ? referencedFootnoteIds(this.editorContent()) : []),
    );

    /** The document's paper, said in millimetres, for the status bar. */
    readonly paperLabel = computed<string>(() => {
        const page = this.ddocPage();
        if (!page) return '';

        const mm = (twips: number): number => Math.round(twips / 1440 * 25.4);

        return `${mm(page.widthTwips)} × ${mm(page.heightTwips)} mm · ${page.orientation}`;
    });

    /**
     * The template's paper, or null for "no sheets" (#1771). Null is the right
     * default for everything that is not a document template — an HTML page has
     * no pages — and also for a template that opted into no page size, since
     * the renderer then uses PHPWord's own default and drawing A4 would be a
     * claim we cannot honour.
     */
    readonly sheet = signal<PageGeometry | null>(null);

    /**
     * The paper controls (#1780). #1776 defaulted a new document to A4 and left
     * no way to change it: templates have the Edit Template dialog, documents
     * had nothing at all. These drive the same `extras.pageSize` /
     * `pageOrientation` the renderer reads, so changing them here changes the
     * .docx as well as the canvas.
     */
    readonly pageSizeOptions = signal<readonly DocumentPageSizeOption[]>([]);
    readonly orientationOptions = signal<readonly DocumentPageSizeOption[]>([]);
    readonly pageSize = signal<string>('');
    readonly pageOrientation = signal<string>('');
    /** VFS path of the node to patch; empty until the paper fetch lands. */
    readonly paperPath = signal<string>('');
    readonly paperSaving = signal(false);

    /**
     * Which preview this file deserves (#1773).
     *
     * A document template becomes a .docx, so showing it inside the site's
     * stylesheets would answer a question nobody asked — the theme styles a web
     * page, and this content will never be one. Everything else IS web content,
     * where the theme CSS is the entire point. One toggle, and the pane shows
     * whichever preview means something; no mode picker for a choice that only
     * ever has one right answer.
     */
    readonly documentPreview = computed<boolean>(() => 'document-builder' === this.profileName());

    /** Says which preview the toggle opens, so the button is not a mystery. */
    readonly previewTitle = computed<string>(() => this.documentPreview()
        ? 'Toggle live preview — renders the document the way the .docx will look'
        : 'Toggle live preview — renders in the site\'s own theme styles');

    /** Blob URL of the rendered PDF; null while none has been produced yet. */
    readonly pdfUrl = signal<string | null>(null);
    readonly pdfError = signal<string | null>(null);
    /** Guards the download buttons against a second click mid-render. */
    readonly downloading = signal(false);

    /** Editor -> DOCX render feed. Debounced and switch-mapped below. */
    private readonly docFeed$ = new Subject<string>();

    constructor() {
        // beforeunload half of the guard (#2484): the per-dialog confirm
        // cannot see a tab close or a reload. Disposed with the component, so
        // a closed editor stops voting.
        this.destroyRef.onDestroy(this.unsaved.watch(this, () => this.dirty()));
        this.loadContent();
        this.loadSheet();
        this.wireDocumentPreview();

        // Fetch the theme context once, the first time the preview is opened —
        // an editor nobody previews should not pay for it (#1767). The service
        // caches, so reopening is free. Document templates never take this
        // path: their preview is the PDF, and the theme has nothing to say
        // about it.
        effect(() => {
            if (!this.preview() || this.documentPreview() || null !== this.context().themeSlug) {
                return;
            }
            untracked(() => {
                this.previewHtml.set(this.editorContent());
                this.authoringContext.get().pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe(ctx => this.context.set(ctx));
            });
        });

        // Opening the pane must render what is already on screen; the feed only
        // carries EDITS, so without this the first thing an author sees after
        // clicking preview is "Rendering document…" until they type.
        effect(() => {
            if (this.preview() && this.documentPreview()) {
                untracked(() => this.docFeed$.next(this.editorContent()));
            }
        });

        // Debounce the editor → frame feed.
        this.previewFeed$
            .pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef))
            .subscribe(html => this.previewHtml.set(html));
    }

    /**
     * Editor content -> rendered PDF, for document templates only (#1773).
     *
     * **Debounced far harder than the web preview (400ms).** That one rewrites
     * an iframe locally; this one composes a .docx and puts it through
     * LibreOffice, so a keystroke-rate feed would queue conversions faster than
     * Gotenberg retires them and the pane would always be showing an older
     * document than the one on screen. `switchMap` is the other half of that:
     * a render whose input is already stale is cancelled rather than raced to
     * the finish.
     *
     * Blob URLs are revoked as they are replaced — one per render, and a
     * document being edited produces a great many.
     */
    private wireDocumentPreview(): void {
        this.docFeed$
            .pipe(
                debounceTime(1200),
                switchMap(html => (this.isDdoc()
                    ? this.ddocs.render(this.node.path, this.ddocSectionsToSend(html), this.ddocFootnotesToSend())
                    : this.previews.render(this.node.id, html)
                ).pipe(
                    map(blob => ({ blob, error: null as string | null })),
                    // Caught INSIDE the switchMap: an error reaching the outer
                    // stream completes it, and the preview would then be dead
                    // for the rest of the session with no sign of why.
                    catchError((err: unknown) => of({ blob: null, error: this.errors.humanize(err) })),
                )),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(({ blob, error }) => {
                if (blob) {
                    this.swapPdfUrl(URL.createObjectURL(blob));
                    this.pdfError.set(null);
                    return;
                }
                // Keep the last good render on screen behind the message: a
                // transient failure should not blank the pane an author is
                // working against.
                this.pdfError.set(error);
            });

        this.destroyRef.onDestroy(() => this.swapPdfUrl(null));
    }

    /**
     * Render and save the document as a file (#1774).
     *
     * Sends the CURRENT editor content, so what downloads is what is on screen
     * — unsaved edits included. That is the useful behaviour for an authored
     * document: the alternative, rendering the last SAVED bytes, would hand
     * back a file that silently disagrees with the editor.
     */
    downloadAs(format: 'docx' | 'pdf'): void {
        if (this.downloading()) return;
        this.downloading.set(true);

        const bytes$ = this.isDdoc()
            ? this.ddocs.download(this.node.path, this.ddocSectionsToSend(this.editorContent()), format, this.ddocFootnotesToSend())
            : this.previews.download(this.node.id, this.editorContent(), format);

        bytes$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (blob) => {
                    this.downloading.set(false);
                    this.saveBlob(blob, format);
                },
                error: (err: unknown) => {
                    this.downloading.set(false);
                    this.toast.error(this.errors.humanize(err), 'Download failed');
                },
            });
    }

    /** Hand a blob to the browser as a download, then release the object URL. */
    private saveBlob(blob: Blob, format: string): void {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        // The server sets Content-Disposition with the Node's own name, but a
        // blob download cannot see it — the name has to be rebuilt here. Same
        // rule as the server's: replace the extension, never append to it.
        link.download = (this.node.name ?? 'document').replace(/\.(dtmpl|ddoc)$/i, '') + '.' + format;
        link.click();
        // Revoked on the next tick: revoking synchronously can beat the
        // browser's own read of the URL and produce an empty file.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    /** Replace the current object URL, revoking the one it displaces. */
    private swapPdfUrl(next: string | null): void {
        const previous = this.pdfUrl();
        this.pdfUrl.set(next);
        if (previous) {
            URL.revokeObjectURL(previous);
        }
    }

    /**
     * Ask the document module for this template's paper.
     *
     * Only for templates: the endpoint resolves a DOCUMENT template Node, and
     * asking it about a theme fragment would be a 404 per open. Failure is
     * silent and leaves the canvas unpaged — an author who cannot write because
     * the paper lookup failed is worse off than one writing on a plain canvas.
     */
    private loadSheet(): void {
        // A `.ddoc` states its own paper and `loadDdoc()` has already applied
        // it. Asking the Node-extras endpoint would answer with the folder's
        // idea of the paper, which is the arrangement ADR-159 replaced.
        if (this.isDdoc() || 'document-builder' !== this.profileName()) {
            return;
        }

        this.pageSizes.fetch(this.node.id).pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                // `sheet` is ABSENT rather than null when unset — API Platform
                // omits null properties, so `?? null` and never `null ===`.
                next: dto => this.applyPaper(dto),
                error: () => this.sheet.set(null),
            });
    }

    /** Seed (or re-seed) the canvas and the paper controls from one payload. */
    private applyPaper(dto: DocumentPageSizeDto): void {
        this.sheet.set(dto.sheet ?? null);
        this.pageSizeOptions.set(dto.options ?? []);
        this.orientationOptions.set(dto.orientationOptions ?? []);
        this.pageSize.set(dto.pageSize ?? '');
        this.pageOrientation.set(dto.pageOrientation ?? '');
        this.paperPath.set(dto.path ?? '');
    }

    /**
     * Persist the paper and re-read the geometry (#1780).
     *
     * Both keys go in ONE patch even though only one select moved: they are two
     * halves of the same paper, and a patch carrying one clears the other —
     * the trap [[feedback_node_extras_lost_update]] records.
     *
     * The new sheet is RE-FETCHED rather than computed here. The mm-per-preset
     * table lives in `PageSizeResolver`, derived from the very array the
     * renderer hands PHPWord; deriving it a second time in TypeScript is how
     * the canvas and the .docx start disagreeing.
     */
    onPaperChange(size: string, orientation: string): void {
        const path = this.paperPath();
        if ('' === path || this.paperSaving()) {
            return;
        }

        this.paperSaving.set(true);
        // Optimistic on the CONTROLS only, so the selects do not snap back
        // while the round-trip is in flight; the canvas waits for the server's
        // geometry.
        this.pageSize.set(size);
        this.pageOrientation.set(orientation);

        this.pageSizes.save(path, size || null, orientation || null)
            .pipe(
                switchMap(() => this.pageSizes.fetch(this.node.id)),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: (dto) => {
                    this.paperSaving.set(false);
                    this.applyPaper(dto);
                },
                error: (err: unknown) => {
                    this.paperSaving.set(false);
                    this.toast.error(this.errors.humanize(err), 'Could not change the page setup');
                },
            });
    }

    /**
     * The document's sections, joined for editing.
     *
     * A `.ddoc` is a LIST of sections and the editor holds one flow, so they
     * are joined with a section-break atom and split apart again on save.
     * Showing only the first would leave the rest invisible while still saving
     * it — an author would see a document shorter than the one they have.
     */
    private loadDdoc(): void {
        this.ddocs.read(this.node.path).pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (payload) => {
                    this.ddocPayload.set(payload);
                    this.editorContent.set(
                        joinDdocSections(payload.sections),
                    );
                    this.seedDdocPaper(payload);
                    this.ddocFootnotes.set({ ...payload.footnotes });
                    this.ddocEditedNotes.set({});
                    this.loading.set(false);
                },
                error: (err: unknown) => {
                    this.loading.set(false);
                    this.toast.error(this.errors.humanize(err), 'Could not open the document');
                },
            });
    }

    /** Seed the paper controls and the canvas from a freshly read document. */
    private seedDdocPaper(payload: DdocPayload): void {
        // ⚠️ Guarded even though the compiler says it need not be: indexing an
        // array yields the element type here, so TypeScript believes a section
        // is always there. The server refuses a document with no sections, so
        // this is belt and braces — but the belt is what turns a malformed
        // payload into empty controls rather than a crash inside them.
        const page: DdocPage | undefined = payload.sections[0]?.page;

        this.ddocPaper.set(payload.paper);
        this.ddocPage.set(page ?? null);
        // A preset the server could not name comes back null, and the catalog
        // then carries a row for this document's own paper. Selecting it keeps
        // the size select honest AND makes the orientation select work, since
        // that row carries both ways up.
        this.ddocSize.set(undefined === page ? '' : (page.preset ?? DDOC_CUSTOM_SIZE));
        this.ddocOrientation.set(page?.orientation ?? '');
        this.ddocMargins.set(page?.marginPreset ?? '');
        this.ddocPaperDirty.set(false);
        this.ddocPaperMixed.set(sectionsDisagreeOnPaper(payload));
        this.sheet.set(this.geometryOf(page));
    }

    /**
     * The canvas's sheet, from the paper the document states.
     *
     * ⚠️ Twips to millimetres is arithmetic on the document's own numbers —
     * 1440 to the inch — not a second copy of `PageSizeResolver`'s table of
     * presets. Re-deriving THAT here is what would make the canvas and the
     * .docx disagree.
     *
     * The margins go with it since #2293: the canvas used to write on a fixed
     * 20mm frame whatever the file said, so a document with one-inch margins
     * paginated on screen against a writing width the .docx does not give it.
     */
    private geometryOf(page: DdocPage | null): PageGeometry | null {
        if (!page) return null;

        const mm = (twips: number): string => `${(twips / 1440 * 25.4).toFixed(2)}mm`;

        return {
            width: mm(page.widthTwips),
            height: mm(page.heightTwips),
            margins: {
                top: mm(page.margins.top),
                right: mm(page.margins.right),
                bottom: mm(page.margins.bottom),
                left: mm(page.margins.left),
            },
        };
    }

    /**
     * A different paper size, at whichever way up is currently chosen.
     *
     * Both come off the SAME catalog row, so the dimensions and the marker can
     * never disagree — which is the failure a landscape-labelled portrait page
     * is.
     */
    onDdocSize(value: string): void {
        const row = this.ddocPaper()?.sizes.find(size => value === size.value);
        const pair = undefined === row ? null : this.pairFor(row, this.ddocOrientation());
        if (null === pair) return;

        this.ddocSize.set(value);
        this.applyDdocPage({
            widthTwips: pair.widthTwips,
            heightTwips: pair.heightTwips,
        });
    }

    /** The same paper the other way up — the row already carries both. */
    onDdocOrientation(value: string): void {
        const row = this.ddocPaper()?.sizes.find(size => this.ddocSize() === size.value);
        const pair = undefined === row ? null : this.pairFor(row, value);
        if (null === pair) return;

        this.ddocOrientation.set(value);
        this.applyDdocPage({
            widthTwips: pair.widthTwips,
            heightTwips: pair.heightTwips,
            orientation: value,
        });
    }

    onDdocMargins(value: string): void {
        const preset = this.ddocPaper()?.margins.find(margin => value === margin.value);
        if (undefined === preset) return;

        this.ddocMargins.set(value);
        this.applyDdocPage({
            margins: {
                top: preset.top, right: preset.right, bottom: preset.bottom, left: preset.left,
            },
        });
    }

    /**
     * A size row's dimensions for one orientation.
     *
     * Keyed by the same two strings the orientation options carry, so this is a
     * LOOKUP into what the server sent rather than a rule about which number
     * goes where.
     */
    private pairFor(row: DdocPaperSize, orientation: string): DdocPaperSize['portrait'] | null {
        if ('portrait' === orientation) return row.portrait;
        if ('landscape' === orientation) return row.landscape;

        return null;
    }

    /**
     * Fold a paper change into the pending page and show it immediately.
     *
     * Marks the document dirty rather than saving: the paper lives in the FILE,
     * and the seam requires every section's body alongside it — so a
     * paper-only save would quietly write the author's unsaved text too. It
     * goes with the next Save, which is what a word processor does anyway.
     */
    private applyDdocPage(patch: Partial<DdocPage>): void {
        const page = this.ddocPage();
        if (null === page) return;

        const next: DdocPage = { ...page, ...patch };
        this.ddocPage.set(next);
        this.ddocPaperDirty.set(true);
        this.ddocPaperMixed.set(false);
        this.dirty.set(true);
        this.sheet.set(this.geometryOf(next));
    }

    /**
     * The sections to send, carrying the paper only when the author moved it.
     *
     * Used by the save, the live preview and the download alike, so what an
     * author previews is the paper they just chose rather than the one on disk.
     */
    private ddocSectionsToSend(html: string): DdocSectionEdit[] {
        const page = this.ddocPage();

        return splitDdocSections(html, this.ddocPaperDirty() && null !== page ? page : undefined);
    }

    /**
     * The notes to send — the ones the author edited or deleted, and no others.
     *
     * Undefined when there are none, so the payload does not mention the notes
     * at all. Same contract as the paper, for the same reason.
     */
    private ddocFootnotesToSend(): DdocFootnoteEdits | undefined {
        const edited = this.ddocEditedNotes();

        return 0 === Object.keys(edited).length ? undefined : (edited as DdocFootnoteEdits);
    }

    /** One note's body changed in the panel. */
    onFootnoteBodyChange(change: { id: number; html: string }): void {
        const key = String(change.id);
        if (this.ddocFootnotes()[key] === change.html) {
            // The editor emits on mount as well as on edit; a no-op change must
            // not put the note in the save payload, or opening the panel would
            // be enough to overwrite somebody else's edit to it.
            return;
        }

        this.ddocFootnotes.set({ ...this.ddocFootnotes(), [key]: change.html });
        this.ddocEditedNotes.set({ ...this.ddocEditedNotes(), [key]: change.html });
        this.dirty.set(true);
    }

    /**
     * Delete a note.
     *
     * ⚠️ The MARKERS stay. Removing them would mean rewriting the body the
     * author is editing from under their caret, and a marker whose note has
     * gone is not broken — the server hands it an empty note back, which is
     * something an author can see and fill in.
     */
    onFootnoteRemove(id: number): void {
        const key = String(id);
        const remaining = { ...this.ddocFootnotes() };
        delete remaining[key];

        this.ddocFootnotes.set(remaining);
        this.ddocEditedNotes.set({ ...this.ddocEditedNotes(), [key]: null });
        this.dirty.set(true);
    }

    private loadContent(): void {
        if (this.isDdoc()) {
            this.loadDdoc();

            return;
        }

        const url = this.fileContentUrl();
        if (!url) {
            this.loading.set(false);
            return;
        }

        this.http.get<{ content: string }>(url).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: ({ content }) => {
                this.editorContent.set(content ?? '');
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
            },
        });
    }

    onContentChange(html: string): void {
        // Bridge emits the post-adapter editor HTML; the adapter's
        // `toStorage()` will run on save to turn it back into dtmpl.
        this.editorContent.set(html);
        // Same HTML feeds whichever preview this file gets — the theme frame
        // (#1767) or the rendered PDF (#1773). Only the open one is fed: a
        // closed pane should not be costing a Gotenberg conversion per pause.
        if (this.preview()) {
            if (this.documentPreview()) {
                this.docFeed$.next(html);
            } else {
                this.previewFeed$.next(html);
            }
        }
        this.dirty.set(true);
    }

    save(): void {
        if (this.saving()) return;

        if (this.isDdoc()) {
            this.saveDdoc();

            return;
        }

        const url = this.fileContentUrl();
        if (!url) return;

        this.saving.set(true);
        const stored = this.dtmplAdapter.toStorage(this.editorContent());

        this.http.put<{ contentHash: string }>(url, { content: stored }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.dirty.set(false);
                this.saving.set(false);
                this.toast.success('Saved', this.node.name);
            },
            // A bare 'Save failed' hides the one thing the author needs. The
            // seeded templates under `.templates/` are mode 0444, so the real
            // answer is "Permission denied: cannot write <path>" — and without
            // it the dialog just keeps saying "unsaved changes" forever with
            // no reason given.
            error: (err: unknown) => {
                this.saving.set(false);
                this.toast.error(this.errors.humanize(err), 'Save failed');
            },
        });
    }

    private saveDdoc(): void {
        this.saving.set(true);

        this.ddocs.write(this.node.path, this.ddocSectionsToSend(this.editorContent()), this.ddocFootnotesToSend())
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.dirty.set(false);
                    // The paper is on disk now, so the next save has nothing to
                    // say about it — and leaving `page` out is what lets
                    // somebody else's paper edit survive that save.
                    this.ddocPaperDirty.set(false);
                    // Same contract for the notes: what was sent is stored, so
                    // the next save should mention none of them.
                    this.ddocEditedNotes.set({});
                    this.saving.set(false);
                    this.toast.success('Saved', this.node.name);
                },
                // The same reason the DTMPL save says this: a bare "Save
                // failed" hides the one thing the author needs, and a document
                // under a read-only folder refuses with the path in the
                // message.
                error: (err: unknown) => {
                    this.saving.set(false);
                    this.toast.error(this.errors.humanize(err), 'Save failed');
                },
            });
    }

    /**
     * ⚠️ Was an unconditional close. The footer rendered "unsaved changes"
     * and Cancel threw them away without asking -- the flag was shown to the
     * user and ignored by the code that discarded the work.
     *
     * `confirmDiscard` completes after one value, so a plain subscribe is
     * enough; there is nothing to unsubscribe from.
     */
    close(): void {
        if (!this.dirty()) {
            this.dialogRef.close();

            return;
        }

        this.confirm.confirmDiscard(this.node.name).subscribe((discard) => {
            if (discard) this.dialogRef.close();
        });
    }

    private fileContentUrl(): string | null {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const tmpl = manifest?.vfs?.fileContentUrl;
        if (!tmpl) return null;
        return tmpl.replace('{path}', encodeURIComponent(this.node.path));
    }
}
