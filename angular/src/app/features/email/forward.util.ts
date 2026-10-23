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
    const body = forwardedText(msg).trim();

    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<p></p><p>${header.map(esc).join('<br>')}</p><p>${esc(body).replace(/\n/g, '<br>')}</p>`;
    const text = `\n\n${header.join('\n')}\n\n${body}`;

    return { subject: fwdSubject, html, text };
}

/** Elements that end a line of text when an HTML body is read as text. */
const BLOCKS = new Set(['P', 'DIV', 'BR', 'TR', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'BLOCKQUOTE', 'PRE']);

/**
 * The text a forward carries: the plain part when the message has one; else the text of its (server-sanitised) HTML
 * part, read with DOMParser -- which runs no scripts -- line by line at block ends; the snippet only when the message
 * has neither. An HTML-only notification would otherwise be forwarded as its 200-character snippet, and nothing would
 * say so.
 */
function forwardedText(msg: EmailMessageDetailDto): string {
    if ((msg.bodyText ?? '').trim() !== '') {
        return msg.bodyText as string;
    }
    if ((msg.bodyHtml ?? '').trim() !== '') {
        const doc = new DOMParser().parseFromString(msg.bodyHtml as string, 'text/html');
        let out = '';
        const walk = (node: Node): void => {
            if (node.nodeType === Node.TEXT_NODE) {
                out += (node.textContent ?? '').replace(/\s+/g, ' ');
                return;
            }
            node.childNodes.forEach(walk);
            if (node instanceof Element && BLOCKS.has(node.tagName)) {
                out += '\n';
            } else if (node instanceof Element && (node.tagName === 'TD' || node.tagName === 'TH')) {
                out += '\t';
            }
        };
        walk(doc.body);
        return out.split('\n').map(l => l.trim()).filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== '')).join('\n');
    }
    return msg.snippet ?? '';
}
