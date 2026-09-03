import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CmsRightPanelComponent } from '@coolms/ui-angular';
import { PageSpaceStateService } from './page-space-state.service';
import { PagePlacementDto, PageVariantSummaryDto } from './page.types';

/**
 * Properties panel for the Pages explorer.
 *
 * Pages was the only one of the three explorers with no `content.panel.right`,
 * so everything a page IS beyond its name — where it lives, what renders it,
 * which locales exist and which of them is live, where it is distributed — was
 * reachable only by opening the editor. That is a round trip through a full
 * page load to answer "is this published?".
 *
 * READ-ONLY on purpose. Editing belongs to the editor, and a second surface
 * that writes the same fields would be a second place for the slug-freeze and
 * review rules to be enforced (or forgotten). The one action here is the one
 * this panel cannot answer for you: open the editor.
 *
 * Everything shown comes from the `PageDto` the listing already loaded — the
 * panel issues no request of its own, so selecting a row costs nothing.
 */
@Component({
    selector: 'app-page-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsRightPanelComponent, DatePipe],
    template: `
        <cms-right-panel
            defaultIcon="file-earmark-text"
            [defaultTitle]="page()?.slug ?? 'Page'"
            (closed)="onClose()"
        >
            @if (page(); as p) {
                <!-- EVERYTHING lives inside one padded wrapper. This is what
                     was actually wrong: cms-right-panel__body sets no padding —
                     each consumer pads its own content, the way
                     cms-instance-detail does — so the panel's text sat flush
                     against the border on both sides. It read as a spacing
                     problem, which it was; restyling the type was solving the
                     wrong thing. -->
                <div class="pd">
                    @if (p.ogImage) {
                        <!-- The share image, at the aspect it was authored for.
                             Decorative: the slug is in the panel header. -->
                        <div class="pd__cover">
                            <img [src]="p.ogImage" alt="" loading="lazy" (error)="onImageError($event)" />
                        </div>
                    }

                    <dl class="pd__list">
                        <dt>Slug</dt>
                        <dd>
                            {{ p.slug }}
                            @if (p.slugLocked) {
                                <!-- The freeze belongs ON the slug: it is a
                                     property OF this value, not a field of its
                                     own. -->
                                <span class="pd__warn" [title]="FROZEN_HINT">
                                    <i class="bi bi-lock-fill"></i> frozen
                                </span>
                            }
                        </dd>

                        <dt>Path</dt>
                        <dd class="pd__mono">{{ p.vfsPath ?? '—' }}</dd>

                        <!-- The URL IS the filename. Worth stating
                             outright: it is what makes the .html suffix
                             meaningful, and this is where someone checks it
                             before renaming. -->
                        <dt>Public URL</dt>
                        <dd class="pd__mono">{{ publicUrl() ?? '—' }}</dd>

                        <dt>Type</dt>
                        <dd>
                            @if (p.contentType) {
                                {{ typeLabel(p.contentType) }}
                            } @else {
                                <span class="pd__muted">Default page template</span>
                            }
                        </dd>

                        @if (p.sectionSlug) {
                            <dt>Section</dt>
                            <dd>{{ p.sectionSlug }}</dd>
                        }

                        <dt>Created</dt>
                        <dd>{{ p.createdAt | date:'medium' }}</dd>
                    </dl>

                    @if (p.slugLocked) {
                        <p class="pd__warn pd__warn--block">{{ FROZEN_HINT }}</p>
                    }

                    <!-- LIFECYCLE: which locale is live. Deliberately separate
                         from placement below — publishing a variant and placing
                         a page are two verbs, and collapsing them into
                         one "status" is what made Articles confusing. -->
                    <section class="pd__section">
                        <h4 class="pd__heading">Variants</h4>
                        @if (p.variants.length) {
                            <ul class="pd__variants">
                                @for (v of p.variants; track v.locale) {
                                    <li class="pd__variant" [class.pd__variant--unserved]="false === v.served">
                                        <span class="pd__locale">{{ v.locale }}</span>
                                        <span class="pd__status"
                                              [class.pd__status--published]="'published' === v.status"
                                              [class.pd__status--review]="isInReview(v)">
                                            {{ statusLabel(v) }}
                                        </span>
                                        @if (false === v.served) {
                                            <!-- Marked, never hidden. The
                                                 translation is intact and this
                                                 site is not publishing its
                                                 language; turning the language
                                                 back on brings it back with
                                                 nothing lost. Saying that is
                                                 the whole point of showing the
                                                 row at all. -->
                                            <span class="pd__unserved"
                                                  title="This site does not publish in this language. The translation is kept and will be served again if the language is turned back on.">
                                                not published on this site
                                            </span>
                                        }
                                        @if (v.title) {
                                            <span class="pd__variant-title">{{ v.title }}</span>
                                        }
                                    </li>
                                }
                            </ul>
                        } @else {
                            <p class="pd__muted">No variants yet — this page has no content in any locale.</p>
                        }
                    </section>

                    <!-- DISTRIBUTION: where it appears besides its own URL. -->
                    <section class="pd__section">
                        <h4 class="pd__heading">Placed on</h4>
                        @if (placements().length) {
                            <ul class="pd__places">
                                @for (pl of placements(); track pl.linkPath) {
                                    <li class="pd__place">
                                        <span class="pd__place-surface">
                                            <i class="bi bi-box-arrow-up-right"></i>
                                            {{ pl.siteSlug }} / {{ pl.surfaceKey }}
                                        </span>
                                        <span class="pd__mono pd__place-path">{{ pl.linkPath }}</span>
                                    </li>
                                }
                            </ul>
                        } @else {
                            <p class="pd__muted">
                                Nowhere — reachable only at its own URL. Use
                                <strong>Place</strong> in the toolbar to add it to a surface.
                            </p>
                        }
                    </section>

                    <div class="pd__actions">
                        <button type="button" class="cms-btn cms-btn-primary cms-btn-sm" (click)="onEdit()">
                            <i class="bi bi-pencil"></i>
                            <span>Open editor</span>
                        </button>
                        <!-- — the panel is read-only, so the one thing
                             it can offer for the metadata it does NOT show is
                             the door to where that is authored. -->
                        <button type="button" class="cms-btn cms-btn-sm" (click)="onMetadata()">
                            <i class="bi bi-tags"></i>
                            <span>Metadata</span>
                        </button>
                    </div>
                </div>
            } @else {
                <div class="pd__empty">
                    <p>Select a page to see its properties.</p>
                </div>
            }
        </cms-right-panel>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

        /* THE fix: the panel body has no padding of its own, so every consumer
           supplies it (cms-instance-detail does the same). Without this the
           text sat hard against both borders. */
        .pd {
            padding: var(--cms-panel-padding);
            display: flex;
            flex-direction: column;
            gap: var(--cms-panel-padding);
        }

        .pd__cover {
            aspect-ratio: 16 / 9;
            background: var(--cms-border-light);
            border-radius: var(--cms-radius);
            overflow: hidden;
        }
        .pd__cover img { width: 100%; height: 100%; object-fit: cover; display: block; }

        /* Label above value, one field per block. Kept from the first version
           (it reads better in a 340px column than a two-column grid, which
           wraps every path onto its own line anyway) — what it was missing was
           the padding above, not a different type scale. */
        .pd__list {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 10px;
            margin: 0;
        }
        .pd__list dt {
            font-size: .6875rem;
            text-transform: uppercase;
            letter-spacing: .04em;
            color: var(--cms-text-muted);
            margin-bottom: 2px;
        }
        .pd__list dd {
            margin: 0;
            font-size: .8125rem;
            color: var(--cms-text);
            word-break: break-word;
        }
        .pd__mono {
            font-family: var(--cms-font-mono, ui-monospace, SFMono-Regular, monospace);
            font-size: .75rem;
            word-break: break-all;
        }
        .pd__muted { color: var(--cms-text-muted); font-size: .8125rem; }
        .pd__warn { color: var(--cms-warning, #d97706); font-size: .78rem; }
        .pd__warn--block { margin: 0; line-height: 1.4; }

        .pd__section { display: flex; flex-direction: column; gap: 6px; }
        .pd__heading {
            font-size: .6875rem;
            text-transform: uppercase;
            letter-spacing: .04em;
            color: var(--cms-text-muted);
            margin: 0;
        }

        .pd__variants, .pd__places { list-style: none; margin: 0; padding: 0; }
        .pd__variant {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 0;
            border-bottom: 1px solid var(--cms-border-light);
            font-size: .8125rem;
        }
        .pd__variant:last-child { border-bottom: 0; }
        .pd__locale {
            text-transform: uppercase;
            font-weight: 600;
            font-size: .6875rem;
            letter-spacing: .02em;
            min-width: 24px;
        }
        .pd__status {
            font-size: .6875rem;
            padding: 1px 6px;
            border-radius: var(--cms-radius-sm);
            border: 1px solid var(--cms-border);
            color: var(--cms-text-secondary);
        }
        /* Published is the only status worth colour: it answers "is this
           live?", the question the panel exists to answer at a glance. */
        .pd__status--published { border-color: var(--cms-success, #16a34a); color: var(--cms-success, #16a34a); }
        .pd__status--review { border-color: var(--cms-warning, #d97706); color: var(--cms-warning, #d97706); }
        .pd__variant--unserved .pd__locale { opacity: .6; }

        .pd__unserved {
            font-size: .75rem;
            padding: 1px 6px;
            border-radius: var(--cms-radius-sm);
            border: 1px solid var(--cms-border);
            color: var(--cms-text-muted);
            /* Was --cms-surface-2, which the theme deliberately leaves
               undefined -- so this chip had no fill at all in either theme.
               --cms-surface-muted is the role every "muted surface" synonym
               in styles.scss already aliases to. */
            background: var(--cms-surface-muted);
        }

        .pd__variant-title {
            color: var(--cms-text-muted);
            font-size: .75rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .pd__place {
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 6px 0;
            border-bottom: 1px solid var(--cms-border-light);
            font-size: .8125rem;
        }
        .pd__place:last-child { border-bottom: 0; }
        .pd__place-surface i { color: var(--cms-accent); margin-right: 4px; }
        .pd__place-path { color: var(--cms-text-muted); }

        .pd__actions { display: flex; gap: 8px; }
        .pd__empty { padding: 2rem; text-align: center; color: var(--cms-text-muted); }
    `],
})
export class PageDetailComponent {
    /**
     * Why a frozen slug matters, stated once and used twice — as the hover on
     * the inline badge and as the sentence below the list.
     */
    protected readonly FROZEN_HINT =
        'Frozen — this page has been published, so renaming it changes a live URL.';

