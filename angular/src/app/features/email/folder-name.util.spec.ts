import { folderDisplayName } from './folder-name.util';

/** A folder with a role is named by it; any other folder, or a role the admin has no words for, by its path. */
describe('folderDisplayName', () => {
    it('names a folder by its role', () => {
        expect(folderDisplayName({ folder: 'INBOX', role: 'inbox' })).toBe('Inbox');
        expect(folderDisplayName({ folder: '[Gmail]/Sent Mail', role: 'sent' })).toBe('Sent');
        expect(folderDisplayName({ folder: 'Junk E-mail', role: 'junk' })).toBe('Spam');
        expect(folderDisplayName({ folder: '[Gmail]/All Mail', role: 'all' })).toBe('All mail');
        expect(folderDisplayName({ folder: '[Gmail]/Starred', role: 'flagged' })).toBe('Starred');
    });

    it('names any other folder by its path, nested ones included', () => {
        expect(folderDisplayName({ folder: 'Partners/Demo requests', role: null })).toBe('Partners/Demo requests');
        expect(folderDisplayName({ folder: 'Projects' })).toBe('Projects');
    });

    it('names a folder by its path when its role is one the admin has no words for', () => {
        expect(folderDisplayName({ folder: 'Important', role: 'important' })).toBe('Important');
    });
});
