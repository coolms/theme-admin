import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { DrawerService, ToastService } from '@coolms/ui-angular';

import { type CallDialAttempt, CallDialAttemptService } from './call-dial-attempt.service';
import { CallDialPanelComponent } from './call-dial-panel.component';
import { CallOverlayPreferencesService } from './call-overlay-preferences.service';

/**
 * The pad draws the attempt the service holds: placing -- the number, elapsed time and Cancel; not placed --
 * "Call not placed -- retry?" with the reason and a Retry that is a new ask. Calling while placing sends nothing.
 */
describe('CallDialPanelComponent and the outbound attempt', () => {
    const attempt = signal<CallDialAttempt | null>(null);
    const elapsed = signal(0);
    const placed  = signal<{ callId: string; number: string } | null>(null);
    let dials: string[];
    let cancels: number;
    let closed: number;
    let toasts: string[];

    function render(): { el: HTMLElement; detect: () => void } {
        const fixture = TestBed.createComponent(CallDialPanelComponent);
        fixture.detectChanges();
        return { el: fixture.nativeElement as HTMLElement, detect: () => fixture.detectChanges() };
    }

    function base(state: 'placing' | 'not_placed', reason: string | null = null): CallDialAttempt {
        return { callId: 'c1', number: '123', state, windowEndsAt: null, reason, startedAt: 0 };
    }

    beforeEach(() => {
        attempt.set(null);
        elapsed.set(0);
        placed.set(null);
        dials = [];
        cancels = 0;
        closed = 0;
        toasts = [];
        TestBed.configureTestingModule({
            imports: [CallDialPanelComponent],
            providers: [
                {
                    provide: CallDialAttemptService,
                    useValue: {
                        attempt, placed, elapsedSeconds: elapsed,
                        dial: (_e: string, n: string) => { dials.push(n); return of('attempt'); },
                        cancel: () => { cancels++; return of(undefined); },
                        dismiss: () => attempt.set(null),
                    },
                },
                {
                    provide: CallOverlayPreferencesService,
                    useValue: { sipEndpoint: signal('PJSIP/101'), ensureLoaded: () => of(undefined) },
                },
                { provide: ToastService, useValue: { success: (m: string) => toasts.push(m), error: (m: string) => toasts.push(m) } },
                { provide: DrawerService, useValue: { close: () => { closed++; } } },
                { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
            ],
        });
    });

    it('shows the placing attempt with its elapsed time and a Cancel', () => {
        attempt.set(base('placing'));
        elapsed.set(7);
        const { el } = render();

        const box = el.querySelector('.dial__attempt') as HTMLElement;
        expect(box).withContext('the attempt is drawn').not.toBeNull();
        expect(box.textContent).toContain('123');
        expect(el.querySelector('.dial__elapsed')?.textContent?.trim()).toBe('0:07');

        (el.querySelector('.dial__cancel') as HTMLButtonElement).click();
        expect(cancels).toBe(1);
    });

    it('a Call click while placing shows the same attempt and asks for nothing', () => {
        attempt.set(base('placing'));
        const { el, detect } = render();
        const call = el.querySelector('.dial__call') as HTMLButtonElement;
        expect(call.textContent).toContain('Calling');

        call.click();
        detect();
        expect(dials).withContext('no second ask').toEqual([]);
        expect(el.querySelectorAll('.dial__attempt').length).toBe(1);
    });

    it('not placed: "Call not placed -- retry?" with the reason; Retry is a new ask for the same number', () => {
        attempt.set(base('not_placed', 'the line is busy'));
        const { el } = render();

        const box = el.querySelector('.dial__attempt--failed') as HTMLElement;
        expect(box.textContent).toContain('Call not placed — retry?');
        expect(box.querySelector('.dial__reason')?.textContent).toContain('the line is busy');
        expect(dials).withContext('nothing retried by itself').toEqual([]);

        (el.querySelector('.dial__retry') as HTMLButtonElement).click();
        expect(dials).toEqual(['123']);
    });

    it('reopening the pad brings the attempt\'s number back', () => {
        attempt.set(base('placing'));
        const fixture = TestBed.createComponent(CallDialPanelComponent);
        expect(fixture.componentInstance.number()).withContext('before init').toBe('');
        fixture.detectChanges();

        expect(fixture.componentInstance.number()).toBe('123');
    });

    it('a placed call says so and closes the pad', () => {
        attempt.set(base('placing'));
        const { detect } = render();
        attempt.set(null);
        placed.set({ callId: 'c1', number: '123' });
        detect();

        expect(closed).toBe(1);
        expect(toasts[0]).toContain('Calling 123');
        expect(placed()).toBeNull();
    });
});
