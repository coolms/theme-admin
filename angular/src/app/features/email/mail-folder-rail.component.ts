import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    afterNextRender,
    afterRenderEffect,
    inject,
    input,
    output,
} from '@angular/core';
import { StateComponent } from '@coolms/ui-angular';

import { type FolderJobAction } from './email.types';
import { folderCount, folderCountTitle, folderUnread, importedFraction } from './folder-fraction.util';
import type { FolderRow } from './folder-tree.util';
import { busyText } from './mail-folder-actions';

/** How long a touch is held to open a row's menu, and how far it may move before it is a scroll. */
export const LONG_PRESS_MS = 500;
const PRESS_SLOP_PX = 10;

/** A row's menu asked for: the folder, where (an event at the point), and the row when it was asked by key. */
export interface FolderMenuAsk {
    readonly folder: string;
    readonly event: MouseEvent;
    readonly opener: HTMLElement | null;
}

/** The Bootstrap icon for each folder role the tree names; any other role, or none, draws a folder. */
const ROLE_ICONS: Readonly<Record<string, string>> = {
    inbox: 'bi-inbox',
    sent: 'bi-send',
    drafts: 'bi-file-earmark-text',
    archive: 'bi-archive',
    all: 'bi-archive',
    trash: 'bi-trash',
    flagged: 'bi-star',
    important: 'bi-bookmark',
    junk: 'bi-exclamation-octagon',
};

/** A folder's icon, by its role from the tree, never by its name. */
export function folderIcon(role: string | null | undefined): string {
    return (typeof role === 'string' ? ROLE_ICONS[role] : undefined) ?? 'bi-folder';
}

/**
 * A mailbox's folders, one row per row given, in that order and with those names. A row that cannot be selected is a
 * heading and opens nothing. A tree that could not be read shows the error with Retry, and no rows.
 *
 * A row keeps one height at every width: its icon, unread badge and total never shrink or wrap, and only the name
 * gives way, cut with an ellipsis, the full name in the tooltip and as the row's accessible name. {@link need} says
 * how wide the rail must be for its widest row (indent, icon, badge and total) with 6ch of name, over every row given.
 */
