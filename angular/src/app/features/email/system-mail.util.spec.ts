import type { EmailMailboxDto, SystemMailDto } from './email.types';
import { systemMailCandidates, systemMailChoice, systemMailFromOptions, systemMailStateText } from './system-mail.util';

/**
 * The System mail page's rules: only a shared, enabled mailbox is offered (the server refuses the rest), a blank
 * display name is sent as null (the configured name kept), and the state is said in words.
 */
describe('system mail rules', () => {
    it('offers only the mailboxes that are shared and enabled', () => {
        const mailboxes: EmailMailboxDto[] = [
            { id: 'a', kind: 'shared', enabled: true },
            { id: 'b', kind: 'personal', enabled: true },
            { id: 'c', kind: 'shared', enabled: false },
            { id: 'd' },
            { id: 'e', kind: 'shared' },
        ];

        expect(systemMailCandidates(mailboxes).map(m => m.id)).toEqual(['a', 'e']);
    });

    it('sends the display name trimmed, and null when blank', () => {
        expect(systemMailChoice('mb-1', 'notifications@example.test', ' Notifications ')).toEqual({
            mailboxId: 'mb-1', fromAddress: 'notifications@example.test', fromName: 'Notifications',
        });
        expect(systemMailChoice('mb-1', 'notifications@example.test', '   ').fromName).toBeNull();
    });

    it('keeps a stored From the mailbox no longer offers: offered first, named, and chosen', () => {
        const offered = ['notifications@example.test', 'notifications@example.org'];

        expect(systemMailFromOptions(offered, null)).toEqual({ options: offered, selected: 'notifications@example.test', notOffered: null });
        expect(systemMailFromOptions(offered, 'notifications@example.org').selected).toBe('notifications@example.org');
        expect(systemMailFromOptions(offered, 'old@example.org')).toEqual({
            options: ['old@example.org', ...offered], selected: 'old@example.org', notOffered: 'old@example.org',
        });
        expect(systemMailFromOptions([], 'old@example.org').selected).withContext('nothing could be read').toBe('old@example.org');
    });

    it('says the state in words, a stop with its reason', () => {
        const view: SystemMailDto = { mailboxId: null, fromAddress: null, fromName: null, state: 'none', stopReason: null, held: 0 };

        expect(systemMailStateText(view)).toContain('configured transport');
        expect(systemMailStateText({ ...view, state: 'sending', mailboxId: 'mb-1' })).toBe('Sending through the chosen mailbox.');
        expect(systemMailStateText({ ...view, state: 'stopped', stopReason: 'mailbox-needs-reconnect' }))
            .toBe('Stopped: the mailbox needs to be connected again.');
    });
});
