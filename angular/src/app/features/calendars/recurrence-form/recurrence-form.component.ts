import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    EventEmitter,
    Input,
    OnChanges,
    OnInit,
    Output,
    SimpleChanges,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

import { ApiService } from '../../../api/api.service';
import { DateTimeFormatService } from '@coolms/ui-angular';
import {
    type EndMode,
    MONTHS,
    type MonthlyAnchor,
    ORDINALS,
    type RecurrenceFormState,
    type RecurrenceFreq,
    WEEKDAYS,
    type WeekdayCode,
    buildDefaultState,
    parseRecurrence,
    serializeRecurrence,
} from './recurrence-form.types';

/**
 * `<app-recurrence-form>` — human-friendly RFC 5545 RRULE builder.
 *
 * Replaces the existing 3-mode none / simple / advanced toggle with
 * one structured form covering the common cases:
 *
 *  - **Daily / Weekly / Monthly / Yearly** with interval.
 *  - **Weekly**: weekday picker (Mon-Sun checkboxes).
 *  - **Monthly**: "Day N" vs "Nth weekday of month" toggle.
 *  - **Yearly**: month + day pickers.
 *  - **End mode**: never / on date / after N occurrences.
 *  - **Exclusions**: chip list of EXDATEs with add / remove.
 *  - **Preview**: debounced backend call shows next 5 occurrences.
 *
 * Power users can drop into a raw RFC 5545 textarea via the "Edit raw
 * spec" toggle. On mount, the component attempts to parse an incoming
 * spec into structured form state; specs beyond the structured form's
 * expressiveness (RDATE lines, BYSETPOS, multiple BYDAY ordinals, etc.)
 * automatically open in raw mode so no data is lost.
 *
 * The component emits the serialised spec on every change via
 * `(valueChange)`. Emits `null` when the user picks "Doesn't repeat".
 */