@Component({
    selector: 'app-mail-folder-rail',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [StateComponent],
    template: `
        <nav class="mbx__folders" aria-label="Folders">
            @if (failure() !== null) {
                <cms-state kind="error" title="Could not load the folders." [error]="failure()"
                           actionLabel="Retry" (acted)="retry.emit()" />
            } @else {
                @for (row of rows(); track row.folder.folder; let i = $index) {
                    @if (row.selectable) {
                        <button type="button" class="mbx__folder" data-test="folder"
                                [attr.data-folder]="row.folder.folder"
                                [style.padding-left.px]="indent(row)"
                                [class.mbx__folder--active]="row.folder.folder === selected()"
                                [attr.aria-current]="row.folder.folder === selected() ? 'true' : null"
                                [attr.aria-busy]="busy(row) !== null ? 'true' : null"
                                [attr.aria-describedby]="busy(row) !== null ? 'mbx-folder-busy-' + i : null"
                                [title]="rowTitle(row)"
                                (click)="pressed(row)"
                                (contextmenu)="pointerMenu($event, row)"
                                (keydown)="keyMenu($event, row)"
                                (pointerdown)="pressStart($event, row)" (pointermove)="pressMove($event)"
                                (pointerup)="pressEnd()" (pointercancel)="pressEnd()">
                            <i class="bi mbx__folder-icon" [class]="icon(row)" aria-hidden="true" data-test="folder-icon"></i>
                            <span class="mbx__folder-name" data-test="folder-name">{{ row.name }}</span>
                            @if (busy(row) !== null) {
                                <span class="mbx__folder-spinner" aria-hidden="true" data-test="folder-busy"></span>
                            }
                            @if (unread(row) > 0) {
                                <span class="mbx__badge" aria-hidden="true" data-test="folder-unread">{{ unread(row) }}</span>
                            }
                            <span class="mbx__folder-total" aria-hidden="true" data-test="folder-total">{{ count(row) }}</span>
                            @if (fraction(row) !== null) {
                                <span class="mbx__folder-progress" aria-hidden="true">
                                    <span class="mbx__folder-progress-bar" [style.width.%]="fraction(row)"></span>
                                </span>
                            }
                        </button>
                    } @else {
                        <!-- A folder that only holds folders opens nothing, but may have actions: focusable then. -->
                        <div class="mbx__folder mbx__folder--holder" data-test="folder-holder"
                             [attr.data-folder]="row.folder.folder"
                             [attr.tabindex]="hasActions(row) ? 0 : null"
                             [style.padding-left.px]="indent(row)" [title]="rowTitle(row)"
                             [attr.aria-busy]="busy(row) !== null ? 'true' : null"
                             [attr.aria-describedby]="busy(row) !== null ? 'mbx-folder-busy-' + i : null"
                             (click)="pressed(row)"
                             (contextmenu)="pointerMenu($event, row)"
                             (keydown)="keyMenu($event, row)"
                             (pointerdown)="pressStart($event, row)" (pointermove)="pressMove($event)"
                             (pointerup)="pressEnd()" (pointercancel)="pressEnd()">
                            <i class="bi mbx__folder-icon" [class]="icon(row)" aria-hidden="true" data-test="folder-icon"></i>
                            <span class="mbx__folder-name" data-test="folder-name">{{ row.name }}</span>
                            @if (busy(row) !== null) {
                                <span class="mbx__folder-spinner" aria-hidden="true" data-test="folder-busy"></span>
                            }
                        </div>
                    }
                    <!-- What runs on a busy folder: the row's description, never part of its name. -->
                    @if (busy(row); as running) {
                        <span class="visually-hidden" [id]="'mbx-folder-busy-' + i">{{ busyText(running) }}</span>
                    }
                }
                @if (answered() && rows().length === 0) {
                    <p class="mbx__rail-note">No folders yet.</p>
                }
                <!-- The list-level action: a folder at the top level, at the foot of the list. -->
                @if (newFolderLabel(); as label) {
                    <button type="button" class="mbx__new-folder" data-test="new-folder" (click)="create.emit()">
                        <i class="bi bi-folder-plus mbx__folder-icon" aria-hidden="true"></i>
                        <span>{{ label }}</span>
                    </button>
                }
            }
        </nav>
        <!-- Every row as its content needs it, with 6ch of name: what the rail measures its minimum from. -->
        <div class="mbx__measure" aria-hidden="true">
            @for (row of rows(); track row.folder.folder) {
                <div class="mbx__measure-row" [style.padding-left.px]="indent(row)">
                    <i class="bi mbx__folder-icon" [class]="icon(row)"></i>
                    <span class="mbx__measure-name"></span>
                    @if (busy(row) !== null) {
                        <span class="mbx__folder-spinner"></span>
                    }
                    @if (row.selectable) {
                        @if (unread(row) > 0) {
                            <span class="mbx__badge">{{ unread(row) }}</span>
                        }
                        <span class="mbx__folder-total">{{ count(row) }}</span>
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        :host { display: block; position: relative; }
        .mbx__folders { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
        /* The highlight reaches into the column's gutter by its own padding, so the row starts at the column's edge
           (the section header's icon), children indented from there. */
        .mbx__folder, .mbx__measure-row {
            position: relative; margin-left: -9px;
            display: flex; align-items: center; gap: 6px; text-align: left;
            padding: 7px 9px; border: 0; border-radius: var(--cms-radius, 6px); background: transparent;
            color: var(--cms-text); font-size: .875rem; white-space: nowrap;
        }
        .mbx__folder { width: calc(100% + 9px); cursor: pointer; }
        /* A long press opens the row's menu: the browser's own callout and text selection stay off the row. */
        .mbx__folder { -webkit-touch-callout: none; user-select: none; }
        /* A job runs on the folder: a small spinner, shown only after the state delay, so a quick one shows nothing. */
        .mbx__folder-spinner {
            flex: 0 0 auto; box-sizing: border-box;
            width: var(--cms-spinner-size-inline); height: var(--cms-spinner-size-inline);
            border: var(--cms-spinner-stroke) solid var(--cms-spinner-track);
            border-top-color: var(--cms-spinner-color);
            border-radius: 50%;
            animation: mbx-folder-appear 0s linear var(--cms-state-delay) both,
                       mbx-folder-turn var(--cms-spinner-duration) linear infinite;
        }
        @keyframes mbx-folder-turn { to { transform: rotate(360deg); } }
        @keyframes mbx-folder-appear { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mbx-folder-pulse { 50% { opacity: .35; } }
        @media (prefers-reduced-motion: reduce) {
            .mbx__folder-spinner {
                animation: mbx-folder-appear 0s linear var(--cms-state-delay) both,
                           mbx-folder-pulse 1.6s ease-in-out infinite;
            }
        }
        .mbx__new-folder {
            margin: 6px 0 0 -9px; width: calc(100% + 9px);
            display: flex; align-items: center; gap: 6px; text-align: left;
            padding: 7px 9px; border: 0; border-radius: var(--cms-radius, 6px); background: transparent;
            color: var(--cms-text-muted); font-size: .875rem; cursor: pointer;
        }
        .mbx__new-folder:hover { background: var(--cms-surface-hover); color: var(--cms-text); }
        .mbx__folder:hover { background: var(--cms-surface-hover); }
        .mbx__folder--holder, .mbx__folder--holder:hover {
            background: transparent; cursor: default; color: var(--cms-text-muted);
        }
        .mbx__folder--active { background: var(--cms-selected-light); font-weight: 600; }
        /* The icon starts at the column's edge, the size of the row's text and in its colour, at one width so every
           name of a level starts at the same x. */
        .mbx__folder-icon { flex: 0 0 1em; width: 1em; font-size: 1em; line-height: 1; color: inherit; text-align: center; }
        /* Only the name gives way: one line, cut with an ellipsis. */
        .mbx__folder-name { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mbx__folder-total { flex: 0 0 auto; color: var(--cms-text-muted); font-size: .75rem; white-space: nowrap; }
        /* A half-imported folder shows how far the backfill has walked it. */
        .mbx__folder-progress {
            position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
            background: var(--cms-border); border-radius: 0 0 4px 4px; overflow: hidden;
        }
        .mbx__folder-progress-bar {
            display: block; height: 100%; background: var(--cms-text-muted); opacity: .55;
        }
        /* A badge is always its text's width plus its padding. */
        .mbx__badge {
            flex: 0 0 auto; white-space: nowrap;
            background: var(--cms-accent, #F5A623); color: var(--cms-accent-fg, #1a1a1a); border-radius: 999px;
            font-size: .6875rem; padding: 1px 7px; min-width: 18px; text-align: center;
        }
        .mbx__rail-note { color: var(--cms-text-muted); font-size: .8125rem; padding: 12px; }
        /* Laid out but never seen, and taking no room: each row at its content's width, in the active row's weight. */
        .mbx__measure {
            position: absolute; left: 0; top: 0; width: 100%; height: 0; overflow: hidden;
            visibility: hidden; pointer-events: none;
        }
        .mbx__measure-row { width: max-content; font-weight: 600; }
        .mbx__measure-name { flex: 0 0 6ch; width: 6ch; }
    `],
})
export class MailFolderRailComponent {
    readonly rows = input.required<readonly FolderRow[]>();
    readonly selected = input.required<string>();
    /** Why the tree could not be read; null when it was, or is still being read. */
    readonly failure = input<unknown>(null);
    /** The tree has answered, so no rows means the mailbox has no folders. */
    readonly answered = input(false);
    /** New folder's label, at the foot of the list, when the person may make a top-level folder; null: not offered. */
    readonly newFolderLabel = input<string | null>(null);
    readonly chosen = output<string>();
    readonly retry = output<void>();
    /**
     * A row's menu is asked for: by right-click or a long press (at the point), or by Shift+F10 or the Menu key on the
     * focused row (under it, the row then the menu's opener).
     */
    readonly menu = output<FolderMenuAsk>();
    /** New folder at the foot of the list was pressed. */
    readonly create = output<void>();