    private readonly state = inject(PageSpaceStateService);

    protected readonly page = this.state.selectedPage;

    /** Never null in the template's `@for`, so callers do not need the guard. */
    protected readonly placements = computed<readonly PagePlacementDto[]>(
        () => this.page()?.placements ?? [],
    );

    /**
     * Configured page kinds, for the label.
     *
     * Read from shared state rather than fetched: the listing already loads
     * the catalogue, and a panel that refetched it would put a request behind
     * every row click for data that cannot change between them.
     */
    protected readonly pageTypes = this.state.pageTypes;

    /**
     * The URL this page is served at.
     *
     * Derived by stripping the space's content root from the VFS path — the
     * URL MIRRORS the filename, extension and all, so there is nothing
     * to compute beyond the prefix. Null for a personal-space page, which has
     * no site root and therefore no public URL at all until it is placed.
     */
    protected readonly publicUrl = computed<string | null>(() => {
        const path = this.page()?.vfsPath;
        if (null === path || undefined === path) {
            return null;
        }
        const match = /^\/content\/[^/]+(\/.*)$/.exec(path);

        return null === match ? null : match[1];
    });

    protected typeLabel(key: string): string {
        return this.pageTypes().find(t => t.key === key)?.label ?? key;
    }

    protected isInReview(v: PageVariantSummaryDto): boolean {
        return 'in_review' === v.status || 'changes_requested' === v.status;
    }

