import { type EmailFolderTreeNodeDto } from './email.types';
import { eventInboxUnread, inboxFolder, inboxUnread, servedUnread, unreadElsewhere } from './mailbox-unread';

function node(folder: string, over: Partial<EmailFolderTreeNodeDto> = {}): EmailFolderTreeNodeDto {
    return { folder, name: folder, selectable: true, total: 10, unseen: 0, role: null, children: [], ...over };
}

describe('mailbox unread', () => {
    it('is the inbox\'s alone: Inbox 5, Important 3 and All mail 9 give 5', () => {
        const tree = [
            node('INBOX', { role: 'inbox', unseen: 5, serverUnseen: 5 }),
            node('[Gmail]', { selectable: false, children: [
                node('[Gmail]/Important', { role: 'system', unseen: 3, serverUnseen: 3 }),
                node('[Gmail]/All Mail', { role: 'all', unseen: 9, serverUnseen: 9 }),
            ] }),
        ];

        expect(inboxUnread(tree)).toBe(5);
    });

    it('finds the inbox by its role first, else by the INBOX path, and at any depth', () => {
        expect(inboxFolder([node('INBOX'), node('Posteingang', { role: 'inbox' })])?.folder).toBe('Posteingang');
        expect(inboxFolder([node('Archive'), node('INBOX')])?.folder).toBe('INBOX');
        expect(inboxFolder([node('Top', { children: [node('Mail', { role: 'inbox' })] })])?.folder).toBe('Mail');
        expect(inboxFolder([node('Archive')])).toBeNull();
        expect(inboxUnread([node('Archive', { unseen: 4 })])).toBe(0);
    });

    it('takes serverUnseen when present, else unseen (serverUnseen absent before a sync has read it)', () => {
        expect(inboxUnread([node('INBOX', { unseen: 4, serverUnseen: 7 })])).toBe(7);
        expect(inboxUnread([node('INBOX', { unseen: 4 })])).toBe(4);
        expect(inboxUnread([node('INBOX', { unseen: 4, serverUnseen: null })])).toBe(4);
    });

    it('reads the list\'s served unread only when the row carries it', () => {
        expect(servedUnread({ id: 'a', unread: 3 })).toBe(3);
        expect(servedUnread({ id: 'a', unread: 0 })).toBe(0);
        expect(servedUnread({ id: 'a' })).toBeNull();
    });

    it('from a change event, takes the inbox entry, or null when the event has none', () => {
        const counts = {
            INBOX: { unseen: 1, serverUnseen: 2 },
            Archive: { unseen: 8, serverUnseen: 8 },
        };
        expect(eventInboxUnread(counts, 'INBOX')).toBe(2);
        expect(eventInboxUnread({ INBOX: { unseen: 1, serverUnseen: null } }, 'INBOX')).toBe(1);
        expect(eventInboxUnread({ Archive: { unseen: 0 } }, 'INBOX')).toBeNull();
    });

    it('says whether a mailbox other than the open one has unread mail', () => {
        const list = [{ id: 'a' }, { id: 'b' }];
        expect(unreadElsewhere(list, 'a', { a: 4, b: 0 })).toBeFalse();
        expect(unreadElsewhere(list, 'a', { a: 0, b: 1 })).toBeTrue();
        expect(unreadElsewhere(list, 'a', {})).toBeFalse();
    });
});
