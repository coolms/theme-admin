import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';

import { UserCalendarPreferencesService } from '@coolms/ui-angular';

interface MiniCell {
    readonly date:       Date;
    readonly dayNumber:  number;
    readonly inMonth:    boolean;
    readonly isToday:    boolean;
    readonly isSelected: boolean;
    readonly key:        string; // YYYY-MM-DD
}

/**
 * M1.2.f.1 — Tiny month-view calendar for the Calendar Detail sidebar.
 *
 * Renders a 6x7 month grid (always 42 cells so layout never reflows
 * between months). Pure presentation — emits `dateSelect` when a cell
 * is clicked; the parent owns the rest (e.g., scrolls FullCalendar's
 * main grid to the chosen date).
 *
 * Keeps its own `displayedMonth` cursor in a signal so prev / next
 * buttons work without parent involvement. The `selectedDate` input
 * highlights the currently-focused day in the main grid (parent
 * supplies it; we don't track it internally).
 *
 * Chose a custom component instead of FullCalendar's `multiMonth` view
 * because: (a) much smaller JS bundle, (b) fully controllable styles,
 * (c) no second `Calendar` instance + render lifecycle to keep in sync.
 */
@Component({
    selector: 'app-mini-calendar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="mini">
            <header class="mini__head">
                <button type="button" class="nav" (click)="prevMonth()"
                        aria-label="Previous month">
                    <i class="bi bi-chevron-left"></i>
                </button>
                <button type="button" class="title" (click)="goToday()"
                        title="Click to jump to today">
                    {{ monthLabel() }}
                </button>
                <button type="button" class="nav" (click)="nextMonth()"
                        aria-label="Next month">
                    <i class="bi bi-chevron-right"></i>
                </button>
            </header>

            <div class="mini__weekdays">
                @for (wd of weekdayLabels(); track wd) {
                    <span class="wd">{{ wd }}</span>
                }
            </div>

            <div class="mini__grid">
                @for (cell of cells(); track cell.key) {
                    <button type="button"
                            class="cell"
                            [class.cell--out]="!cell.inMonth"
                            [class.cell--today]="cell.isToday"
                            [class.cell--selected]="cell.isSelected"
                            (click)="onSelect(cell)">
                        {{ cell.dayNumber }}
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        :host { display: block; }
        .mini {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px);
            padding: 10px;
            font-size: .8rem;
            user-select: none;
        }
        .mini__head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
            margin-bottom: 6px;
        }
        .nav {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            border: 0;
            background: transparent;
            border-radius: var(--cms-radius-sm, 4px);
            color: var(--cms-text-muted, #848b96);
            cursor: pointer;
        }
        .nav:hover { background: var(--cms-surface-muted); color: var(--cms-text); }
        .title {
            flex: 1;
            border: 0;
            background: transparent;
            font-weight: 600;
            font-size: .85rem;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: var(--cms-radius-sm, 4px);
            color: var(--cms-text);
        }
        .title:hover { background: var(--cms-surface-muted); }

        .mini__weekdays {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
            margin-bottom: 4px;
        }
        .wd {
            text-align: center;
            font-size: .65rem;
            font-weight: 600;
            color: var(--cms-text-muted, #848b96);
            text-transform: uppercase;
        }

        .mini__grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
        }
        .cell {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            aspect-ratio: 1;
            border: 1px solid transparent;
            background: transparent;
            color: var(--cms-text);
            font-size: .75rem;
            border-radius: var(--cms-radius-sm, 4px);
            cursor: pointer;
            line-height: 1;
        }
        .cell:hover { background: var(--cms-surface-muted); }
        .cell--out { color: var(--cms-text-muted); }
        .cell--today {
            border-color: var(--cms-accent, #F5A623);
            font-weight: 600;
        }
        .cell--selected {
            background: var(--cms-accent, #F5A623);
            color: var(--cms-accent-fg, #1a1a1a);
        }
        .cell--selected:hover { background: var(--cms-accent, #F5A623); }
    `],
})
export class MiniCalendarComponent {
    /** Selected date in the main grid (highlighted blue). */
    selectedDate = input<Date | null>(null);

    /** Emitted when a date cell is clicked. */
    dateSelect = output<Date>();

    /** Emitted when the displayed month changes (prev / next click). */
    monthChange = output<{ year: number; month: number }>();

    private readonly userPrefs = inject(UserCalendarPreferencesService);

    /**
     * Weekday header labels — re-orderable based on the user's week-start
     * preference (Task #433). Monday = ISO default; Sunday = US.
     */
    readonly weekdayLabels = computed<readonly string[]>(() =>
        this.userPrefs.weekStart() === 'sunday'
            ? ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
            : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    );

    /**
     * Cursor: year + 0-based month displayed by this mini-cal.
     *
     * Initialised lazily via a factory so we evaluate `new Date()` at
     * construction time rather than at module-load time — the latter
     * was the root cause of the "shows April when today is May 30"
     * bug, because module-level signal initialisers were captured
     * when Vite first imported the file (often the prior month).
     */
    private readonly cursor = signal<{ year: number; month: number }>(
        (() => {
            const now = new Date();
            return { year: now.getFullYear(), month: now.getMonth() };
        })(),
    );

    constructor() {
        // Follow the parent's selectedDate when it moves to a different
        // month. Without this, the user clicks Today / a far-off date in
        // the main grid and the mini-cal stays put — confusing because
        // the highlighted "selected" cell renders as an out-of-month
        // greyed-out cell on an unrelated month grid.
        effect(() => {
            const sel = this.selectedDate();
            if (!sel) return;
            const c = untracked(() => this.cursor());
            if (sel.getFullYear() !== c.year || sel.getMonth() !== c.month) {
                untracked(() => this.cursor.set({
                    year:  sel.getFullYear(),
                    month: sel.getMonth(),
                }));
            }
        });
    }

    readonly monthLabel = computed(() => {
        const c = this.cursor();
        return new Date(c.year, c.month, 1).toLocaleString(undefined, {
            month: 'long',
            year:  'numeric',
        });
    });

    readonly cells = computed<MiniCell[]>(() => {
        const { year, month } = this.cursor();
        const today = this.todayKey();
        const selKey = this.dateKey(this.selectedDate());

        const firstOfMonth = new Date(year, month, 1);
        // Task #433 — shift so the grid's column 0 lines up with the user's
        // chosen week-start day. Monday-start: 0 = Monday (ISO). Sunday-start
        // (US convention): 0 = Sunday (native JS getDay() == 0).
        const sundayStart = this.userPrefs.weekStart() === 'sunday';
        const offsetIntoWeek = sundayStart
            ? firstOfMonth.getDay()
            : (firstOfMonth.getDay() + 6) % 7;
        const start = new Date(year, month, 1 - offsetIntoWeek);

        const out: MiniCell[] = [];
        for (let i = 0; i < 42; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const key = this.dateKey(d)!; // d is always a real Date — never null
            out.push({
                date:       d,
                dayNumber:  d.getDate(),
                inMonth:    d.getMonth() === month,
                isToday:    key === today,
                isSelected: selKey !== null && key === selKey,
                key,
            });
        }
        return out;
    });

    /** Programmatic navigation (used by parent when main grid scrolls). */
    setMonth(year: number, month: number): void {
        this.cursor.set({ year, month });
    }

    prevMonth(): void {
        const c = this.cursor();
        const d = new Date(c.year, c.month - 1, 1);
        const next = { year: d.getFullYear(), month: d.getMonth() };
        this.cursor.set(next);
        this.monthChange.emit(next);
    }

    nextMonth(): void {
        const c = this.cursor();
        const d = new Date(c.year, c.month + 1, 1);
        const next = { year: d.getFullYear(), month: d.getMonth() };
        this.cursor.set(next);
        this.monthChange.emit(next);
    }

    goToday(): void {
        const now = new Date();
        const next = { year: now.getFullYear(), month: now.getMonth() };
        this.cursor.set(next);
        this.monthChange.emit(next);
        this.dateSelect.emit(now);
    }

    onSelect(cell: MiniCell): void {
        // If user clicked an out-of-month cell, also slide the cursor.
        if (!cell.inMonth) {
            this.cursor.set({
                year:  cell.date.getFullYear(),
                month: cell.date.getMonth(),
            });
            this.monthChange.emit({
                year:  cell.date.getFullYear(),
                month: cell.date.getMonth(),
            });
        }
        this.dateSelect.emit(cell.date);
    }

    private dateKey(d: Date | null): string | null {
        if (!d) return null;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    private todayKey(): string {
        return this.dateKey(new Date())!;
    }
}
