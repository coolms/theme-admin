import {
    ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output,
    signal, untracked, viewChild, Injector,
} from '@angular/core';
import { ToastService } from '@coolms/ui-angular';
import { ComposeAttachmentsComponent } from './compose-attachments.component';
import {
    expiredAttachmentId, restoredAttachments, storedAttachments, tooLargeSend, type ComposeAttachment,
} from './compose-attachments';
import { draftFiles, replyDraftOf, writtenInWindow } from './compose-draft';
import { addressesOf, quotedMessageUnavailable } from './compose-prefill';
import { EmailService } from './email.service';
import { type EmailComposeDto, type EmailDraftDto, type EmailDraftWrite, type OutgoingEmailRequest } from './email.types';
import { type MailDraftsChangedEvent } from './mail-drafts-changed';
import { sendFailureText } from './send-via';
import { DRAFT_GONE_KEPT, ServerDraft } from './server-draft';

/** The most lines the box grows to; past them it scrolls inside itself. */
export const QUICK_REPLY_MAX_LINES = 6;
/** The pause after typing before the draft is saved, as the compose window waits. */
export const QUICK_REPLY_SAVE_MS = 600;

/** The reply the box hands to the compose window: its draft on the server (none yet: null), and its mode. */
export interface QuickReplyHandOff {
    readonly draftId: string | null;
    readonly mode: 'reply' | 'reply_all';
}

/**
 * The quick reply: a chat-like box pinned at the bottom of the message pane, outside the message's scroll. One line,
 * "Write a reply...", that grows with the text to about six lines and then scrolls inside. It goes to the sender (the
 * Reply-To when there is one) with Re:, as the server's reply prefill gives them; the server appends the quote, which
 * is not shown. Plain text, attachments with the size meter, Send and Expand. Ctrl or Cmd+Enter sends; Enter is a new
 * line. The text is that message's reply draft on the server, the one the compose window also writes, found again by
 * the message (the drafts lookup) and saved after a pause; Expand (or Reply while the box holds text) hands that one
 * draft to the window: the box then says the reply is open there, with a way to bring the window up.
 */
