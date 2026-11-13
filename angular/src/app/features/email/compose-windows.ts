import { type TagOption } from '@coolms/ui-angular';
import { restoredAttachments, type ComposeAttachment } from './compose-attachments';
import { draftFiles } from './compose-draft';
import { type ComposePrefillState } from './compose-prefill';
import { type EmailComposeMode, type EmailComposePartDto, type EmailDraftDto } from './email.types';
import { type ServerDraft } from './server-draft';

/** The most compose windows open at once, minimized ones included. */
export const MAX_COMPOSE_WINDOWS = 3;
/** How long a discarded draft can be brought back by the notice's Undo. */
export const DISCARD_UNDO_MS = 10_000;
/**
 * The editor profile the compose window's body is written with. The mail profile the mail API will serve takes its
 * place here once it is served; until then, the editor's standard profile.
 */
export const MAIL_EDITOR_PROFILE = 'standard';
/** Where one pane shows at a time, compose is full screen. */
export const PHONE_MAX_WIDTH_PX = 599.98;

/** A compose window that is open but not the one being written in: drawn as a bar, its fields kept as they were. */
export interface ComposeWindowSnapshot {
    readonly id: number;
    /** When it was last used, on the page's own clock: the one left unused longest goes first. */
    readonly lastUsed: number;
    /** Its draft on the server; one with no id is made at its first save. */
    readonly draft: ServerDraft | null;
    readonly mode: 'compose' | EmailComposeMode;
    readonly replyTargetId: string | null;
    readonly prefill: ComposePrefillState | null;
    readonly prefillOptions: TagOption[];
    readonly to: string[];
    readonly cc: string[];
    readonly bcc: string[];
    readonly showCcBcc: boolean;
    readonly subject: string;
    readonly text: string;
    readonly html: string;
    readonly rich: boolean;
    readonly attachments: ComposeAttachment[];
    readonly quoteKept: boolean;
    readonly forwardFiles: EmailComposePartDto[];
    readonly from: string | null;
    readonly maximized: boolean;
    readonly initial: {
        readonly to: string[];
        readonly cc: string[];
        readonly bcc: string[];
        readonly subject: string;
        readonly text: string;
        readonly html: string;
        readonly rich: boolean;
    };
}

/** A minimized window with its draft as the server now has it (saved elsewhere): what it shows when it is restored. */
export function parkedWithDraft(w: ComposeWindowSnapshot, d: EmailDraftDto): ComposeWindowSnapshot {
    const kept = new Set(d.messageParts.map(p => p.part));

    return {
        ...w,
        to: [...d.to],
        cc: [...d.cc],
        bcc: [...d.bcc],
        showCcBcc: w.showCcBcc || d.cc.length > 0 || d.bcc.length > 0,
        subject: d.subject,
        text: d.text,
        html: d.html ?? '',
        rich: d.html !== null,
        attachments: restoredAttachments(draftFiles(d)),
        quoteKept: w.mode === 'compose' ? w.quoteKept : d.quote !== false,
        forwardFiles: w.mode === 'forward' ? w.forwardFiles.filter(p => kept.has(p.part)) : w.forwardFiles,
        from: d.from,
    };
}

/** A window's title: its subject, else what it is. */
export function windowTitle(mode: 'compose' | EmailComposeMode, subject: string): string {
    const titles: Record<string, string> = { reply: 'Reply', reply_all: 'Reply all', forward: 'Forward' };
    const s = subject.trim();

    return s !== '' ? s : (titles[mode] ?? 'New message');
}

/** A window's recipients, as its bar shows them: To then Cc, or a line saying there are none yet. */
export function windowRecipients(to: readonly string[], cc: readonly string[]): string {
    const all = [...to, ...cc].map(a => a.trim()).filter(a => a !== '');

    return all.length > 0 ? all.join(', ') : 'No recipients';
}

/**
 * The minimized windows that must close so one more can open, keeping at most MAX_COMPOSE_WINDOWS: the ones left unused
 * longest. The window being opened is never among them.
 */
export function windowsToClose(parked: readonly ComposeWindowSnapshot[]): ComposeWindowSnapshot[] {
    const over = parked.length + 1 - MAX_COMPOSE_WINDOWS;

    return over > 0 ? [...parked].sort((a, b) => a.lastUsed - b.lastUsed).slice(0, over) : [];
}

/** The addresses From offers: the mailbox's own and its confirmed aliases; none (no From) without an alias. */
export function fromChoices(own: string | null, confirmedAliases: readonly string[], served: string | null): string[] {
    if (confirmedAliases.length === 0) {
        return [];
    }
    const list = [own, ...confirmedAliases, served].filter((a): a is string => a !== null && a.trim() !== '');

    return [...new Set(list)];
}