    /** A touch held on a row: its timer, where it started, and the row. */
    private press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
    /** A long press opened the menu: the click that ends it selects nothing. */
    private swallowClick = false;
    /**
     * The rail's width, in px, its widest row needs: indent, icon, unread badge and total, with 6ch of name. Said when
     * the rows or their counts change and when the rail is resized, while it is shown.
     */
    readonly need = output<number>();

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

    constructor() {
        afterRenderEffect(() => {
            this.rows();
            this.measure();
        });
        const destroyRef = inject(DestroyRef);
        destroyRef.onDestroy(() => this.cancelPress());
        afterNextRender(() => {
            if (typeof ResizeObserver === 'undefined') {
                return;
            }
            const observer = new ResizeObserver(() => this.measure());
            observer.observe(this.host);
            destroyRef.onDestroy(() => observer.disconnect());
        });
    }

    /** The job running on a row's folder, or null. */
    protected busy(row: FolderRow): FolderJobAction | null {
        return row.flags?.busy ?? null;
    }

    protected busyText(action: FolderJobAction): string {
        return busyText(action);
    }

    /** Whether the row offers anything at all: a holder with none stays out of the tab order. */
    protected hasActions(row: FolderRow): boolean {
        const f = row.flags;
        return f !== undefined && f.busy === null && (f.canCreateChild || f.canRename || f.canMarkRead);
    }

