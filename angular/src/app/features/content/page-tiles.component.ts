import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import {
    CmsItemInteractionsDirective,
    ExplorerViewMode,
    type CmsSelectionChange,
} from '@coolms/ui-angular';
import { PageDto, PageTypeDto, PageVariantSummaryDto } from './page.types';

/**
 * Tile view of one folder in the Pages explorer (ADR-153, #1694).
 *
 * The reason this component exists at all: the DataGrid is a TABLE. It renders
 * cells, and `ogImage` is not a cell — the whole point of a share image is that
 * you recognise the page by it while arranging a site. So the tile view is a
 * second rendering of the same rows, not a styling option on the first.
 *
 * Deliberately dumb. It owns no data, no selection state and no navigation:
 * `PagesListComponent` loads the folder, holds the selection and decides what a
 * double-click means. That keeps ONE owner for those facts across both views —
 * the alternative (tiles fetching their own page) would have the table and the
 * tiles disagreeing about which folder you are in the moment either reloads.
 *
 * Interaction parity with Media/Documents comes from
 * {@see CmsItemInteractionsDirective} rather than hand-rolled click handlers,
 * so single-click-selects / double-click-opens behave identically here.
 */
@Component({
    selector: 'app-page-tiles',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsItemInteractionsDirective],
    template: `
        @if (items().length === 0) {
            <div class="page-tiles__empty">
                <i class="bi bi-file-earmark-text"></i>
                <p>Nothing here yet.</p>
                <p class="page-tiles__empty-hint">
                    Use <strong>New Page</strong> or <strong>New Collection</strong> to add content.
                </p>
            </div>
        } @else {
            <div class="page-tiles" [class]="'page-tiles--' + layout()">
                @for (item of items(); track item.id) {
                    <div class="page-tile"
                         [class.page-tile--selected]="item.id === selectedId()"
                         [class.page-tile--folder]="isFolder(item)"
                         [attr.data-selectable]="''"
                         [title]="item.vfsPath ?? item.slug"
                         cmsItemInteractions
                         [cmsItem]="item"
                         [currentSelection]="currentSelection()"
                         (selectionChanged)="onSelectionChanged($event)"
                         (activated)="activate.emit($event)">

                        <div class="page-tile__cover">
                            @if (isFolder(item)) {
                                <i class="bi bi-folder-fill page-tile__glyph"></i>
                            } @else if (item.ogImage) {
                                <!-- Decorative: the tile's accessible name is the
                                     slug rendered right below it, so alt="" keeps
                                     a screen reader from reading the page twice. -->
                                <img class="page-tile__img"
                                     [src]="item.ogImage"
                                     alt=""
                                     loading="lazy"
                                     (error)="onImageError($event)" />
                            } @else {
                                <i class="bi bi-file-earmark-text page-tile__glyph
                                          page-tile__glyph--placeholder"></i>
                            }
                        </div>

                        <div class="page-tile__body">
                            <div class="page-tile__name">{{ item.slug }}</div>
                            @if (layout() === 'content') {
                                <!-- The wide row is the mode that has ROOM for
                                     the thing every other mode has to drop: the
                                     page's actual location, which is what tells
                                     two same-named pages apart. -->
                                <div class="page-tile__path">{{ item.vfsPath }}</div>
                            }
                            @if (isFolder(item)) {
                                <div class="page-tile__meta">Folder</div>
                            } @else if (item.contentType) {
                                <!-- #1696 — the kind is only meaningful if you can
                                     see it afterwards; a picker whose result is
                                     invisible is a picker nobody trusts. -->
                                <div class="page-tile__meta page-tile__meta--type">
                                    {{ typeLabel(item.contentType) }}
                                </div>
                            }
                            @if (!isFolder(item) && item.variants.length) {
                                <div class="page-tile__variants">
                                    @for (variant of item.variants; track variant.locale) {
                                        <span class="page-tile__chip"
                                              [class.page-tile__chip--published]="isPublished(variant)"
                                              [class.page-tile__chip--review]="isInReview(variant)"
                                              [title]="variant.locale + ' — ' + statusLabel(variant)">
                                            {{ variant.locale }}
                                        </span>
                                    }
                                </div>
                            } @else if (!isFolder(item)) {
                                <div class="page-tile__meta">No variants</div>
                            }

                            @if (item.placements?.length) {
                                <!-- #1698 — WHERE the page appears, which is a
                                     different fact from which locale is live.
                                     Shown because placement is derived from
                                     links: nothing else on the row would reveal
                                     that this page is on a site's blog. -->
                                <div class="page-tile__places"
                                     [title]="placementTitle(item)">
                                    <i class="bi bi-box-arrow-up-right"></i>
                                    {{ placementSummary(item) }}
                                </div>
                            }
                        </div>
                    </div>
                }
            </div>
        }
    `,
    styles: [`
        :host { display: block; }

        .page-tiles {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: var(--cms-panel-padding);
            padding: var(--cms-content-padding);
        }

        /* The three non-table renderings (#1709) are ONE tile under three
           layouts, not three components: they differ in how much room each
           item gets and therefore how much detail survives, which is a
           dimension question. Splitting them would have triplicated the
           selection, activation and image-fallback wiring above. */

        /* Small — scan many at once. Half the width, and the detail lines go:
           at this size they would wrap to two lines each and the tile would be
           taller than the large one it is supposed to compact. */
        .page-tiles--small { grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; }
        .page-tiles--small .page-tile__glyph { font-size: 1.5rem; }
        .page-tiles--small .page-tile__body { padding: 5px 7px; }
        .page-tiles--small .page-tile__name { font-size: .75rem; }
        .page-tiles--small .page-tile__meta,
        .page-tiles--small .page-tile__variants,
        .page-tiles--small .page-tile__places { display: none; }

        /* Content — one wide row per item: thumbnail, name, path, everything
           else inline. A single column, so the row can be as wide as the pane. */
        .page-tiles--content { grid-template-columns: 1fr; gap: 6px; }
        .page-tiles--content .page-tile { flex-direction: row; align-items: stretch; }
        .page-tiles--content .page-tile__cover { flex: 0 0 96px; width: 96px; aspect-ratio: auto; }
        .page-tiles--content .page-tile__glyph { font-size: 1.5rem; }
        .page-tiles--content .page-tile__body {
            flex: 1 1 auto;
            justify-content: center;
            padding: 8px 12px;
        }
        .page-tiles--content .page-tile__name { font-size: .875rem; }

        .page-tile {
            display: flex;
            flex-direction: column;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            background: var(--cms-surface);
            overflow: hidden;
            cursor: pointer;
            transition: border-color .1s, box-shadow .1s;
        }
        .page-tile:hover {
            border-color: var(--cms-text-muted);
            box-shadow: var(--cms-shadow-sm);
        }
        .page-tile--selected {
            border-color: var(--cms-accent);
            box-shadow: var(--cms-shadow-md);
        }

        /* Fixed 16:9 box so a wall of tiles stays on a grid regardless of the
           share images' own aspect ratios — an og:image is 1200x630 by
           convention but nothing enforces it, and one portrait upload would
           otherwise push its whole row out of alignment. */
        .page-tile__cover {
            position: relative;
            aspect-ratio: 16 / 9;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--cms-border-light);
            overflow: hidden;
        }
        .page-tile__img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        .page-tile__glyph {
            font-size: 2.25rem;
            color: var(--cms-text-secondary);
        }
        .page-tile__glyph--placeholder { color: var(--cms-text-muted); opacity: .6; }
        .page-tile--folder .page-tile__glyph { color: var(--cms-accent); }

        .page-tile__body {
            padding: 8px 10px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }
        .page-tile__name {
            font-size: .8125rem;
            font-weight: 500;
            color: var(--cms-text);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .page-tile__meta {
            font-size: .75rem;
            color: var(--cms-text-muted);
        }
        .page-tile__path {
            font-size: .7rem;
            color: var(--cms-text-muted);
            font-family: var(--cms-font-mono, ui-monospace, monospace);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        /* The kind reads as a property of the page, not as chrome — slightly
           stronger than the muted meta line it shares a slot with. */
        .page-tile__meta--type {
            color: var(--cms-text-secondary);
            font-weight: 500;
        }
        /* Placement reads as an outward fact — the accent marks "this is out
           there", distinct from the neutral type line above it. */
        .page-tile__places {
            font-size: .7rem;
            color: var(--cms-accent-text, var(--cms-text-secondary));
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .page-tile__variants { display: flex; flex-wrap: wrap; gap: 3px; }
        .page-tile__chip {
            font-size: .6875rem;
            line-height: 1.4;
            padding: 0 5px;
            border-radius: var(--cms-radius-sm);
            border: 1px solid var(--cms-border);
            color: var(--cms-text-secondary);
            background: var(--cms-surface-alt, transparent);
            text-transform: uppercase;
            letter-spacing: .02em;
        }
        /* Published is the only status worth colour: it answers "is this live?",
           which is the question you actually ask while looking at a site tree.
           The rest stay neutral so the published ones read at a glance. */
        .page-tile__chip--published {
            border-color: var(--cms-success, #198754);
            color: var(--cms-success, #198754);
        }
        .page-tile__chip--review {
            border-color: var(--cms-warning, #b8860b);
            color: var(--cms-warning, #b8860b);
        }

        .page-tiles__empty {
            padding: 2rem;
            text-align: center;
            color: var(--cms-text-muted);
        }
        .page-tiles__empty i { font-size: 2rem; display: block; margin-bottom: .5rem; }
        .page-tiles__empty-hint { font-size: .85rem; }
    `],
})
export class PageTilesComponent {
    readonly items = input.required<readonly PageDto[]>();

