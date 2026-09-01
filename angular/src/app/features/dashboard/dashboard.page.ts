import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CdkDrag, CdkDropList, moveItemInArray, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { AppConfigState, CmsLoaderComponent, ConfigService, NaviGraphService, type LayoutConfig, type NaviGraphNode } from '@coolms/core-angular';
import { CmsListPageComponent, LayoutActionsService, TabStripComponent, type TabStripItem, type ToolbarAction } from '@coolms/ui-angular';
import { WidgetPickerDialogComponent } from './widget-picker.dialog';

/** One catalogue entry, as `GET /dashboard/widgets` returns it. */
interface DashboardWidget {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly endpoint: string;
    readonly valuePath: string;
    // Optional on the wire, not nullable: API-Platform omits a null property
    // entirely, so these keys are ABSENT rather than null. Typing them as
    // `| null` was what let the bug in `read()` past the compiler.
    readonly displayPath?: string;
    readonly kind: string;
    /**
     * TWELFTHS of the dashboard grid, 1-12 — the one field here that must be
     * interpreted rather than displayed. The backend's `DashboardWidget::
     * COLUMNS_MAX` is the whole contract: render a different number of columns
     * and every card comes out the wrong width.
     */
    readonly columns: number;
    readonly group?: string;
    /** Hidden by the saved layout: keeps its position, is not drawn. */
    readonly hidden?: boolean;
    /** What the LAYOUT said about the width — absent when it said nothing. */
    readonly explicitColumns?: number;
}

/** A card, once its endpoint has answered and the layout has placed it. */
interface Card {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    /** Kept so a card that gets SHOWN again can fetch the value it skipped. */
    readonly endpoint: string;
    readonly valuePath: string;
    readonly displayPath?: string;
    readonly group?: string;
    display: string | null;
    failed: boolean;
    /** The width in force — what gets drawn. */
    columns: number;
    /**
     * What the layout STATED, or null when it stated nothing.
     *
     *  Not the same as `columns`, and conflating them is a one-way door: a
     * save re-submits every card, so sending the effective width for a card
     * nobody touched would freeze the module's own default into the layout
     * forever. Only a deliberate resize sets this.
     */
    explicitColumns: number | null;
    hidden: boolean;
}

/** The grid's gutter, in px. Must match the `gap` in the stylesheet below. */
const GRID_GAP_PX = 16;
const GRID_COLUMNS = 12;
const MIN_COLUMNS = 1;

/**
 * `/admin/dashboard` — the widgets installed modules offer, arranged
 *.
 *
 * ## What this page knows, and what it deliberately does not
 *
 * It knows how to draw a stat, how to read a dot-path, and how to let someone
 * move and resize cards. It does NOT know what any figure means, where it comes
 * from, or who may see it: the catalogue names an endpoint per widget and this
 * fetches it, so a module's numbers keep their own security, caching and
 * refresh. Adding a module adds its card with no edit here.
 *
 * ## Arranging is a MODE, not a separate screen
 *
 * The same cards, in the same grid, at the same sizes — with handles. An
 * editor that re-rendered the dashboard as a list of boxes would be showing
 * something other than the thing being arranged, and every width judgement
 * would be made against a layout nobody will ever see.
 *
 * Nothing is saved until Save. Entering the mode snapshots the cards, Cancel
 * restores the snapshot, and Save PUTs the whole arrangement and then RELOADS —
 * because the server decides more than the client sent: widgets nobody
 * mentioned are appended, and a colleague's placements for cards this viewer
 * cannot see are preserved.
 *
 * ## One request per widget, on purpose
 *
 * Two widgets pointing at the same route cost two requests today. Batching them
 * would mean this page knowing which endpoints are safe to combine, which is
 * exactly the module knowledge the seam exists to avoid holding.
 */
