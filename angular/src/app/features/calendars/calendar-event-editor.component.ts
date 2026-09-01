import { Dialog, DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    DestroyRef,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Observable, switchMap, filter } from 'rxjs';

import {
    ApiService,
    CalendarItemDto,
    CalendarItemStatusCode,
    CalendarItemTypeCode,
    CalendarItemVisibilityCode,
    CreateCalendarItemDto,
    NonWorkingDayPolicy,
} from '../../api/api.service';
import { ErrorHandlerService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    DateTimeRangePickerComponent,
    ModalComponent,
    ToastService,
    type DateTimeRangeValue,
} from '@coolms/ui-angular';
import {
    RecurrenceDialogComponent,
    type RecurrenceDialogData,
    type RecurrenceDialogResult,
} from './recurrence-form/recurrence-dialog.component';
import {
    buildPresetOptions,
    buildPresetSpec,
    detectPreset,
    summariseRecurrence,
    type RecurrencePresetKey,
} from './recurrence-form/recurrence-presets';
import {
    ScopePromptDialogComponent,
    type ScopePromptDialogData,
    type ScopePromptResult,
} from './recurrence-form/scope-prompt-dialog.component';

export interface CalendarEventEditorData {
    mode:          'create' | 'edit';
    calendarId:    string;
    calendarTz:    string;
    /** Edit-mode: the existing item. */
    item?:         CalendarItemDto;
    /** Create-mode: prefill values from a date-select drag. */
    defaultStart?: string;
    defaultEnd?:   string;
    defaultAllDay?: boolean;
    /** In edit-mode, gates the save / delete buttons. */
    canEdit?:      boolean;
    /**
     * Phase 2 — when set, the editor was opened from clicking a single
     * occurrence of a recurring series (the events card supplies the
     * displayed instant via `arg.event.start`). Save / delete will
     * prompt the user for scope ("only this" vs "all events") and
     * route to the right endpoint accordingly.
     *
     * NULL means we're editing the canonical row (e.g. from a list
     * view), so save / delete use the existing PATCH / DELETE paths
     * with no scope prompt.
     */
    occurrenceInstant?: string;
}

export type CalendarEventEditorResult =
    | { action: 'created'; item: CalendarItemDto }
    | { action: 'updated'; item: CalendarItemDto }
    /** Phase 2 — "only this event" save -> an override row was written. */
    | { action: 'overridden'; parentItemId: string; overrideId: string }
    /** Phase 3 — "this and following events" save -> series was split. */
    | { action: 'split'; parentItemId: string; newBaseId: string; seriesId: string | null }
    | { action: 'deleted'; id: string }
    /** Phase 2 — "only this event" delete -> EXDATE was appended to the parent. */
    | { action: 'occurrence-skipped'; parentItemId: string; recurrenceInstant: string }
    /** Phase 3 — "delete this and following events" -> series was truncated. */
    | { action: 'following-deleted'; parentItemId: string; recurrenceInstant: string }
    | { action: 'cancelled' };

const TYPES: ReadonlyArray<{ value: CalendarItemTypeCode; label: string }> = [
    { value: 'event',       label: 'Event' },
    { value: 'task',        label: 'Task' },
    { value: 'external',    label: 'External' },
];

const VISIBILITIES: ReadonlyArray<{ value: CalendarItemVisibilityCode; label: string }> = [
    { value: 'default',   label: 'Default' },
    { value: 'public',    label: 'Public' },
    { value: 'private',   label: 'Private' },
    { value: 'busy_only', label: 'Busy only' },
];

const STATUSES: ReadonlyArray<{ value: CalendarItemStatusCode; label: string }> = [
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'tentative', label: 'Tentative' },
    { value: 'cancelled', label: 'Cancelled' },
];

