import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';

import { DeclaredSectionComponent } from './declared-section.component';
import { type DeclaredKey, type DeclaredSection } from './declared-settings.service';

const SAVE = '/api/v1/auth/me/settings/region';

function key(over: Partial<DeclaredKey>): DeclaredKey {
    return {
        key: 'weekStart', type: 'choice', default: 'monday', label: 'Week starts on', min: null, max: null,
        choices: ['monday', 'sunday'], nullable: false, readOnly: false, value: 'monday', own: null, locked: false,
        ...over,
    };
}

function section(keys: ReadonlyArray<DeclaredKey>): DeclaredSection {
    return { section: 'region', label: 'Region', icon: 'globe', version: 'v1', keys };
}

describe('DeclaredSectionComponent', () => {
    let fixture: ComponentFixture<DeclaredSectionComponent>;
    let http: HttpTestingController;
    let saved: string[];

    function draw(keys: ReadonlyArray<DeclaredKey>): HTMLElement {
        fixture.componentRef.setInput('section', section(keys));
        fixture.detectChanges();
        TestBed.flushEffects();
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    function choose(el: HTMLElement, value: string): void {
        const select = el.querySelector('select') as HTMLSelectElement;
        select.value = value;
        select.dispatchEvent(new Event('change'));
        fixture.detectChanges();
    }

    function button(el: HTMLElement, text: string): HTMLButtonElement {
        return [...el.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement;
    }

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [DeclaredSectionComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: () => ({
                            apiBase: '/api/v1',
                            supportedLocales: [{ code: 'en', label: 'English' }, { code: 'uk', label: 'Ukrainian' }],
                        }),
                    },
                },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        fixture = TestBed.createComponent(DeclaredSectionComponent);
        saved = [];
        fixture.componentInstance.saved.subscribe(name => saved.push(name));
    });

    afterEach(() => http.verify());

    it('saves only what changed, over the version read', () => {
        const el = draw([key({})]);
        expect(button(el, 'Save changes').disabled).toBe(true);

        choose(el, 'sunday');
        button(el, 'Save changes').click();

        const save = http.expectOne(SAVE);
        expect(save.request.method).toBe('PATCH');
        expect(save.request.body).toEqual({ weekStart: 'sunday' });
        expect(save.request.headers.get('If-Match')).toBe('"v1"');
        save.flush({});
        expect(saved).toEqual(['region']);
    });

    it('going back to the value read leaves nothing to save', () => {
        const el = draw([key({})]);

        choose(el, 'sunday');
        choose(el, 'monday');

        expect(button(el, 'Save changes').disabled).toBe(true);
    });

    it('a locked key says who set it, cannot be changed, and offers no way back to the default', () => {
        const el = draw([key({ locked: true, value: 'sunday', own: 'monday' })]);

        expect(el.textContent).toContain('Set by your administrator');
        expect((el.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
        expect(button(el, 'Use the default')).toBeUndefined();
    });

    it('the way back to the default sends null, and only where the person has their own', () => {
        expect(button(draw([key({})]), 'Use the default')).toBeUndefined();

        const el = draw([key({ value: 'sunday', own: 'sunday' })]);
        button(el, 'Use the default').click();

        const save = http.expectOne(SAVE);
        expect(save.request.body).toEqual({ weekStart: null });
        save.flush({});
    });

    it('offers the languages the server supports, and no others', () => {
        const el = draw([key({ key: 'language', type: 'language', choices: null, value: 'en' })]);

        const offered = [...el.querySelectorAll('option')].map(o => o.value);
        expect(offered).toEqual(['en', 'uk']);
    });

    it('keeps a value the list no longer offers, so opening the form does not change it', () => {
        const el = draw([key({ key: 'language', type: 'language', choices: null, value: 'de' })]);

        const select = el.querySelector('select') as HTMLSelectElement;
        expect([...select.options].map(o => o.value)).toEqual(['de', 'en', 'uk']);
        expect(select.value).toBe('de');
    });

    it('offers automatic and the zones for a time zone', () => {
        const el = draw([key({ key: 'timezone', type: 'timezone', choices: ['automatic'], value: 'automatic' })]);

        const offered = [...el.querySelectorAll('option')].map(o => o.value);
        expect(offered[0]).toBe('automatic');
        expect(offered).toContain('UTC');
        expect(offered).toContain('Europe/Berlin');
    });

    it('an emptied number is no edit: it does not become a null that removes their own value', () => {
        const el = draw([key({ key: 'pageSize', type: 'integer', choices: null, min: 10, max: 200, value: 25, own: 25 })]);
        const input = el.querySelector('input[type=number]') as HTMLInputElement;

        input.value = '';
        input.dispatchEvent(new Event('change'));
        fixture.detectChanges();

        expect(button(el, 'Save changes').disabled).toBe(true);
        expect(input.value).toBe('25');
    });

    it('going back to the default keeps what is still being edited in the section', () => {
        const el = draw([key({ value: 'sunday', own: 'sunday' }), key({ key: 'timeFormat', choices: ['12h', '24h'], value: '24h' })]);
        const time = el.querySelectorAll('select')[1] as HTMLSelectElement;
        time.value = '12h';
        time.dispatchEvent(new Event('change'));
        fixture.detectChanges();

        button(el, 'Use the default').click();
        http.expectOne(SAVE).flush({});
        draw([key({}), key({ key: 'timeFormat', choices: ['12h', '24h'], value: '24h' })]);

        expect(button(el, 'Save changes').disabled).toBe(false);
        button(el, 'Save changes').click();
        const next = http.expectOne(SAVE);
        expect(next.request.body).toEqual({ timeFormat: '12h' });
        next.flush({});
    });

    it('text is typed, and a structure has no field here', () => {
        const el = draw([
            key({ key: 'note', type: 'string', choices: null, value: 'x' }),
            key({ key: 'grid', type: 'structure', choices: null, value: {} }),
        ]);

        expect(el.querySelector('input[type=text]')).not.toBeNull();
        expect(el.querySelectorAll('.field').length).toBe(1);
        expect(el.querySelector('select')).toBeNull();
    });

    it('a time zone is offered once', () => {
        const el = draw([key({ key: 'timezone', type: 'timezone', choices: ['automatic'], value: 'UTC' })]);

        const offered = [...el.querySelectorAll('option')].map(o => o.value);
        expect(offered.filter(z => 'UTC' === z).length).toBe(1);
    });

    it('a plain word reads as one, and a format is shown as it is', () => {
        const el = draw([key({ key: 'dateFormat', choices: ['yyyy-MM-dd'], value: 'yyyy-MM-dd' }), key({})]);

        const labels = [...el.querySelectorAll('option')].map(o => o.textContent);
        expect(labels).toEqual(['yyyy-MM-dd', 'Monday', 'Sunday']);
    });

    it('a colour with no value of its own is drawn in the colour in force, and nothing is left to save', () => {
        document.documentElement.style.setProperty('--cms-accent', '#f59e0b');
        const el = draw([key({ key: 'accentColor', type: 'colour', choices: null, nullable: true, value: null })]);

        expect((el.querySelector('input[type=color]') as HTMLInputElement).value).toBe('#f59e0b');
        expect(button(el, 'Save changes').disabled).toBe(true);
        document.documentElement.style.removeProperty('--cms-accent');
    });

    it('shows the refusal the server names, and keeps what was typed', () => {
        const el = draw([key({})]);
        choose(el, 'sunday');
        button(el, 'Save changes').click();

        http.expectOne(SAVE).flush({ detail: 'weekStart: not one of the choices' }, { status: 422, statusText: 'Refused' });
        fixture.detectChanges();

        expect(el.querySelector('[role=alert]')?.textContent).toContain('weekStart');
        expect(button(el, 'Save changes').disabled).toBe(false);
        expect(saved).toEqual([]);
    });

    it('saved elsewhere: says so, asks the parent to read again, and does not claim a save', () => {
        let stale = 0;
        fixture.componentInstance.stale.subscribe(() => ++stale);
        const el = draw([key({})]);
        choose(el, 'sunday');
        button(el, 'Save changes').click();

        http.expectOne(SAVE).flush({}, { status: 412, statusText: 'Precondition Failed' });
        fixture.detectChanges();

        expect(el.querySelector('[role=alert]')?.textContent).toContain('changed somewhere else');
        expect(stale).toBe(1);
        expect(saved).toEqual([]);
    });

    it('new values from the server replace what was being edited', () => {
        const el = draw([key({})]);
        choose(el, 'sunday');

        draw([key({ value: 'sunday', own: 'sunday' })]);

        expect(button(el, 'Save changes').disabled).toBe(true);
    });
});
