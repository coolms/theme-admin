import { HttpClient, HttpContext } from '@angular/common/http';
import { DestroyRef, Directive, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { EMPTY, Observable, Subject, catchError, concatMap } from 'rxjs';
import { AppConfigState, BACKGROUND_REQUEST, type UserDto } from '@coolms/core-angular';

/** The two panes a splitter resizes; the message pane takes the rest. */
export type MailPane = 'folders' | 'list';

export type MailPaneWidths = Readonly<Record<MailPane, number>>;

/** Each resizable pane's limits and its default (the stylesheet's) width, in px. */
export const MAIL_PANE_LIMITS: Readonly<Record<MailPane, { readonly min: number; readonly max: number; readonly initial: number }>> = {
    folders: { min: 200, max: 380, initial: 230 },
    list: { min: 280, max: 620, initial: 340 },
};

/** The message pane is never narrower than this, in px. */
export const MAIL_MESSAGE_MIN = 360;

/** One splitter's own width, taken from the grid before the panes. */
const SPLITTER_WIDTH = 7;

/** The two splitters' own width, taken from the grid before the panes. */
const SPLITTERS_WIDTH = 2 * SPLITTER_WIDTH;

/** The narrowest grid that holds the folders, the list and the message at their minimums, with both splitters: 854px. */
export const MAIL_THREE_PANES_MIN = MAIL_PANE_LIMITS.folders.min + MAIL_PANE_LIMITS.list.min + MAIL_MESSAGE_MIN + SPLITTERS_WIDTH;

/** The narrowest grid that holds the list and the message at their minimums, with one splitter: 647px. */
export const MAIL_TWO_PANES_MIN = MAIL_PANE_LIMITS.list.min + MAIL_MESSAGE_MIN + SPLITTER_WIDTH;

/**
 * How many panes the grid shows side by side: all three where their minimums fit; the list and the message (the
 * folders one press away, in the list's place) where those two fit; else one at a time. A grid not measured (0)
 * shows three.
 */
export type MailPaneCount = 1 | 2 | 3;

/** How many panes a grid this wide shows side by side. */
export function mailPaneCount(grid: number): MailPaneCount {
    if (!(grid > 0) || grid >= MAIL_THREE_PANES_MIN) {
        return 3;
    }
    return grid >= MAIL_TWO_PANES_MIN ? 2 : 1;
}

/** The person's interface preference entry the admin keeps its pane widths in. */
export const MAIL_PANES_PREF = 'admin:mail:panes';

/** The browser's cache of each width, read first so the panes do not jump on load. */
export const MAIL_PANE_CACHE_KEYS: Readonly<Record<MailPane, string>> = {
    folders: 'coolms.email.railWidth',
    list: 'coolms.email.listWidth',
};

/** The splitters' names. */
export const MAIL_PANE_WORDS: Readonly<Record<MailPane, string>> = {
    folders: 'Resize folders',
    list: 'Resize list',
};

/** The panes as drawn: each width, and how far each splitter may go now. */
export interface MailPaneLayout extends MailPaneWidths {
    readonly foldersMax: number;
    readonly listMax: number;
}

function clamp(n: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, n));
}

/** A width within its pane's limits, rounded; null for anything that is not a finite number. */
export function clampPaneWidth(pane: MailPane, value: unknown): number | null {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
        return null;
    }
    const { min, max } = MAIL_PANE_LIMITS[pane];
    return Math.round(clamp(n, min, max));
}

/**
 * The panes in a grid this wide, from the widths the person chose: the message pane keeps its minimum by the list
 * giving way first, then the folder column, each down to its own minimum. Where only the list and the message show,
 * the list alone gives way. A grid not measured (0), or one showing a pane at a time, draws the chosen widths with
 * the static limits.
 */
export function mailPaneLayout(grid: number, chosen: MailPaneWidths): MailPaneLayout {
    const f = MAIL_PANE_LIMITS.folders;
    const l = MAIL_PANE_LIMITS.list;
    const wantFolders = clamp(chosen.folders, f.min, f.max);
    const wantList = clamp(chosen.list, l.min, l.max);
    const count = mailPaneCount(grid);
    if (!(grid > 0) || count === 1) {
        return { folders: wantFolders, list: wantList, foldersMax: f.max, listMax: l.max };
    }
    if (count === 2) {
        const twoRoom = grid - SPLITTER_WIDTH - MAIL_MESSAGE_MIN;
        return {
            folders: wantFolders,
            list: Math.max(l.min, Math.min(wantList, twoRoom)),
            foldersMax: f.max,
            listMax: clamp(twoRoom, l.min, l.max),
        };
    }
    const room = grid - SPLITTERS_WIDTH - MAIL_MESSAGE_MIN;
    const list = Math.max(l.min, Math.min(wantList, room - wantFolders));
    const folders = Math.max(f.min, Math.min(wantFolders, room - list));
    return {
        folders,
        list,
        foldersMax: clamp(room - list, f.min, f.max),
        listMax: clamp(room - folders, l.min, l.max),
    };
}

/** The body PATCH /auth/me/preferences takes for the pane widths: the one shape the server keeps. */
export function mailPanesSaveBody(widths: MailPaneWidths): unknown {
    return {
        uiPrefs: {
            [MAIL_PANES_PREF]: {
                columnWidths: { folders: Math.round(widths.folders), list: Math.round(widths.list) },
            },
        },
    };
}