@Component({
    selector: 'app-mail-quick-reply',
    standalone: true,
    imports: [ComposeAttachmentsComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="mqr" data-test="quick-reply" role="group" aria-label="Quick reply">
            @if (inWindow()) {
                <p class="mqr__handed" role="status" data-test="quick-reply-in-window">
                    <i class="bi bi-window-stack" aria-hidden="true"></i>
                    <span>The reply is open in the compose window.</span>
                    <button type="button" class="mbx__btn mbx__btn--sm" data-test="quick-reply-show-window"
                            (click)="showWindowNow()">Show it</button>
                </p>
            } @else if (prefill()?.from?.choices?.length === 0) {
                <!-- A reader who may not send from this mailbox has no quick reply. -->
            } @else {
                @if (quoteRefused()) {
                    <p class="mqr__note" role="alert" data-test="quick-reply-quote-refused">
                        The original could no longer be read, so the reply was not sent. Expand to send it without the quote.
                    </p>
                } @else if (prefillFailed()) {
                    <p class="mqr__note" role="alert" data-test="quick-reply-prefill-failed">
                        The reply could not be prepared.
                        <button type="button" class="mbx__btn mbx__btn--sm" (click)="readPrefill()">Try again</button>
                    </p>
                }
                <div class="mqr__row">
                    <textarea #box class="mqr__box" rows="1" data-test="quick-reply-box"
                              placeholder="Write a reply…" [attr.aria-label]="label()"
                              [value]="text()" (input)="onInput(box.value)"
                              (keydown)="onKeydown($event)"></textarea>
                    <button type="button" class="mbx__icon-btn mqr__expand" data-test="quick-reply-expand"
                            title="Expand" aria-label="Expand to the compose window" (click)="expandNow()">
                        <i class="bi bi-arrows-angle-expand" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="mbx__btn mbx__btn--primary mbx__btn--sm" data-test="quick-reply-send"
                            [disabled]="!canSend()" (click)="send()">
                        {{ sending() ? 'Sending…' : 'Send' }}
                    </button>
                </div>
                <app-compose-attachments class="mqr__files" [mailboxId]="mailboxId()" [limitBytes]="limitBytes()"
                                         [bodyBytes]="bodyBytes()" [sendRefused]="sendRefused()"
                                         [(attachments)]="attachments" (changed)="scheduleSave()" />
            }
        </div>
    `,
    styles: [`
        :host { display: block; flex: 0 0 auto; }
        .mqr {
            display: flex; flex-direction: column; gap: 6px; padding: 10px 0 12px;
            border-top: 1px solid var(--cms-border); background: var(--cms-surface);
        }
        .mqr__row { display: flex; align-items: flex-end; gap: 6px; }
        .mqr__box {
            flex: 1 1 auto; min-width: 0; resize: none; box-sizing: border-box;
            font: inherit; line-height: 1.4; padding: 7px 10px; overflow-y: hidden;
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md);
            background: var(--cms-surface); color: var(--cms-text);
        }
        .mqr__box:focus-visible { outline: 2px solid var(--cms-focus-ring); outline-offset: 1px; }
        .mqr__handed, .mqr__note {
            display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font-size: .8125rem;
            color: var(--cms-text-secondary);
        }
        .mqr__note { color: var(--cms-warning-text); }
    `],
})
export class MailQuickReplyComponent {
    readonly mailboxId = input.required<string>();
    readonly messageId = input.required<string>();
    /** The box's accessible name, naming whom the reply goes to. */
    readonly label = input('Write a reply');
    /** The mailbox's size limit, for the meter. */
    readonly limitBytes = input<number | null>(null);
    /** The compose window holds this message's reply now. */
    readonly windowHolds = input(false);

    /** Expand, or Reply while the box holds text: the page opens the window on this draft. */
    readonly expand = output<QuickReplyHandOff>();
    /** Bring the compose window holding this reply up, or open it on the draft. */
    readonly showWindow = output<QuickReplyHandOff>();
    /** A reply went. */
    readonly sent = output<void>();

    readonly text = signal('');
    readonly attachments = signal<ComposeAttachment[]>([]);
    readonly prefill = signal<EmailComposeDto | null>(null);
    readonly prefillFailed = signal(false);
    readonly sending = signal(false);
    readonly quoteRefused = signal(false);
    readonly sendRefused = signal<{ limitBytes: number; sizeBytes: number } | null>(null);
    /** The reply draft is one the compose window writes (formatted, to all, or without the quote). */
    private readonly storedInWindow = signal(false);
    readonly inWindow = computed(() => this.windowHolds() || this.storedInWindow());
    readonly bodyBytes = computed(() => new TextEncoder().encode(this.text()).length);
    readonly canSend = computed(() => !this.sending() && this.prefill() !== null
        && (this.text().trim() !== '' || storedAttachments(this.attachments()).length > 0)
        && !this.attachments().some(a => a.status === 'uploading' || a.status === 'attaching' || a.status === 'refused'));

    private readonly email = inject(EmailService);
    private readonly toast = inject(ToastService);
    private readonly injector = inject(Injector);
    private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private prefillSeq = 0;
    private lookupSeq = 0;
    /** The message the box shows, for the save that is still owed when it changes. */
    private shown: { mailboxId: string; messageId: string } | null = null;
    /** The message's reply draft on the server; one with no id is made at its first save. */
    private draft: ServerDraft | null = null;
    /** The reply draft as last read, whose recipients and subject a save keeps until the prefill is read. */
    private stored: EmailDraftDto | null = null;

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            this.flush();
            this.draft?.release();
        });
        // Another message, or the window took or gave back the reply: the box shows that message's draft.
        effect(() => {
            const mailboxId = this.mailboxId();
            const messageId = this.messageId();
            const windowHolds = this.windowHolds();
            untracked(() => this.load(mailboxId, messageId, windowHolds));
        });
    }

    /** The box holds something worth handing to the window. */
    hasContent(): boolean {
        return this.text().trim() !== '' || this.attachments().length > 0;
    }

    /** Saves what is owed now (before the window takes the draft, or the box goes). */
    flush(): void {
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            this.save();
        }
    }

    /**
     * The reply as the window takes it: what the box holds is saved now, and once that save has landed `then` gets the
     * draft's id, so the window opens on the same draft and never makes a second.
     */
    handOff(then: (handOff: QuickReplyHandOff) => void): void {
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.save();
        const draft = this.draft;
        if (draft === null) {
            then({ draftId: null, mode: 'reply' });
            return;
        }
        draft.settled(() => then({ draftId: draft.id, mode: draft.answers?.mode === 'reply_all' ? 'reply_all' : 'reply' }));
    }

    /** A realtime change to one of the person's drafts: this message's reply draft is read again, or cleared. */
    onDraftsChanged(event: MailDraftsChangedEvent): void {
        if (!this.windowHolds()) {
            this.draft?.told(event);
        }
    }

    protected onInput(value: string): void {
        this.text.set(value);
        this.quoteRefused.set(false);
        this.fit();
        this.scheduleSave();
    }

    protected onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            this.send();
        }
    }

    protected scheduleSave(): void {
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.save();
        }, QUICK_REPLY_SAVE_MS);
    }

    /** Expand: the draft is saved as it is, and handed to the window. */
    expandNow(): void {
        this.handOff(handOff => this.expand.emit(handOff));
    }

    /** Show it: the window holding the reply comes up, or opens on the draft written there. */
    protected showWindowNow(): void {
        const draft = this.draft;
        this.showWindow.emit({
            draftId: draft?.id ?? null,
            mode: draft?.answers?.mode === 'reply_all' ? 'reply_all' : 'reply',
        });
    }

    readPrefill(): void {
        const id = this.messageId();
        const seq = ++this.prefillSeq;
        this.prefillFailed.set(false);
        this.email.composePrefill(id, 'reply').subscribe({
            next: answer => {
                if (seq === this.prefillSeq) {
                    this.prefill.set(answer);
                }
            },
            error: () => {
                if (seq === this.prefillSeq) {
                    this.prefillFailed.set(true);
                }
            },
        });
    }

    send(): void {
        const answer = this.prefill();
        if (!this.canSend() || answer === null) {
            return;
        }
        const request: OutgoingEmailRequest = {
            text: this.text().trim(),
            to: addressesOf(answer.to),
            subject: answer.subject,
            from: answer.from.address,
            // The server appends the quote; it is not shown here, and removing it takes the compose window.
            quote: true,
        };
        const ids = storedAttachments(this.attachments()).map(a => a.id);
        if (ids.length > 0) {
            request.attachments = ids;
        }
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        const draft = this.draft;
        this.sendRefused.set(null);
        this.quoteRefused.set(false);
        this.sending.set(true);
        // A save on its way lands first, so the reply names the draft it was written in and the server removes it.
        const go = (): void => {
            const draftId = draft?.id ?? null;
            if (draftId !== null) {
                request.draftId = draftId;
            }
            this.email.reply(this.messageId(), request).subscribe({
                next: () => this.afterSend(draft),
                error: (e: unknown) => this.sendFailed(e),
            });
        };
        if (draft === null) {
            go();
        } else {
            draft.settled(go);
        }
    }

    private afterSend(draft: ServerDraft | null): void {
        this.sending.set(false);
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        // The server removed the draft with the send: the next reply is a new one.
        draft?.release();
        if (this.draft === draft && this.shown !== null) {
            this.draft = this.newDraft(this.shown.mailboxId, this.shown.messageId);
        }
        this.stored = null;
        this.text.set('');
        this.attachments.set([]);
        this.fit();
        this.toast.success('Reply sent.');
        this.sent.emit();
    }

    private sendFailed(e: unknown): void {
        this.sending.set(false);
        // A failed send keeps the draft: what the box holds is saved as it is.
        this.scheduleSave();
        if (quotedMessageUnavailable(e)) {
            this.quoteRefused.set(true);
            return;
        }
        const expired = expiredAttachmentId(e);
        if (expired !== null) {
            const words = 'This file is no longer there to send. Remove it and attach it again.';
            this.attachments.update(list => list.map(a => (a.id === expired
                ? { ...a, status: 'refused' as const, refusal: words } : a)));
            return;
        }
        const tooLarge = tooLargeSend(e);
        if (tooLarge !== null) {
            this.sendRefused.set(tooLarge);
            return;
        }
        this.toast.error(sendFailureText(e));
    }

    /** The box as tall as its text, from one line up to the most lines, then it scrolls inside. */
    private fit(): void {
        const box = this.box()?.nativeElement;
        if (box === undefined) {
            return;
        }
        const style = getComputedStyle(box);
        const line = parseFloat(style.lineHeight);
        const frame = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
            + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        const most = line * QUICK_REPLY_MAX_LINES + frame;
        box.style.height = 'auto';
        const wanted = box.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        box.style.height = `${Math.min(wanted, most)}px`;
        box.style.overflowY = wanted > most + 0.5 ? 'auto' : 'hidden';
    }

    private load(mailboxId: string, messageId: string, windowHolds: boolean): void {
        const moved = this.shown?.mailboxId !== mailboxId || this.shown.messageId !== messageId;
        if (moved) {
            this.flush();
            this.draft?.release();
            this.shown = { mailboxId, messageId };
            this.draft = this.newDraft(mailboxId, messageId);
            this.stored = null;
            this.prefill.set(null);
            this.quoteRefused.set(false);
            this.sendRefused.set(null);
            this.readPrefill();
        }
        this.text.set('');
        this.attachments.set([]);
        this.storedInWindow.set(false);
        if (!windowHolds) {
            // The message's reply draft, found by the message: opened here, or given back by the window.
            this.lookUp(mailboxId, messageId);
        }
        afterNextRender(() => this.fit(), { injector: this.injector });
    }

    private lookUp(mailboxId: string, messageId: string): void {
        const seq = ++this.lookupSeq;
        this.email.draftsAnswering(mailboxId, messageId).subscribe({
            next: list => {
                const found = replyDraftOf(list);
                const draft = this.draft;
                if (seq !== this.lookupSeq || found === null || draft === null || draft.pending || this.windowHolds()) {
                    return;
                }
                draft.adopt(found);
                this.show(found);
            },
            error: () => undefined,
        });
    }

    private newDraft(mailboxId: string, messageId: string): ServerDraft {
        const draft: ServerDraft = new ServerDraft(this.email, mailboxId, { messageId, mode: 'reply' }, {
            loaded: d => {
                if (this.draft === draft) {
                    if (this.saveTimer !== null) {
                        clearTimeout(this.saveTimer);
                        this.saveTimer = null;
                    }
                    this.show(d);
                }
            },
            gone: kept => {
                if (this.draft === draft) {
                    this.draft = this.newDraft(mailboxId, messageId);
                    if (kept !== null) {
                        // Deleted elsewhere while the box's text was being saved: the text stays, as a new draft.
                        this.draft.save(kept);
                        this.toast.info(DRAFT_GONE_KEPT);
                        return;
                    }
                    this.stored = null;
                    this.storedInWindow.set(false);
                    this.text.set('');
                    this.attachments.set([]);
                    this.fit();
                }
            },
        });

        return draft;
    }

    /** The reply draft as the server has it: in the box, or, when it is the window's, said to be there. */
    private show(draft: EmailDraftDto): void {
        this.stored = draft;
        const window = writtenInWindow(draft);
        this.storedInWindow.set(window);
        this.text.set(window ? '' : draft.text);
        this.attachments.set(window ? [] : restoredAttachments(draftFiles(draft)));
        afterNextRender(() => this.fit(), { injector: this.injector });
    }

    /** What the box holds, as the whole reply draft: plain text, the quote kept, to the prefill's recipient. */
    private body(): EmailDraftWrite {
        const answer = this.prefill();
        const stored = this.stored;

        return {
            to: answer !== null ? addressesOf(answer.to) : (stored?.to ?? []),
            cc: [],
            bcc: [],
            subject: answer?.subject ?? stored?.subject ?? '',
            text: this.text(),
            html: null,
            attachments: storedAttachments(this.attachments()).map(a => a.id),
            from: answer?.from.address ?? stored?.from ?? null,
            quote: true,
            messageParts: [],
        };
    }

    /** The box's text and files as this message's reply draft; an empty box makes none. */
    private save(): void {
        const draft = this.draft;
        if (draft === null || this.inWindow()) {
            return;
        }
        if (draft.id === null && !draft.pending && !this.hasContent()) {
            return;
        }
        draft.save(this.body());
    }
}
