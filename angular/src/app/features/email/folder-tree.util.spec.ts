import type { EmailFolderDto, EmailFolderTreeNodeDto } from './email.types';
import { folderRows } from './folder-tree.util';

function node(folder: string, name: string, over: Partial<EmailFolderTreeNodeDto> = {}): EmailFolderTreeNodeDto {
    return { folder, name, selectable: true, total: 1, unseen: 0, role: null, children: [], ...over };
}

describe('folderRows', () => {
    it('keeps the order the server answers, and the depth of each', () => {
        const rows = folderRows([
            node('INBOX', 'INBOX', { role: 'inbox' }),
            node('Zebra', 'Zebra', { children: [node('Zebra/Two', 'Two'), node('Zebra/One', 'One')] }),
            node('Alpha', 'Alpha'),
        ], []);

        expect(rows.map(r => [r.folder.folder, r.depth])).toEqual([
            ['INBOX', 0], ['Zebra', 0], ['Zebra/Two', 1], ['Zebra/One', 1], ['Alpha', 0],
        ]);
    });

    it('draws the name the server gives, whatever the role or the path says', () => {
        const rows = folderRows([
            node('[Gmail]/Sent Mail', 'Надіслані', { role: 'sent' }),
            node('Partners/Demo requests', 'Demo requests'),
        ], []);

        expect(rows.map(r => r.name)).toEqual(['Надіслані', 'Demo requests']);
    });

    it('a folder that only holds folders opens nothing', () => {
        expect(folderRows([node('Clients', 'Clients', { selectable: false })], [])[0].selectable).toBeFalse();
    });

    it('takes the counts as they stand now from the flat list', () => {
        const flat: EmailFolderDto[] = [{ folder: 'INBOX', total: 5, unseen: 2 }];
        const rows = folderRows([node('INBOX', 'INBOX', { unseen: 9 }), node('Other', 'Other', { unseen: 3 })], flat);

        expect(rows[0].folder.unseen).toBe(2);
        expect(rows[1].folder.unseen).toBe(3);
    });

    it('with no tree shows the flat list as it stands, named as before', () => {
        const flat: EmailFolderDto[] = [{ folder: 'INBOX', role: 'inbox', total: 1, unseen: 0 }, { folder: 'A/B', total: 1, unseen: 0 }];

        expect(folderRows([], flat).map(r => [r.name, r.depth, r.selectable])).toEqual([['Inbox', 0, true], ['A/B', 0, true]]);
    });
});
