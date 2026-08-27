import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import {
    ExplorerLayoutComponent,
    ExplorerViewMode,
    ExplorerViewSwitcherComponent,
    PageFooterService,
    PageToolbarComponent,
    type ToolbarAction,
} from '@coolms/ui-angular';
import { PageSpaceStateService } from './page-space-state.service';

/**
 * Pages explorer — thin shell (ADR-153, #1693).
 *
 * Owns nothing but the page-scoped state and the toolbar; the space accordion
 * and the tree grid are slot components resolved from the `content:pages-list`
 * layout, exactly as Documents, Media and Articles do it.
 *
 * Replaces the old routed `PagesListComponent`, which carried its own
 * `<cms-list-page>` shell. That shell had no left panel, which is why Pages
 * could not offer spaces — the change here is the shell, not the grid.
 *
 * `PageFooterService` is provided here because it is non-root: without it
 * `ExplorerLayoutComponent`'s footer cannot resolve its dependency and the
 * route fails to mount with a NullInjectorError. `PageSpaceStateService` is
 * provided here too, so two Pages tabs do not share a selected space.
 */
@Component({
    selector: 'app-pages-explorer-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [PageSpaceStateService, PageFooterService],
    imports: [ExplorerLayoutComponent, ExplorerViewSwitcherComponent, PageToolbarComponent],
    template: `
        <!-- #1696 — the header actions are bound to the LAYOUT, not to a
             projected cms-page-header.

             ExplorerLayout renders its own header whenever the layout YAML
             carries a title, and only falls back to the projected
             [explorer-header] when it does not. content:pages-list DOES declare
             one, so the projected header this page used to pass was never in
             the DOM — and "New Page" / "New Collection" (both position: header)
             had nowhere to render. Creating a page from the Pages explorer was
             impossible from #1693 until now. Documents gets away with the
             projected form only because document:library declares no title. -->
        <app-explorer-layout
            #layout
            layoutId="content:pages-list"
            [context]="pageContext()"
            [headerActions]="headerActions()"
            (headerActionClick)="onAction($event)"
            (backgroundClick)="state.selectedPage.set(null)"
        >
            <app-page-toolbar
                treeSlug="navi.toolbar.content.pages"
                [context]="toolbarContext()"
                (actionClick)="onAction($event)"
                (headerActionsChanged)="headerActions.set($event)"
            >
                <!-- #1709 — the view switcher comes from the LAYOUT's declared
                     modes, not from NaviGraph actions. It used to be two
                     view-grid / view-list toolbar nodes seeded per module,
                     which is why every explorer had a different set. -->
                <app-explorer-view-switcher
                    toolbar-right-extra
                    [modes]="layout.viewModes()"
                    [active]="viewMode()"
                    (modeChange)="onViewMode($event)"
                />
            </app-page-toolbar>
        </app-explorer-layout>
    `,
    // Mirrors the other explorer hosts. Without these the page host collapses
    // to its content-intrinsic height instead of filling the admin shell, so
    // ExplorerLayout's flex chain cannot pin the footer to the bottom.
    // `min-height: 0` is load-bearing — without it the inner overflow:hidden
    // wrappers leak past their parent and the whole page scrolls instead of
    // its inner panes.
    styles: [`:host { display: flex; flex-direction: column; flex: 1; min-height: 0; }`],
})
export class PagesExplorerPage {
    /**
     * Not private — the template binds `backgroundClick` straight to it, the
     * way Media and Documents do. A wrapper method would be a name for
     * "set this signal to null".
     */
    readonly state = inject(PageSpaceStateService);

    /**
     * Layout predicate context (#1711). `activeItem` is what `openOnSelect`
     * gates the right panel on — the layout has no other way to know whether
     * anything is selected, because the selection belongs to a slot it merely
     * renders.
     */
    readonly pageContext = computed((): Record<string, unknown> => ({
        activeItem: this.state.panelOpen() ? this.state.selectedPage() : null,
    }));

    /**
     * The layout, for the view modes it parsed out of the YAML (#1709).
     *
     * A SIGNAL query, not `@ViewChild`: the layout resolves its config
     * asynchronously, so the effect below has to re-run when `defaultViewMode`
     * lands. A static field would be read once, before the fetch returned.
     */
    private readonly layout = viewChild(ExplorerLayoutComponent);

    readonly headerActions = signal<ToolbarAction[]>([]);

    /** Current rendering — shared state, so the sibling slot obeys it. */
    readonly viewMode = this.state.viewMode;

    /** Whether the layout's declared default has already been taken. */
    private adopted = false;

    constructor() {
        // Adopt the layout's declared default once the config resolves. The
        // service seeds a literal for the frames before that lands; without
        // this, changing `defaultViewMode` in YAML would have no effect.
        //
        // Once only — after the user has touched the switcher, a later config
        // emission must not yank the pane back to the default under them.
        effect(() => {
            const declared = this.layout()?.defaultViewMode() ?? null;
            if (null === declared || this.adopted) {
                return;
            }
            this.adopted = true;
            untracked(() => this.state.viewMode.set(declared));
        });
    }

    onViewMode(mode: ExplorerViewMode): void {
        this.state.viewMode.set(mode);
    }

    /**
     * Toolbar predicate context. `_selected` comes from shared state rather
     * than from this component: the grid that owns the selection is a sibling
     * slot, invisible from here.
     *
     * `_viewMode` is still published even though no NaviGraph node reads it
     * since #1709 removed the view toggle from the tree — a module that wants
     * an action only in one rendering (say, "arrange" in tiles) can predicate
     * on it without the host having to grow a new context key.
     */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.state.hasSelection(),
        _viewMode: this.state.viewMode(),
    }));

    /**
     * Forward toolbar/header actions to the grid, which is what can actually
     * perform them.
     *
     * The view toggle used to be intercepted here as two NaviGraph actions
     * (`view-grid` / `view-list`). It is now the shared switcher fed by the
     * layout's declared modes (#1709), so this handler is pure forwarding.
     */
    onAction(action: string): void {
        this.state.actionRequested$.next(action);
    }
}
