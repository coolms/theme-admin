import { deletedText, yourMailbox } from './your-mailbox';

describe('yourMailbox -- a mailbox as a sentence names it', () => {
    it('by its provider where it carries one, else plainly', () => {
        expect(yourMailbox({ oauthProvider: 'google' })).toBe('your Gmail mailbox');
        expect(yourMailbox({ oauthProvider: 'microsoft' })).toBe('your Microsoft mailbox');
        expect(yourMailbox({ oauthProvider: null })).toBe('your mailbox');
        expect(yourMailbox({})).toBe('your mailbox');
        expect(yourMailbox(null)).toBe('your mailbox');
        expect(yourMailbox(undefined)).toBe('your mailbox');
    });

    it('a message gone at the provider is said deleted in it', () => {
        expect(deletedText(yourMailbox({ oauthProvider: 'google' }))).toBe('This message was deleted in your Gmail mailbox.');
        expect(deletedText(yourMailbox(null))).toBe('This message was deleted in your mailbox.');
    });
});
