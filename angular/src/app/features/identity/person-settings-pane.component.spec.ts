import { HttpErrorResponse } from '@angular/common/http';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorHandlerService } from '@coolms/core-angular';
import { Store } from '@ngxs/store';
import { type Observable, of, throwError } from 'rxjs';

import { ModuleSettingsService } from '../settings/module-settings.service';
import { DeclaredSettingsService } from './declared-settings.service';
import { PersonSettingsPaneComponent } from './person-settings-pane.component';

const KEY = 'identity.person_settings';

const SECTIONS = [{
    section: 'region',
    label: 'Language & region',
    icon: 'globe',
    version: 'v',
    keys: [
        { key: 'weekStart', type: 'choice', label: 'Week starts on', choices: ['monday', 'sunday'], value: 'monday', own: null, locked: false },
        { key: 'timezone', type: 'timezone', label: 'Time zone', choices: ['automatic'], value: 'UTC', own: null, locked: false },
        { key: 'unset', type: 'choice', label: 'Nothing for an installation', choices: ['a'], value: 'a', own: null, locked: false },
    ],
}];

const BLOCK = {
    'region.weekStart': 'monday',
    'region.weekStart.locked': false,
    'region.timezone': 'UTC',
    'region.timezone.locked': false,
};

/** As the server answers a block nobody has saved: everything in force is a default. */
const UNSAVED = { effective: BLOCK, data: {}, defaults: BLOCK };