/**
 * — Calendar event editor modal.
 *
 * Supports create + edit + delete. Recurrence editing is delegated to
 * the structured `<app-recurrence-form>` component, which renders a
 * frequency-aware form (Daily / Weekly + BYDAY / Monthly + day-of-month
 * vs Nth weekday / Yearly + BYMONTH/BYMONTHDAY), end-mode picker
 * (never / on date / after N), exclusion chip list, and a debounced
 * "next 5 occurrences" preview against `POST /api/v1/recurrence/preview`.
 * Power users can drop into raw RFC 5545 via the form's "Custom" mode.
 *
 * On edit, the form attempts to parse the canonical row's recurrence
 * string back into structured state; anything outside the structured
 * subset (RDATE, BYSETPOS, multi-ordinal BYDAY) opens in raw mode so
 * no data is lost on round-trip.
 */
@Component({
    selector: 'app-calendar-event-editor',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule, DateTimeRangePickerComponent],
    template: `
        <app-modal [title]="title" [width]="540">
            <div class="form">

                <label class="field">Title
                    <input type="text" [(ngModel)]="title_" [disabled]="!editable"
                           placeholder="Event title" />
                </label>

                <div class="field-row">
                    <label class="field">Type
                        <select [(ngModel)]="type" [disabled]="!editable">
                            @for (t of types; track t.value) {
                                <option [ngValue]="t.value">{{ t.label }}</option>
                            }
                        </select>
                    </label>
                </div>

                <!-- : coupled datetime range with built-in all-day toggle.
                     The "When" field is required, so allowClear is off — the
                     user can't accidentally null the range with a single click. -->
                <app-datetime-range-picker
                    [value]="rangeValue()"
                    [disabled]="!editable"
                    [label]="'When'"
                    [allowClear]="false"
                    (valueChange)="onRangeChange($event)" />


                <label class="field">Location
                    <input type="text" [(ngModel)]="location" [disabled]="!editable"
                           placeholder="(optional)" />
                </label>

                <label class="field">Description
                    <textarea rows="3" [(ngModel)]="description" [disabled]="!editable"
                              placeholder="(optional)"></textarea>
                </label>

                <div class="field-row">
                    <label class="field">Color
                        <input type="color" [(ngModel)]="color" [disabled]="!editable" />
                    </label>
                    <label class="field">Visibility
                        <select [(ngModel)]="visibility" [disabled]="!editable">
                            @for (v of visibilities; track v.value) {
                                <option [ngValue]="v.value">{{ v.label }}</option>
                            }
                        </select>
                    </label>
                    <label class="field">Status
                        <select [(ngModel)]="status" [disabled]="!editable">
                            @for (s of statuses; track s.value) {
                                <option [ngValue]="s.value">{{ s.label }}</option>
                            }
                        </select>
                    </label>
                </div>

                <!-- Recurrence — preset dropdown, opens a sub-dialog for "Custom…". -->
                <div class="field">
                    <label>Repeats</label>
                    <select [ngModel]="recurrencePresetKey()"
                            (ngModelChange)="onPresetChange($event)"
                            [disabled]="!editable">
                        @for (opt of presetOptions(); track opt.key) {
                            <option [value]="opt.key">{{ opt.label }}</option>
                        }
                    </select>

                    @if (recurrencePresetKey() === 'custom' && recurrenceSpec()) {
                        <div class="recurrence-summary">
                            <span class="recurrence-summary__text">{{ recurrenceSummary() }}</span>
                            @if (editable) {
                                <button type="button" class="btn-link recurrence-summary__edit"
                                        (click)="openRecurrenceDialog()">Edit</button>
                            }
                        </div>
                    }
                </div>

                <!-- — non-working-day policy. Visible only when
                     the event actually has a recurrence; for one-shot
                     events the policy has no effect. -->
                @if (recurrenceSpec()) {
                    <div class="field">
                        <label>On non-working day</label>
                        <select [(ngModel)]="nwdPolicy" [disabled]="!editable">
                            <option value="off">Allow (default)</option>
                            <option value="skip">Skip the occurrence</option>
                            <option value="shift_forward">Shift to next working day</option>
                        </select>
                    </div>
                }

                @if (error()) {
                    <p class="error">{{ error() }}</p>
                }
            </div>

            <ng-container footer>
                @if (mode === 'edit' && editable) {
                    <button type="button" class="cms-btn cms-btn-danger footer__delete"
                            [disabled]="saving() || deleting()"
                            (click)="onDelete()">
                        <i class="bi bi-trash"></i>
                        {{ deleting() ? 'Deleting…' : 'Delete' }}
                    </button>
                }
                <button type="button" class="cms-btn"
                        (click)="onCancel()">Cancel</button>
                @if (editable) {
                    <button type="button" class="cms-btn cms-btn-primary"
                            [disabled]="saving() || deleting()"
                            (click)="onSave()">
                        {{ saving() ? 'Saving…' : (mode === 'create' ? 'Create' : 'Save changes') }}
                    </button>
                }
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .form { display: flex; flex-direction: column; gap: 12px; }
        .field { display: flex; flex-direction: column; gap: 4px; font-size: .85rem; }
        .field-inline { display: inline-flex; align-items: center; gap: 6px; font-size: .85rem; }
        .field-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 8px;
            align-items: end;
        }
        input, select, textarea {
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-sm, 4px);
            padding: 6px 8px;
            font-size: .9rem;
            font-family: inherit;
        }
        input[type="color"] { padding: 2px; height: 32px; }
        textarea { font-family: var(--cms-font-mono, monospace); }
        textarea.mono { font-family: var(--cms-font-mono, monospace); }
        .mono { font-family: var(--cms-font-mono, monospace); }

        /* Recurrence summary shown under the preset dropdown when the
           current value is a non-preset spec. Two lines: humanised
           summary on the left, "Edit" link on the right. */
        .recurrence-summary {
            display: flex; align-items: center; gap: 8px;
            margin-top: 4px;
            font-size: .8rem;
            color: var(--cms-text-muted, #848b96);
        }
        .recurrence-summary__text { flex: 1; }
        .recurrence-summary__edit {
            background: none; border: none; padding: 0;
            color: var(--cms-accent, #F5A623);
            font-size: .8rem; cursor: pointer;
            text-decoration: underline;
        }
        .error { color: var(--cms-danger, #dc2626); font-size: .85rem; margin: 0; }

        /* Footer slot is "display: flex; justify-content: flex-end; gap: 8px"
           (see styles.scss .cms-dialog-footer). Pushing the Delete button
           hard-left with margin-right: auto leaves Cancel + Save at the
           right edge — Gmail-style destructive-action placement. */
        .footer__delete { margin-right: auto; }
    `],
})
export class CalendarEventEditorComponent {
    /**
     * Last-resort color when neither the existing item nor the current
     * user's profile color is available. Accent blue, matches the
     * platform's primary action color.
     */
    static readonly FALLBACK_COLOR = '#2563eb';