@Component({
    selector: 'app-recurrence-form',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="rrule-form">

            <!-- Frequency dropdown — drives which sub-form is visible.
                 The "Doesn't repeat" option is hidden when [allowNone]=false
                 (the case when this form is hosted inside a sub-dialog opened
                 from a parent "Custom…" selection — the user already opted
                 into recurrence, so a NONE option is misleading clutter). -->
            <div class="rrule-row">
                <label class="field">
                    <span class="field__label">Repeats</span>
                    <select [ngModel]="state().mode" (ngModelChange)="setMode($event)"
                            [disabled]="disabled">
                        @if (allowNone) {
                            <option value="NONE">Doesn't repeat</option>
                        }
                        <option value="DAILY">Daily</option>
                        <option value="WEEKLY">Weekly</option>
                        <option value="MONTHLY">Monthly</option>
                        <option value="YEARLY">Yearly</option>
                        <option value="RAW">Custom (RFC 5545)</option>
                    </select>
                </label>

                @if (state().mode !== 'NONE' && state().mode !== 'RAW') {
                    <label class="field field--narrow">
                        <span class="field__label">Every</span>
                        <input type="number" min="1" max="365"
                               [ngModel]="state().interval"
                               (ngModelChange)="setInterval($event)"
                               [disabled]="disabled" />
                    </label>
                    <span class="rrule-row__unit">{{ intervalUnit() }}</span>
                }
            </div>

            <!-- Raw mode: just a textarea passthrough. -->
            @if (state().mode === 'RAW') {
                <label class="field">
                    <span class="field__label">RFC 5545 spec</span>
                    <textarea rows="4" class="mono"
                              [ngModel]="state().rawSpec"
                              (ngModelChange)="setRawSpec($event)"
                              [disabled]="disabled"
                              placeholder="RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR&#10;EXDATE:20260501T090000Z"></textarea>
                </label>
                <p class="hint">
                    Multi-line. Backend parses via
                    <code>the server's RRULE parser</code>. See RFC 5545 §3.8.5.
                </p>
            }

            <!-- WEEKLY: weekday picker. -->
            @if (state().mode === 'WEEKLY') {
                <div class="field">
                    <span class="field__label">On these days</span>
                    <div class="weekday-picker">
                        @for (wd of weekdays; track wd.code) {
                            <button type="button"
                                    class="weekday-picker__btn"
                                    [class.is-selected]="isWeekdaySelected(wd.code)"
                                    [disabled]="disabled"
                                    [title]="wd.long"
                                    (click)="toggleWeekday(wd.code)">
                                {{ wd.short }}
                            </button>
                        }
                    </div>
                </div>
            }

            <!-- MONTHLY: anchor type radio + per-shape sub-fields. -->
            @if (state().mode === 'MONTHLY') {
                <fieldset class="anchor">
                    <legend>On</legend>
                    <label class="field-inline">
                        <input type="radio" name="manchor" value="dayOfMonth"
                               [checked]="state().monthlyAnchor.kind === 'dayOfMonth'"
                               [disabled]="disabled"
                               (change)="setMonthlyAnchorKind('dayOfMonth')" />
                        Day
                        <input type="number" min="1" max="31"
                               class="inline-input"
                               [ngModel]="monthlyDayOfMonth()"
                               (ngModelChange)="setMonthlyDayOfMonth($event)"
                               [disabled]="disabled || state().monthlyAnchor.kind !== 'dayOfMonth'" />
                    </label>
                    <label class="field-inline">
                        <input type="radio" name="manchor" value="weekdayOfMonth"
                               [checked]="state().monthlyAnchor.kind === 'weekdayOfMonth'"
                               [disabled]="disabled"
                               (change)="setMonthlyAnchorKind('weekdayOfMonth')" />
                        The
                        <select [ngModel]="monthlyOrdinal()"
                                (ngModelChange)="setMonthlyOrdinal($event)"
                                [disabled]="disabled || state().monthlyAnchor.kind !== 'weekdayOfMonth'">
                            @for (o of ordinals; track o.value) {
                                <option [ngValue]="o.value">{{ o.label }}</option>
                            }
                        </select>
                        <select [ngModel]="monthlyWeekday()"
                                (ngModelChange)="setMonthlyWeekday($event)"
                                [disabled]="disabled || state().monthlyAnchor.kind !== 'weekdayOfMonth'">
                            @for (wd of weekdays; track wd.code) {
                                <option [ngValue]="wd.code">{{ wd.long }}</option>
                            }
                        </select>
                    </label>
                </fieldset>
            }

            <!-- YEARLY: month + day. -->
            @if (state().mode === 'YEARLY') {
                <div class="rrule-row">
                    <label class="field">
                        <span class="field__label">In</span>
                        <select [ngModel]="state().yearMonth"
                                (ngModelChange)="setYearMonth($event)"
                                [disabled]="disabled">
                            @for (m of months; track m.value) {
                                <option [ngValue]="m.value">{{ m.label }}</option>
                            }
                        </select>
                    </label>
                    <label class="field field--narrow">
                        <span class="field__label">On day</span>
                        <input type="number" min="1" max="31"
                               [ngModel]="state().yearDay"
                               (ngModelChange)="setYearDay($event)"
                               [disabled]="disabled" />
                    </label>
                </div>
            }

            <!-- End mode: 3 radios. Hidden in NONE / RAW. -->
            @if (state().mode !== 'NONE' && state().mode !== 'RAW') {
                <fieldset class="end">
                    <legend>Ends</legend>
                    <label class="field-inline">
                        <input type="radio" name="endmode" value="never"
                               [checked]="state().end.kind === 'never'"
                               [disabled]="disabled"
                               (change)="setEndKind('never')" />
                        Never
                    </label>
                    <label class="field-inline">
                        <input type="radio" name="endmode" value="untilDate"
                               [checked]="state().end.kind === 'untilDate'"
                               [disabled]="disabled"
                               (change)="setEndKind('untilDate')" />
                        On
                        <input type="date" class="inline-input"
                               [ngModel]="endDateOrEmpty()"
                               (ngModelChange)="setEndDate($event)"
                               [disabled]="disabled || state().end.kind !== 'untilDate'" />
                    </label>
                    <label class="field-inline">
                        <input type="radio" name="endmode" value="afterCount"
                               [checked]="state().end.kind === 'afterCount'"
                               [disabled]="disabled"
                               (change)="setEndKind('afterCount')" />
                        After
                        <input type="number" min="1" max="9999"
                               class="inline-input inline-input--narrow"
                               [ngModel]="endCountOrOne()"
                               (ngModelChange)="setEndCount($event)"
                               [disabled]="disabled || state().end.kind !== 'afterCount'" />
                        occurrences
                    </label>
                </fieldset>
            }

            <!-- Exclusions list: chip per EXDATE, add via date picker.
                 Rendered as a single inline row (label + chips + date+add)
                 rather than label-above + bordered-card-below, to keep the
                 form short. The dashed-border card was visually heavy and
                 introduced ~80px of perceived vertical weight when empty. -->
            @if (state().mode !== 'NONE' && state().mode !== 'RAW') {
                <div class="exclude-row">
                    <span class="field__label exclude-row__label">Skip dates</span>
                    @for (iso of state().excludeDates; track iso) {
                        <span class="exclude__chip">
                            {{ formatLocalDate(iso) }}
                            <button type="button" class="exclude__remove"
                                    [disabled]="disabled"
                                    (click)="removeExclude(iso)"
                                    title="Remove exclusion"
                                    aria-label="Remove exclusion">×</button>
                        </span>
                    }
                    <span class="exclude-row__add">
                        <input type="date" class="inline-input"
                               [ngModel]="excludeDraft()"
                               (ngModelChange)="excludeDraft.set($event)"
                               [disabled]="disabled" />
                        <button type="button" class="cms-btn cms-btn-link"
                                [disabled]="disabled || !excludeDraft()"
                                (click)="addExclude()">+ Add</button>
                    </span>
                </div>
            }

            <!-- Preview list: next 5 occurrences from backend. -->
            @if (state().mode !== 'NONE') {
                <div class="preview">
                    <div class="preview__head">
                        <span class="field__label">Next occurrences</span>
                        @if (previewLoading()) {
                            <span class="preview__pending">Loading…</span>
                        }
                    </div>

                    @if (previewError()) {
                        <p class="error">{{ previewError() }}</p>
                    } @else if (preview().length === 0 && !previewLoading()) {
                        <p class="hint">No occurrences inside the {{ horizonYears }}-year preview window.</p>
                    } @else {
                        <ul class="preview__list">
                            @for (iso of preview(); track iso) {
                                <li>{{ formatLocalDateTime(iso) }}</li>
                            }
                        </ul>
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        /* Angular components default to display: inline. Without this,
           the flex children below collapse into a zero-width column. */
        :host {
            display: block;
            width: 100%;
            min-width: 0;
        }
        .rrule-form {
            display: flex; flex-direction: column;
            gap: 10px; padding: 0;
            width: 100%; min-width: 0;
            box-sizing: border-box;
        }
        .rrule-row {
            display: flex; flex-wrap: wrap;
            gap: 10px; align-items: end;
            width: 100%; min-width: 0;
        }
        .rrule-row__unit {
            font-size: .8125rem;
            color: var(--cms-text-muted, #848b96);
            margin-bottom: 6px;
        }
        .field {
            display: flex; flex-direction: column;
            gap: 4px; font-size: .8125rem;
            min-width: 0;
        }
        /* Horizontal flex sizing ONLY applies to fields inside a .rrule-row
           (row-direction flex). When .field is a direct child of .rrule-form
           (column-direction flex), "flex: 1 1 160px" would be interpreted as a
           160px HEIGHT basis — forcing single-row fields like "On these days"
           or "RFC 5545 spec" to be 160px tall regardless of content, which
           reads as a fat empty rectangle below the visible row. */
        .rrule-row > .field { flex: 1 1 160px; }
        .rrule-row > .field--narrow { flex: 0 0 96px; }
        /* Match the platform .cms-label style (see styles.scss). */
        .field__label {
            font-size: .8125rem;
            font-weight: 500;
            color: var(--cms-text-secondary, #6b7280);
        }
        .field-inline {
            display: inline-flex; align-items: center;
            gap: 6px; font-size: .8125rem;
            margin-right: 12px;
        }
        input, select, textarea {
            border: 1px solid var(--cms-btn-border, #d1d5db);
            border-radius: var(--cms-radius, 4px);
            padding: 5px 10px;
            font-size: .8125rem;
            font-family: inherit;
            box-sizing: border-box;
            max-width: 100%;
            color: var(--cms-text, #111827);
            background: var(--cms-surface);
        }
        /* Field-scoped inputs/selects (those owning their own row) take
           the field's full width. Inline inputs (next to a label like
           "Day N") stay narrow. */
        .field > input,
        .field > select,
        .field > textarea {
            width: 100%;
        }
        .inline-input { width: 80px; flex: 0 0 auto; }
        /* date inputs need extra space for the spinners + native picker icon. */
        .inline-input[type="date"] { width: 150px; }
        .inline-input--narrow { width: 72px; flex: 0 0 auto; }
        textarea.mono {
            font-family: var(--cms-font-mono, monospace);
        }

        /* Weekday picker — toggle pills */
        .weekday-picker {
            display: flex; gap: 4px;
        }
        .weekday-picker__btn {
            width: 36px; height: 32px;
            border: 1px solid var(--cms-border, #e5e7eb);
            background: var(--cms-surface);
            border-radius: var(--cms-radius-sm, 4px);
            font-size: .85rem;
            cursor: pointer;
            transition: background .12s, color .12s, border-color .12s;
        }
        .weekday-picker__btn:disabled {
            cursor: not-allowed; opacity: .6;
        }
        .weekday-picker__btn:hover:not(:disabled) {
            border-color: var(--cms-accent, #F5A623);
        }
        .weekday-picker__btn.is-selected {
            background: var(--cms-accent, #F5A623);
            color: var(--cms-accent-fg, #1a1a1a);
            border-color: var(--cms-accent, #F5A623);
        }

        /* Anchor + End fieldsets — flat radio rows */
        .anchor, .end {
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius, 4px);
            padding: 6px 12px 8px;
            margin: 0;
        }
        .anchor legend, .end legend {
            padding: 0 6px;
            font-size: .8125rem;
            font-weight: 500;
            color: var(--cms-text-secondary, #6b7280);
        }
        .anchor .field-inline, .end .field-inline {
            display: flex;
            flex-wrap: wrap;
            margin: 4px 0 0;
            row-gap: 4px;
        }

        /* Exclusions: one inline row — label, chips, then a date input +
           Add link. No bordered card; the field stack's natural gap is
           visual separation enough. */
        .exclude-row {
            display: flex; flex-wrap: wrap;
            gap: 6px; align-items: center;
        }
        .exclude-row__label {
            margin-right: 4px;
        }
        .exclude-row__add {
            display: inline-flex; align-items: center; gap: 4px;
            margin-left: auto;
        }
        .exclude__chip {
            display: inline-flex; align-items: center;
            gap: 4px;
            background: var(--cms-surface-muted);
            border-radius: 12px;
            padding: 2px 4px 2px 10px;
            font-size: .8rem;
        }
        .exclude__remove {
            background: transparent;
            border: none;
            color: var(--cms-text-muted, #848b96);
            cursor: pointer;
            font-size: 1rem;
            line-height: 1;
            padding: 0 4px;
        }
        .exclude__remove:hover:not(:disabled) {
            color: var(--cms-danger, #dc2626);
        }

        /* Preview */
        .preview {
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius, 4px);
            padding: 6px 12px 8px;
            background: var(--cms-surface-muted);
        }
        .preview__head {
            display: flex; align-items: center;
            gap: 8px;
        }
        .preview__pending {
            font-size: .75rem;
            color: var(--cms-text-muted, #848b96);
        }
        .preview__list {
            list-style: disc;
            margin: 4px 0 0;
            padding-left: 20px;
            font-size: .8125rem;
            color: var(--cms-text, #111827);
        }
        .preview__list li { margin: 1px 0; }


        .hint { font-size: .75rem; color: var(--cms-text-muted, #848b96); margin: 4px 0 0; }
        .hint--inline { margin: 0; }
        .error { font-size: .8rem; color: var(--cms-danger, #dc2626); margin: 4px 0 0; }
        code {
            font-family: var(--cms-font-mono, monospace);
            background: var(--cms-surface-muted); padding: 1px 4px; border-radius: 3px;
        }
    `],
})
export class RecurrenceFormComponent implements OnInit, OnChanges {
    /** Initial RFC 5545 spec. `null` = no recurrence. */
    @Input() value: string | null = null;

    /** Anchor instant. ISO 8601 with offset. Required. */
    @Input({ required: true }) dtstart!: string;

    /** Optional named TZ for preview emission. */
    @Input() tz: string | null = null;

    /** Read-only mode. */
    @Input() disabled = false;

    /** Number of preview occurrences to fetch. */
    @Input() previewCount = 5;

    /** Preview window safety horizon, in years. */
    @Input() horizonYears = 2;

    /**
     * When `false`, hides the "Doesn't repeat" option from the Repeats
     * dropdown and bootstraps the form at DAILY when `value` is null /
     * empty. Used when this form is hosted inside a sub-dialog opened
     * from a parent "Custom…" / "Configure…" selection — at that point
     * the user has already opted into recurrence, so offering NONE again
     * is misleading clutter (closing the dialog without saving is the
     * cancel path; the outer "Doesn't repeat" preset is the remove path).
     *
     * Default `true` preserves existing inline-form behaviour (Calendar
     * Schedule Detail's edit page still wants the option present).
     */
    @Input() allowNone = true;

    /** Emits the serialised spec string on every form change. `null` = no recurrence. */
    @Output() valueChange = new EventEmitter<string | null>();

    private readonly api = inject(ApiService);
    private readonly dtf = inject(DateTimeFormatService);
    private readonly destroyRef = inject(DestroyRef);

    readonly weekdays = WEEKDAYS;
    readonly months   = MONTHS;
    readonly ordinals = ORDINALS;

    readonly state = signal<RecurrenceFormState>(buildDefaultState(new Date()));
    readonly excludeDraft = signal<string>('');
    readonly preview = signal<string[]>([]);
    readonly previewLoading = signal<boolean>(false);
    readonly previewError = signal<string | null>(null);

    /** Debounced preview trigger: emits a serialised spec string. */
    private readonly previewTrigger$ = new Subject<string>();

    /**
     * Convenience computed: human-readable "day/week/month/year(s)"
     * suffix after the interval input, agreeing in number with
     * the value.
     */
    readonly intervalUnit = computed(() => {
        const s = this.state();
        const plural = s.interval > 1 ? 's' : '';
        switch (s.mode) {
            case 'DAILY':   return `day${plural}`;
            case 'WEEKLY':  return `week${plural}`;
            case 'MONTHLY': return `month${plural}`;
            case 'YEARLY':  return `year${plural}`;
            default:        return '';
        }
    });

    ngOnInit(): void {
        // Initialise form state from inputs.
        const dt = new Date(this.dtstart);
        const fresh = buildDefaultState(dt);

        if (this.value) {
            const parsed = parseRecurrence(this.value, dt);
            if (parsed) {
                this.state.set(parsed);
            } else {
                // Spec we can't round-trip — preserve it verbatim in RAW mode.
                this.state.set({ ...fresh, mode: 'RAW', rawSpec: this.value });
            }
        } else if (!this.allowNone) {
            // Sub-dialog mode with no incoming spec: open at DAILY rather
            // than NONE, since NONE isn't a reachable state from here.
            // Emit immediately so the host signal sees the new default.
            this.state.set({ ...fresh, mode: 'DAILY' });
            queueMicrotask(() => this.emit());
        } else {
            this.state.set(fresh);
        }

        // Preview pipeline: debounce form changes, hit the backend.
        this.previewTrigger$
            .pipe(
                debounceTime(250),
                distinctUntilChanged(),
                switchMap(spec => {
                    if (!spec) {
                        this.previewLoading.set(false);
                        this.preview.set([]);
                        this.previewError.set(null);
                        return [];
                    }
                    this.previewLoading.set(true);
                    this.previewError.set(null);
                    return this.api.recurrencePreview({
                        rrule:        spec,
                        dtstart:      this.dtstart,
                        tz:           this.tz,
                        count:        this.previewCount,
                        horizonYears: this.horizonYears,
                    });
                }),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: res => {
                    this.previewLoading.set(false);
                    if (Array.isArray((res as { occurrences?: unknown }).occurrences)) {
                        this.preview.set(res.occurrences);
                    }
                },
                error: err => {
                    this.previewLoading.set(false);
                    // Surface the backend's message — usually "Invalid RRULE",
                    // tz unknown, etc. Helpful while the user is mid-edit.
                    const detail =
                        err?.error?.['hydra:description']
                        ?? err?.error?.detail
                        ?? err?.message
                        ?? 'Preview unavailable.';
                    this.previewError.set(String(detail));
                    this.preview.set([]);
                },
            });

        this.refreshPreview();
    }

    ngOnChanges(changes: SimpleChanges): void {
        // When the parent updates the dtstart (e.g. range picker shifts the
        // event start), refresh the preview so it stays anchored correctly.
        if (changes['dtstart'] && !changes['dtstart'].firstChange) {
            this.refreshPreview();
        }
        if (changes['tz'] && !changes['tz'].firstChange) {
            this.refreshPreview();
        }
    }

    // -- State mutations + serialise + emit ----------------------------------

    private emit(): void {
        const spec = serializeRecurrence(this.state());
        this.valueChange.emit(spec);
        this.refreshPreview();
    }

    private refreshPreview(): void {
        const spec = serializeRecurrence(this.state());
        this.previewTrigger$.next(spec ?? '');
    }

    setMode(mode: RecurrenceFreq): void {
        // When [allowNone] is false, defend against template injection /
        // programmatic misuse — silently ignore an attempt to set NONE.
        // (The option isn't rendered anyway when allowNone is false.)
        if (!this.allowNone && mode === 'NONE') return;
        // When switching INTO structured modes from NONE / RAW, reset to
        // defaults so stale BY-rules don't leak across freq changes.
        const cur = this.state();
        if (mode === cur.mode) return;
        const fresh = buildDefaultState(new Date(this.dtstart));
        this.state.set({
            ...fresh,
            mode,
            // Preserve excludeDates across freq switches — they're still
            // meaningful if the new freq covers the excluded instants.
            excludeDates: cur.excludeDates,
            // Carry the raw spec across mode changes so the user can flip
            // between RAW and structured without losing their typing.
            rawSpec: cur.rawSpec,
        });
        this.emit();
    }

    setInterval(n: number): void {
        const i = Math.max(1, Math.min(365, Math.trunc(Number(n) || 1)));
        this.state.update(s => ({ ...s, interval: i }));
        this.emit();
    }

    setRawSpec(s: string): void {
        this.state.update(prev => ({ ...prev, rawSpec: s }));
        this.emit();
    }

    isWeekdaySelected(code: WeekdayCode): boolean {
        return this.state().byWeekdays.includes(code);
    }

    toggleWeekday(code: WeekdayCode): void {
        this.state.update(s => {
            const set = new Set(s.byWeekdays);
            if (set.has(code)) {
                set.delete(code);
            } else {
                set.add(code);
            }
            // Keep weekday order canonical (Mo, Tu, …, Su) for stable
            // spec serialisation regardless of click order.
            const ordered: WeekdayCode[] = WEEKDAYS
                .map(wd => wd.code)
                .filter(c => set.has(c));
            // Never persist an empty BYDAY list — leave at least the
            // anchor's weekday to keep the spec valid.
            const safe = ordered.length === 0
                ? [WEEKDAYS.map(wd => wd.code).find(c => c === code) ?? 'MO']
                : ordered;
            return { ...s, byWeekdays: safe };
        });
        this.emit();
    }

    setMonthlyAnchorKind(kind: 'dayOfMonth' | 'weekdayOfMonth'): void {
        const dt = new Date(this.dtstart);
        const wd = WEEKDAYS.map(w => w.code)[(dt.getDay() + 6) % 7];
        const anchor: MonthlyAnchor = kind === 'dayOfMonth'
            ? { kind: 'dayOfMonth', day: dt.getDate() }
            : { kind: 'weekdayOfMonth', ordinal: 1, weekday: wd };
        this.state.update(s => ({ ...s, monthlyAnchor: anchor }));
        this.emit();
    }

    monthlyDayOfMonth(): number {
        const a = this.state().monthlyAnchor;
        return a.kind === 'dayOfMonth' ? a.day : 1;
    }

    setMonthlyDayOfMonth(n: number): void {
        const day = Math.max(1, Math.min(31, Math.trunc(Number(n) || 1)));
        this.state.update(s => ({
            ...s,
            monthlyAnchor: { kind: 'dayOfMonth', day },
        }));
        this.emit();
    }

    monthlyOrdinal(): number {
        const a = this.state().monthlyAnchor;
        return a.kind === 'weekdayOfMonth' ? a.ordinal : 1;
    }

    setMonthlyOrdinal(o: number): void {
        const a = this.state().monthlyAnchor;
        if (a.kind !== 'weekdayOfMonth') return;
        this.state.update(s => ({
            ...s,
            monthlyAnchor: { kind: 'weekdayOfMonth', ordinal: Number(o), weekday: a.weekday },
        }));
        this.emit();
    }

    monthlyWeekday(): WeekdayCode {
        const a = this.state().monthlyAnchor;
        return a.kind === 'weekdayOfMonth' ? a.weekday : 'MO';
    }

    setMonthlyWeekday(w: WeekdayCode): void {
        const a = this.state().monthlyAnchor;
        if (a.kind !== 'weekdayOfMonth') return;
        this.state.update(s => ({
            ...s,
            monthlyAnchor: { kind: 'weekdayOfMonth', ordinal: a.ordinal, weekday: w },
        }));
        this.emit();
    }

    setYearMonth(m: number): void {
        const month = Math.max(1, Math.min(12, Math.trunc(Number(m) || 1)));
        this.state.update(s => ({ ...s, yearMonth: month }));
        this.emit();
    }

    setYearDay(d: number): void {
        const day = Math.max(1, Math.min(31, Math.trunc(Number(d) || 1)));
        this.state.update(s => ({ ...s, yearDay: day }));
        this.emit();
    }

    setEndKind(kind: EndMode['kind']): void {
        let end: EndMode;
        switch (kind) {
            case 'never':
                end = { kind: 'never' };
                break;
            case 'untilDate':
                end = { kind: 'untilDate', date: new Date(this.dtstart).toISOString().substring(0, 10) };
                break;
            case 'afterCount':
                end = { kind: 'afterCount', count: 10 };
                break;
        }
        this.state.update(s => ({ ...s, end }));
        this.emit();
    }

    endDateOrEmpty(): string {
        const e = this.state().end;
        return e.kind === 'untilDate' ? e.date : '';
    }

    setEndDate(d: string): void {
        if (!d) return;
        this.state.update(s => ({ ...s, end: { kind: 'untilDate', date: d } }));
        this.emit();
    }

    endCountOrOne(): number {
        const e = this.state().end;
        return e.kind === 'afterCount' ? e.count : 1;
    }

    setEndCount(c: number): void {
        const count = Math.max(1, Math.min(9999, Math.trunc(Number(c) || 1)));
        this.state.update(s => ({ ...s, end: { kind: 'afterCount', count } }));
        this.emit();
    }

    // -- Exclusion list ------------------------------------------------------

    addExclude(): void {
        const d = this.excludeDraft();
        if (!d) return;
        // Store as 00:00:00 UTC instant for that calendar day. The
        // backend's EXDATE matcher compares by UTC instant.
        const [y, m, day] = d.split('-').map(Number);
        const iso = new Date(Date.UTC(y, m - 1, day, 0, 0, 0)).toISOString();
        this.state.update(s => {
            if (s.excludeDates.includes(iso)) return s;
            return { ...s, excludeDates: [...s.excludeDates, iso] };
        });
        this.excludeDraft.set('');
        this.emit();
    }

    removeExclude(iso: string): void {
        this.state.update(s => ({
            ...s,
            excludeDates: s.excludeDates.filter(x => x !== iso),
        }));
        this.emit();
    }

    /** Exclude-date chips + occurrence-preview — pref-aware (tz + date-format), . */
    formatLocalDate(iso: string): string {
        return this.dtf.date(iso);
    }

    formatLocalDateTime(iso: string): string {
        return this.dtf.dateTime(iso);
    }
}
