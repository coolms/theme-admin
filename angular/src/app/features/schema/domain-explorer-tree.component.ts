import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { CmsLoaderComponent } from '@coolms/core-angular';
import { DomainExplorerStateService } from './domain-explorer-state.service';

/**
 * Left-panel slot for the Domain Explorer.
 * Registered as 'DomainExplorerTree' in ComponentRegistry.
 * Injects DomainExplorerStateService from the host component's injector.
 */
@Component({
    selector: 'app-domain-explorer-tree',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, ],
    template: `
        <!-- Filter bar -->
        <div class="de-filter-bar">
            <i class="bi bi-search de-filter-bar__icon"></i>
            <input type="text"
                   class="de-filter-bar__input"
                   placeholder="Filter…"
                   [value]="st.filterText()"
                   (input)="st.filterText.set($any($event.target).value)" />
            @if (st.filterText()) {
                <button class="de-filter-bar__clear" (click)="st.filterText.set('')">
                    <i class="bi bi-x"></i>
                </button>
            }
        </div>

        @if (st.loading()) {
            <div class="de-loading">
                <cms-loader [inline]="true" />
            </div>
        } @else {
            <div class="de-module-list">

                @if (showEntities()) {

                @for (group of st.filteredModules(); track group.module) {
                    <div class="de-module">
                        <button class="de-module__header"
                                [class.de-module__header--open]="st.activeModule() === group.module"
                                (click)="st.toggleModule(group.module)">
                            <i class="bi de-module__chevron"
                               [class.bi-chevron-right]="st.activeModule() !== group.module"
                               [class.bi-chevron-down]="st.activeModule() === group.module"></i>
                            <span class="de-module__name">{{ group.module }}</span>
                            <span class="de-module__count">{{ group.entities.length }}</span>
                        </button>

                        @if (st.activeModule() === group.module) {
                            <ul class="de-entity-list">
                                @for (entity of group.entities; track entity.className) {
                                    <li class="de-entity-item"
                                        [class.de-entity-item--active]="st.activeEntity()?.className === entity.className"
                                        (click)="st.selectEntity(entity)"
                                        (contextmenu)="st.openEntityCtxMenu($event, entity)">
                                        @if (entity.isAggregate) {
                                            <i class="bi bi-box de-entity-item__icon de-entity-item__icon--aggregate"
                                               title="Aggregate Root"></i>
                                        } @else if (entity.isEmbeddable) {
                                            <i class="bi bi-braces de-entity-item__icon de-entity-item__icon--embeddable"
                                               title="Embeddable"></i>
                                        } @else {
                                            <i class="bi bi-circle de-entity-item__icon de-entity-item__icon--plain"></i>
                                        }
                                        <span class="de-entity-item__name">{{ entity.label || entity.shortName }}</span>
                                        @if (entity.isDynamic) {
                                            <i class="bi bi-lightning-fill de-entity-item__dynamic"
                                               title="Dynamic Entity"></i>
                                        }
                                    </li>
                                }
                            </ul>
                        }
                    </div>
                }

                @if (st.filteredModules().length === 0 && st.filterText()) {
                    <div class="de-loading" style="font-size:.8rem;">
                        No entities match "<em>{{ st.filterText() }}</em>".
                    </div>
                }

                } <!-- end @if (showEntities()) -->

                @if (showDynamicTypes()) {

                <!-- ── DYNAMIC TYPES ─────────────────────────────────────── -->
                @if (showEntities()) {
                    <div class="de-section-header de-section-header--dynamic"
                         (click)="st.runtimeExpanded.set(!st.runtimeExpanded())">
                        <i class="bi"
                           [class.bi-chevron-down]="st.runtimeExpanded()"
                           [class.bi-chevron-right]="!st.runtimeExpanded()"></i>
                        <span>Dynamic Types</span>
                        <span class="de-module__count">{{ st.childrenMap().get('root')?.length ?? 0 }}</span>
                    </div>
                }

                @if (st.runtimeExpanded()) {
                    @if (st.flatTypes().length === 0 && !st.filterText()) {
                        <div class="de-empty-section">No runtime types yet.</div>
                    }

                    <!-- Flat depth-first tree render (lazy-loaded) -->
                    @for (node of st.flatTypes(); track node.type.id) {
                        <div class="de-type-row"
                             [class.de-type-row--active]="st.activeRuntimeType()?.id === node.type.id"
                             [style.padding-left.px]="8 + node.depth * 16"
                             (click)="st.selectRuntimeType(node.type)"
                             (contextmenu)="st.openTypeCtxMenu($event, node.type)">
                            @if (node.type.hasChildren) {
                                <button class="de-type-row__chevron"
                                        (click)="st.toggleType(node.type); $event.stopPropagation()">
                                    <i class="bi"
                                       [class.bi-chevron-down]="st.expandedIds().has(node.type.id!)"
                                       [class.bi-chevron-right]="!st.expandedIds().has(node.type.id!)"></i>
                                </button>
                            } @else {
                                <span class="de-type-row__chevron-placeholder"></span>
                            }
                            <i class="bi bi-grid-3x3-gap-fill de-type-row__icon"></i>
                            <span class="de-type-row__name">
                                {{ node.type.label || node.type.slug }}
                            </span>
                        </div>
                    }

                    @if (st.searchResults() !== null && st.flatTypes().length === 0 && st.filterText()) {
                        <div class="de-loading" style="font-size:.8rem; padding: 8px 16px;">
                            No types match "<em>{{ st.filterText() }}</em>".
                        </div>
                    }
                }

                } <!-- end @if (showDynamicTypes()) -->

                <!-- Spacer — fills remaining height; click deselects, right-click opens bg menu -->
                @if (showDynamicTypes()) {
                    <div class="de-tree-spacer"
                         (click)="onBgClick()"
                         (contextmenu)="st.openBackgroundCtxMenu($event)">
                    </div>
                }

            </div>
        }
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }

        /* ── Filter bar ─────────────────────────────────────────────────── */
        .de-filter-bar {
            display: flex;
            align-items: center;
            padding: 8px 10px;
            border-bottom: 1px solid var(--cms-border-color);
            gap: 6px;
            flex-shrink: 0;
        }
        .de-filter-bar__icon { color: var(--cms-text-muted); font-size: .8rem; flex-shrink: 0; }
        .de-filter-bar__input {
            flex: 1;
            border: none;
            outline: none;
            font-size: .8rem;
            background: transparent;
            color: var(--cms-text);
        }
        .de-filter-bar__clear {
            background: none;
            border: none;
            cursor: pointer;
            color: var(--cms-text-muted);
            padding: 0;
            line-height: 1;
            font-size: .9rem;
        }
        .de-filter-bar__clear:hover { color: var(--cms-text); }

        /* ── Module list ────────────────────────────────────────────────── */
        .de-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px 16px;
            color: var(--cms-text-muted);
        }
        .de-module-list {
            overflow-y: auto;
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .de-tree-spacer { flex: 1; min-height: 40px; }

        /* Section header (ENTITIES / DYNAMIC TYPES) */
        .de-section-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px 5px;
            font-size: .7rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .07em;
            color: var(--cms-text-muted);
            border-top: 1px solid var(--cms-border-color);
            margin-top: 4px;
        }
        .de-section-header:first-child { border-top: none; margin-top: 0; }
        .de-section-header span:first-of-type { flex: 1; }
        .de-section-header--dynamic {
            cursor: pointer;
            user-select: none;
        }
        .de-section-header--dynamic:hover { background: var(--cms-hover-bg); }

        /* Module toggle */
        .de-module__header {
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
            padding: 6px 12px;
            background: none;
            border: none;
            font-size: .8rem;
            font-weight: 600;
            cursor: pointer;
            color: var(--cms-text);
            text-align: left;
        }
        .de-module__header:hover { background: var(--cms-hover-bg); }
        .de-module__header--open { color: var(--cms-primary); }
        .de-module__chevron { font-size: .7rem; flex-shrink: 0; }
        .de-module__name { flex: 1; }
        .de-module__count {
            font-size: .7rem;
            font-weight: 400;
            color: var(--cms-text-muted);
            background: var(--cms-surface-2, rgba(0,0,0,.05));
            border-radius: 8px;
            padding: 1px 6px;
        }
        .de-module__count--records { background: var(--cms-info-subtle); color: var(--cms-info-text); }

        /* Entity list */
        .de-entity-list {
            list-style: none;
            margin: 0;
            padding: 2px 0 4px;
        }
        .de-entity-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px 5px 22px;
            cursor: pointer;
            font-size: .8125rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: background .1s;
        }
        .de-entity-item:hover { background: var(--cms-hover-bg); }
        .de-entity-item--active {
            background: var(--cms-active-bg);
            color: var(--cms-primary);
            font-weight: 500;
        }
        .de-entity-item__icon { font-size: .7rem; flex-shrink: 0; }
        .de-entity-item__icon--aggregate  { color: var(--cms-info-text); }
        .de-entity-item__icon--embeddable { color: var(--cms-success-text); }
        .de-entity-item__icon--plain { color: var(--cms-text-muted); }
        .de-entity-item__name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
        .de-entity-item__dynamic { font-size: .65rem; color: #854d0e; }

        /* Runtime type rows */
        .de-type-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px 5px 16px;
            cursor: pointer;
            font-size: .8125rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: background .1s;
        }
        .de-type-row:hover { background: var(--cms-hover-bg); }
        .de-type-row--active {
            background: var(--cms-active-bg);
            color: var(--cms-primary);
            font-weight: 500;
        }
        .de-type-row__icon { font-size: .65rem; flex-shrink: 0; color: var(--cms-meta); }
        .de-type-row__name { flex: 1; overflow: hidden; text-overflow: ellipsis; }

        /* Chevron for expandable type nodes */
        .de-type-row__chevron {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 14px;
            height: 14px;
            flex-shrink: 0;
            background: none;
            border: none;
            padding: 0;
            cursor: pointer;
            color: var(--cms-text-muted);
            font-size: .65rem;
            line-height: 1;
        }
        .de-type-row__chevron:hover { color: var(--cms-text); }
        .de-type-row__chevron-placeholder {
            display: inline-block;
            width: 14px;
            height: 14px;
            flex-shrink: 0;
        }

        .de-empty-section {
            padding: 8px 16px;
            font-size: .8rem;
            color: var(--cms-text-muted);
            font-style: italic;
        }

        /* Utility */
        .text-muted { color: var(--cms-text-muted) !important; }
    `],
})
export class DomainExplorerTreeComponent {
    readonly st               = inject(DomainExplorerStateService);
    readonly showDynamicTypes = input<boolean>(false);
    readonly showEntities     = input<boolean>(true);

    onBgClick(): void { this.st.clearSelection(); }
}
