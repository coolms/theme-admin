import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { UserCalendarPreferencesService } from '@coolms/ui-angular';

import { MiniCalendarComponent } from './mini-calendar.component';

/**
 * The mini-calendar rings TODAY, and today has to be the PERSON's -- the
 * calendar day now falls on in the profile's timezone. It used to read
 * `new Date()` with the browser's getters, so for a profile in Tokyo and a
 * browser in Europe the ring sat on yesterday's cell every evening.
 *
 * The clock is mocked to a moment that is one day for the browser and the
 * next for Tokyo, and the case asserts the browser would indeed disagree, so
 * it cannot pass by accident on a machine already in that zone.
 */
describe('MiniCalendarComponent', () => {
    /** Deliberately not the container's zone, so a browser-zone render cannot pass. */
    const PROFILE_TZ = 'Asia/Tokyo';

    /** 16:00 UTC on Sunday 10 March 2030 is 01:00 on Monday 11 March in Tokyo. */
    const NOW = new Date('2030-03-10T16:00:00.000Z');

    let fixture: ComponentFixture<MiniCalendarComponent>;

    beforeEach(() => {
        jasmine.clock().install();
        jasmine.clock().mockDate(NOW);

        TestBed.configureTestingModule({
            imports: [MiniCalendarComponent],
            providers: [{
                provide:  UserCalendarPreferencesService,
                useValue: {
                    ensureLoaded: () => undefined,
                    tz:           () => PROFILE_TZ,
                    dateFormat:   () => 'yyyy-MM-dd',
                    timeFormat:   () => '24h',
                    weekStart:    () => 'monday',
                },
            }],
        });
        fixture = TestBed.createComponent(MiniCalendarComponent);
    });

    afterEach(() => jasmine.clock().uninstall());

    const ringed = (): string[] =>
        [...(fixture.nativeElement as HTMLElement).querySelectorAll('.cell--today')]
            .map(el => (el.textContent ?? '').trim());

    it('rings the PROFILE\'s today, not the browser\'s', () => {
        expect(new Date().getDate())
            .withContext('this spec is vacuous unless the browser puts the moment on another day')
            .not.toBe(11);

        fixture.detectChanges();

        expect(ringed()).toEqual(['11']);
    });

    it('goes to the PROFILE\'s today', () => {
        let selected: Date | null = null;
        fixture.componentInstance.dateSelect.subscribe(d => (selected = d));
        fixture.detectChanges();

        fixture.componentInstance.goToday();

        expect(selected).not.toBeNull();
        expect(selected!.getFullYear()).toBe(2030);
        expect(selected!.getMonth()).toBe(2);
        expect(selected!.getDate()).toBe(11);
    });
});