    /** Id of the selected row, shared with the table view so switching keeps it. */
    readonly selectedId = input<string | null>(null);

    /**
     * Which of the three non-table renderings to draw (#1709).
     *
     * `details` never reaches here — that mode is the DataGrid, and the host
     * swaps components rather than passing it down. The input is typed as the
     * full {@link ExplorerViewMode} anyway so the host can forward its state
     * signal without narrowing it at every call site; an unexpected value just
     * lands on the unmodified `large` styling.
     */
    readonly layout = input<ExplorerViewMode>('large');

    /**
     * Configured page kinds, passed in rather than fetched here (#1696).
     *
     * The tile only needs `key → label`, and the list already travels with the
     * page load; fetching it again from a presentational component would put a
     * second request behind every view toggle for data that cannot change
     * between them.
     */
    readonly pageTypes = input<readonly PageTypeDto[]>([]);

    /**
     * Single click (after the dblclick window) — null when nothing is selected.
     * Named after Media's `selectionChange` rather than `select`, which would
     * shadow the native DOM event.
     */
    readonly selectionChange = output<PageDto | null>();

    /** Double click: the host decides (enter a folder / open a page). */
    readonly activate = output<PageDto>();

    protected isFolder(item: PageDto): boolean {
        return 'directory' === item.nodeType;
    }

