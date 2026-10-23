import { DateTimeFormatService } from '@coolms/ui-angular';
import { type EmailMessageDetailDto } from './email.types';

/**
 * A forward of one message: "Fwd:" on the subject (once), and the original's header block -- From, Date, Subject,
 * To -- above its text, the way mail clients forward inline. The text is the message's plain body (else its snippet),
 * escaped, never its HTML: what is forwarded is what the reader saw, without carrying markup into the composer.
 * Attachments are not carried (the composer starts without them).
 */
export function buildForward(
    msg: EmailMessageDetailDto,
    dtf: DateTimeFormatService,
): { subject: string; html: string; text: string } {
    const subject = (msg.subject ?? '').trim();
    const fwdSubject = subject === '' ? 'Fwd:' : (/^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`);
    const from = (msg.fromName ?? '').trim() !== '' ? `${msg.fromName} <${msg.fromAddress ?? ''}>` : (msg.fromAddress ?? '');
    const when = dtf.dateTime(msg.sentAt);
    const header = [
        '---------- Forwarded message ----------',
        `From: ${from}`,
        ...(when !== '' ? [`Date: ${when}`] : []),
        `Subject: ${subject}`,
        `To: ${(msg.toAddresses ?? []).join(', ')}`,
    ];
    const body = (msg.bodyText ?? msg.snippet ?? '').trim();

    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<p></p><p>${header.map(esc).join('<br>')}</p><p>${esc(body).replace(/\n/g, '<br>')}</p>`;
    const text = `\n\n${header.join('\n')}\n\n${body}`;

    return { subject: fwdSubject, html, text };
}
