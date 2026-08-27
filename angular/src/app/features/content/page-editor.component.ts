import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    DestroyRef,
    OnInit,
    computed,
    effect,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { concat, forkJoin, of, Observable } from 'rxjs';
import { concatMap, tap, toArray } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { CoolmsEditorComponent } from '@coolms/editor-angular';
import { PageService } from './page.service';
import { MarkdownService } from './markdown.service';
import { PageDto, PageTypeDto, PageVariantDto } from './page.types';
import {
    ConfirmDialogService,
    DateTimeFieldComponent,
    FieldWidgetHostComponent,
    FieldWidgetRegistry,
    ToastService,
    VfsNodeDto,
} from '@coolms/ui-angular';
import { DtmplContentAdapter } from './dtmpl-content-adapter';
import { ContentFieldPanelsComponent } from './content-field-panels.component';
import { ContentFieldDescriptorDto, ContentFieldPanelsService } from './content-field-panels.service';
import { BlockEditorComponent } from './block-editor.component';
import { FileHistoryPanelComponent } from './file-history-panel.component';
import { FileHistoryService } from './file-history.service';
import { EditorPanelsService, EditorPanelDto } from './editor-panels.service';
import { PageSizeService, PageSizeOption } from './page-size.service';
import { EditorCollabService } from './editor-collab.service';
import { EditorPresenceBarComponent } from './editor-presence-bar.component';
import { AppConfigState } from '@coolms/core-angular';

/**
 * Which side-rail panel is open (null = collapsed). A panel *id* — the set of
 * available ids is no longer a fixed union: it's whatever the installed modules
 * contribute via `GET /editor/panels` (the editor-panel registry).
 */
type RailTab = string;

/**
 * Page editor — multi-locale, multi-variant rich-text editor for pages.
 *
 * Sub-prompt B3 cut: previously hosted Tiptap directly + a hardcoded
 * toolbar. The Tiptap mount, source-mode toggle, link dialog, and toolbar
 * all delegate to `<coolms-editor>` (the @coolms/editor-angular bridge)
 * which reads its toolbar from the editor sub-manifest. What stays here:
 *
 *   - Locale tabs (BE / EN / RU + add-variant)
 *   - Per-locale content cache + dirty tracking
 *   - Title + meta (SEO) fields
 *   - Save draft / publish flow
 *   - Fullscreen + close lifecycle
 *
 * Storage form (dtmpl) ↔ editor HTML translation lives in DtmplContentAdapter
 * (Content module concern). The bridge is dtmpl-agnostic.
 *
 * Temporary regression vs B2: media insert button is missing from the
 * toolbar because the Media module's contributor lands in C1+C2. Existing
 * media nodes in saved content still render via the browser's native
 * `<img>` parsing; the editor just can't insert new ones until C2.
 * Alt-text editor, drag-resize, and gallery insertion all return alongside
 * C2 when MediaWidget extensions register through the bridge.
 */