    protected pressed(row: FolderRow): void {
        if (this.swallowClick) {
            this.swallowClick = false;
            return;
        }
        if (row.selectable) {
            this.chosen.emit(row.folder.folder);
        }
    }

    protected pointerMenu(event: MouseEvent, row: FolderRow): void {
        this.cancelPress();
        this.menu.emit({ folder: row.folder.folder, event, opener: null });
    }

    /** Shift+F10 or the Menu key on a focused row: the menu opens under it. */
    protected keyMenu(event: KeyboardEvent, row: FolderRow): void {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
            return;
        }
        event.preventDefault();
        const opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
        const rect = opener?.getBoundingClientRect();
        const at = new MouseEvent('contextmenu', { clientX: rect?.left ?? 0, clientY: rect?.bottom ?? 0 });
        this.menu.emit({ folder: row.folder.folder, event: at, opener });
    }

    /** A touch held about LONG_PRESS_MS without moving opens the row's menu where it is held. */
    protected pressStart(event: PointerEvent, row: FolderRow): void {
        if (event.pointerType !== 'touch') {
            return;
        }
        this.cancelPress();
        const x = event.clientX;
        const y = event.clientY;
        this.press = {
            x, y,
            timer: setTimeout(() => {
                this.press = null;
                this.swallowClick = true;
                this.menu.emit({ folder: row.folder.folder, event: new MouseEvent('contextmenu', { clientX: x, clientY: y }), opener: null });
            }, LONG_PRESS_MS),
        };
    }

    /** The finger moved to scroll: no menu. */
    protected pressMove(event: PointerEvent): void {
        if (this.press !== null && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > PRESS_SLOP_PX) {
            this.cancelPress();
        }
    }

    protected pressEnd(): void {
        this.cancelPress();
    }

    private cancelPress(): void {
        if (this.press !== null) {
            clearTimeout(this.press.timer);
            this.press = null;
        }
    }

    /** A row's left padding: the gutter, and 14px for each level down. */
    protected indent(row: FolderRow): number {
        return 9 + row.depth * 14;
    }

    /** A row's icon: by its role, and a folder for one that only holds folders, whatever its role. */
    protected icon(row: FolderRow): string {
        return row.selectable ? folderIcon(row.folder.role) : 'bi-folder';
    }

    protected unread(row: FolderRow): number {
        return folderUnread(row.folder);
    }

    protected count(row: FolderRow): string {
        return folderCount(row.folder);
    }

    /** The full name, then what the counts mean, how much is stored among them, and a job running on it. */
    protected rowTitle(row: FolderRow): string {
        const running = this.busy(row);
        const lines = [row.name];
        if (row.selectable) {
            lines.push(folderCountTitle(row.folder));
        }
        if (running !== null) {
            lines.push(busyText(running));
        }

        return lines.join('\n');
    }

    protected fraction(row: FolderRow): number | null {
        return importedFraction(row.folder);
    }

    /** Reads the widest measuring row and says what the rail needs; nothing while the rail is not shown. */
    private measure(): void {
        if (this.host.getClientRects().length === 0) {
            return;
        }
        let widest = 0;
        for (const row of Array.from(this.host.querySelectorAll<HTMLElement>('.mbx__measure-row'))) {
            // The row reaches into the gutter by its negative margin, so the rail needs that much less.
            const width = row.getBoundingClientRect().width + parseFloat(getComputedStyle(row).marginLeft || '0');
            widest = Math.max(widest, width);
        }
        this.need.emit(Math.ceil(widest));
    }
}