    readonly data: CalendarEventEditorData = inject(DIALOG_DATA);
    readonly dialogRef: DialogRef<CalendarEventEditorResult> = inject(DialogRef);

    private readonly api        = inject(ApiService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dialog     = inject(Dialog);
    private readonly cdr        = inject(ChangeDetectorRef);

    readonly mode  = this.data.mode;
    readonly title = this.mode === 'create' ? 'New event' : 'Edit event';

    constructor() {
        this.loadDefaultColorFromProfile();
    }

    /**
     * In create mode, async-fetch the current user's profile to seed the
     * color picker with the user's avatarColor. Only swaps in the
     * profile color when the user hasn't already touched the input
     * (i.e. the field is still at the FALLBACK_COLOR). Edit mode is
     * skipped — we never trample an existing event's color choice.
     * Errors are swallowed silently: this is a UX nicety, not a hard
     * requirement, and falling through to the FALLBACK_COLOR is fine.
     */
    private loadDefaultColorFromProfile(): void {
        if (this.mode !== 'create' || this.data.item?.color) return;
        this.api.getMe().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: me => {
                const profileColor = me.avatarColor;
                if (profileColor && this.color === CalendarEventEditorComponent.FALLBACK_COLOR) {
                    this.color = profileColor;
                    // OnPush change detection skips the view rebuild when a
                    // bare property assignment fires asynchronously outside
                    // a user interaction. Without markForCheck the color
                    // picker keeps rendering the fallback blue until the
                    // user touches *any* control, at which point it
                    // suddenly snaps to the profile color. Manually marking
                    // the view dirty closes the gap and shows the profile
                    // color from the moment getMe resolves.
                    this.cdr.markForCheck();
                }
            },
            error: () => { /* keep fallback */ },
        });
    }

    readonly types        = TYPES;
    readonly visibilities = VISIBILITIES;
    readonly statuses     = STATUSES;

    /** Edit gating — false in edit-mode when caller passed canEdit=false. */
    readonly editable = this.mode === 'create' ? true : (this.data.canEdit !== false);

    // Form state
    title_:        string = this.data.item?.title ?? '';
    type:          CalendarItemTypeCode = (this.data.item?.type ?? 'event');
    // : coupled datetime range owned by <app-datetime-range-picker>.
    // We seed the picker's initial value from the existing item (edit)
    // or the date-select drag defaults (create). The picker emits
    // canonical ISO + allDay back into `rangeValue`.
    readonly rangeValue = signal<DateTimeRangeValue | null>(
        this.makeInitialRange(),
    );
    location:      string  = this.data.item?.location ?? '';
    description:   string  = this.data.item?.description ?? '';
    /**
     * Event color. Resolution order:
     *  1. Existing item color (edit mode).
     *  2. Current user's profile avatarColor (create mode, populated by
     *     {@see loadDefaultColorFromProfile} on init).
     *  3. Hardcoded `#2563eb` (accent blue) as the last-resort fallback
     *     when the user has no avatar color set or the /me fetch fails.
     * The initial value is the existing-item-or-blue pair; the profile
     * color overwrites blue once /me resolves (only when no item color
     * was supplied — we never trample an explicit per-event choice).
     */
    color:         string  = this.data.item?.color ?? CalendarEventEditorComponent.FALLBACK_COLOR;
    visibility:    CalendarItemVisibilityCode = (this.data.item?.visibility ?? 'default');
    status:        CalendarItemStatusCode     = (this.data.item?.status ?? 'confirmed');
    /**
     * — non-working-day handling for the series. Server default
     * is `off` so existing rows render with no change. Only sent on the
     * wire when the user actually picked a non-off value (saves a few
     * bytes and makes the diff in dev-tools cleaner).
     */
    nwdPolicy:     NonWorkingDayPolicy = (this.data.item?.nwdPolicy ?? 'off');

    /**
     * Recurrence spec — owned by the editor. The structured form lives
     * inside a sub-dialog opened from the Repeats dropdown's "Custom…"
     * option. Preset keys map cleanly onto canonical specs via
     * `buildPresetSpec`; anything outside the preset shapes is held
     * here as a raw RFC 5545 string and rendered as a summary line.
     */
    readonly recurrenceSpec = signal<string | null>(this.data.item?.recurrence ?? null);

    /**
     * Currently selected dropdown key. Computed from `recurrenceSpec`
     * at mount time so existing rows open on the matching preset (or
     * `custom` for non-preset shapes), then driven by the dropdown.
     */
    readonly recurrencePresetKey = signal<RecurrencePresetKey>(
        detectPreset(this.data.item?.recurrence ?? null, new Date(this.anchorStart())),
    );

    /** Dropdown options — labels are dtstart-derived. */
    readonly presetOptions = computed(() => buildPresetOptions(new Date(this.anchorStart())));

    /** Summary line shown under the dropdown when the spec is `custom`. */
    readonly recurrenceSummary = computed(() => summariseRecurrence(this.recurrenceSpec()));

    readonly saving   = signal(false);
    readonly deleting = signal(false);
    readonly error    = signal<string | null>(null);

    /**
     * Anchor instant used by recurrence presets + the sub-dialog's
     * structured form. Derives from the picker's current range start
     * when the user has picked a date; falls back to the create-mode
     * default or the current instant so labels like "Weekly on
     * Thursday" stay coherent before the user has set a When value.
     */
    anchorStart(): string {
        const range = this.rangeValue();
        if (range?.start) return range.start;
        if (this.data.defaultStart) return this.data.defaultStart;
        return new Date().toISOString();
    }

    onPresetChange(key: RecurrencePresetKey): void {
        if (key === 'custom') {
            // Opening the dialog is the "selection" — don't move the
            // dropdown until the user actually saves a custom spec.
            this.openRecurrenceDialog();
            return;
        }
        this.recurrencePresetKey.set(key);
        this.recurrenceSpec.set(buildPresetSpec(key, new Date(this.anchorStart())));
    }

    openRecurrenceDialog(): void {
        const data: RecurrenceDialogData = {
            value:    this.recurrenceSpec(),
            dtstart:  this.anchorStart(),
            tz:       this.data.calendarTz,
            disabled: !this.editable,
        };
        const ref = this.dialog.open<RecurrenceDialogResult, RecurrenceDialogData>(
            RecurrenceDialogComponent,
            { data },
        );
        ref.closed.subscribe(result => {
            if (result === undefined) return; // cancelled
            this.recurrenceSpec.set(result);
            this.recurrencePresetKey.set(
                detectPreset(result, new Date(this.anchorStart())),
            );
        });
    }

    /**
     * Seed the picker's initial value from the existing item (edit mode)
     * or from the date-select drag defaults (create mode). The picker
     * owns its own state thereafter; we just feed the kickoff.
     *
     * Robustness: existing rows in the wild can have `end = null` —
     * tasks legitimately do (`Task`-type items only carry a due `start`);
     * all-day events sometimes do too (older creates didn't always send
     * an `end`, and the DB column is nullable). Returning `null` from
     * here strands the user with an empty "When" field they can't open
     * to inspect the original date. So we synthesise a default end:
     *  - all-day -> same day (single-day event)
     *  - timed   -> start + 1 hour (most-common event duration)
     * The user can still adjust the range in the picker; we just refuse
     * to render an empty placeholder when we know the start.
     */
    private makeInitialRange(): DateTimeRangeValue | null {
        const allDay = this.data.item?.allDay ?? this.data.defaultAllDay ?? false;
        const start  = this.data.item?.start  ?? this.data.defaultStart ?? null;
        let   end    = this.data.item?.end    ?? this.data.defaultEnd   ?? null;
        if (!start) return null;
        if (!end) end = this.synthesiseEnd(start, allDay);
        return { start, end, allDay };
    }

    /**
     * Derive an end value when the existing row doesn't carry one.
     * For all-day events we return the same date (the picker renders
     * a single-day range). For timed events we add one hour to the
     * start so the picker shows the user a non-degenerate range they
     * can drag to adjust.
     */
    private synthesiseEnd(start: string, allDay: boolean): string {
        if (allDay) {
            // For all-day rows, `start` may be either a bare `YYYY-MM-DD`
            // or an ISO-with-T. The picker only consumes the first 10
            // chars for the date portion, so handing back the same string
            // produces a single-day range without any TZ ambiguity.
            return start;
        }
        const d = new Date(start);
        if (Number.isNaN(d.getTime())) return start; // pathological — return start so the picker still opens
        d.setHours(d.getHours() + 1);
        return d.toISOString();
    }

    onRangeChange(range: DateTimeRangeValue | null): void {
        this.rangeValue.set(range);
    }

    onCancel(): void {
        this.dialogRef.close({ action: 'cancelled' });
    }

    onSave(): void {
        if (!this.editable) return;
        if (this.title_.trim() === '') {
            this.error.set('Title is required.');
            return;
        }
        const range = this.rangeValue();
        if (!range) {
            this.error.set('Valid start + end date/time is required.');
            return;
        }
        this.error.set(null);

        // Phase 2/3 — editing one occurrence of a recurring series:
        // prompt for scope before committing. NULL `occurrenceInstant`
        // means we're editing the canonical row (list view, create
        // mode), so the existing PATCH/POST path applies directly.
        if (this.isOccurrenceEdit()) {
            this.promptScope('edit').then(scope => {
                if (scope === undefined) return; // user cancelled
                if (scope === 'this') {
                    this.commitOccurrenceOverride(range);
                } else if (scope === 'following') {
                    this.commitSeriesSplit(range);
                } else {
                    // 'all' falls through to the canonical PATCH.
                    this.commitCanonicalSave(range);
                }
            });
            return;
        }

        this.commitCanonicalSave(range);
    }

    /**
     * Existing path — POST a new item or PATCH the canonical row with
     * all current form values. Used in create mode, list-mode edits,
     * and "all events" scope on recurring edits.
     */
    private commitCanonicalSave(range: DateTimeRangeValue): void {
        this.saving.set(true);
        const payload: CreateCalendarItemDto = {
            calendarId:  this.data.calendarId,
            type:        this.type,
            title:       this.title_.trim(),
            description: this.description.trim() || null,
            location:    this.location.trim() || null,
            start:       range.start,
            end:         range.end,
            allDay:      range.allDay,
            recurrence:  this.recurrenceSpec(),
            color:       this.color || null,
            visibility:  this.visibility,
            status:      this.status,
            // — only send NWD policy when the event actually has
            // a recurrence; the field is a no-op otherwise and we'd
            // rather keep one-shot writes minimal.
            ...(this.recurrenceSpec() ? { nwdPolicy: this.nwdPolicy } : {}),
        };

        const obs$: Observable<CalendarItemDto> = this.mode === 'create'
            ? this.api.createCalendarItem(payload)
            : this.api.updateCalendarItem(this.data.item!.id, payload);

        obs$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: item => {
                this.saving.set(false);
                this.toast.success(this.mode === 'create' ? 'Event created' : 'Event updated');
                this.dialogRef.close(
                    this.mode === 'create'
                        ? { action: 'created', item }
                        : { action: 'updated', item },
                );
            },
            error: (err: unknown) => {
                this.saving.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }

    /**
     * Phase 3 — POST /calendar/items/{itemId}/split. Trims the base's
     * RRULE at the occurrence's original instant and creates a new
     * base item starting at the user-edited times. The form's
     * recurrence value is intentionally NOT sent — the new base
     * inherits the trimmed base's RRule structure server-side.
     */
    private commitSeriesSplit(range: DateTimeRangeValue): void {
        const item    = this.data.item!;
        const instant = this.data.occurrenceInstant!;
        this.saving.set(true);
        this.api.splitCalendarItem(item.id, {
            recurrenceInstant: instant,
            newStart:          range.start,
            newEnd:            range.end,
            title:             this.title_.trim(),
            description:       this.description.trim() || null,
            status:            this.status,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: res => {
                this.saving.set(false);
                this.toast.success('Series split at this occurrence');
                this.dialogRef.close({
                    action:       'split',
                    parentItemId: res.itemId,
                    newBaseId:    res.newBaseId,
                    seriesId:     res.seriesId,
                });
            },
            error: (err: unknown) => {
                this.saving.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }

    /**
     * Phase 2 — POST /calendar/items/{itemId}/exception. Writes an
     * override row for this single occurrence. The recurrence field
     * on the form is intentionally NOT included — overrides cover one
     * instance and never carry their own RRULE.
     */
    private commitOccurrenceOverride(range: DateTimeRangeValue): void {
        const item    = this.data.item!;
        const instant = this.data.occurrenceInstant!;
        this.saving.set(true);
        this.api.createCalendarItemException(item.id, {
            recurrenceInstant: instant,
            newStart:          range.start,
            newEnd:            range.end,
            title:             this.title_.trim(),
            description:       this.description.trim() || null,
            status:            this.status,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: res => {
                this.saving.set(false);
                this.toast.success('This occurrence updated');
                this.dialogRef.close({
                    action:       'overridden',
                    parentItemId: res.parentItemId,
                    overrideId:   res.overrideId,
                });
            },
            error: (err: unknown) => {
                this.saving.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }

    /**
     * True when the editor was opened on a single occurrence of a
     * recurring series — gated by both the data flag (set by the
     * events card when it opens the editor from a click on an
     * occurrence) AND the item actually carrying a recurrence spec.
     */
    private isOccurrenceEdit(): boolean {
        return this.mode === 'edit'
            && !!this.data.occurrenceInstant
            && !!this.data.item?.recurrence;
    }

    private promptScope(intent: 'edit' | 'delete'): Promise<ScopePromptResult> {
        const data: ScopePromptDialogData = {
            intent,
            itemTitle: this.data.item?.title,
        };
        return new Promise(resolve => {
            this.dialog.open<ScopePromptResult>(ScopePromptDialogComponent, { data })
                .closed.pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(result => resolve(result));
        });
    }

    onDelete(): void {
        if (!this.editable || this.mode !== 'edit' || !this.data.item) return;
        const item = this.data.item;

        // Phase 2/3 — deleting one occurrence of a recurring series
        // prompts for scope:
        //   "only this"      -> POST /skip (append EXDATE)
        //   "this and following" -> POST /delete-following (truncate RRULE)
        //   "all events"     -> existing DELETE on the canonical row
        if (this.isOccurrenceEdit()) {
            this.promptScope('delete').then(scope => {
                if (scope === undefined) return;
                if (scope === 'this') {
                    this.commitOccurrenceSkip();
                } else if (scope === 'following') {
                    this.commitDeleteFollowing();
                } else {
                    this.commitCanonicalDelete();
                }
            });
            return;
        }

        // Non-recurring (or canonical-row edit) delete — keep the
        // existing confirm-dialog flow.
        this.confirmSvc.open({
            title:        `Delete "${item.title}"?`,
            message:      item.recurrence
                ? 'This will delete the entire recurring event (all occurrences).'
                : 'This event will be permanently removed.',
            confirmLabel: 'Delete',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => {
                this.deleting.set(true);
                return this.api.deleteCalendarItem(item.id);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.deleting.set(false);
                this.toast.success('Event deleted');
                this.dialogRef.close({ action: 'deleted', id: item.id });
            },
            error: (err: unknown) => {
                this.deleting.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }

    private commitOccurrenceSkip(): void {
        const item    = this.data.item!;
        const instant = this.data.occurrenceInstant!;
        this.deleting.set(true);
        this.api.skipCalendarItemOccurrence(item.id, instant)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: res => {
                    this.deleting.set(false);
                    this.toast.success('This occurrence skipped');
                    this.dialogRef.close({
                        action:            'occurrence-skipped',
                        parentItemId:      res.itemId,
                        recurrenceInstant: res.recurrenceInstant,
                    });
                },
                error: (err: unknown) => {
                    this.deleting.set(false);
                    this.error.set(this.errors.humanize(err));
                },
            });
    }

    private commitDeleteFollowing(): void {
        const item    = this.data.item!;
        const instant = this.data.occurrenceInstant!;
        this.deleting.set(true);
        this.api.deleteFollowingCalendarItem(item.id, instant)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: res => {
                    this.deleting.set(false);
                    this.toast.success('This and following occurrences removed');
                    this.dialogRef.close({
                        action:            'following-deleted',
                        parentItemId:      res.itemId,
                        recurrenceInstant: res.recurrenceInstant,
                    });
                },
                error: (err: unknown) => {
                    this.deleting.set(false);
                    this.error.set(this.errors.humanize(err));
                },
            });
    }

    private commitCanonicalDelete(): void {
        const item = this.data.item!;
        this.deleting.set(true);
        this.api.deleteCalendarItem(item.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.deleting.set(false);
                    this.toast.success('Event deleted');
                    this.dialogRef.close({ action: 'deleted', id: item.id });
                },
                error: (err: unknown) => {
                    this.deleting.set(false);
                    this.error.set(this.errors.humanize(err));
                },
            });
    }
}