@Component({
    selector: 'app-page-editor',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    // EditorCollabService is per-editor: its ngOnDestroy unsubscribes the
    // doc presence channel when this dialog closes.
    providers: [EditorCollabService],
    imports: [FormsModule, CoolmsEditorComponent, ContentFieldPanelsComponent, FieldWidgetHostComponent, BlockEditorComponent, FileHistoryPanelComponent, EditorPresenceBarComponent, DateTimeFieldComponent],
    template: `
        <div class="page-editor" [class.page-editor--fullscreen]="fullscreen()" [class.page-editor--landing]="landingMode()">

            <!-- ── Header ──────────────────────────────────────────────── -->
            <div class="page-editor__header">
                <span class="page-editor__title">
                    <i class="bi bi-file-earmark-text"></i>
                    {{ page()?.vfsPath ?? page()?.slug ?? '…' }}
                </span>
                <div class="page-editor__header-actions">
                    <!-- ── Live presence (Track B #8) ───────────────────────── -->
                    <!-- Other users currently in this variant's doc channel.
                         Self-hides when nobody else is here; only populated when
                         collab is active (write permission on the variant). -->
                    <app-editor-presence-bar [peers]="collab.peers()" />
                    <button class="cms-btn cms-btn-sm" title="Toggle fullscreen"
                            (click)="fullscreen.set(!fullscreen())">
                        <i class="bi" [class.bi-fullscreen]="!fullscreen()" [class.bi-fullscreen-exit]="fullscreen()"></i>
                    </button>
                    <button class="cms-btn cms-btn-sm" (click)="tryClose()">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            </div>

            <!-- ── Peer-saved banner (Track B #8) ──────────────────────── -->
            <!-- Non-blocking strip shown when a *different* user saves this
                 variant. Reload pulls the fresh body from the variant endpoint;
                 own saves are suppressed by the collab service. -->
            @if (collabEnabled() && collab.peerSaved(); as saved) {
                <div class="page-editor__peer-saved" role="status">
                    <i class="bi bi-arrow-repeat"></i>
                    <span class="page-editor__peer-saved-msg">
                        <strong>{{ saved.byName || 'Someone' }}</strong> saved a newer version.
                    </span>
                    <button class="cms-btn cms-btn-sm cms-btn-primary"
                            (click)="reloadFromPeerSave()">
                        Reload
                    </button>
                    <button class="cms-btn cms-btn-sm" title="Dismiss"
                            (click)="collab.acknowledgeSaved()">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            }

            <!-- ── Locale tabs ─────────────────────────────────────────── -->
            <div class="page-editor__tabs">
                <div class="page-editor__tab-list">
                    @for (v of variants(); track v.locale) {
                        <button class="page-editor__tab"
                                [class.page-editor__tab--active]="activeTab() === v.locale"
                                [class.page-editor__tab--dirty]="dirtyLocales().has(v.locale)"
                                (click)="switchTab(v.locale)">
                            {{ v.locale.toUpperCase() }}
                            @if (dirtyLocales().has(v.locale)) { <span class="page-editor__dirty-dot"></span> }
                        </button>
                    }
                    @if (addingVariant()) {
                        <select #newLocaleSelect
                                class="page-editor__new-locale-input"
                                (change)="confirmAddVariant(newLocaleSelect.value)"
                                (keydown.escape)="addingVariant.set(false)"
                                (blur)="addingVariant.set(false)">
                            <option value="">— Pick a locale —</option>
                            @for (l of availableLocales(); track l.code) {
                                <option [value]="l.code">{{ l.label }} ({{ l.code }})</option>
                            }
                        </select>
                    } @else if (availableLocales().length > 0) {
                        <button class="cms-btn cms-btn-sm page-editor__add-tab" title="Add variant"
                                (click)="startAddVariant()">
                            <i class="bi bi-plus-lg"></i>
                        </button>
                    } @else {
                        <button class="cms-btn cms-btn-sm page-editor__add-tab"
                                title="All supported locales already authored"
                                disabled>
                            <i class="bi bi-plus-lg"></i>
                        </button>
                    }
                </div>
                <div class="page-editor__tab-actions">
                    @if (activeVariant(); as v) {
                        <span class="cms-badge"
                              [class.cms-badge--success]="v.status === 'published'"
                              [class.cms-badge--warning]="v.status === 'draft'"
                              [class.cms-badge--info]="v.status === 'in_review'"
                              [class.cms-badge--danger]="v.status === 'changes_requested'"
                              [class.cms-badge--muted]="v.status === 'archived'">
                            {{ statusLabel(v.status) }}
                        </span>

                        <!-- ── Editorial review actions (W6.a) ─────────────── -->
                        <!-- W6.c: only collections that opt into review show
                             "Submit for review"; elsewhere the author publishes
                             directly via the Publish button. -->
                        @if ((v.status === 'draft' || v.status === 'changes_requested') && page()?.requiresReview) {
                            <button class="cms-btn cms-btn-sm"
                                    [disabled]="saving()"
                                    (click)="submitForReview()"
                                    title="Save and submit this variant for review">
                                <i class="bi bi-send"></i> Submit for review
                            </button>
                        } @else if (v.status === 'in_review') {
                            <!-- Emphasis via cms-btn-primary, the platform's affirmative
                                 button (#2125). This asked for cms-btn-success, which the
                                 platform does not define — the variants are primary / danger
                                 / ghost / link / active / sm / lg — so it fell back to the
                                 plain neutral and read IDENTICALLY to the "Request changes"
                                 button beside it. A one-site variant does not earn a new
                                 colour in the design system; the existing emphasis one says
                                 the same thing. -->
                            <button class="cms-btn cms-btn-sm cms-btn-primary"
                                    [disabled]="saving()"
                                    (click)="approveReview()"
                                    title="Approve and publish">
                                <i class="bi bi-check2-circle"></i> Approve
                            </button>
                            <button class="cms-btn cms-btn-sm"
                                    [disabled]="saving()"
                                    (click)="requestReviewChanges()"
                                    title="Send back to the author with a note">
                                <i class="bi bi-arrow-counterclockwise"></i> Request changes
                            </button>
                        }

                        @if (!landingMode()) {
                            <button class="cms-btn cms-btn-sm"
                                    [disabled]="exporting()"
                                    (click)="exportMarkdown()"
                                    title="Download this locale's body as a Markdown (.md) file">
                                <i class="bi bi-markdown"></i> {{ exporting() ? 'Exporting…' : 'Export .md' }}
                            </button>
                        }

                        <button class="cms-btn cms-btn-sm cms-btn-primary"
                                [disabled]="saving()"
                                (click)="publish()"
                                title="Save and publish (skips review)">
                            <i class="bi bi-cloud-upload"></i> Publish
                        </button>
                    }
                </div>
            </div>

            @if (activeVariant(); as variant) {
                <!-- ── Changes-requested callout (W6.c) ──────────────────── -->
                <!-- Surfaces the reviewer's note to the author so the
                     request-changes round-trip is actionable, not just a badge. -->
                @if (variant.status === 'changes_requested') {
                    <div class="page-editor__review-note" role="alert">
                        <i class="bi bi-exclamation-triangle-fill"></i>
                        <div class="page-editor__review-note-body">
                            <strong>Changes requested</strong>
                            @if (variant.reviewNote) {
                                <p>{{ variant.reviewNote }}</p>
                            } @else {
                                <p>The reviewer sent this back without a note — revise and resubmit.</p>
                            }
                        </div>
                    </div>
                }

                <!-- ── Title field ─────────────────────────────────────── -->
                <div class="page-editor__title-row">
                    <label class="page-editor__title-label">Title</label>
                    <input class="page-editor__title-input"
                           type="text"
                           [ngModel]="titleValue()"
                           (ngModelChange)="onTitleChange($event)"
                           placeholder="Page title…" />
                </div>

                <!-- ── Slug (advanced, #1618) ──────────────────────────────
                     The slug is the page/article URL segment (the Package
                     filename). It FREEZES on first publish (slugLocked); a
                     rename then changes the live URL, so it is force-gated
                     behind a confirm. -->
                @if (page()) {
                    <div class="page-editor__slug-row">
                        <label class="page-editor__slug-label">Slug</label>
                        <span class="page-editor__slug-prefix">/</span>
                        <input class="page-editor__slug-input"
                               type="text"
                               spellcheck="false"
                               autocomplete="off"
                               [ngModel]="slugInput()"
                               (ngModelChange)="slugInput.set($event)"
                               (keydown.enter)="rename()"
                               placeholder="url-segment" />
                        @if (slugLocked()) {
                            <span class="page-editor__slug-lock"
                                  title="Published — renaming changes the live URL">
                                <i class="bi bi-lock-fill"></i> frozen
                            </span>
                        }
                        <button type="button"
                                class="cms-btn cms-btn-sm"
                                [disabled]="!canRename()"
                                (click)="rename()">
                            {{ renaming() ? 'Renaming…' : 'Rename' }}
                        </button>

                        <!-- Page type (#1697) — sits with the slug because both
                             are properties of the PACKAGE, not of a variant, and
                             both need an explicit target to write to. Applies on
                             change: unlike a rename it alters no URL and is
                             reversible, so a confirm step would only add friction. -->
                        <label class="page-editor__slug-label"
                               style="margin-left: 12px;">Type</label>
                        <select class="cms-input cms-input-sm"
                                style="width: auto;"
                                [disabled]="typeSaving()"
                                [ngModel]="typeInput()"
                                (ngModelChange)="onTypeChange($event)">
                            <option value="">Default</option>
                            @for (t of pageTypes(); track t.key) {
                                <option [value]="t.key">{{ t.label }}</option>
                            }
                        </select>
                    </div>
                }

                <!-- ── Editor body + right side-rail ───────────────────── -->
                <div class="page-editor__main">
                    <div class="page-editor__body">
                        <!-- Landing pages render their blocks, not the prose body —
                             so the section builder IS the main canvas (the rich-text
                             editor is dropped). landingMode is seeded from the page's
                             contentType at load (see seedLandingMode), so the prose
                             editor below never mounts for a landing page; the block
                             editor's activeChange only corrects unstamped legacy pages. -->
                        @if (!landingMode()) {
                            <coolms-editor
                                profile="admin"
                                class="page-editor__canvas"
                                [style.max-width]="canvasMaxWidth()"
                                [content]="editorContent()"
                                (contentChange)="onContentChange($event)"
                                [contentAdapter]="dtmplAdapter"
                                [mountKey]="editorMountKey()" />
                        }
                        @if (postPath()) {
                            <app-block-editor class="page-editor__post" [path]="postPath()" [embedded]="true"
                                              (activeChange)="landingMode.set($event)" />
                        }
                    </div>

                    <!-- ── Side-rail: History / Meta / Schedule / Fields ───── -->
                    <!-- Consolidates the former expand-below panels into one
                         right-docked, tabbed surface. The vertical icon strip is
                         always visible; the panel opens to the left of it. -->
                    <aside class="page-editor__rail">
                        @if (rail(); as tab) {
                            <!-- Transient panels (History / Meta / Schedule): their
                                 state lives on the host, so destroying them on tab
                                 switch/collapse loses nothing. The Fields panel is
                                 the exception — it owns its own model + dirty — so
                                 it's rendered persistently below instead of here. -->
                            @if (tab !== 'fields') {
                                <div class="page-editor__rail-panel">
                                    <div class="page-editor__rail-head">
                                        <span class="page-editor__rail-title">{{ railTitle(tab) }}</span>
                                        <button class="cms-btn cms-btn-sm" title="Collapse panel"
                                                (click)="rail.set(null)">
                                            <i class="bi bi-chevron-double-right"></i>
                                        </button>
                                    </div>
                                    <div class="page-editor__rail-body">
                                        @switch (tab) {
                                            @case ('history') {
                                                @if (activeVariantPath()) {
                                                    <app-file-history-panel
                                                        [path]="activeVariantPath()"
                                                        (restored)="onRevisionRestored()" />
                                                }
                                            }
                                            @case ('meta') {
                                                @if (seoFields().length > 0) {
                                                    @for (f of seoFields(); track f.name) {
                                                        <div class="page-editor__rail-field">
                                                            <label class="cms-label">{{ f.label }}</label>
                                                            <app-field-widget-host
                                                                [kind]="seoWidgetKind(f)"
                                                                [value]="seoValue(f.name)"
                                                                [config]="f.widget ?? {}"
                                                                [disabled]="!!f.locked"
                                                                [valueChange]="seoChangeFn(f.name)" />
                                                        </div>
                                                    }
                                                } @else {
                                                    <p class="page-editor__rail-hint">No SEO fields are configured.</p>
                                                }
                                            }
                                            @case ('schedule') {
                                                <div class="page-editor__rail-field">
                                                    <label class="cms-label">Publish at</label>
                                                    <app-datetime-field placeholder="Not scheduled"
                                                                        [value]="publishAtInput()"
                                                                        (valueChange)="onScheduleChange('publish', $event)" />
                                                </div>
                                                <div class="page-editor__rail-field">
                                                    <label class="cms-label">Unpublish at</label>
                                                    <app-datetime-field placeholder="Not scheduled"
                                                                        [value]="unpublishAtInput()"
                                                                        (valueChange)="onScheduleChange('unpublish', $event)" />
                                                </div>
                                            }
                                            @case ('layout') {
                                                <div class="page-editor__rail-field">
                                                    <label class="cms-label">Page size</label>
                                                    <select class="cms-input cms-input-sm"
                                                            [ngModel]="pageSizeValue()"
                                                            (ngModelChange)="onPageSizeChange($event)">
                                                        <option value="">Default (responsive)</option>
                                                        @for (o of pageSizeOptions(); track o.value) {
                                                            <option [value]="o.value">{{ o.label }}</option>
                                                        }
                                                    </select>
                                                </div>
                                                @if (pageSizeValue() === 'custom') {
                                                    <div class="page-editor__rail-field">
                                                        <label class="cms-label">Width (px)</label>
                                                        <input class="cms-input cms-input-sm" type="number"
                                                               min="200" step="10"
                                                               [ngModel]="pageWidthValue()"
                                                               (ngModelChange)="onPageWidthChange($event)"
                                                               placeholder="e.g. 900" />
                                                    </div>
                                                }
                                                <p class="page-editor__rail-hint">
                                                    Sizes the editor canvas, the public page width, and DOCX page exports.
                                                </p>
                                            }
                                        }
                                    </div>
                                </div>
                            }
                        }

                        <!-- ── Fields panel (persistent) ─────────────────────────
                             Kept mounted whenever the collection contributes a
                             field set, and merely hidden ([hidden]) when its tab
                             isn't open — so unsaved field edits survive switching
                             to another rail tab or collapsing the rail, and the
                             footer's single Save (which reads it via viewChild)
                             always sees its dirty state. The component renders
                             nothing until it has panels, and hides its own Save
                             button (embedded mode) since the footer drives save. -->
                        @if (hasFieldsPanel()) {
                            <div class="page-editor__rail-panel" [hidden]="rail() !== 'fields'">
                                <div class="page-editor__rail-head">
                                    <span class="page-editor__rail-title">{{ railTitle('fields') }}</span>
                                    <button class="cms-btn cms-btn-sm" title="Collapse panel"
                                            (click)="rail.set(null)">
                                        <i class="bi bi-chevron-double-right"></i>
                                    </button>
                                </div>
                                <div class="page-editor__rail-body">
                                    <app-content-field-panels [path]="postPath()" [embedded]="true" />
                                </div>
                            </div>
                        }
                        <!-- Manifest-driven: each tab is a panel an installed
                             module contributes via GET /editor/panels. Schedule
                             appears only when the Scheduler module is installed;
                             Fields only when the collection opts into a field set
                             — the host never references those modules. -->
                        <nav class="page-editor__rail-strip">
                            @for (p of railPanels(); track p.id) {
                                <button class="page-editor__rail-tab" [class.is-active]="rail() === p.id"
                                        [title]="p.title" (click)="toggleRail(p.id)">
                                    <i class="bi bi-{{ p.icon }}"></i>
                                    @if (p.id === 'schedule' && (activeVariant()?.publishAt || activeVariant()?.unpublishAt)) {
                                        <span class="page-editor__rail-dot"></span>
                                    }
                                </button>
                            }
                        </nav>
                    </aside>
                </div>

                <!-- ── Footer ──────────────────────────────────────────── -->
                <div class="page-editor__footer">
                    <!-- Landing pages: a quiet section count fills the footer's
                         otherwise-empty left (replaces the old block-editor header
                         band). Hidden for prose pages, where there are no blocks. -->
                    @if (landingMode()) {
                        <span class="page-editor__footer-status" title="Sections on this landing page">
                            <i class="bi bi-grid-1x2"></i>
                            {{ blockCount() }} {{ blockCount() === 1 ? 'block' : 'blocks' }}
                        </span>
                    }
                    <div class="page-editor__footer-actions">
                        <button class="cms-btn cms-btn-sm" (click)="tryClose()">Close</button>
                        <button class="cms-btn cms-btn-primary cms-btn-sm"
                                [disabled]="saving() || !anyDirty()"
                                (click)="saveAll()">
                            {{ saving() ? 'Saving…' : 'Save' }}
                        </button>
                    </div>
                </div>
            } @else if (loading()) {
                <div class="page-editor__loading">Loading…</div>
            } @else if (variants().length === 0) {
                <div class="page-editor__empty">
                    No variants yet. Click <strong>+</strong> to add a locale.
                </div>
            }

        </div>
    `,
    styles: [`
        .page-editor {
            display: flex; flex-direction: column;
            width: min(90vw, 1200px);
            height: min(90vh, 860px);
            background: var(--cms-surface);
            border-radius: var(--cms-radius-lg);
            overflow: hidden;
        }
        .page-editor--fullscreen {
            width: 100vw; height: 100vh;
            border-radius: 0;
        }

        /* Header */
        .page-editor__header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 16px;
            border-bottom: 1px solid var(--cms-border);
            flex-shrink: 0;
        }
        .page-editor__title {
            font-size: .875rem; font-weight: 600;
            display: flex; align-items: center; gap: 8px;
            font-family: 'Courier New', monospace;
        }
        .page-editor__header-actions { display: flex; gap: 6px; }

        /* Tabs */
        .page-editor__tabs {
            display: flex; align-items: center; justify-content: space-between;
            padding: 6px 12px;
            border-bottom: 1px solid var(--cms-border);
            flex-shrink: 0;
            gap: 8px;
        }
        .page-editor__tab-list { display: flex; align-items: center; gap: 4px; }
        .page-editor__tab {
            padding: 4px 12px; border-radius: 4px; font-size: .8125rem; font-weight: 500;
            border: 1px solid transparent; background: transparent; cursor: pointer;
            color: var(--cms-text-muted);
            display: flex; align-items: center; gap: 4px;
        }
        .page-editor__tab:hover { background: var(--cms-border-light); }
        .page-editor__tab--active {
            background: var(--cms-accent-light);
            color: var(--cms-accent-text);
            border-color: var(--cms-accent);
        }
        .page-editor__tab--dirty { border-style: dashed; }
        .page-editor__dirty-dot {
            width: 6px; height: 6px; border-radius: 50%;
            background: var(--cms-warning);
        }
        .page-editor__new-locale-input {
            min-width: 160px; padding: 4px 8px; border-radius: 4px;
            border: 1px solid var(--cms-border); font-size: .8125rem;
            background: var(--cms-surface);
        }
        .page-editor__add-tab { padding: 4px 8px; }
        .page-editor__tab-actions { display: flex; align-items: center; gap: 8px; }

        /* Changes-requested callout (W6.c) */
        .page-editor__review-note {
            display: flex; align-items: flex-start; gap: 10px;
            margin: 10px 16px 0;
            padding: 10px 12px;
            border: 1px solid var(--cms-danger);
            border-left-width: 3px;
            border-radius: var(--cms-radius);
            background: var(--cms-danger-light, rgba(220, 53, 69, .08));
            color: var(--cms-text);
            font-size: .8125rem;
            flex-shrink: 0;
        }
        .page-editor__review-note > i { color: var(--cms-danger); margin-top: 1px; }
        .page-editor__review-note-body strong { display: block; margin-bottom: 2px; }
        .page-editor__review-note-body p { margin: 0; color: var(--cms-text-muted); white-space: pre-line; }

        /* Peer-saved banner (Track B #8) */
        .page-editor__peer-saved {
            display: flex; align-items: center; gap: 10px;
            padding: 8px 16px;
            border-bottom: 1px solid var(--cms-border);
            background: var(--cms-accent-light);
            color: var(--cms-text);
            font-size: .8125rem;
            flex-shrink: 0;
        }
        .page-editor__peer-saved > i { color: var(--cms-accent); }
        .page-editor__peer-saved-msg { flex: 1; }

        /* Scheduled publish/unpublish actions (W6.d) */
        .page-editor__schedule-actions { display: flex; gap: 6px; justify-content: flex-end; }

        /* Title row */
        .page-editor__title-row {
            display: flex; align-items: center; gap: 12px;
            padding: 8px 16px;
            border-bottom: 1px solid var(--cms-border);
            flex-shrink: 0;
        }
        .page-editor__title-label { font-size: .75rem; font-weight: 600; white-space: nowrap; color: var(--cms-text-muted); }
        .page-editor__title-input {
            flex: 1; border: none; outline: none;
            font-size: 1.125rem; font-weight: 600;
            background: transparent;
            color: var(--cms-text);
        }

        /* Slug row (advanced) — secondary to the title; monospace input. */
        .page-editor__slug-row {
            display: flex; align-items: center; gap: 8px;
            padding: 6px 16px;
            border-bottom: 1px solid var(--cms-border);
            flex-shrink: 0;
        }
        .page-editor__slug-label { font-size: .75rem; font-weight: 600; white-space: nowrap; color: var(--cms-text-muted); }
        .page-editor__slug-prefix { color: var(--cms-text-muted); font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; }
        .page-editor__slug-input {
            flex: 1; min-width: 0;
            border: 1px solid var(--cms-border); border-radius: 4px;
            padding: 3px 8px;
            font-size: .8125rem; font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
            background: var(--cms-surface, transparent); color: var(--cms-text);
        }
        .page-editor__slug-lock {
            display: inline-flex; align-items: center; gap: 4px;
            font-size: .6875rem; white-space: nowrap; color: var(--cms-text-muted);
        }

        /* Main = editor body + right rail. The panel floats OVER the body
           (absolute) so opening/closing it never resizes the editor — no
           content/toolbar reflow jump. Only the thin icon strip is in flow. */
        .page-editor__main { flex: 1; min-height: 0; display: flex; position: relative; }
        .page-editor__body { flex: 1; min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
        .page-editor__body coolms-editor { flex: 1; min-height: 0; display: flex; flex-direction: column; }
        /* Landing pages: the block builder IS the main canvas (the prose editor is
           dropped), so it fills the body and scrolls. It takes no space otherwise
           (it self-hides for non-landing pages). */
        .page-editor__post { flex: 0 0 auto; width: 100%; }
        .page-editor--landing .page-editor__post { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
        /* Layout panel: a page-size max-width caps + centers the editing canvas. */
        .page-editor__canvas { width: 100%; margin-inline: auto; }
        .page-editor__rail-hint { font-size: .75rem; color: var(--cms-text-muted, #6c757d); margin: .5rem 0 0; }

        /* Right side-rail (History / Meta / Schedule / Fields) */
        .page-editor__rail { display: flex; flex-shrink: 0; border-left: 1px solid var(--cms-border); }
        .page-editor__rail-strip {
            display: flex; flex-direction: column; gap: 2px; padding: 6px 4px; flex-shrink: 0;
        }
        .page-editor__rail-tab {
            position: relative; width: 34px; height: 34px;
            display: flex; align-items: center; justify-content: center;
            border: 1px solid transparent; border-radius: 6px;
            background: transparent; color: var(--cms-text-muted); cursor: pointer;
        }
        .page-editor__rail-tab:hover { background: var(--cms-border-light); color: var(--cms-text); }
        .page-editor__rail-tab.is-active {
            background: var(--cms-accent-light); color: var(--cms-accent-text); border-color: var(--cms-accent);
        }
        .page-editor__rail-dot {
            position: absolute; top: 5px; right: 5px;
            width: 6px; height: 6px; border-radius: 50%; background: var(--cms-info, var(--cms-accent));
        }
        .page-editor__rail-panel {
            position: absolute; top: 0; bottom: 0; right: 42px; z-index: 5;
            width: min(340px, 80vw); display: flex; flex-direction: column;
            background: var(--cms-surface);
            border-left: 1px solid var(--cms-border);
            box-shadow: -8px 0 20px rgba(0, 0, 0, .12);
        }
        /* The class sets display:flex, which would otherwise out-specify the UA
           [hidden] rule — restate it so the persistent Fields panel actually
           hides when its tab isn't open. */
        .page-editor__rail-panel[hidden] { display: none; }
        .page-editor__rail-head {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 12px; border-bottom: 1px solid var(--cms-border); flex-shrink: 0;
        }
        .page-editor__rail-title { font-size: .8125rem; font-weight: 600; }
        .page-editor__rail-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
        .page-editor__rail-field { margin-bottom: 12px; }
        .page-editor__rail-field .cms-label { display: block; margin-bottom: 4px; }
        .page-editor__rail-field .cms-input { width: 100%; }

        /* Footer */
        .page-editor__footer {
            display: flex; align-items: flex-start; justify-content: space-between;
            padding: 8px 16px; border-top: 1px solid var(--cms-border);
            flex-shrink: 0; gap: 12px; flex-wrap: wrap;
        }

        .page-editor__meta {
            display: flex; gap: 12px; flex: 1; flex-wrap: wrap;
            margin-top: 8px; width: 100%;
        }
        .page-editor__meta-field { flex: 1; min-width: 180px; }
        /* Landing-page section count: a muted status pinned to the footer's left,
           vertically centered against the button row (the footer is flex-start). */
        .page-editor__footer-status {
            display: inline-flex; align-items: center; gap: 6px; align-self: center;
            font-size: .75rem; color: var(--cms-text-muted);
        }
        .page-editor__footer-actions { display: flex; gap: 6px; align-items: center; margin-left: auto; }

        /* States */
        .page-editor__loading, .page-editor__empty {
            flex: 1; display: flex; align-items: center; justify-content: center;
            color: var(--cms-text-muted); font-size: .875rem;
        }

        /* Rotated chevron for meta toggle */
        .rotated { transform: rotate(180deg); transition: transform 200ms; }
    `],
})
export class PageEditorComponent implements OnInit {
    private readonly dialogRef   = inject(DialogRef);
    private readonly rawData     = inject(DIALOG_DATA) as { page?: PageDto; node?: VfsNodeDto };
    private readonly pageSvc     = inject(PageService);
    private readonly markdownSvc = inject(MarkdownService);
    private readonly toast       = inject(ToastService);
    private readonly confirmSvc  = inject(ConfirmDialogService);
    private readonly destroyRef  = inject(DestroyRef);
    private readonly cdr         = inject(ChangeDetectorRef);
    private readonly store       = inject(Store);
    private readonly history     = inject(FileHistoryService);
    private readonly editorPanels = inject(EditorPanelsService);
    private readonly pageSizeSvc = inject(PageSizeService);
    private readonly fieldWidgets = inject(FieldWidgetRegistry);
    private readonly fieldPanelsSvc = inject(ContentFieldPanelsService);
    /** Live presence + peer-save signal for the active variant's doc channel.
     *  Public so the template binds `collab.peers()` / `collab.peerSaved()`. */
    readonly collab              = inject(EditorCollabService);
    /** Wires dtmpl ↔ HTML for the bridge. Public on the component so the
     *  template can `[contentAdapter]="dtmplAdapter"`-bind it directly. */
    readonly dtmplAdapter        = inject(DtmplContentAdapter);

