import type { EmailFolderDto } from './email.types';

/** The words for a folder with a special-use role, as the web Workspace names them. */
const ROLE_NAMES: Readonly<Record<string, string>> = {
    inbox: 'Inbox',
    sent: 'Sent',
    drafts: 'Drafts',
    archive: 'Archive',
    junk: 'Spam',
    trash: 'Trash',
    all: 'All mail',
    flagged: 'Starred',
};

/**
 * A folder's name as a person reads it: a folder with a role by that role (INBOX is Inbox, [Gmail]/Sent Mail is
 * Sent), any other by its path, which keeps a nested folder (Partners/Demo requests) apart from one of the same name.
 */
export function folderDisplayName(folder: Pick<EmailFolderDto, 'folder' | 'role'>): string {
    const role = folder.role ?? null;

    return (role !== null ? ROLE_NAMES[role] : undefined) ?? folder.folder;
}
