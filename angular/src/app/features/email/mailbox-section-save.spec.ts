import { of } from 'rxjs';
import { type ElevationService } from '@coolms/core-angular';

import { afterAccess, rebaseDraft } from './mailbox-section-save';

/**
 * The two rules every section of a mailbox's settings shares: a save goes only where the server's answer allows it,
 * and a new read never discards what is being typed in a section that did not save.
 */
describe('a mailbox settings section\'s save and its draft', () => {
    describe('afterAccess', () => {
        const elevation = (elevated: boolean, grants: boolean) => ({
            elevated: () => elevated,
            offerFor: () => of(grants),
        }) as unknown as ElevationService;

        it('allowed: sends at once', () => {
            const send = jasmine.createSpy('send');
            afterAccess('allowed', elevation(false, false), send);
            expect(send).toHaveBeenCalledTimes(1);
        });

        it('elevate: sends once the session is elevated, and not when the prompt is declined', () => {
            const send = jasmine.createSpy('send');
            afterAccess('elevate', elevation(false, true), send);
            afterAccess('elevate', elevation(false, false), send);
            expect(send).toHaveBeenCalledTimes(1);
        });

        it('denied: sends nothing, even in an elevated session', () => {
            const send = jasmine.createSpy('send');
            afterAccess('denied', elevation(true, true), send);
            expect(send).not.toHaveBeenCalled();
        });
    });

    describe('rebaseDraft', () => {
        it('an untouched field follows the new read; a changed one keeps what was typed', () => {
            const before = { host: 'a', port: 993 };
            const draft = { host: 'a', port: 143 };

            expect(rebaseDraft(before, draft, { host: 'b', port: 993 })).toEqual({ host: 'b', port: 143 });
        });

        it('after the section\'s own save, its saved fields are the read: the draft is clean again', () => {
            const before = { host: 'a', port: 993 };
            const draft = { host: 'a', port: 143 };

            expect(rebaseDraft(before, draft, { host: 'a', port: 143 })).toEqual({ host: 'a', port: 143 });
        });
    });
});