describe('PersonSettingsPaneComponent', () => {
    let fixture: ComponentFixture<PersonSettingsPaneComponent>;
    let saved: unknown[];
    let answer: () => Observable<unknown>;

    function draw(): HTMLElement {
        fixture = TestBed.createComponent(PersonSettingsPaneComponent);
        fixture.componentRef.setInput('settingKey', KEY);
        fixture.detectChanges();
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    function button(el: HTMLElement): HTMLButtonElement {
        return [...el.querySelectorAll('button')].find(b => b.textContent?.includes('Save changes')) as HTMLButtonElement;
    }

    beforeEach(() => {
        saved = [];
        answer = () => of({ ...UNSAVED, effective: { ...BLOCK, 'region.weekStart': 'sunday', 'region.weekStart.locked': true } });
        TestBed.configureTestingModule({
            imports: [PersonSettingsPaneComponent],
            providers: [
                { provide: DeclaredSettingsService, useValue: { read: () => of(SECTIONS) } },
                {
                    provide: ModuleSettingsService,
                    useValue: {
                        get: () => of(UNSAVED),
                        save: (key: string, data: unknown) => {
                            saved.push({ key, data });
                            return answer();
                        },
                    },
                },
                { provide: Store, useValue: { selectSnapshot: () => ({ supportedLocales: [] }) } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'It could not be read.' } },
            ],
        });
    });

    it('draws what the block holds a key for, and only that', () => {
        const el = draw();

        expect(el.textContent).toContain('Week starts on');
        expect(el.textContent).not.toContain('Nothing for an installation');
        expect(el.querySelectorAll('input[type=checkbox]').length).toBe(2);
    });

    it('does not offer automatic as a default: an installation has no device to follow', () => {
        const el = draw();

        const zones = [...(el.querySelector('select[id="region.timezone"]') as HTMLSelectElement).options].map(o => o.value);
        expect(zones).not.toContain('automatic');
        expect(zones).toContain('UTC');
    });

    it('sends what changed and no default it did not touch, so a later change to a default still arrives', () => {
        const el = draw();
        expect(button(el).disabled).toBe(true);

        const week = el.querySelector('select[id="region.weekStart"]') as HTMLSelectElement;
        week.value = 'sunday';
        week.dispatchEvent(new Event('change'));
        const lock = el.querySelector('input[type=checkbox]') as HTMLInputElement;
        lock.checked = true;
        lock.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        button(el).click();
        fixture.detectChanges();

        expect(saved).toEqual([{
            key: KEY,
            data: { 'region.weekStart': 'sunday', 'region.weekStart.locked': true },
        }]);
        expect(button(el).disabled).toBe(true);
    });

    it('an unset colour is drawn in the colour in force, and nothing is left to save', () => {
        document.documentElement.style.setProperty('--cms-accent', '#f59e0b');
        const declared = TestBed.inject(DeclaredSettingsService) as unknown as { read: () => unknown };
        declared.read = () => of([{
            section: 'appearance',
            label: 'Appearance',
            icon: 'x',
            version: 'v',
            keys: [{ key: 'accentColor', type: 'colour', label: 'Accent colour', value: null, own: null, locked: false }],
        }]);
        const blocks = TestBed.inject(ModuleSettingsService) as unknown as { get: () => unknown };
        blocks.get = () => of({ effective: { 'appearance.accentColor': null }, data: {}, defaults: { 'appearance.accentColor': null } });

        const el = draw();

        expect((el.querySelector('input[type=color]') as HTMLInputElement).value).toBe('#f59e0b');
        expect(el.textContent).toContain('None set');
        expect(button(el).disabled).toBe(true);
        document.documentElement.style.removeProperty('--cms-accent');
    });

    it('reads again when the block is reset around it', () => {
        const blocks = TestBed.inject(ModuleSettingsService) as unknown as { get: () => unknown };
        const el = draw();
        expect((el.querySelector('select[id="region.weekStart"]') as HTMLSelectElement).value).toBe('monday');

        blocks.get = () => of({ ...UNSAVED, effective: { ...BLOCK, 'region.weekStart': 'sunday' } });
        fixture.componentRef.setInput('revision', 1);
        fixture.detectChanges();
        fixture.detectChanges();

        expect((el.querySelector('select[id="region.weekStart"]') as HTMLSelectElement).value).toBe('sunday');
    });

    it('keeps what was stored, and drops a stored value set back to its default', () => {
        const blocks = TestBed.inject(ModuleSettingsService) as unknown as { get: () => unknown };
        blocks.get = () => of({
            effective: { ...BLOCK, 'region.weekStart': 'sunday', 'region.timezone': 'Asia/Tokyo' },
            data: { 'region.weekStart': 'sunday', 'region.timezone': 'Asia/Tokyo' },
            defaults: BLOCK,
        });
        const el = draw();
        const week = el.querySelector('select[id="region.weekStart"]') as HTMLSelectElement;

        week.value = 'monday';
        week.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        button(el).click();

        expect(saved).toEqual([{ key: KEY, data: { 'region.timezone': 'Asia/Tokyo' } }]);
    });

    it('a block that holds automatic shows it, rather than a zone it does not hold', () => {
        const blocks = TestBed.inject(ModuleSettingsService) as unknown as { get: () => unknown };
        blocks.get = () => of({
            effective: { ...BLOCK, 'region.timezone': 'automatic' },
            data: { 'region.timezone': 'automatic' },
            defaults: BLOCK,
        });

        const el = draw();

        expect((el.querySelector('select[id="region.timezone"]') as HTMLSelectElement).value).toBe('automatic');
    });

    it('a read that succeeds clears an old failure', () => {
        answer = () => throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'refused' } }));
        const el = draw();
        const lock = el.querySelector('input[type=checkbox]') as HTMLInputElement;
        lock.checked = true;
        lock.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        button(el).click();
        fixture.detectChanges();
        expect(el.querySelector('[role=alert]')).not.toBeNull();

        fixture.componentRef.setInput('revision', 1);
        fixture.detectChanges();
        fixture.detectChanges();

        expect(el.querySelector('[role=alert]')).toBeNull();
    });

    it('going back to what was read leaves nothing to save', () => {
        const el = draw();
        const lock = el.querySelector('input[type=checkbox]') as HTMLInputElement;

        lock.checked = true;
        lock.dispatchEvent(new Event('change'));
        lock.checked = false;
        lock.dispatchEvent(new Event('change'));
        fixture.detectChanges();

        expect(button(el).disabled).toBe(true);
    });

    it('a read that fails says so, and offers nothing to save over', () => {
        const blocks = TestBed.inject(ModuleSettingsService) as unknown as { get: () => unknown };
        blocks.get = () => throwError(() => new HttpErrorResponse({ status: 500 }));

        const el = draw();

        expect(el.querySelector('[role=alert]')?.textContent).toContain('could not be read');
        expect(button(el)).toBeUndefined();
    });

    it('shows the refusal the server names, and keeps what was chosen', () => {
        answer = () => throwError(() => new HttpErrorResponse({
            status: 422,
            error: { detail: 'region.weekStart: not one of the choices' },
        }));
        const el = draw();
        const lock = el.querySelector('input[type=checkbox]') as HTMLInputElement;
        lock.checked = true;
        lock.dispatchEvent(new Event('change'));
        fixture.detectChanges();

        button(el).click();
        fixture.detectChanges();

        expect(el.querySelector('[role=alert]')?.textContent).toContain('region.weekStart');
        expect(button(el).disabled).toBe(false);
    });
});