    readonly loading       = signal(true);
    readonly page          = signal<PageDto | null>(null);
    readonly variants      = signal<PageVariantDto[]>([]);
    readonly activeTab     = signal('');
    readonly saving        = signal(false);
    readonly exporting     = signal(false);
    readonly fullscreen    = signal(false);
    readonly addingVariant = signal(false);
    /** W6.d scheduled publish/unpublish inputs (datetime-local
     *  `YYYY-MM-DDTHH:mm` local strings; converted to/from ISO). */
    readonly publishAtInput  = signal('');
    readonly unpublishAtInput = signal('');
    /**
     * Editor side-rail (right dock): which panel is open, or null = collapsed.
     * Consolidates the former Meta / Schedule / History expand-below toggles
     * plus the post-level Fields set into one tabbed panel — better use of the
     * horizontal space on wide screens. The vertical icon strip stays visible;
     * clicking the active tab collapses the panel.
     */
    readonly rail = signal<RailTab | null>(null);
    /**
     * True when the open page is a landing page. Drives a layout swap: the
     * rich-text body editor (a hidden placeholder for landing pages) is dropped
     * and the block list becomes the scrollable main area — otherwise the tall
     * block editor, stuck in the fixed footer, gets clipped by the dialog and
     * can't be scrolled to.
     *
     * Seeded synchronously from the page's `contentType` the moment the page
     * loads ({@see seedLandingMode}) so the prose `<coolms-editor>` never mounts
     * for a landing page — avoiding a wasted TipTap init plus a peer-visible
     * presence join/leave on the doc channel. The block editor's async
     * {@see BlockEditorComponent.activeChange} still corrects the rare legacy
     * page whose `extras.contentType` was never stamped.
     */
    readonly landingMode   = signal(false);

