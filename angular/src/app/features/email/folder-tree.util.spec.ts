import type { EmailFolderDto, EmailFolderTreeNodeDto } from './email.types';
import { folderRows } from './folder-tree.util';

function node(folder: string, name: string, over: Partial<EmailFolderTreeNodeDto> = {}): EmailFolderTreeNodeDto {
    return { folder, name, selectable: true, total: 1, unseen: 0, role: null, children: [], ...over };
}

/**
 * A tree whose names are neither alphabetical nor what a role would be called, and whose order is neither: any
 * sorting or naming done here instead of by the server reads differently.
 */
const TREE: EmailFolderTreeNodeDto[] = [
    node('INBOX', 'Mail that came in', { role: 'inbox' }),
    node('[Gmail]/Sent Mail', 'Gone out', { role: 'sent' }),
    node('Zulu', 'Zulu', { children: [node('Zulu/Yankee', 'Yankee'), node('Zulu/Bravo', 'Bravo')] }),
    node('Projects', 'Projects', { selectable: false, children: [node('Projects/Mango', 'Mango')] }),
    node('Alpha', 'Alpha'),
];

describe('folderRows', () => {
    it('keeps the order and the names the server answers, and the depth of each', () => {
        expect(folderRows(TREE, []).map(r => [r.folder.folder, r.name, r.depth])).toEqual([
            ['INBOX', 'Mail that came in', 0],
            ['[Gmail]/Sent Mail', 'Gone out', 0],
            ['Zulu', 'Zulu', 0],
            ['Zulu/Yankee', 'Yankee', 1],
            ['Zulu/Bravo', 'Bravo', 1],
            ['Projects', 'Projects', 0],
            ['Projects/Mango', 'Mango', 1],
            ['Alpha', 'Alpha', 0],
        ]);
    });

    it('a folder that only holds folders opens nothing', () => {
        expect(folderRows(TREE, []).filter(r => !r.selectable).map(r => r.folder.folder)).toEqual(['Projects']);
    });

    it('takes the counts from the flat list by path; the flat list adds, orders and names nothing', () => {
        const flat: EmailFolderDto[] = [
            { folder: 'Alpha', total: 7, unseen: 4 },
            { folder: 'INBOX', role: 'inbox', total: 5, unseen: 2 },
            { folder: 'Not in the tree', total: 1, unseen: 1 },
        ];
        const rows = folderRows(TREE, flat);

        expect(rows.map(r => r.folder.folder)).toEqual(folderRows(TREE, []).map(r => r.folder.folder));
        expect(rows.map(r => r.name)).toEqual(folderRows(TREE, []).map(r => r.name));
        expect(rows[0].folder.unseen).toBe(2);
        expect(rows[7].folder.unseen).toBe(4);
        expect(rows[1].folder.unseen).withContext('a folder the flat list lacks keeps the tree\'s count').toBe(0);
    });

    it('with no tree there are no rows, whatever the flat list holds', () => {
        const flat: EmailFolderDto[] = [{ folder: 'INBOX', role: 'inbox', total: 1, unseen: 0 }, { folder: 'A/B', total: 1, unseen: 0 }];

        expect(folderRows([], flat)).toEqual([]);
    });
});
