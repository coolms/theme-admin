import {
    ChangeDetectionStrategy,
    Component,
    HostListener,
    inject,
    input,
    output,
} from '@angular/core';
import { CalendarDto } from '../../api/api.service';
import { CalendarSettingsPanelComponent } from './calendar-settings-panel.component';

type SettingsTab = 'settings' | 'hours' | 'rules' | 'shares';

/**
 * — In-page Calendar settings side panel.
 *
 * Slides in from the right inside `calendar-detail.page.ts` (NOT in
 * the global right-side drawer). The architectural distinction:
 *  - Per-page settings (this) live inside the page content area;
 *    when the user navigates away the panel state is gone with the
 *    page itself, which is the right default.
 *  - The global DrawerService is reserved for cross-cutting
 *    surfaces (notifications, calendar quick-panel, scheduler
 *    tasks, etc.).
 *
 * Reuses `CalendarSettingsPanelComponent` for the body content (4
 * tabs: Settings / Hours / Holidays / Shares) so the actual form
 * code lives in one place. This wrapper provides:
 *  - the slide-in animation
 *  - the dimmed backdrop over the underlying calendar grid
 *  - X / ESC / click-backdrop close patterns
 *  - panel header with title + close button
 *
 * Width: 380px desktop; full-width on narrow viewports (<= 768px).
 *
 * Hosting: absolutely positioned inside `calendar-detail-shell`.
 * The parent must have `position: relative` (or be the host of a
 * positioned ancestor) so this overlay scopes to the page rather
 * than the document.
 */
@Component({
    selector: 'app-calendar-settings-side-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CalendarSettingsPanelComponent],
    template: `
        @if (open()) {
            <div class="backdrop" (click)="onBackdropClick()" aria-label="Close calendar settings"></div>
            <aside class="side-panel" role="dialog" aria-label="Calendar settings">
                <header class="side-panel__head">
                    <h2 class="side-panel__title">
                        <i class="bi bi-gear"></i> Calendar settings
                    </h2>
                    <button type="button" class="close-btn" (click)="close.emit()" title="Close (Esc)">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </header>
                <div class="side-panel__body">
                    <app-calendar-settings-panel
                            [calendar]="calendar()!"
                            [allCalendars]="allCalendars()"
                            [canEdit]="canEdit()"
                            [canManageShares]="canManageShares()"
                            [initialTab]="initialTab()"
                            [onCalendarChanged]="onCalendarChangedHandler"
                            [onRulesChanged]="onRulesChangedHandler" />
                </div>
            </aside>
        }
    `,
    styles: [`
        :host { display: contents; }

        .backdrop {
            position: absolute;
            inset: 0;
            background: var(--cms-overlay-scrim);
            z-index: 30;
            animation: fadeIn 160ms ease-out;
        }

        .side-panel {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            width: 380px;
            max-width: 100vw;
            background: var(--cms-surface, #fff);
            border-left: 1px solid var(--cms-border, #e5e7eb);
            box-shadow: -4px 0 16px rgba(0, 0, 0, .12);
            z-index: 31;
            display: flex;
            flex-direction: column;
            animation: slideIn 200ms ease-out;
        }

        @media (max-width: 768px) {
            .side-panel { width: 100%; }
        }

        .side-panel__head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
            flex-shrink: 0;
        }
        .side-panel__title {
            margin: 0;
            font-size: 1rem;
            font-weight: 600;
            color: var(--cms-text);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .close-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border: 0;
            background: transparent;
            border-radius: var(--cms-radius-sm, 4px);
            color: var(--cms-text-muted, #848b96);
            cursor: pointer;
        }
        .close-btn:hover { background: var(--cms-surface-muted); color: var(--cms-text); }

        .side-panel__body {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 12px 16px;
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
        }
        @keyframes slideIn {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
        }
    `],
})
export class CalendarSettingsSidePanelComponent {
    open             = input<boolean>(false);
    calendar         = input<CalendarDto | null>(null);
    allCalendars     = input<readonly CalendarDto[]>([]);
    canEdit          = input<boolean>(false);
    canManageShares  = input<boolean>(false);
    initialTab       = input<SettingsTab>('settings');

    /** Bridges back up to the parent so the events grid can refetch. */
    onCalendarChanged = input<(c: CalendarDto) => void>(() => undefined);
    onRulesChanged    = input<() => void>(() => undefined);

    close = output<void>();

    /**
     * Inputs on the embedded `CalendarSettingsPanelComponent` expect plain
     * callbacks (it's rendered via `*ngComponentOutlet` originally, where
     * EventEmitters can't be wired). We bridge our own input signals into
     * function references the child reads directly.
     */
    readonly onCalendarChangedHandler = (cal: CalendarDto): void => {
        this.onCalendarChanged()(cal);
    };
    readonly onRulesChangedHandler = (): void => {
        this.onRulesChanged()();
    };

    @HostListener('document:keydown.escape')
    onEscape(): void {
        if (this.open()) {
            this.close.emit();
        }
    }

    onBackdropClick(): void {
        this.close.emit();
    }
}