    /** Configured page kinds for the Type picker (#1697). */
    readonly pageTypes = signal<PageTypeDto[]>([]);

    /** The Type picker's displayed value — see {@see seedLandingMode}. */
    readonly typeInput = signal<string>('');

    /** True while a type change is in flight — disables the picker. */
    readonly typeSaving = signal(false);

    readonly dirtyLocales = signal<Set<string>>(new Set());

    /**
     * The side-panels the installed modules contribute for this page, fetched
     * from `GET /editor/panels` (the editor-panel registry). Drives the rail
     * strip — so the Schedule tab appears only when the Scheduler module is
     * installed and Fields only for collections that opt into a field set, with
     * this host referencing neither module.
     */
    readonly railPanels = signal<readonly EditorPanelDto[]>([]);
    private lastPanelsPath = '';
    /** Guards the one-shot fetch of the declared `seo` field-group descriptors. */
    private lastSeoFieldsPath = '';

    /** True once a Schedule field has been touched since load/save (single-Save gate). */
    readonly scheduleDirty = signal(false);

    // ── Page size / content width (Track B — Layout panel) ─────────────────────
    /** The preset catalog from `GET /content/page-size` (A4 / Letter / … / Custom). */
    readonly pageSizeOptions = signal<readonly PageSizeOption[]>([]);
    /** The page's selected preset (`''` = unset → default container). */
    readonly pageSizeValue = signal('');
    /** The custom pixel width (only used when `pageSizeValue() === 'custom'`). */
    readonly pageWidthValue = signal<number | null>(null);
    /** True once the size was changed since load/save (single-Save gate). */
    readonly pageSizeDirty = signal(false);
    private lastSizePath = '';

    /**
     * The CSS `max-width` for the editor canvas, mirroring the public render's
     * `PageSize` catalog so the author edits at the page's real width live.
     * `null` keeps the editor's natural full width (the unset default).
     */
    readonly canvasMaxWidth = computed<string | null>(() => {
        switch (this.pageSizeValue()) {
            case 'a4': return '210mm';
            case 'letter':
            case 'legal': return '8.5in';
            case 'wide': return '1320px';
            case 'full': return '100%';
            case 'custom': {
                const w = this.pageWidthValue();
                return w && w > 0 ? `${w}px` : null;
            }
            default: return null;
        }
    });

    /**
     * The post-level Fields panel. Kept mounted (hidden) whenever the page
     * contributes a field set so its dirty/save survive rail tab switches —
     * see the persistent render + {@see hasFieldsPanel} in the template.
     */
    private readonly fieldsPanel = viewChild(ContentFieldPanelsComponent);

    /**
     * The landing-page section builder. Self-contained (own merge-patch on
     * `extras.blocks`) — driven through the window's single Save here, so its
     * own "Save sections" button is hidden via `[embedded]`. Resolves to null
     * for non-landing pages (it renders nothing) so its dirty/save are no-ops.
     */
    private readonly blockEditor = viewChild(BlockEditorComponent);

    /**
     * Live count of the landing page's sections, surfaced as a quiet status in
     * the footer's (otherwise empty) left when {@see landingMode} is on. Reads
     * the embedded block editor's `blocks` signal — null/0 until it mounts and
     * loads. Reactive: a viewChild signal + a signal read inside a computed.
     */
    readonly blockCount = computed(() => this.blockEditor()?.blocks().length ?? 0);

    /**
     * True when the active page contributes a post-level Fields panel. Gates the
     * persistent Fields rail panel (mounted-but-hidden so edits aren't lost on
     * tab switch); derived from the manifest-driven {@see railPanels}.
     */
    readonly hasFieldsPanel = computed(() => this.railPanels().some(p => p.id === 'fields'));

    /**
     * Whether *anything* in the window has unsaved edits — body/meta in *any*
     * locale (not just the active tab, since Save now flushes them all),
     * schedule, or the post fields. Gates the single footer Save button so one
     * action persists exactly the parts that changed.
     */
    readonly anyDirty = computed(() =>
        this.dirtyLocales().size > 0
        || this.scheduleDirty()
        || this.pageSizeDirty()
        || (this.fieldsPanel()?.dirty() ?? false)
        || (this.blockEditor()?.dirty() ?? false),
    );

