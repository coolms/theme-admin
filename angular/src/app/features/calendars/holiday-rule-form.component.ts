import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
    ApiService,
    HolidayRuleDto,
    HolidayRuleTypeCode,
} from '../../api/api.service';
import { ErrorHandlerService } from '@coolms/core-angular';
import {
    LazySelectComponent,
    LazySelectOption,
    ModalComponent,
    ToastService,
} from '@coolms/ui-angular';

export interface HolidayRuleFormData {
    mode:          'create' | 'edit';
    calendarId:    string;
    rule?:         HolidayRuleDto;
    existingRules: ReadonlyArray<HolidayRuleDto>;
}

interface OtherDateRow { year: number; month: number; day: number }

const TYPES: ReadonlyArray<{ value: HolidayRuleTypeCode; label: string }> = [
    { value: 'fixed',            label: 'Fixed (month + day)' },
    { value: 'other',            label: 'Other (one-off dates)' },
    { value: 'moveable',         label: 'Moveable (Nth weekday of month)' },
    { value: 'transferred',      label: 'Transferred (offset from another rule)' },
    { value: 'related',          label: 'Related (offset from another rule)' },
    { value: 'gregorian_easter', label: 'Gregorian Easter' },
    { value: 'julian_easter',    label: 'Julian Easter' },
];

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/**
 * — Modal form for creating / editing a HolidayRule.
 *
 * Dynamic params section switches on `type`. Validation is light at the
 * FE; the backend enforces the per-type schema via the Domain entity's
 * constructor (`HolidayRule::assertValidParams`).
 */
