import type { FilterChipOption } from '@coolms/ui-angular';

import type { EmailMessageDto } from './email.types';

/** Which of a folder's read rows the list shows: all of them, the unread, or those with attachments. */
export type MailListFilter = 'all' | 'unread' | 'attachments';

/** The list's filter chips, in their order; All is the default. */
export const MAIL_LIST_FILTERS: readonly FilterChipOption[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'attachments', label: 'Attachments' },
];

/** The filter a chip names; anything else reads as All. */
export function mailListFilterOf(id: string): MailListFilter {
    return id === 'unread' || id === 'attachments' ? id : 'all';
}

/**
 * The rows the filter keeps, in their order. Unread is a row not seen; Attachments a row the server says has some (a
 * server row, whose attachments are not known, is left out).
 */
export function mailRowsShown(rows: readonly EmailMessageDto[], filter: MailListFilter): readonly EmailMessageDto[] {
    if (filter === 'unread') return rows.filter(m => m.seen !== true);
    if (filter === 'attachments') return rows.filter(m => m.hasAttachments === true);
    return rows;
}