    constructor() {
        // Fetch the contributed panels whenever the page (→ its path) resolves.
        // load is async — no signal is written synchronously here, so this
        // never feeds back on itself.
        effect(() => {
            const path = this.postPath();
            if (!path || path === this.lastPanelsPath) {
                return;
            }
            this.lastPanelsPath = path;
            this.editorPanels.getPanels(path)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: panels => { this.railPanels.set(panels); this.cdr.markForCheck(); },
                    error: () => { this.railPanels.set([]); this.cdr.markForCheck(); },
                });
        });

        // Load the page's current size + the preset catalog when the path
        // resolves, so the Layout panel + the live canvas width are seeded.
        effect(() => {
            const path = this.postPath();
            if (!path || path === this.lastSizePath) {
                return;
            }
            this.lastSizePath = path;
            this.pageSizeSvc.fetch(path)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: dto => {
                        this.pageSizeOptions.set(dto.options ?? []);
                        this.pageSizeValue.set(dto.pageSize ?? '');
                        this.pageWidthValue.set(dto.pageWidth ?? null);
                        this.pageSizeDirty.set(false);
                        this.cdr.markForCheck();
                    },
                    error: () => { this.pageSizeOptions.set([]); this.cdr.markForCheck(); },
                });
        });

        // Fetch the declared `seo` field-group descriptors once (variant-scoped, same
        // across locales) so the Meta rail renders declaration-driven inputs.
        effect(() => {
            const path = this.activeVariantPath();
            if (!path || this.seoFields().length > 0 || path === this.lastSeoFieldsPath) {
                return;
            }
            this.lastSeoFieldsPath = path;
            this.fieldPanelsSvc.fetch(path)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: dto => {
                        const seo = (dto.panels ?? []).find(p => p.group === 'seo');
                        this.seoFields.set(seo?.fields ?? []);
                        // Re-seed the active locale now that descriptors exist (the first
                        // activateTab ran with an empty descriptor list).
                        const loc = this.activeTab();
                        if (loc && !this.metaCache()[loc]) {
                            this.seoValues.set(this.seedSeoFromVariant(this.variants().find(v => v.locale === loc)));
                        }
                        this.cdr.markForCheck();
                    },
                    error: () => { this.seoFields.set([]); },
                });
        });
    }

    // ── Page size handlers (Layout panel) ──────────────────────────────────────
    onPageSizeChange(value: string): void {
        this.pageSizeValue.set(value);
        if (value !== 'custom') this.pageWidthValue.set(null);
        this.pageSizeDirty.set(true);
    }

    onPageWidthChange(value: string): void {
        const n = parseInt(value, 10);
        this.pageWidthValue.set(Number.isFinite(n) && n > 0 ? n : null);
        this.pageSizeDirty.set(true);
    }

    readonly activeVariant = computed(() =>
        this.variants().find(v => v.locale === this.activeTab()) ?? null,
    );

    /**
     * The page's Package node path — the target for **post-level** (locale-
     * invariant) module field sets (ADR-129, e.g. the Blog set: author /
     * publish date / categories / tags). The `<app-content-field-panels>`
     * instance bound to it renders nothing for plain pages and lights up for
     * posts in a collection that opts into a field set.
     */
    readonly postPath = computed(() => this.page()?.vfsPath ?? '');

    /**
     * The active variant's VFS file path — `{page.vfsPath}/{locale}.dtmpl` —
     * the per-variant target for the W6.3 file-history panel. Empty until a
     * page + locale are resolved (the panel is gated on it being non-empty).
     */
    readonly activeVariantPath = computed(() => {
        const vfsPath = this.page()?.vfsPath;
        const locale = this.activeTab();
        return vfsPath && locale ? `${vfsPath}/${locale}.dtmpl` : '';
    });

    /**
     * Per-variant-path write-permission cache (Track B #8). The collab
     * affordances (presence + the peer-saved banner) are edit features, so
     * they're gated on the same `canWrite` notion the revision log exposes —
     * fetched once per path via {@see FileHistoryService.log} and reused.
     */
    private readonly canWriteByPath = signal<Record<string, boolean>>({});

    /** Whether collab is active for the current variant (write permission known + true). */
    readonly collabEnabled = computed(() => {
        const path = this.activeVariantPath();
        return path ? (this.canWriteByPath()[path] ?? false) : false;
    });

    /**
     * Supported locales (from API manifest) MINUS the locales already
     * authored on this Page. Drives the "+" picker contents. When empty
     * the "+" button is hidden -- nothing left to add for this Page.
     *
     * Strict-match by code: the authored variant filenames carry the
     * exact locale code from `coolms_i18n.supported_locales`, so any
     * region-tagged variants (`en-GB`) get filtered out only when
     * authored under that exact code.
     */
    readonly availableLocales = computed(() => {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const supported = manifest?.supportedLocales ?? [];
        const authored = new Set(this.variants().map(v => v.locale));
        return supported.filter(l => !authored.has(l.code));
    });

    readonly titleValue = signal('');

    /** Editable slug ([#1618]); seeded from the page's current slug on load. */
    readonly slugInput = signal('');
    /** In-flight guard for the rename request. */
    readonly renaming = signal(false);
    /** True when the slug is frozen (the page/article has been published). */
    readonly slugLocked = computed(() => this.page()?.slugLocked === true);
    /** Rename is offered only for a real, changed, non-empty slug (and not mid-flight). */
    readonly canRename = computed(() => {
        const next = this.slugInput().trim();
        return next !== '' && next !== (this.page()?.slug ?? '') && !this.renaming();
    });

    /** The declared `seo` field-group descriptors (labels/types/widgets), fetched once. */
    readonly seoFields = signal<readonly ContentFieldDescriptorDto[]>([]);
    /** The ACTIVE locale's SEO field values (name -> value); re-seeded on tab switch. */
    private readonly seoValues = signal<Record<string, unknown>>({});

    /**
     * Per-locale meta cache: locale → { title, seo }. The live `titleValue()` +
     * `seoValues()` signals above reflect only the *active* tab and get clobbered
     * on tab switch (activateTab re-seeds them from the next locale), so without
     * this a meta edit on a non-active locale would be lost — both visually
     * (switch away and back) and on the cross-locale Save. Written on every meta
     * edit, read back by activateTab + the Save flush. Mirrors {@see contentCache}
     * for the body so the two halves of a variant stay symmetric.
     */
    private readonly metaCache = signal<Record<string, { title: string; seo: Record<string, unknown> }>>({});

    /** Per-SEO-field change callbacks, cached so a field's `valueChange` keeps a stable identity. */
    private readonly seoChangeFns = new Map<string, (value: unknown) => void>();

    /** Per-locale body content cache: locale → dtmpl storage string.
     *  Signal-backed so async cache fills propagate through the
     *  `activeContent` computed and reach the bridge's `[content]` input.
     *  A plain Map would not trigger recomputation when `.set()` runs
     *  after `activeTab` was already set, leaving the editor empty until
     *  a locale switch happens to flip activeTab onto a hot cache entry. */
    private readonly contentCache = signal<Record<string, string>>({});
    /** Tracks which locales have been loaded from the API */
    private readonly loadedLocales = new Set<string>();

    /** Content the bridge mounts with. Decoupled from `contentCache` to
     *  prevent the feedback loop where bridge emit -> cache update ->
     *  computed re-emit -> bridge re-init (cursor jump, perceived as
     *  "new editor instance" on Enter). Set only on tab switch + initial
     *  load; never updated from `onContentChange`. */
    readonly editorContent = signal('');

    /**
     * Bumped to force the `<coolms-editor>` bridge to re-mount with fresh
     * `editorContent` when the locale (its natural mount key) hasn't changed —
     * specifically after a revision restore, where the body changes underneath
     * the same active tab and a plain `[content]` update wouldn't refresh it.
     */
    private readonly editorReloadNonce = signal(0);
    readonly editorMountKey = computed(() => `${this.activeTab()}#${this.editorReloadNonce()}`);

    ngOnInit(): void {
        // #1697 — the kinds this installation offers, for the Type picker.
        // Failure leaves the list empty: the picker then shows "Default" plus
        // whatever the page already is, which is a degraded control rather
        // than a broken editor.
        this.pageSvc.listPageTypes()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: types => { this.pageTypes.set(types); this.cdr.markForCheck(); },
                error: () => this.pageTypes.set([]),
            });

        if (this.rawData.page) {
            this.page.set(this.rawData.page);
            this.slugInput.set(this.rawData.page.slug ?? '');
            this.seedLandingMode(this.rawData.page);
            this.loadVariants(this.rawData.page);
        } else if (this.rawData.node) {
            this.pageSvc.getPageByVfsPath(this.rawData.node.path)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: p => {
                        if (p) {
                            this.page.set(p);
                            this.slugInput.set(p.slug ?? '');
                            this.seedLandingMode(p);
                            this.loadVariants(p);
                        } else {
                            this.loading.set(false);
                            this.toast.error('Page not found for this VFS node');
                        }
                        this.cdr.markForCheck();
                    },
                    error: () => {
                        this.loading.set(false);
                        this.cdr.markForCheck();
                    },
                });
        } else {
            this.loading.set(false);
        }
    }

    /**
     * Seed the landing/prose canvas decision from the page's own content type,
     * known synchronously at load. This runs before the variants (and thus the
     * editor body) render, so for a landing page the prose `<coolms-editor>`
     * never mounts in the first place — no wasted TipTap init, no peer-visible
     * presence join/leave on the `editor.doc.{variantNodeId}` channel. The
     * block editor's `activeChange` remains the correction for any legacy
     * landing page whose `extras.contentType` was never stamped.
     */
    /**
     * Seed the Package-level state both load paths share: the landing canvas
     * swap and the Type picker's value.
     *
     * The picker needs its OWN signal rather than binding straight to
     * `page()`: a one-way `[ngModel]` is only rewritten when the bound value
     * CHANGES, so after a refused change the select would keep displaying the
     * value the server rejected. Writing this signal only on load and on
     * success makes the control show what is actually stored.
     */
    private seedLandingMode(page: PageDto): void {
        this.landingMode.set(page.contentType === 'landing');
        this.typeInput.set(page.contentType ?? '');
    }

    /**
     * Apply a page-type change (#1697).
     *
     * Re-seeds `landingMode` from the server's answer rather than from the
     * picked value: switching to or from `landing` swaps the whole canvas
     * (block builder vs prose editor), and that swap must follow what was
     * actually STORED — if the write is refused, the canvas must not change.
     */
    onTypeChange(next: string): void {
        const page = this.page();
        if (!page) return;

        const vfsPath = page.vfsPath;
        if (!vfsPath) {
            this.toast.error('This page has no path, so its type cannot be changed.');
            return;
        }
        if ((page.contentType ?? '') === next) return;

        this.typeSaving.set(true);
        this.pageSvc.setPageType(vfsPath, next)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: updated => {
                    this.typeSaving.set(false);
                    const merged = { ...page, contentType: updated.contentType ?? null };
                    this.page.set(merged);
                    this.seedLandingMode(merged);
                    this.toast.success('Page type changed', this.typeLabel(updated.contentType ?? ''));
                },
                error: (e: { error?: { detail?: string }; message?: string }) => {
                    this.typeSaving.set(false);
                    // Snap the picker back to what is actually stored: the user
                    // changed the select, the server refused, and leaving the
                    // rejected value on screen would misreport the page.
                    this.seedLandingMode(page);
                    this.toast.error(e.error?.detail ?? e.message ?? 'Could not change the page type.');
                },
            });
    }

    /** Human label for a type key; '' is the "no explicit kind" state. */
    private typeLabel(key: string): string {
        if ('' === key) return 'Default';

        return this.pageTypes().find(t => t.key === key)?.label ?? key;
    }

    // ── Variants ───────────────────────────────────────────────────────────────

    private loadVariants(page: PageDto): void {
        this.pageSvc.listVariants(page)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: variants => {
                    this.variants.set(variants);
                    this.loading.set(false);
                    if (variants.length > 0) {
                        this.activateTab(variants[0].locale);
                    }
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.loading.set(false);
                    this.cdr.markForCheck();
                },
            });
    }

    switchTab(locale: string): void {
        if (locale === this.activeTab()) return;
        this.activateTab(locale);
    }

    private activateTab(locale: string): void {
        // Prefer any cached (unsaved) meta edits for this locale over the
        // persisted variant — switching away and back must not drop them.
        const cachedMeta = this.metaCache()[locale];
        if (cachedMeta) {
            this.titleValue.set(cachedMeta.title);
            this.seoValues.set({ ...cachedMeta.seo });
        } else {
            const variant = this.variants().find(v => v.locale === locale);
            this.titleValue.set(variant?.title ?? '');
            this.seoValues.set(this.seedSeoFromVariant(variant));
        }
        // Set editor content BEFORE flipping activeTab so the bridge sees
        // matching mountKey + content in the same change-detection pass.
        // Cache hit -- immediate. Cache miss -- empty during async fetch,
        // then refreshed when fetch resolves (one extra remount; acceptable).
        this.editorContent.set(this.contentCache()[locale] ?? '');
        this.activeTab.set(locale);

        // Repoint live presence + peer-save watch at the now-active variant.
        this.syncCollab();

        if (this.loadedLocales.has(locale)) {
            this.cdr.markForCheck();
            return;
        }

        const p = this.page();
        if (!p) return;
        this.pageSvc.getContent(p.id, locale)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: ({ content }) => {
                    this.contentCache.update(c => ({ ...c, [locale]: content }));
                    this.loadedLocales.add(locale);
                    // Only push to the bridge if this tab is still active
                    // (user may have switched again during the round-trip).
                    if (this.activeTab() === locale) {
                        this.editorContent.set(content);
                    }
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.contentCache.update(c => ({ ...c, [locale]: '' }));
                    this.loadedLocales.add(locale);
                    this.cdr.markForCheck();
                },
            });
    }

    /** Bridge emits dtmpl-form content (via DtmplContentAdapter.toStorage). */
    onContentChange(stored: string): void {
        const locale = this.activeTab();
        if (!locale) return;
        if (this.contentCache()[locale] === stored) return;
        this.contentCache.update(c => ({ ...c, [locale]: stored }));
        this.markDirty();
    }

    // ── Dirty tracking ────────────────────────────────────────────────────────

    private markDirty(): void {
        const locale = this.activeTab();
        if (!locale) return;
        this.dirtyLocales.update(s => {
            const next = new Set(s);
            next.add(locale);
            return next;
        });
    }

    onTitleChange(value: string): void {
        this.titleValue.set(value);
        this.cacheMeta();
        this.markDirty();
    }

    /**
     * Rename the slug ([#1618]) — the URL segment / Package filename. Guarded by
     * {@link canRename}. A published (frozen) slug requires an explicit
     * confirmation because it changes the LIVE url (and, for a published
     * article, needs re-publishing to its surfaces); the confirm's `force` is
     * what unlocks the backend freeze. On success the page's path has changed,
     * so the editor closes with a truthy result and the pages-list reopens it
     * fresh at the new path — avoiding stale post-path / variant-path signals.
     */
    rename(): void {
        const page = this.page();
        if (!page || !this.canRename()) return;

        const vfsPath = page.vfsPath;
        if (!vfsPath) {
            this.toast.error('This page has no path, so its slug cannot be renamed.');
            return;
        }
        const newSlug = this.slugInput().trim();

        const run = (force: boolean): void => {
            this.renaming.set(true);
            this.pageSvc.renamePage(vfsPath, newSlug, force)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: () => {
                        this.renaming.set(false);
                        this.toast.success('Slug renamed', newSlug);
                        this.dialogRef.close(true);
                    },
                    error: (e: { error?: { detail?: string }; message?: string }) => {
                        this.renaming.set(false);
                        this.toast.error(e.error?.detail ?? e.message ?? 'Could not rename the slug.');
                    },
                });
        };

        if (this.slugLocked()) {
            this.confirmSvc.open({
                title: 'Rename a published slug?',
                message: `“${page.slug}” has been published, so its URL is frozen. Renaming it to “${newSlug}” changes the live URL — and a published article must be re-published to its surfaces afterwards. Continue?`,
                confirmLabel: 'Rename anyway',
                cancelLabel: 'Keep current slug',
                danger: true,
            }).pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe(confirmed => { if (confirmed) run(true); });
        } else {
            run(false);
        }
    }

    /** The active locale's value for a declared SEO field (null when unset). */
    seoValue(name: string): unknown {
        return this.seoValues()[name] ?? null;
    }

    /**
     * The widget kind to render a declared SEO field with: a module-contributed
     * widget by `widget.kind` when installed, else the built-in widget for the
     * field `type` (text / textarea / date). Unknown / unset falls back to text.
     */
    seoWidgetKind(field: ContentFieldDescriptorDto): string {
        const kind = field.widget?.kind ?? field.type;
        return this.fieldWidgets.componentFor(kind) ? kind : 'text';
    }

    /** A stable per-field SEO change callback (identity preserved across renders). */
    seoChangeFn(name: string): (value: unknown) => void {
        let fn = this.seoChangeFns.get(name);
        if (!fn) {
            fn = (value: unknown) => this.onSeoChange(name, value);
            this.seoChangeFns.set(name, fn);
        }
        return fn;
    }

    private onSeoChange(name: string, value: unknown): void {
        this.seoValues.update(m => ({ ...m, [name]: value === '' ? null : value }));
        this.cacheMeta();
        this.markDirty();
    }

    /** Seed the active SEO value map from a variant's raw extras, one entry per declared seo field. */
    private seedSeoFromVariant(variant: PageVariantDto | undefined): Record<string, unknown> {
        const extras = variant?.extras ?? {};
        const out: Record<string, unknown> = {};
        for (const f of this.seoFields()) {
            out[f.name] = extras[f.name] ?? null;
        }
        return out;
    }

    /**
     * Snapshot the active locale's full meta state ({@see metaCache}: `{ title,
     * seo }`) so the edit survives a tab switch and is recoverable by the
     * cross-locale Save. Writing the whole SEO map (not just the changed field)
     * keeps the cache entry a complete record of the locale's current meta state.
     */
    private cacheMeta(): void {
        const locale = this.activeTab();
        if (!locale) return;
        this.metaCache.update(m => ({
            ...m,
            [locale]: {
                title: this.titleValue(),
                seo: { ...this.seoValues() },
            },
        }));
    }

    // ── Add variant ───────────────────────────────────────────────────────────

    startAddVariant(): void {
        this.addingVariant.set(true);
        setTimeout(() => {
            const el = document.querySelector<HTMLSelectElement>('.page-editor__new-locale-input');
            el?.focus();
        });
    }

    confirmAddVariant(locale: string): void {
        // No longer .toLowerCase() -- locale codes preserve the
        // configured casing from `supportedLocales` (`en-GB`, not
        // `en-gb`) so the picker writes them through unchanged.
        locale = locale.trim();
        this.addingVariant.set(false);
        const p = this.page();
        if (!locale || !p) return;

        // Pass the loaded PageDto so createVariant skips its own getPage
        // round-trip; mirrors the listVariants polymorphic pattern.
        this.pageSvc.createVariant(p, { locale })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: variant => {
                    this.variants.update(vs => [...vs, variant]);
                    this.loadedLocales.add(locale);
                    this.contentCache.update(c => ({ ...c, [locale]: '' }));
                    this.activateTab(locale);
                    this.cdr.markForCheck();
                },
                error: () => this.toast.error('Failed to create variant'),
            });
    }

    // ── Save ──────────────────────────────────────────────────────────────────

    /**
     * Body + per-variant meta (title column + metaTitle/metaDesc extras) for a
     * *given* locale as one Observable — not just the active tab — so the single
     * Save can flush every dirty locale. Meta is sourced from the per-locale
     * {@see metaCache} (edits made while that locale was active, even after
     * switching away), falling back to the persisted variant when untouched; the
     * body comes from {@see contentCache}. Returns `null` only when page/locale
     * is missing. It does NOT touch `saving()` — the caller owns that flag so the
     * concurrent ops don't fight over it.
     */
    private variantSave$(pageId: string, locale: string): Observable<unknown> | null {
        if (!pageId || !locale) return null;

        // Meta: cached unsaved edits win; otherwise the locale's untouched values
        // come straight off the persisted variant. Title is a real Node column —
        // empty title is sent as '' so the backend clears the column back to
        // null; metaTitle/metaDesc stay in extras (per-variant SEO).
        const meta = this.metaCache()[locale] ?? this.variantMeta(locale);
        const extras: Record<string, unknown> = {};
        for (const f of this.seoFields()) {
            const v = meta.seo[f.name];
            extras[f.name] = (v === '' || v === undefined) ? null : v;
        }
        const patch: { title?: string; extras?: Record<string, unknown> } = { title: meta.title };
        if (Object.keys(extras).length > 0) patch.extras = extras;

        const metaOp = this.pageSvc.updateVariant(pageId, locale, patch)
            .pipe(tap(v => this.refreshVariant(v)));

        // Only persist the body for locales whose content actually loaded: a
        // locale can be marked dirty by a meta edit before its content GET
        // resolves, and writing '' then would wipe the stored body. Guarding on
        // loadedLocales keeps a meta-only save from clobbering the body.
        if (this.loadedLocales.has(locale)) {
            const content = this.contentCache()[locale] ?? '';
            return forkJoin([metaOp, this.pageSvc.saveContent(pageId, locale, content)]);
        }
        return metaOp;
    }

    /** The persisted (last-saved) meta state ({ title, seo }) for a locale, read off its variant. */
    private variantMeta(locale: string): { title: string; seo: Record<string, unknown> } {
        const v = this.variants().find(x => x.locale === locale);
        return {
            title: v?.title ?? '',
            seo: this.seedSeoFromVariant(v),
        };
    }

    publish(): void {
        const locale = this.activeTab();
        const p = this.page();
        if (!locale || !p || this.saving()) return;

        this.saving.set(true);
        const content = this.contentCache()[locale] ?? '';

        this.pageSvc.saveContent(p.id, locale, content)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.pageSvc.publishVariant(p.id, locale)
                        .pipe(takeUntilDestroyed(this.destroyRef))
                        .subscribe({
                            next: published => {
                                this.saving.set(false);
                                // The Content publish endpoint returns the new status
                                // snapshot only; we patch the local variant by locale
                                // so the tab status indicator stays accurate.
                                const current = this.variants().find(v => v.locale === locale);
                                if (current) {
                                    this.refreshVariant({
                                        ...current,
                                        status: published.status as PageVariantDto['status'],
                                    });
                                }
                                this.dirtyLocales.update(s => {
                                    const next = new Set(s);
                                    next.delete(locale);
                                    return next;
                                });
                                this.toast.success('Published', locale.toUpperCase());
                                this.cdr.markForCheck();
                            },
                            error: () => {
                                this.saving.set(false);
                                this.toast.error('Publish failed');
                                this.cdr.markForCheck();
                            },
                        });
                },
                error: () => {
                    this.saving.set(false);
                    this.toast.error('Save failed');
                    this.cdr.markForCheck();
                },
            });
    }

    // ── Markdown export (Track B #1) ────────────────────────────────────────────

    /**
     * Download the active locale's body as a `.md` file. Reads the **saved**
     * variant body server-side (the same hardened HTML→Markdown converter the
     * round-trip test covers) — so if the locale has unsaved edits we flag that
     * the export reflects the last save, then proceed.
     */
    exportMarkdown(): void {
        const p = this.page();
        const locale = this.activeTab();
        if (!p?.vfsPath || !locale || this.exporting()) return;

        if (this.dirtyLocales().has(locale)) {
            this.toast.info('Exporting the saved version', 'Save first to include recent edits');
        }

        this.exporting.set(true);
        this.markdownSvc.exportPage(p.vfsPath, locale)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: res => {
                    this.exporting.set(false);
                    this.markdownSvc.downloadMarkdown(res.filename, res.markdown);
                    this.toast.success('Exported', res.filename);
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.exporting.set(false);
                    this.toast.error('Export failed');
                    this.cdr.markForCheck();
                },
            });
    }

    // ── Editorial review (W6.a) ────────────────────────────────────────────────

    /** Humanize the review status for the badge ("in review", "changes requested"). */
    statusLabel(status: string): string {
        return status.split('_').join(' ');
    }

    /** Author submits the active variant for review (saves the body first). */
    submitForReview(): void {
        const locale = this.activeTab();
        const v = this.activeVariant();
        const p = this.page();
        if (!locale || !v || !p || this.saving()) return;

        this.saving.set(true);
        const content = this.contentCache()[locale] ?? '';
        this.pageSvc.saveContent(p.id, locale, content)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => this.pageSvc.submitForReview(v.id)
                    .pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe({
                        next: r => {
                            this.applyReviewResult(locale, r.status);
                            this.dirtyLocales.update(s => {
                                const next = new Set(s);
                                next.delete(locale);
                                return next;
                            });
                            this.toast.success('Submitted for review', locale.toUpperCase());
                        },
                        error: () => this.reviewError('Submit failed'),
                    }),
                error: () => this.reviewError('Save failed'),
            });
    }

    /** Reviewer approves the active variant (publishes it). */
    approveReview(): void {
        const locale = this.activeTab();
        const v = this.activeVariant();
        if (!locale || !v || this.saving()) return;

        this.saving.set(true);
        this.pageSvc.approveVariant(v.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: r => {
                    this.applyReviewResult(locale, r.status);
                    this.toast.success('Approved & published', locale.toUpperCase());
                },
                error: () => this.reviewError('Approve failed'),
            });
    }

    /** Reviewer sends the active variant back to the author with an optional note. */
    requestReviewChanges(): void {
        const locale = this.activeTab();
        const v = this.activeVariant();
        if (!locale || !v || this.saving()) return;

        const note = window.prompt('Reason for requesting changes (optional):');
        if (note === null) return; // cancelled

        this.saving.set(true);
        this.pageSvc.requestChanges(v.id, note)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: r => {
                    this.applyReviewResult(locale, r.status);
                    this.toast.success('Changes requested', locale.toUpperCase());
                },
                error: () => this.reviewError('Request failed'),
            });
    }

    private applyReviewResult(locale: string, status: string): void {
        this.saving.set(false);
        const current = this.variants().find(v => v.locale === locale);
        if (current) {
            this.refreshVariant({ ...current, status: status as PageVariantDto['status'] });
        }
        this.cdr.markForCheck();
    }

    private reviewError(message: string): void {
        this.saving.set(false);
        this.toast.error(message);
        this.cdr.markForCheck();
    }

    private refreshVariant(updated: PageVariantDto): void {
        this.variants.update(vs =>
            vs.map(v => v.locale === updated.locale ? updated : v),
        );
    }

    // ── Scheduled publish/unpublish (W6.d) ──────────────────────────────────────

    /**
     * Open the given side-rail panel, or collapse it if it's already open.
     * Opening Schedule seeds its datetime inputs from the variant and clears
     * the dirty flag (seeding is not a user edit).
     */
    toggleRail(tab: RailTab): void {
        const next = this.rail() === tab ? null : tab;
        this.rail.set(next);
        if (next === 'schedule') {
            const v = this.activeVariant();
            this.publishAtInput.set(this.isoToLocalInput(v?.publishAt));
            this.unpublishAtInput.set(this.isoToLocalInput(v?.unpublishAt));
            this.scheduleDirty.set(false);
        }
    }

    /** Human label for a rail tab — its contributed panel's title. */
    railTitle(tab: RailTab): string {
        return this.railPanels().find(p => p.id === tab)?.title ?? '';
    }

    /** A Schedule datetime field changed — record the value + mark dirty. */
    onScheduleChange(which: 'publish' | 'unpublish', value: string): void {
        if (which === 'publish') {
            this.publishAtInput.set(value);
        } else {
            this.unpublishAtInput.set(value);
        }
        this.scheduleDirty.set(true);
    }

    /**
     * Schedule publish/unpublish window as one Observable, or `null` when no
     * variant is active. Caller owns the `saving()` flag (see {@see variantSave$}).
     */
    private scheduleSave$(): Observable<unknown> | null {
        const v = this.activeVariant();
        if (!v) return null;
        const publishAt = this.localInputToIso(this.publishAtInput());
        const unpublishAt = this.localInputToIso(this.unpublishAtInput());
        return this.pageSvc.scheduleVariant(v.id, publishAt, unpublishAt).pipe(
            tap(res => this.refreshVariant({
                ...v,
                publishAt: res.publishAt ?? undefined,
                unpublishAt: res.unpublishAt ?? undefined,
            })),
        );
    }

    /**
     * The window's single Save: persists exactly the parts that changed —
     * body/meta in EVERY dirty locale (not just the active tab), schedule
     * (touched), the post Fields panel, the landing block editor and the page
     * size — so the user has one button instead of one per panel. Everything
     * runs under one `saving()` flag and reports through one toast. Flushing
     * all dirty locales keeps Save in step with the close-guard, which warns
     * about all of them.
     *
     * The ops split by the ROW they write, which decides what may overlap:
     *
     *  - `nodeOps` — the Fields panel, the landing blocks and the page size all
     *    merge-patch the page **Package** node (`p.vfsPath`), and every one of
     *    them lands in its single `extras` JSON column. The server read-modify-
     *    writes that column WHOLE, with no optimistic lock, so concurrent
     *    patches are last-writer-wins over the entire bag: whichever committed
     *    second wrote back its own stale copy of the others' keys and the toast
     *    still said "Saved". They are therefore run STRICTLY SEQUENTIAL via
     *    `concat`, each starting only once the previous has committed — the
     *    same fix [#1771] applied to the Edit Template dialog, and the reason
     *    the section-properties dialog dropped its `forkJoin`. Disjoint KEYS
     *    are not disjoint WRITES when the storage is one JSON document.
     *  - `ops` — body/meta and schedule, which target the per-locale variant
     *    nodes (`{vfsPath}/{locale}.dtmpl`), one row each. Distinct rows, so
     *    these stay parallel.
     */
    saveAll(): void {
        if (this.saving()) return;

        const p = this.page();
        /** Writers on the page Package node's one `extras` column — sequential. */
        const nodeOps: Observable<unknown>[] = [];
        /** Writers on distinct per-locale variant nodes — safe in parallel. */
        const ops: Observable<unknown>[] = [];
        const onSuccess: Array<() => void> = [];
        const savedLocales: string[] = [];

        // The Fields panel and the block editor are kept mounted (hidden) so
        // their dirty edits survive rail tab switches; `save$()` hands us their
        // write to sequence, and keeps their own dirty/saving state coherent.
        const fp = this.fieldsPanel();
        if (fp?.dirty()) {
            nodeOps.push(fp.save$());
        }
        const be = this.blockEditor();
        if (be?.dirty()) {
            nodeOps.push(be.save$());
        }

        // Flush every dirty locale — body lives in the per-locale contentCache
        // and meta in the per-locale metaCache, so each dirty locale's full
        // state is recoverable here even when it's not the active tab.
        if (p) {
            for (const locale of this.dirtyLocales()) {
                const op = this.variantSave$(p.id, locale);
                if (!op) continue;
                ops.push(op);
                savedLocales.push(locale);
                onSuccess.push(() => {
                    this.dirtyLocales.update(s => {
                        const next = new Set(s);
                        next.delete(locale);
                        return next;
                    });
                    // The variant now holds the saved meta (refreshVariant ran in
                    // the metaOp tap); drop the cache entry so activateTab reads
                    // back the single source of truth.
                    this.metaCache.update(m => {
                        const next = { ...m };
                        delete next[locale];
                        return next;
                    });
                });
            }
        }

        if (this.scheduleDirty()) {
            const s = this.scheduleSave$();
            if (s) {
                ops.push(s);
                onSuccess.push(() => this.scheduleDirty.set(false));
            }
        }

        // Page size → the Package's extras.pageSize / pageWidth (Track B Layout).
        // Same node, same column as the two panels above — hence `nodeOps`.
        if (this.pageSizeDirty() && p?.vfsPath) {
            nodeOps.push(this.pageSizeSvc.save(p.vfsPath, this.pageSizeValue() || null, this.pageWidthValue()));
            onSuccess.push(() => this.pageSizeDirty.set(false));
        }

        if (ops.length === 0 && nodeOps.length === 0) return;

        this.saving.set(true);
        // `toArray()` emits exactly once when the sequential chain completes —
        // including when `nodeOps` is empty — so the variant ops always follow.
        concat(...nodeOps)
            .pipe(
                toArray(),
                concatMap(() => ops.length > 0 ? forkJoin(ops) : of(null)),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: () => {
                    this.saving.set(false);
                    onSuccess.forEach(fn => fn());
                    const label = savedLocales.map(l => l.toUpperCase()).join(', ');
                    this.toast.success('Saved', label || undefined);
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.saving.set(false);
                    this.toast.error('Save failed');
                    this.cdr.markForCheck();
                },
            });
    }

    /** ISO-8601 → `YYYY-MM-DDTHH:mm` in the browser's local zone (input value). */
    private isoToLocalInput(iso?: string): string {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const pad = (n: number): string => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /** Local `datetime-local` value → absolute ISO-8601 (with offset), or null. */
    private localInputToIso(local: string): string | null {
        if (!local) return null;
        const d = new Date(local); // parsed in the browser's local zone
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    // ── Revision history (W6.3) ─────────────────────────────────────────────────

    /**
     * A revision was restored: the backend wrote the old body forward as the new
     * current content (non-destructive). Reload the active locale's body from
     * the server so the editor shows the restored version.
     */
    onRevisionRestored(): void {
        this.reloadActiveVariant();
    }

    /**
     * Refetch the active locale's body from the variant endpoint, remount the
     * bridge, and clear the dirty flag — the server copy is now the saved state.
     * Mirrors the cache-miss path in `activateTab`; shared by revision-restore
     * and the peer-saved reload (Track B #8).
     */
    private reloadActiveVariant(): void {
        const p = this.page();
        const locale = this.activeTab();
        if (!p || !locale) return;

        this.loadedLocales.delete(locale);
        this.pageSvc.getContent(p.id, locale)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: ({ content }) => {
                    this.contentCache.update(c => ({ ...c, [locale]: content }));
                    this.loadedLocales.add(locale);
                    this.editorContent.set(content);
                    // Force a bridge re-mount: the locale (its mount key) is
                    // unchanged, so a plain content update wouldn't refresh it.
                    this.editorReloadNonce.update(n => n + 1);
                    this.dirtyLocales.update(s => {
                        const next = new Set(s);
                        next.delete(locale);
                        return next;
                    });
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.loadedLocales.add(locale);
                    this.cdr.markForCheck();
                },
            });
    }

    // ── Collaborative presence + peer-save (Track B #8) ─────────────────────────

    /**
     * Repoint the collab service at the active variant's doc channel. Collab is
     * gated on write permission (the revision log's `canWrite`): we fetch it once
     * per variant path (cached) and only `watch` when the caller may edit; for
     * read-only viewers the channel stays closed and presence/banner never show.
     */
    private syncCollab(): void {
        const variant = this.variants().find(v => v.locale === this.activeTab());
        const path = this.activeVariantPath();
        if (!variant || !path) {
            this.collab.stop();
            return;
        }

        const known = this.canWriteByPath()[path];
        if (known !== undefined) {
            this.applyCollab(variant, known);
            return;
        }

        this.history.log(path)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: log => {
                    this.canWriteByPath.update(m => ({ ...m, [path]: log.canWrite }));
                    // Only act if this variant is still the active one.
                    if (this.activeTab() === variant.locale) {
                        this.applyCollab(variant, log.canWrite);
                    }
                    this.cdr.markForCheck();
                },
                error: () => this.collab.stop(),
            });
    }

    private applyCollab(variant: PageVariantDto, canWrite: boolean): void {
        if (canWrite) {
            this.collab.watch(variant.id);
        } else {
            this.collab.stop();
        }
    }

    /** Banner action: discard the local view and reload the peer's saved body. */
    reloadFromPeerSave(): void {
        this.collab.acknowledgeSaved();
        this.reloadActiveVariant();
    }

    // ── Close ─────────────────────────────────────────────────────────────────

    tryClose(): void {
        const dirtyLocales = Array.from(this.dirtyLocales());
        // Mirror the footer Save's notion of "dirty": besides per-locale
        // body/meta edits, the Schedule fields and the (now-persistent) Fields
        // panel can hold unsaved work even when their rail tab is closed — so
        // closing while only those changed must still warn, not exit silently.
        const otherDirty = this.scheduleDirty() || (this.fieldsPanel()?.dirty() ?? false);
        if (dirtyLocales.length === 0 && !otherDirty) {
            this.dialogRef.close(true);
            return;
        }
        const message = dirtyLocales.length > 0
            ? `You have unsaved changes in: ${dirtyLocales.join(', ').toUpperCase()}. Close anyway?`
            : 'You have unsaved changes. Close anyway?';
        this.confirmSvc.open({
            title: 'Unsaved changes',
            message,
            confirmLabel: 'Close anyway',
            danger: true,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
            if (confirmed) this.dialogRef.close(true);
        });
    }
}