    protected statusLabel(v: PageVariantSummaryDto): string {
        return v.status.replace(/_/g, ' ');
    }

    /**
     * A stored `ogImage` can 404 — the media behind it may be gone, or the
     * value may be an absolute URL from another environment. Hide the broken
     * image and let the panel read as though the page has none.
     */
    protected onImageError(event: Event): void {
        (event.target as HTMLImageElement).style.display = 'none';
    }

    /**
     * Closing closes the PANEL and leaves the selection alone.
     *
     * The layout gates the panel on `activeItem`, so the naive version —
     * clearing the selection — made the close button deselect behind the
     * user's back: the row stayed highlighted in the grid while the toolbar's
     * row actions vanished. The host reports `activeItem` as null while this
     * flag is down instead, which is the same shape Documents uses.
     */
    protected onClose(): void {
        this.state.panelOpen.set(false);
    }

    /**
     * The one write this panel offers: hand off to the editor.
     *
     * Routed through the SAME action channel the toolbar uses rather than
     * opening the editor here — the listing owns that navigation, and a second
     * caller would be a second place for the landing-vs-prose decision to be
     * made.
     */
    protected onEdit(): void {
        this.state.actionRequested$.next('edit');
    }

    /** Same channel, same reason: the listing owns the dialog. */
    protected onMetadata(): void {
        this.state.actionRequested$.next('metadata');
    }
}