@Component({
    selector: 'app-holiday-rule-form',
    standalone: true,
    imports: [ModalComponent, FormsModule, LazySelectComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <app-modal [title]="title" [width]="560">
            <div class="form">
                <label class="field">Type
                    <select [(ngModel)]="type" [disabled]="mode === 'edit'">
                        @for (t of types; track t.value) {
                            <option [ngValue]="t.value">{{ t.label }}</option>
                        }
                    </select>
                    @if (mode === 'edit') {
                        <small class="hint">Type cannot be changed; delete + recreate to switch types.</small>
                    }
                </label>

                <label class="field">Label
                    <input type="text" [(ngModel)]="label" />
                </label>

                <!-- Compensation flag + weekend-adjustment row.
                     Both fields stack their own label on top of the
                     control (consistent with everything else in the
                     form), and the row stretches naturally instead of
                     using auto-fit grid columns that overflowed the
                     dialog body. -->
                <div class="field-row field-row--adjustment">
                    <label class="field">
                        <span class="field__label">Working day (compensation)</span>
                        <label class="checkbox">
                            <input type="checkbox" [(ngModel)]="isWorking" />
                            <span>Yes</span>
                        </label>
                    </label>
                    <label class="field">Weekend adjustment
                        <select [(ngModel)]="weekendAdjustment">
                            <option [ngValue]="null">— None —</option>
                            <option [ngValue]="-1">-1 (previous workday)</option>
                            <option [ngValue]="0">0 (no shift)</option>
                            <option [ngValue]="1">+1 (next workday)</option>
                        </select>
                    </label>
                </div>

                <!-- Dynamic params per type -->
                <div class="params">
                    @switch (type) {
                        @case ('fixed') {
                            <div class="field-row">
                                <label class="field">Month (1–12)
                                    <input type="number" min="1" max="12" [(ngModel)]="fixedMonth" />
                                </label>
                                <label class="field">Day (1–31)
                                    <input type="number" min="1" max="31" [(ngModel)]="fixedDay" />
                                </label>
                            </div>
                        }
                        @case ('other') {
                            <p class="hint">One-off dates:</p>
                            @for (row of otherDates(); track $index) {
                                <div class="field-row field-row--date">
                                    <input type="number" placeholder="Year"
                                           [value]="row.year"
                                           (input)="updateOther($index, 'year', $any($event.target).valueAsNumber)" />
                                    <input type="number" placeholder="Month" min="1" max="12"
                                           [value]="row.month"
                                           (input)="updateOther($index, 'month', $any($event.target).valueAsNumber)" />
                                    <input type="number" placeholder="Day" min="1" max="31"
                                           [value]="row.day"
                                           (input)="updateOther($index, 'day', $any($event.target).valueAsNumber)" />
                                    <button type="button" class="icon-btn icon-btn--danger"
                                            title="Remove"
                                            (click)="removeOther($index)">
                                        <i class="bi bi-x"></i>
                                    </button>
                                </div>
                            }
                            <button type="button" class="link-btn" (click)="addOther()">
                                <i class="bi bi-plus-lg"></i> Add date
                            </button>
                        }
                        @case ('moveable') {
                            <div class="field-row">
                                <label class="field">Month (1–12)
                                    <input type="number" min="1" max="12" [(ngModel)]="moveableMonth" />
                                </label>
                                <label class="field">Week of month
                                    <select [(ngModel)]="moveableWeekOfMonth">
                                        <option [ngValue]="1">1st</option>
                                        <option [ngValue]="2">2nd</option>
                                        <option [ngValue]="3">3rd</option>
                                        <option [ngValue]="4">4th</option>
                                        <option [ngValue]="5">5th</option>
                                        <option [ngValue]="-1">Last</option>
                                    </select>
                                </label>
                                <label class="field">Day of week
                                    <select [(ngModel)]="moveableDayOfWeek">
                                        @for (w of weekdays; track w) {
                                            <option [ngValue]="w">{{ w }}</option>
                                        }
                                    </select>
                                </label>
                            </div>
                        }
                        @case ('transferred') {
                            <div class="field-row">
                                <label class="field">Base rule
                                    <app-lazy-select
                                            [options]="baseRuleOptions"
                                            [value]="baseRuleId"
                                            [entityLabel]="'rule'"
                                            (valueChange)="baseRuleId = $event" />
                                </label>
                                <label class="field">Offset (days)
                                    <input type="number" min="-7" max="7" [(ngModel)]="offsetDays" />
                                </label>
                            </div>
                        }
                        @case ('related') {
                            <div class="field-row">
                                <label class="field">Base rule
                                    <app-lazy-select
                                            [options]="baseRuleOptions"
                                            [value]="baseRuleId"
                                            [entityLabel]="'rule'"
                                            (valueChange)="baseRuleId = $event" />
                                </label>
                                <label class="field">Offset (days)
                                    <input type="number" min="-7" max="7" [(ngModel)]="offsetDays" />
                                </label>
                            </div>
                        }
                        @default {
                            <p class="hint">No additional parameters required.</p>
                        }
                    }
                </div>

                @if (error()) {
                    <p class="error">{{ error() }}</p>
                }
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn"
                        (click)="dialogRef.close()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="saving()"
                        (click)="onSave()">
                    {{ saving() ? 'Saving…' : (mode === 'create' ? 'Create' : 'Save changes') }}
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .form { display: flex; flex-direction: column; gap: 12px; }
        .field { display: flex; flex-direction: column; gap: 4px; font-size: .85rem; min-width: 0; }
        .field__label { font-size: .85rem; }
        /* Inline checkbox sat inside a stacked .field so its label
           aligns with the others (e.g. "Weekend adjustment"). */
        .checkbox {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 32px;        /* match input/select height */
            font-size: .9rem;
        }
        .checkbox input[type="checkbox"] {
            width: auto;
            margin: 0;
            padding: 0;
        }
        /* Flex with wrap and min-width:0 children means the row can
           shrink to the dialog body without spilling out. Each child
           grows equally; the dialog's fixed 560px width is plenty for
           two side-by-side fields. */
        .field-row {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: end;
        }
        .field-row > * { flex: 1 1 160px; min-width: 0; }
        /* The compensation row needs a slightly larger min so the
           "Working day (compensation)" label doesn't wrap aggressively
           at the 560px dialog width. */
        .field-row--adjustment > * { flex: 1 1 220px; }
        input, select {
            width: 100%;
            box-sizing: border-box;
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-sm, 4px);
            padding: 6px 8px;
            font-size: .9rem;
            font-family: inherit;
        }
        .params { margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--cms-border, #e5e7eb); }
        .hint { color: var(--cms-text-muted, #848b96); font-size: .8rem; margin: 4px 0; }
        .error { color: var(--cms-danger, #dc2626); font-size: .85rem; }

        /* One-off date row — keep the year/month/day inputs reasonably
           wide while leaving room for the X button on the right. */
        .field-row--date > input { flex: 1 1 80px; }
        .field-row--date > .icon-btn { flex: 0 0 32px; }

        .icon-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border: 1px solid var(--cms-border, #e5e7eb);
            background: transparent;
            border-radius: var(--cms-radius-sm, 4px);
            cursor: pointer;
            color: var(--cms-text-muted, #848b96);
        }
        .icon-btn:hover { background: var(--cms-btn-hover-bg, #f3f4f6); }
        .icon-btn--danger:hover { color: var(--cms-danger, #dc2626); border-color: var(--cms-danger, #dc2626); }

        .link-btn {
            background: none;
            border: none;
            padding: 4px 0;
            color: var(--cms-accent, #F5A623);
            font-size: .85rem;
            cursor: pointer;
            text-decoration: underline;
        }
        .link-btn:hover { opacity: .8; }
    `],
})
export class HolidayRuleFormComponent {
    readonly data: HolidayRuleFormData = inject(DIALOG_DATA);
    readonly dialogRef: DialogRef<HolidayRuleDto | undefined> = inject(DialogRef);
    private readonly api        = inject(ApiService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    readonly types     = TYPES;
    readonly weekdays  = WEEKDAYS;
    readonly mode      = this.data.mode;
    readonly title     = this.mode === 'create' ? 'New holiday rule' : 'Edit holiday rule';

    readonly pickableRules = this.data.existingRules.filter(r =>
        r.id && r.id !== this.data.rule?.id);

    /** Task — option projection for `<app-lazy-select>`. */
    readonly baseRuleOptions: readonly LazySelectOption[] = this.pickableRules.map(r => ({
        id:    r.id!,
        label: r.label ?? r.id!,
    }));

    type:              HolidayRuleTypeCode = (this.data.rule?.type ?? 'fixed');
    label:             string  = this.data.rule?.label ?? '';
    isWorking:         boolean = this.data.rule?.isWorking ?? false;
    weekendAdjustment: number | null = this.data.rule?.weekendAdjustment ?? null;

    // Fixed
    fixedMonth: number = ((this.data.rule?.params as { month?: number })?.month) ?? 1;
    fixedDay:   number = ((this.data.rule?.params as { day?: number })?.day) ?? 1;

    // Moveable
    moveableMonth:       number = ((this.data.rule?.params as { month?: number })?.month) ?? 1;
    moveableWeekOfMonth: number = ((this.data.rule?.params as { weekOfMonth?: number })?.weekOfMonth) ?? 1;
    moveableDayOfWeek:   typeof WEEKDAYS[number] = (((this.data.rule?.params as { dayOfWeek?: string })?.dayOfWeek) as typeof WEEKDAYS[number] | undefined) ?? 'MO';

    // Transferred / Related
    baseRuleId:   string = ((this.data.rule?.params as { baseRuleId?: string })?.baseRuleId) ?? '';
    offsetDays:   number = ((this.data.rule?.params as { offsetDays?: number })?.offsetDays) ?? 1;

    // Other
    readonly otherDates = signal<OtherDateRow[]>(
        Array.isArray((this.data.rule?.params as { dates?: OtherDateRow[] })?.dates)
            ? [...((this.data.rule?.params as { dates: OtherDateRow[] }).dates)]
            : [],
    );

    readonly saving = signal(false);
    readonly error  = signal<string | null>(null);

    addOther(): void {
        this.otherDates.update(rows => [
            ...rows,
            { year: new Date().getFullYear(), month: 1, day: 1 },
        ]);
    }

    removeOther(index: number): void {
        this.otherDates.update(rows => rows.filter((_, i) => i !== index));
    }

    updateOther(index: number, field: keyof OtherDateRow, value: number): void {
        this.otherDates.update(rows =>
            rows.map((r, i) => i === index ? { ...r, [field]: value } : r));
    }

    private buildParams(): Record<string, unknown> {
        switch (this.type) {
            case 'fixed':
                return { month: Number(this.fixedMonth), day: Number(this.fixedDay) };
            case 'other':
                return { dates: this.otherDates().map(r => ({
                    year: Number(r.year), month: Number(r.month), day: Number(r.day),
                })) };
            case 'moveable':
                return {
                    month: Number(this.moveableMonth),
                    weekOfMonth: Number(this.moveableWeekOfMonth),
                    dayOfWeek: this.moveableDayOfWeek,
                };
            case 'transferred':
            case 'related':
                return { baseRuleId: this.baseRuleId, offsetDays: Number(this.offsetDays) };
            case 'gregorian_easter':
            case 'julian_easter':
            default:
                return {};
        }
    }

    onSave(): void {
        if (this.label.trim() === '') {
            this.error.set('Label is required.');
            return;
        }
        const params = this.buildParams();
        this.saving.set(true);
        this.error.set(null);

        const obs$ = this.mode === 'create'
            ? this.api.createHolidayRule({
                calendarId: this.data.calendarId,
                label: this.label.trim(),
                type:  this.type,
                params,
                isWorking: this.isWorking,
                weekendAdjustment: this.weekendAdjustment,
            })
            : this.api.updateHolidayRule(this.data.rule!.id!, {
                label: this.label.trim(),
                params,
                isWorking: this.isWorking,
                weekendAdjustment: this.weekendAdjustment,
            });

        obs$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: rule => {
                this.saving.set(false);
                this.toast.success(this.mode === 'create' ? 'Holiday rule created' : 'Holiday rule updated');
                this.dialogRef.close(rule);
            },
            error: (err: unknown) => {
                this.saving.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }
}