@Component({
    selector: 'app-dashboard-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, CmsListPageComponent, CdkDropList, CdkDrag, TabStripComponent],
    template: `
        <cms-list-page icon="speedometer2" [title]="'Dashboard'"
                       [actions]="actions()" (actionClick)="onAction($event)">
            <!-- The wrapper earns its place: it is the QUERY CONTAINER the
                 cards' widths are measured against. Viewport media queries
                 would be wrong here — the admin's sidebar means a 1280px
                 window is a ~730px pane, so every breakpoint would fire ~260px
                 too late. -->
            <div class="dashboard">
                @if (tabs().length > 1) {
                    <!-- The shared strip, not a hand-rolled one: it is THE
                         in-page bucket selector in this admin. Rendered only
                         when a module has actually claimed a section, so a
                         platform where nobody has looks exactly as it did. -->
                    <app-tab-strip [tabs]="tabs()" [activeId]="section() ?? ''"
                                   (selected)="switchSection($any($event))" />
                }
                @if (loading()) {
                    <div class="dashboard__status">
                        <cms-loader label="Loading dashboard" />
                    </div>
                } @else if (error()) {
                    <div class="alert alert-danger m-3">{{ error() }}</div>
                } @else if (cards().length === 0) {
                    <!-- Not an error. A platform whose installed modules offer nothing
                         has an empty dashboard, and saying so beats an empty grid that
                         looks broken. -->
                    <div class="dashboard__empty">
                        <i class="bi bi-grid-1x2"></i>
                        <p>No modules are offering dashboard widgets yet.</p>
                    </div>
                } @else {
                    @if (editing()) {
                        <p class="dashboard__hint">
                            <i class="bi bi-info-circle"></i>
                            Drag a card by its handle to reorder, drag its right edge to
                            resize, and use the eye to hide or show it. You can also drag an
                            item from the left menu onto the grid to add its widgets. This
                            arrangement is shared with everyone.
                        </p>
                    }
                    @if (saveError()) {
                        <div class="alert alert-danger">{{ saveError() }}</div>
                    }
                    @if (dropNote()) {
                        <div class="dashboard__note">{{ dropNote() }}</div>
                    }

                    <!-- Native drag-and-drop, NOT CDK: the thing being dragged
                         is a sidebar link in another component tree, and a CDK
                         drop list can only receive from a list it is connected
                         to. An anchor is draggable by default and carries its
                         own href, so nothing in the sidebar had to change. -->
                    <div #grid class="dashboard__grid" cdkDropList
                         cdkDropListOrientation="mixed"
                         [class.dashboard__grid--dropping]="dropTarget()"
                         [cdkDropListDisabled]="!editing()"
                         (cdkDropListDropped)="onReorder($event)"
                         (dragover)="onDragOver($event)"
                         (dragleave)="dropTarget.set(false)"
                         (drop)="onDropMenuItem($event)">
                        @for (card of shown(); track card.id) {
                            <!-- The span rides a CUSTOM PROPERTY rather than an
                                 inline grid-column, and that is load-bearing:
                                 an inline declaration beats any stylesheet rule,
                                 so the narrow-pane rules below could never widen
                                 a card. Passing the number instead lets CSS own
                                 the decision it is better at. -->
                            <article class="dashboard__card"
                                     [class.dashboard__card--editing]="editing()"
                                     [class.dashboard__card--hidden]="card.hidden"
                                     [style.--cms-widget-span]="card.columns"
                                     cdkDrag [cdkDragDisabled]="!editing()">
                                @if (editing()) {
                                    <!-- An affordance, not the only way in.
The card itself drags: with
                                         cdkDragHandle the grip was the ONLY
                                         thing that worked, and most of a card's
                                         surface is the article's own empty flex
                                         space — so reaching for the card, which
                                         is what everyone does, did nothing. -->
                                    <span class="dashboard__grip" aria-hidden="true">
                                        <i class="bi bi-grip-vertical"></i>
                                    </span>
                                }
                                <i class="dashboard__icon bi" [class]="card.icon"></i>
                                <div class="dashboard__body">
                                    <div class="dashboard__value" [class.dashboard__value--failed]="card.failed">
                                        {{ card.display ?? '—' }}
                                    </div>
                                    <div class="dashboard__label">{{ card.label }}</div>
                                </div>
                                @if (editing()) {
                                    <button type="button" class="dashboard__toggle"
                                            [title]="card.hidden ? 'Show this card' : 'Hide this card'"
                                            (click)="toggleHidden(card)">
                                        <i class="bi" [class.bi-eye-slash]="card.hidden" [class.bi-eye]="!card.hidden"></i>
                                    </button>
                                    <!-- Pointer events, not a drag directive: the
                                         handle must snap to whole twelfths, and the
                                         only way to know how wide a twelfth is on
                                         this pane is to measure the grid. -->
                                    <span class="dashboard__resize" title="Drag to resize"
                                          (pointerdown)="startResize($event, card)"></span>
                                    <span class="dashboard__width">{{ card.columns }}/12</span>
                                }
                            </article>
                        }
                        @if (editing()) {
                            <!-- Sits IN the grid, at the end, because that is
                                 where a new card would land — an "Add" button up
                                 in the toolbar would be a control about the grid
                                 rather than a place in it. -->
                            <button type="button" class="dashboard__add"
                                    [disabled]="addable().length === 0"
                                    [title]="addable().length === 0
                                        ? 'Every available widget is already on the dashboard'
                                        : 'Add a widget'"
                                    (click)="openPicker()">
                                <i class="bi bi-plus-lg"></i>
                                <span>{{ addable().length === 0 ? 'Nothing left to add' : 'Add widget' }}</span>
                            </button>
                        }
                    </div>
                }
            </div>
        </cms-list-page>
    `,
    styles: [`
        /* The shell only stretches when its own host does — documented on
           cms-list-page and omitted when this page was written. */
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        .dashboard { container-type: inline-size; }

        .dashboard__hint {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 12px 0 0;
            color: var(--cms-text-muted);
            font-size: .85rem;
        }

        .dashboard__grid {
            display: grid;
            /* TWELVE columns, always, because that is what a widget's width is
               expressed in. The old auto-fill grid could not honour a
               declared width at all: it decided the track count itself, so
               "span 4" meant a third on one screen and everything on another.
               minmax(0, 1fr) rather than 1fr so a long unbroken value cannot
               push its track wider than its share. */
            grid-template-columns: repeat(12, minmax(0, 1fr));
            gap: 16px;
            /* Vertical only. The shell's body owns the horizontal edge, and
               padding here is what inset the cards 20px from the header bar
               above them. */
            padding: 16px 0;
        }

        .dashboard__note {
            margin: 8px 0 0;
            padding: 8px 12px;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 6px);
            color: var(--cms-text-muted);
            font-size: .85rem;
        }

        /* The whole grid is the target, not one tile: a menu item is dropped
           ONTO the dashboard, and asking someone to hit a particular square
           would imply a position the drop does not actually choose. */
        .dashboard__grid--dropping {
            outline: 2px dashed var(--cms-accent);
            outline-offset: 4px;
            border-radius: var(--cms-radius, 8px);
        }

        .dashboard__card {
            grid-column: span var(--cms-widget-span, 4);
            position: relative;
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 18px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 8px);
        }

        /* A FLOOR, not an override: max() leaves a card that asked for the full
           width alone and only widens the ones that would otherwise become
           unreadable slivers.

           Both numbers are DERIVED from the 220px the old auto-fill grid was
           tuned to, not chosen by eye. A span-N card measures N tracks plus the
           N-1 gaps between them, so a third stops clearing 220px at a 692px
           pane and a half at 456px — hence 700 and 460. The first guess put the
           step at 900px, which quietly widened a card to a half in the admin's
           real 730px pane where its declared third still measured a comfortable
           233px: a breakpoint that fires early does not look broken, it just
           silently stops honouring what the widget asked for.

            These MUST stay BELOW the base rule. A container query adds no
           specificity, so source order is the only thing deciding — written
           above it they parse, lint and ship as dead CSS. */
        @container (max-width: 700px) {
            .dashboard__card { grid-column: span max(var(--cms-widget-span, 4), 6); }
        }
        @container (max-width: 460px) {
            .dashboard__card { grid-column: span 12; }
        }

        /*  user-select is the fix for "I dragged the card and then nothing
           worked". Pressing on a card's text and moving SELECTS it, and
           the browser then offers that selection as a NATIVE drag — which
           competes with the CDK drag, swallows clicks until it ends, and lands
           in the menu-item drop handler carrying "107.46 MB Storage used"
           instead of a URL. Only while arranging: a figure on a dashboard is
           worth being able to copy. */
        .dashboard__card--editing {
            padding-left: 34px;
            user-select: none;
            -webkit-user-drag: none;
        }
        /* Still visible while arranging — a card you cannot see is one you
           cannot bring back. Dashed and dimmed says "not on the dashboard"
           without removing the thing being decided about. */
        .dashboard__card--hidden {
            opacity: .55;
            border-style: dashed;
            background: transparent;
        }

        .dashboard__grip,
        .dashboard__toggle {
            position: absolute;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            padding: 0;
            border: 0;
            border-radius: var(--cms-radius-sm, 4px);
            background: transparent;
            color: var(--cms-text-muted);
            cursor: pointer;
        }
        .dashboard__grip { left: 4px; top: 50%; transform: translateY(-50%); pointer-events: none; }
        /* The whole card is the drag surface, so the cursor belongs on the
           card — not only on the grip that merely advertises it. */
        .dashboard__card--editing { cursor: grab; }
        .dashboard__card--editing:active { cursor: grabbing; }
        .dashboard__toggle { right: 10px; top: 8px; }
        .dashboard__grip:hover,
        .dashboard__toggle:hover { color: var(--cms-text); background: var(--cms-hover, rgba(127,127,127,.15)); }

        /* A 4px BAR inside a 16px TARGET. The bar is what you see; the
           span is what you have to hit, and 4px is not something a person
           reliably hits with a trackpad — it was not reliably hittable in
           testing either, which is how the difference got noticed. The extra
           width is transparent and sits in the grid's 16px gutter, so nothing
           moves and no neighbour is covered. */
        .dashboard__resize {
            position: absolute;
            top: 6px;
            bottom: 6px;
            right: -8px;
            width: 16px;
            display: flex;
            justify-content: center;
            cursor: col-resize;
            touch-action: none;
        }
        .dashboard__resize::after {
            content: '';
            width: 4px;
            border-radius: 2px;
            background: var(--cms-accent);
            opacity: .35;
        }
        .dashboard__resize:hover::after { opacity: 1; }

        .dashboard__width {
            position: absolute;
            right: 10px;
            bottom: 6px;
            color: var(--cms-text-muted);
            font-size: .7rem;
            font-variant-numeric: tabular-nums;
        }

        /* Deliberately NOT a card: dashed, quiet, and the same height as its
           neighbours so the row does not change shape when the mode opens. */
        .dashboard__add {
            grid-column: span 4;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            min-height: 76px;
            border: 1px dashed var(--cms-border);
            border-radius: var(--cms-radius, 8px);
            background: transparent;
            color: var(--cms-text-muted);
            font: inherit;
            cursor: pointer;
        }
        .dashboard__add:hover:not(:disabled) { color: var(--cms-text); border-color: var(--cms-accent); }
        .dashboard__add:disabled { cursor: default; opacity: .5; }

        .dashboard__icon {
            font-size: 1.6rem;
            color: var(--cms-accent);
            line-height: 1;
        }
        .dashboard__body { min-width: 0; }
        .dashboard__value {
            font-size: 1.5rem;
            font-weight: 600;
            line-height: 1.1;
            overflow-wrap: anywhere;
        }
        /* A widget whose endpoint refused or failed shows a dash in muted ink
           rather than a zero. Zero is an ANSWER, and showing one for "we could
           not ask" is the kind of quiet lie a dashboard must not tell. */
        .dashboard__value--failed { color: var(--cms-text-muted); font-weight: 400; }
        .dashboard__label {
            margin-top: 2px;
            color: var(--cms-text-muted);
            font-size: .85rem;
        }
        .dashboard__status,
        .dashboard__empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            min-height: 40vh;
            color: var(--cms-text-muted);
        }
        .dashboard__empty i { font-size: 2.2rem; }

        .cdk-drag-preview { box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12)); border-radius: var(--cms-radius, 8px); }
        .cdk-drag-placeholder { opacity: .35; }
        .cdk-drop-list-dragging .dashboard__card:not(.cdk-drag-placeholder) { transition: transform 180ms ease; }
    `],
})
export class DashboardPageComponent {
    private readonly http   = inject(HttpClient);
    private readonly config = inject(ConfigService);
    private readonly layoutActions = inject(LayoutActionsService);

