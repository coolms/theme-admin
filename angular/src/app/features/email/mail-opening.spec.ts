import { MAIL_PREFERENCE_DEFAULTS } from './mail-preferences.service';
import { loadsRemoteImagesAtOnce, openingMailbox } from './mail-opening';

/**
 * Where the mail page opens and how a message opens there, from the person's mail settings: the default mailbox comes
 * after an OAuth return and before the last one viewed; remote images load at once only when "always loaded".
 */
describe('The mail page opening, from the mail settings', () => {
    const LIST = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    it('opens on an OAuth return first, then the default mailbox, then the last viewed, then the first', () => {
        expect(openingMailbox(LIST, 'c', 'b', 'a')).toBe('c');
        expect(openingMailbox(LIST, null, 'b', 'a')).toBe('b');
        expect(openingMailbox(LIST, null, null, 'c')).toBe('c');
        expect(openingMailbox(LIST, null, null, null)).toBe('a');
    });

    it('a default mailbox no longer in the list is passed over', () => {
        expect(openingMailbox(LIST, null, 'gone', 'c')).toBe('c');
        expect(openingMailbox([], null, 'b', null)).toBeNull();
    });

    it('remote images load at once only when the rule the server resolved says allow', () => {
        const as = (choice: 'inherit' | 'block' | 'allow', effective: 'block' | 'allow') =>
            loadsRemoteImagesAtOnce({ ...MAIL_PREFERENCE_DEFAULTS, remoteImages: choice, remoteImagesEffective: effective });

        expect(as('allow', 'allow')).toBeTrue();
        expect(as('inherit', 'allow')).withContext('following an installation that allows them').toBeTrue();
        expect(as('inherit', 'block')).withContext('following an installation that blocks them').toBeFalse();
        expect(as('block', 'block')).toBeFalse();
        expect(as('allow', 'block')).withContext('the server\'s resolution decides, not the choice').toBeFalse();
        expect(loadsRemoteImagesAtOnce(MAIL_PREFERENCE_DEFAULTS)).withContext('nothing answered yet: blocked').toBeFalse();
    });
});
