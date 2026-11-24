import type { ElevationEndedReason, ElevationState } from '@coolms/core-angular';

import { endedSentence } from './elevation-prompt-dialog.component';

/** A state whose last elevation ended for the given reason at the given time. */
const ended = (reason: ElevationEndedReason, at: string | null = '2026-11-25T08:30:00Z'): ElevationState =>
    ({ elevated: false, ended: { reason, at } }) as ElevationState;
const clock = (): string => '08:30';

describe('endedSentence', () => {
    it('says how the last elevation ended, with its time, and asks for the password again', () => {
        expect(endedSentence(ended('closed'), clock)).toBe(
            'Your elevated session ended when the admin panel was closed or reloaded at 08:30. Enter your password to elevate again.');
        expect(endedSentence(ended('expired'), clock)).toBe(
            'Your elevated session expired at 08:30. Enter your password to elevate again.');
        expect(endedSentence(ended('dropped_by_user'), clock)).toBe(
            'You ended your elevated session at 08:30. Enter your password to elevate again.');
        expect(endedSentence(ended('refresh_from_other_pair'), clock)).toContain('continued from another address or browser');
    });

    it('a second factor reset on the server asks for a new one, not the password', () => {
        expect(endedSentence(ended('factor_reset'), clock)).toBe(
            'Your elevated session was ended at 08:30 because your second factor was reset. Enroll a new one before elevating.');
    });

    it('without a time, the sentence names none; never, or a reason it does not know, asks plainly', () => {
        expect(endedSentence(ended('factor_reset', null), clock)).toBe(
            'Your elevated session was ended because your second factor was reset. Enroll a new one before elevating.');
        expect(endedSentence(ended('never', null), clock)).toBe(
            'This action needs an elevated session. Enter your password to elevate.');
        expect(endedSentence(ended('something_new' as ElevationEndedReason), clock)).toBe(
            'This action needs an elevated session. Enter your password to elevate.');
    });
});