    /** Backend-defined page chrome (`core:dashboard` layout config). */
    protected readonly layout = signal<LayoutConfig | null>(null);
    private readonly store  = inject(Store);
    private readonly dialog = inject(Dialog);
    private readonly navi   = inject(NaviGraphService);

    private readonly grid = viewChild<ElementRef<HTMLElement>>('grid');

    protected readonly loading   = signal(true);
    protected readonly error     = signal<string | null>(null);
    protected readonly saveError = signal<string | null>(null);
    protected readonly cards     = signal<Card[]>([]);
    protected readonly editing   = signal(false);
    protected readonly saving    = signal(false);
    /** True while a menu item is being dragged over the grid. */
    protected readonly dropTarget = signal(false);
    /** Transient feedback for a drop that added nothing, and why. */
    protected readonly dropNote   = signal<string | null>(null);

    /** Sections a module has claimed, and which one is being shown. */
    protected readonly sections = signal<string[]>([]);
    protected readonly section  = signal<string | null>(null);

    /** Taken on entering the mode; Cancel puts it back without a round trip. */
    private snapshot: Card[] = [];

    /**
     * The switcher. "Overview" is the ungrouped dashboard and is always first;
     * its id is the empty string, because "no section" is what it means and a
     * sentinel like 'main' would then be a section name a module could claim.
     */
    protected readonly tabs = computed<TabStripItem[]>(() => [
        { id: '', label: 'Overview', icon: 'speedometer2' },
        ...this.sections().map(name => ({ id: name, label: this.titleOf(name) })),
    ]);

