import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Provider, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { ConfigService, ErrorHandlerService } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    DateTimeFormatService,
    LayoutActionsService,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';

import { CalendarsApiService } from './calendars/calendars-api.service';
import { HolidayRuleFormComponent } from './calendars/holiday-rule-form.component';
import { RecurrenceFormComponent } from './calendars/recurrence-form/recurrence-form.component';
import { ScheduleDetailPageComponent } from './schedules/schedule-detail.page';
import { SchedulesApiService } from './schedules/schedules-api.service';

/**
 * A form's radios and checkboxes are drawn by the admin's own style (styles.scss): a round radio with a centre dot
 * when checked, a square checkbox with a tick, both 18px. A form whose own rule styles every `input` as a text field
 * -- a radius, padding, a border, a background, a width -- reshapes them too. In the served admin a component's styles
 * are added after the admin's own, so they also win the ties: the recurrence form's "Ends: Never / On / After" radios
 * were drawn as rounded squares, read as checkboxes. Each control here is held against one drawn by the admin's style
 * alone, and no rule of its component may reach its shape.
 */
describe('a form\'s radios and checkboxes are drawn as the admin draws them', () => {
    const SHAPE = [
        'width', 'height', 'padding-top', 'padding-left', 'border-top-width', 'border-top-color',
        'border-top-left-radius', 'background-image', 'background-color',
    ] as const;

    /** Any service: every method answers nothing. */
    const anything = new Proxy({}, {
        get: (_target, key) => (key === 'then' || key === 'ngOnDestroy' ? undefined : () => of(null)),
    });

    beforeEach(() => {
        const services: Provider[] = [CalendarsApiService, DateTimeFormatService, ToastService, ErrorHandlerService,
            LayoutActionsService, SchedulesApiService, Router, ActivatedRoute, PageTitleService, ConfirmDialogService,
            ConfigService, DialogRef].map(token => ({ provide: token, useValue: anything }));
        TestBed.configureTestingModule({
            providers: [
                ...services,
                { provide: DIALOG_DATA, useValue: { mode: 'create', calendarId: 'cal-1', existingRules: [] } },
            ],
        });
    });

    /** The shape the admin's own style gives a control of `type`, checked or not, outside any form. */
    function drawnAlone(type: 'radio' | 'checkbox', checked: boolean): Record<string, string> {
        const control = document.createElement('input');
        control.type = type;
        control.checked = checked;
        document.body.appendChild(control);
        try {
            return shapeOf(control);
        } finally {
            control.remove();
        }
    }

    function shapeOf(control: HTMLInputElement): Record<string, string> {
        const style = getComputedStyle(control);
        return Object.fromEntries(SHAPE.map(p => [p, style.getPropertyValue(p)]));
    }

    /**
     * Each of the component's own rules that reaches `control` and sets a part of its shape. The computed shape alone
     * depends on which stylesheet the page loads last -- in this runner the admin's style comes after the components',
     * so the radius a component sets is outvoted here while the served admin shows it -- so no component rule may
     * reach the control's shape at all.
     */
    function componentRulesReaching(control: HTMLInputElement): string[] {
        const found: string[] = [];
        for (const sheet of Array.from(document.styleSheets)) {
            for (const rule of Array.from(sheet.cssRules)) {
                if (rule instanceof CSSStyleRule && rule.selectorText.includes('[_ngcontent-') && control.matches(rule.selectorText)) {
                    // The shorthands too: one written with var() leaves its longhands empty in the rule's own style.
                    const set = [...SHAPE, 'padding', 'border', 'border-width', 'border-color', 'border-radius', 'background']
                        .filter(p => rule.style.getPropertyValue(p) !== '');
                    if (set.length > 0) {
                        found.push(`${rule.selectorText.replace(/\[_ngcontent-[^\]]+\]/g, '')} sets ${set.join(', ')}`);
                    }
                }
            }
        }
        return found;
    }

    /** Every radio and checkbox `component` draws, each against one drawn alone; the number of them compared. */
    function expectDrawnAsAlone(component: Type<unknown>, inputs: Record<string, unknown> = {}): number {
        const fixture = TestBed.createComponent(component);
        for (const [name, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(name, value);
        }
        fixture.detectChanges();
        document.body.appendChild(fixture.nativeElement);
        const controls = Array.from(
            (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('input[type=radio], input[type=checkbox]'),
        );
        try {
            for (const control of controls) {
                const type = control.type as 'radio' | 'checkbox';
                const which = `${component.name}: ${type} ${control.name || ''}${control.checked ? ' (checked)' : ''}`;
                expect(shapeOf(control)).withContext(which).toEqual(drawnAlone(type, control.checked));
                expect(componentRulesReaching(control)).withContext(which).toEqual([]);
            }
        } finally {
            fixture.nativeElement.remove();
            fixture.destroy();
        }
        return controls.length;
    }

    it('the recurrence form\'s radios -- "Ends: Never / On / After" and the monthly anchor -- are round', () => {
        const compared = expectDrawnAsAlone(RecurrenceFormComponent, {
            value: 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3',
            dtstart: '2026-11-15T09:00:00Z',
        });

        // Two anchor radios and three end radios: none left out of the comparison.
        expect(compared).toBe(5);
    });

    it('the holiday rule form\'s checkbox is the admin\'s 18px checkbox', () => {
        expect(expectDrawnAsAlone(HolidayRuleFormComponent)).toBe(1);
    });

    it('the schedule page\'s "Enabled" checkbox is the admin\'s 18px checkbox', () => {
        // The page draws its form once the schedule is read: its form row, as the page writes it.
        TestBed.overrideTemplate(ScheduleDetailPageComponent, `
            <div class="form-row"><label class="check"><input type="checkbox" checked /> Enabled</label></div>
            <div class="form-row"><label class="check"><input type="checkbox" /> Enabled</label></div>`);
        spyOn(ScheduleDetailPageComponent.prototype, 'ngOnInit');

        expect(expectDrawnAsAlone(ScheduleDetailPageComponent)).toBe(2);
    });
});