    /**
     * The directive compares selection by reference, so hand it the instance
     * out of `items()` rather than rebuilding one from the id.
     */
    protected readonly currentSelection = computed<readonly PageDto[]>(() => {
        const id = this.selectedId();
        if (null === id) {
            return [];
        }

        return this.items().filter((item) => item.id === id);
    });

    protected onSelectionChanged(event: CmsSelectionChange<PageDto>): void {
        this.selectionChange.emit(event.selection[0] ?? null);
    }

    /**
     * A stored `ogImage` can 404 — the media behind it may have been deleted,
     * or the value may be an absolute URL from another environment. Hide the
     * broken image and let the tile's placeholder background stand, rather
     * than leaving the browser's broken-image glyph in a wall of tiles.
     */
    protected onImageError(event: Event): void {
        (event.target as HTMLImageElement).style.display = 'none';
    }

    /**
     * Human label for a stored `contentType`.
     *
     * Falls back to the raw key when the catalogue no longer offers it — a
     * page keeps the type it was created with even if config drops the kind,
     * and showing the key beats showing nothing (it is the thing an operator
     * would search the config for).
     */
    protected typeLabel(key: string): string {
        return this.pageTypes().find(t => t.key === key)?.label ?? key;
    }

    /** Surface keys this page appears on, e.g. `blog, news`. */
    protected placementSummary(item: PageDto): string {
        return (item.placements ?? []).map(p => p.surfaceKey).join(', ');
    }

    /** The full site/surface pairs, for the hover — the summary drops the site. */
    protected placementTitle(item: PageDto): string {
        return (item.placements ?? [])
            .map(p => `${p.siteSlug} / ${p.surfaceKey}`)
            .join('\n');
    }

    protected isPublished(variant: PageVariantSummaryDto): boolean {
        return 'published' === variant.status;
    }

    protected isInReview(variant: PageVariantSummaryDto): boolean {
        return 'in_review' === variant.status || 'changes_requested' === variant.status;
    }

    protected statusLabel(variant: PageVariantSummaryDto): string {
        return variant.status.replace(/_/g, ' ');
    }
}