    protected switchSection(id: string): void {
        const next = '' === id ? null : id;
        if (next === this.section()) return;

        // Leaving the mode rather than carrying unsaved edits across: a layout
        // belongs to ONE dashboard, and silently discarding another's drag on
        // Save would be the worst of the available surprises.
        this.editing.set(false);
        this.saveError.set(null);
        this.section.set(next);
        void this.load();
    }

    /** `growth` reads as Growth; a module may still ship any string it likes. */
    private titleOf(name: string): string {
        return name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]/g, ' ');
    }

    /** Hidden cards are drawn only while arranging — otherwise hidden means hidden. */
    protected readonly shown = computed(() =>
        this.editing() ? this.cards() : this.cards().filter(card => !card.hidden),
    );

    /**
     * Which actions the header offers is declared in the `core:dashboard`
     * layout: Arrange while viewing, Save / Cancel / Reset while
     * arranging, all three greying out mid-save. The page says WHICH MODE it
     * is in and stops there.
     */
    protected readonly actions = computed<ToolbarAction[]>(() =>
        this.layoutActions.resolve(this.layout()?.headerActions, this.actionContext()),
    );

    private readonly actionContext = computed((): Record<string, unknown> => ({
        _editing: this.editing(),
        _saving:  this.saving(),
    }));

    constructor() {
        // Chrome is backend-defined; one cached fetch, degrading to no actions
        // rather than breaking the page -- the cards below are the point.
        this.config.layout('core:dashboard')
            .pipe(takeUntilDestroyed())
            .subscribe({
                next: cfg => this.layout.set(cfg),
                error: () => { /* page still renders, without its header actions */ },
            });
        void this.load();
    }

    protected onAction(id: string): void {
        switch (id) {
            case 'arrange': this.startEditing(); break;
            case 'cancel':  this.cancel(); break;
            case 'save':    void this.save(); break;
            case 'reset':   void this.reset(); break;
        }
    }

    // -- arranging ----------------------------------------------------------

    private startEditing(): void {
        this.saveError.set(null);
        this.snapshot = this.cards().map(card => ({ ...card }));
        this.editing.set(true);
    }

    private cancel(): void {
        this.cards.set(this.snapshot);
        this.editing.set(false);
        this.saveError.set(null);
    }

    protected onReorder(event: CdkDragDrop<unknown>): void {
        const next = [...this.cards()];
        moveItemInArray(next, event.previousIndex, event.currentIndex);
        this.cards.set(next);
    }

    /** Widgets that are on the catalogue but not on the dashboard. */
    protected readonly addable = computed(() => this.cards().filter(card => card.hidden));

    protected toggleHidden(card: Card): void {
        this.show({ ...card, hidden: !card.hidden });
    }

    protected openPicker(cards: Card[] = this.addable()): void {
        const choices = cards.map(card => ({
            id: card.id,
            label: card.label,
            icon: card.icon,
            group: card.group,
        }));

        this.dialog
            .open<string | null>(WidgetPickerDialogComponent, { data: { widgets: choices } })
            .closed
            .subscribe(id => {
                const card = 'string' === typeof id ? this.current(id) : undefined;
                if (card) {
                    // Back where it was, not appended. A hidden card REMEMBERS
                    // its position — that is what makes hide/show a toggle
                    // rather than a re-drag, and adding one is the same act.
                    this.show({ ...card, hidden: false });
                }
            });
    }

    // -- dropping a menu item -----------------------------------------------

    protected onDragOver(event: DragEvent): void {
        if (!this.editing() || !this.carriesLink(event)) return;

        // Without preventDefault the browser refuses the drop entirely — the
        // default for most elements is "not a drop target".
        event.preventDefault();
        this.dropTarget.set(true);
    }

    /**
     * Is this drag a LINK, or something else entirely?
     *
     *  Not a nicety. Dragging a card used to select its text, and the
     * browser then offers that selection as a native drag — which this grid
     * accepted, highlighted itself for, and answered with "That menu item does
     * not belong to a module offering widgets" for a drag that was never a menu
     * item. Chrome puts `text/uri-list` on an anchor drag and only `text/plain`
     * on a text one, so the distinction is exact rather than heuristic.
     */
    private carriesLink(event: DragEvent): boolean {
        const types = event.dataTransfer?.types;

        return undefined !== types && Array.from(types).includes('text/uri-list');
    }

    /**
     * A sidebar item dropped on the grid adds that module's widgets.
     *
     * The chain is href -> navi node -> `meta.module` -> widgets. It needs the
     * middle step because a route tells you nothing about ownership:
     * `/cdp-segments` and `/call/wallboard` belong to `cdp` and `call`, and no
     * amount of string-slicing gets there reliably. The navi node knows,
     * because the module's own `config/modules/<module>/navigraph` declared it.
     */
    protected onDropMenuItem(event: DragEvent): void {
        this.dropTarget.set(false);
        if (!this.editing() || !this.carriesLink(event)) return;

        event.preventDefault();

        const href = event.dataTransfer?.getData('text/uri-list')
            || event.dataTransfer?.getData('text/plain')
            || '';
        const module = this.moduleOf(href);

        if (null === module) {
            this.note('That menu item does not belong to a module offering widgets.');

            return;
        }

        const offered = this.cards().filter(card => this.moduleOfCard(card) === module);
        const missing = offered.filter(card => card.hidden);

        if (0 === offered.length) {
            this.note('The ' + module + ' module does not offer any dashboard widgets.');
        } else if (0 === missing.length) {
            this.note('Every widget from ' + module + ' is already on the dashboard.');
        } else if (1 === missing.length) {
            // One candidate is not a choice; asking would be ceremony.
            this.show({ ...missing[0], hidden: false });
        } else {
            // Several — which is exactly the case the picker was built for.
            this.openPicker(missing);
        }
    }

    /** Resolve a dropped admin URL to the module that contributed that menu item. */
    private moduleOf(href: string): string | null {
        if ('' === href) return null;

        let path: string;
        try {
            path = new URL(href, window.location.origin).pathname;
        } catch {
            return null;
        }

        // The SPA is served under /admin, so a sidebar href carries that prefix
        // while the navi node's own path does not.
        const wanted = path.replace(/^\/admin/, '').replace(/\/$/, '') || '/';
        const node = this.findNode(this.navi.adminNav(), wanted);
        const module = node?.meta['module'];

        return 'string' === typeof module ? module : null;
    }

    private findNode(nodes: NaviGraphNode[], wanted: string): NaviGraphNode | null {
        for (const node of nodes) {
            const link = node.meta.routerLink;
            const linkPath = 'string' === typeof link ? (link.startsWith('/') ? link : '/' + link) : null;

            if (node.path === wanted || linkPath === wanted) return node;

            const child = this.findNode(node.children, wanted);
            if (child) return child;
        }

        return null;
    }

    /** Same rule the picker groups by: an explicit group, else the id prefix. */
    private moduleOfCard(card: Card): string {
        return card.group ?? (card.id.split('.')[0] ?? card.id);
    }

    private note(message: string): void {
        this.dropNote.set(message);
        window.setTimeout(() => {
            if (this.dropNote() === message) this.dropNote.set(null);
        }, 6000);
    }

    /**
     * Apply a hide/show, and fetch the value if this is the card's first
     * appearance.
     *
     * A hidden card's endpoint is never called, so one being shown has no
     * figure yet. Without this it would sit at an em-dash until Save reloaded
     * the page — which reads as "this widget is broken" at exactly the moment
     * someone is deciding whether to keep it.
     */
    private show(card: Card): void {
        this.replace(card);

        if (!card.hidden && null === card.display && !card.failed) {
            void this.hydrate(card);
        }
    }

    private async hydrate(card: Card): Promise<void> {
        const resolved = await this.resolve(card);
        const latest = this.current(card.id);

        // Only if it is still shown: a slow endpoint must not un-hide a card
        // the user hid again while waiting.
        if (latest && !latest.hidden) {
            this.replace({ ...latest, display: resolved.display, failed: resolved.failed });
        }
    }

    /**
     * Resize by dragging the card's right edge, snapping to whole twelfths.
     *
     * The snap needs the width of one column ON THIS PANE, which only the live
     * grid can answer — it is a fraction of whatever the container query left
     * it. Twelve tracks and eleven gaps make one track-plus-gap exactly
     * `(width + gap) / 12`, so the pointer's travel converts to columns by a
     * single division. Rounding rather than truncating so the card follows the
     * pointer symmetrically in both directions.
     */
    protected startResize(event: PointerEvent, card: Card): void {
        const grid = this.grid()?.nativeElement;
        if (!grid) return;

        // Stops CDK from reading this as the start of a drag.
        event.preventDefault();
        event.stopPropagation();

        const step = (grid.getBoundingClientRect().width + GRID_GAP_PX) / GRID_COLUMNS;
        const startX = event.clientX;
        const startColumns = card.columns;
        const abort = new AbortController();

        const move = (moveEvent: PointerEvent): void => {
            const columns = Math.min(
                GRID_COLUMNS,
                Math.max(MIN_COLUMNS, startColumns + Math.round((moveEvent.clientX - startX) / step)),
            );
            if (columns !== this.current(card.id)?.columns) {
                // Both, and that is the point: `columns` is what gets drawn,
                // `explicitColumns` is what gets SAVED. A resize is the only
                // thing that may set the second — see the note on the Card type.
                this.replace({ ...card, columns, explicitColumns: columns });
            }
        };

        window.addEventListener('pointermove', move, { signal: abort.signal });
        window.addEventListener('pointerup', () => abort.abort(), { signal: abort.signal });
        window.addEventListener('pointercancel', () => abort.abort(), { signal: abort.signal });
    }

    private current(id: string): Card | undefined {
        return this.cards().find(card => card.id === id);
    }

    private replace(card: Card): void {
        this.cards.set(this.cards().map(existing => existing.id === card.id ? card : existing));
    }

    // -- persistence --------------------------------------------------------

    private async save(): Promise<void> {
        this.saving.set(true);
        this.saveError.set(null);
        try {
            await this.send('PUT', {
                widgets: this.cards().map(card => ({
                    widget: card.id,
                    // Omitted when the layout never stated one. Sending the
                    // effective width instead would convert every module
                    // default into a stored decision on the first save.
                    ...(null === card.explicitColumns ? {} : { columns: card.explicitColumns }),
                    ...(card.hidden ? { hidden: true } : {}),
                })),
            });

            this.editing.set(false);
            // Reload rather than trust the local copy: the server appends
            // widgets nobody mentioned and preserves placements for cards this
            // viewer cannot see, so what was sent is not what is now saved.
            await this.load();
        } catch (failure) {
            this.saveError.set(this.explain(failure, 'The arrangement could not be saved.'));
        } finally {
            this.saving.set(false);
        }
    }

    private async reset(): Promise<void> {
        this.saving.set(true);
        this.saveError.set(null);
        try {
            await this.send('DELETE', null);
            this.editing.set(false);
            await this.load();
        } catch (failure) {
            this.saveError.set(this.explain(failure, 'The arrangement could not be reset.'));
        } finally {
            this.saving.set(false);
        }
    }

    /** The API answers a refusal with a `detail`; anything else is a generic toast. */
    private explain(failure: unknown, fallback: string): string {
        const detail = (failure as { error?: { detail?: unknown } })?.error?.detail;

        return 'string' === typeof detail && '' !== detail ? detail : fallback;
    }

    // -- loading ------------------------------------------------------------

    private apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    private async load(): Promise<void> {
        this.loading.set(true);
        try {
            const catalogue = await this.fetch<{ widgets: DashboardWidget[]; sections?: string[] }>(
                this.apiBase() + '/dashboard/widgets' + this.sectionQuery(),
            );
            const offered = catalogue?.widgets ?? [];

            // Every response carries the full section list, whichever dashboard
            // was asked for, so the switcher never goes stale from being on the
            // wrong tab to hear about a new one.
            this.sections.set(catalogue?.sections ?? []);

            // Fetched in parallel and settled individually: one module being
            // down must not blank the whole dashboard, so a failure becomes one
            // quiet card rather than a page-level error.
            this.cards.set(await Promise.all(offered.map(async (widget) => this.toCard(widget))));
            this.error.set(null);
        } catch {
            this.error.set('The dashboard catalogue could not be loaded.');
        } finally {
            this.loading.set(false);
        }
    }

    private async toCard(widget: DashboardWidget): Promise<Card> {
        const card: Card = {
            id: widget.id,
            label: widget.label,
            icon: widget.icon,
            endpoint: widget.endpoint,
            valuePath: widget.valuePath,
            displayPath: widget.displayPath,
            group: widget.group,
            columns: widget.columns,
            explicitColumns: widget.explicitColumns ?? null,
            hidden: widget.hidden ?? false,
            display: null,
            failed: false,
        };

        // A hidden card is not drawn, so its endpoint is not called — a card
        // someone removed should not go on costing a request per page load.
        // It gains its value the moment it is shown again.
        return card.hidden ? card : { ...card, ...await this.resolve(card) };
    }

    /** @returns what the widget's own endpoint says, or why it could not say it */
    private async resolve(card: Card): Promise<{ display: string | null; failed: boolean }> {
        try {
            const data = await this.fetch<Record<string, unknown>>(card.endpoint);
            const display = this.read(data, card.displayPath) ?? this.read(data, card.valuePath);

            return { display, failed: null === display };
        } catch {
            // Includes the 403 a viewer gets for a module they may not read.
            // The widget was offered because the ROLE allowed it; the endpoint
            // is the authority on the data, and this is what disagreeing looks
            // like from here.
            return { display: null, failed: true };
        }
    }

    /**
     * Walk a dot-path, returning null rather than guessing at anything odd.
     *
     *  `undefined` as well as `null`, and that was a real bug. A
     * nullable PHP property is OMITTED from the JSON rather than sent as null,
     * so `displayPath` arrives here as `undefined` — which a strict
     * `null === path` misses, so `undefined.split()` threw, the caller's catch
     * treated it as a failed FETCH, and the widget drew a dash while its
     * endpoint was answering perfectly. The absent key is the normal case, not
     * the odd one: every widget without a pre-formatted display has it.
     */
    private read(data: unknown, path: string | null | undefined): string | null {
        if (null === path || undefined === path || '' === path) return null;

        let current: unknown = data;
        for (const key of path.split('.')) {
            if (null === current || 'object' !== typeof current) return null;
            current = (current as Record<string, unknown>)[key];
        }

        return 'string' === typeof current || 'number' === typeof current ? String(current) : null;
    }

    private fetch<T>(url: string): Promise<T> {
        // Plain JSON, not ld+json: Hydra rewrites a map's keys, which would
        // reshape the very response a dot-path is walking.
        return new Promise<T>((resolve, reject) => {
            this.http.get<T>(url, { headers: { Accept: 'application/json' } })
                .subscribe({ next: resolve, error: reject });
        });
    }

    /** `?section=growth`, or nothing at all for the main dashboard. */
    private sectionQuery(): string {
        const section = this.section();

        return null === section ? '' : '?section=' + encodeURIComponent(section);
    }

    private send(method: 'PUT' | 'DELETE', body: unknown): Promise<unknown> {
        // The section rides on the write too: without it, arranging a section
        // would silently save over the main dashboard's layout.
        const url = this.apiBase() + '/dashboard/layout' + this.sectionQuery();
        const options = { headers: { Accept: 'application/json' } };

        return new Promise<unknown>((resolve, reject) => {
            const request$ = 'PUT' === method
                ? this.http.put(url, body, options)
                : this.http.delete(url, options);

            request$.subscribe({ next: resolve, error: reject });
        });
    }
}
