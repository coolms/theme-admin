import { type EmailMessageDto } from './email.types';
import { MailLiveFollower, type MailMessagesChangedEvent, type MailView, readMessagesChanged } from './mail-messages-changed';

const MAILBOX = 'mb-1';

const event = (seq: number, change: Record<string, unknown>): MailMessagesChangedEvent => {
    const read = readMessagesChanged({
        type: 'mail.messages.changed', mailboxId: MAILBOX, origin: 'sync', seq, changes: [change], counts: {}, mailboxUnseen: 0,
    });
    if (read === null) {
        throw new Error('the event did not read');
    }
    return read;
};

const view = (): MailView => ({
    mailboxId: MAILBOX, folder: 'Archive',
    messages: [{ id: 'kept' }, { id: 'open' }] as EmailMessageDto[],
    thread: [], openMessage: { id: 'open', subject: 'Old invoice' } as EmailMessageDto,
    folders: [], mailboxUnread: {},
});

/**
 * A message gone from the mailbox, as the reader takes it: an evicted copy (opened from the server, no longer kept here)
 * stays shown and says so; a gone change without a reason (a purge, a retired row) keeps today's behaviour. The row
 * leaves the list either way.
 */
describe('A gone message in the reader: evicted, or deleted', () => {
    it('reads the reason only when it is evicted', () => {
        expect(event(1, { id: 'open', folder: 'Archive', gone: true, reason: 'evicted' }).changes[0])
            .toEqual({ id: 'open', folder: 'Archive', gone: true, reason: 'evicted' });
        expect(event(2, { id: 'open', folder: 'Archive', gone: true }).changes[0])
            .toEqual({ id: 'open', folder: 'Archive', gone: true });
        expect(event(3, { id: 'open', folder: 'Archive', gone: true, reason: 'something' }).changes[0])
            .withContext('another reason is a plain gone').toEqual({ id: 'open', folder: 'Archive', gone: true });
    });

    it('evicted: the row leaves the list, the reader keeps the message and is told it is no longer kept', () => {
        const after = new MailLiveFollower(() => undefined).apply(view(), event(5, { id: 'open', folder: 'Archive', gone: true, reason: 'evicted' }));

        expect(after.messages.map(m => m.id)).toEqual(['kept']);
        expect(after.openMessage?.id).withContext('still shown').toBe('open');
        expect(after.evictedOpen).toBeTrue();
    });

    it('deleted (no reason): the row leaves the list, and the reader is as it was', () => {
        const after = new MailLiveFollower(() => undefined).apply(view(), event(5, { id: 'open', folder: 'Archive', gone: true }));

        expect(after.messages.map(m => m.id)).toEqual(['kept']);
        expect(after.openMessage?.id).toBe('open');
        expect(after.evictedOpen).withContext('a deletion is not an eviction').toBeFalse();
    });

    it('an evicted message that is not the one open only leaves the list', () => {
        const after = new MailLiveFollower(() => undefined).apply(view(), event(5, { id: 'kept', folder: 'Archive', gone: true, reason: 'evicted' }));

        expect(after.messages.map(m => m.id)).toEqual(['open']);
        expect(after.evictedOpen).toBeFalse();
    });
});