/** The widths saved on the server, from GET /auth/me's uiPrefs, each clamped; a pane not saved is absent. */
export function serverPaneWidths(uiPrefs: unknown): Partial<Record<MailPane, number>> {
    const entry = (uiPrefs as Record<string, unknown> | null | undefined)?.[MAIL_PANES_PREF];
    const widths = (entry as { columnWidths?: unknown } | null | undefined)?.columnWidths;
    if (widths === null || typeof widths !== 'object') {
        return {};
    }
    const out: Partial<Record<MailPane, number>> = {};
    for (const pane of ['folders', 'list'] as const) {
        const w = clampPaneWidth(pane, (widths as Record<string, unknown>)[pane]);
        if (w !== null) {
            out[pane] = w;
        }
    }
    return out;
}

function readCache(pane: MailPane): number | null {
    try {
        return clampPaneWidth(pane, localStorage.getItem(MAIL_PANE_CACHE_KEYS[pane]));
    } catch {
        return null;
    }
}

function writeCache(pane: MailPane, width: number): void {
    try {
        localStorage.setItem(MAIL_PANE_CACHE_KEYS[pane], String(Math.round(width)));
    } catch {
        /* storage denied -- the server keeps the width */
    }
}

/**
 * The mail grid's pane widths, on the grid element: the browser's cache first, then the person's saved widths from
 * the server when they arrive (unless a splitter moved first); each move saved to both. The splitters draw
 * {@link layout}, which keeps the message pane at its minimum as the grid narrows; {@link count} says how many panes
 * the grid's width holds side by side.
 */
@Directive({
    selector: '[appMailPanes]',
    exportAs: 'appMailPanes',
    standalone: true,
})
export class MailPanesDirective {
    readonly words = MAIL_PANE_WORDS;
    readonly limits = MAIL_PANE_LIMITS;

    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);
    private readonly destroyRef = inject(DestroyRef);
    private readonly grid = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

    /** The widths the person chose. */
    private readonly chosen = signal<MailPaneWidths>({
        folders: readCache('folders') ?? MAIL_PANE_LIMITS.folders.initial,
        list: readCache('list') ?? MAIL_PANE_LIMITS.list.initial,
    });
    private readonly gridWidth = signal(0);
    /** A splitter moved on this page: the server's older answer no longer applies. */
    private moved = false;
    private readonly saves = new Subject<MailPaneWidths>();

    readonly layout = computed(() => mailPaneLayout(this.gridWidth(), this.chosen()));
    /** How many panes the grid shows side by side at its width now. */
    readonly count = computed(() => mailPaneCount(this.gridWidth()));

    constructor() {
        this.saves.pipe(
            concatMap(widths => this.save(widths)),
            takeUntilDestroyed(),
        ).subscribe();
        // GET /auth/me, read here rather than through IdentityApiClient.me(), whose manifest getter throws where no
        // manifest is loaded: an unread width leaves the cache's.
        const meUrl = this.store.selectSnapshot(AppConfigState.manifest)?.auth?.me;
        if (meUrl !== undefined && meUrl !== '') {
            this.http.get<UserDto | null>(meUrl).pipe(
                catchError(() => EMPTY),
                takeUntilDestroyed(),
            ).subscribe(me => this.serverAnswered(me?.uiPrefs));
        }
        afterNextRender(() => {
            this.gridWidth.set(this.grid.clientWidth);
            if (typeof ResizeObserver === 'undefined') {
                return;
            }
            const observer = new ResizeObserver(() => this.gridWidth.set(this.grid.clientWidth));
            observer.observe(this.grid);
            this.destroyRef.onDestroy(() => observer.disconnect());
        });
    }

    /** A splitter's drag or key ended at this width: kept, cached, and saved for the person. */
    resized(pane: MailPane, width: number): void {
        const w = clampPaneWidth(pane, width);
        if (w === null) {
            return;
        }
        this.moved = true;
        this.chosen.update(c => ({ ...c, [pane]: w }));
        writeCache(pane, w);
        this.saves.next(this.chosen());
    }

    private serverAnswered(uiPrefs: unknown): void {
        if (this.moved) {
            return;
        }
        const saved = serverPaneWidths(uiPrefs);
        if (saved.folders === undefined && saved.list === undefined) {
            return;
        }
        this.chosen.update(c => ({ folders: saved.folders ?? c.folders, list: saved.list ?? c.list }));
        for (const pane of ['folders', 'list'] as const) {
            const w = saved[pane];
            if (w !== undefined) {
                writeCache(pane, w);
            }
        }
    }

    private save(widths: MailPaneWidths): Observable<unknown> {
        const url = this.store.selectSnapshot(AppConfigState.manifest)?.auth?.preferencesUrl;
        if (url === undefined || url === '') {
            return EMPTY;
        }
        return this.http.patch(url, mailPanesSaveBody(widths), {
            headers: { 'Content-Type': 'application/merge-patch+json' },
            // Saved on the way, not a step the person waits on: a refusal opens no dialog.
            context: new HttpContext().set(BACKGROUND_REQUEST, true),
        }).pipe(
            // The cache keeps the width; the next move saves again.
            catchError(() => EMPTY),
        );
    }
}
