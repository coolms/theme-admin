import type { EmailMessageDto } from './email.types';

/** Which of a folder's read rows the list shows: all of them, the unread, or those with attachments. */
export type MailListFilter = 'all' | 'unread' | 'attachments';

/** The values the list can apply. */
export const MAIL_LIST_FILTER_VALUES: readonly MailListFilter[] = ['all', 'unread', 'attachments'];

/** The rows a choice's value keeps; every row without one. */
export function mailListFilterOf(id: string | null): MailListFilter {
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
