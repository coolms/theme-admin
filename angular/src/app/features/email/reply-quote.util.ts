import { type DateTimeFormatService } from '@coolms/ui-angular';

import { type EmailMessageDetailDto } from './email.types';

/**
 * The "On {date}, {sender} wrote:" quoted-original block for a reply, built
 * from what the detail pane actually shows (the sender + snippet). A leading
 * blank line/paragraph puts the caret above the quote so the user types on
 * top.
 *
 * The date is the PERSON's -- the profile's timezone, date format and 12h/24h
 * choice, through `DateTimeFormatService.dateTime()`. The page used to call
 * `new Date(sentAt).toLocaleString()` with no options at all, so the one line
 * of a reply the recipient reads back as a fact carried the BROWSER's locale,
 * the BROWSER's zone and a seconds field. An instant the formatter cannot
 * read now drops the clause instead of quoting "On Invalid Date".
 */
export function buildReplyQuote(msg: EmailMessageDetailDto, dtf: DateTimeFormatService): { html: string; text: string } {
    const who = (msg.fromName ?? '').trim() !== '' ? `${msg.fromName} <${msg.fromAddress ?? ''}>` : (msg.fromAddress ?? 'the sender');
    const when = dtf.dateTime(msg.sentAt);
    const attribution = when !== '' ? `On ${when}, ${who} wrote:` : `${who} wrote:`;
    const body = (msg.snippet ?? '').trim();

    const esc = (s: string): string =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<p></p><p>${esc(attribution)}</p><blockquote>${esc(body).replace(/\n/g, '<br>')}</blockquote>`;
    const text = `\n\n${attribution}\n${body.split('\n').map(l => `> ${l}`).join('\n')}`;

    return { html, text };
}
