import {
    ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output,
    signal, untracked, viewChild, Injector,
} from '@angular/core';
import { DraftStoreService, ToastService } from '@coolms/ui-angular';
import { ComposeAttachmentsComponent } from './compose-attachments.component';
import {
    expiredAttachmentId, restoredAttachments, storedAttachments, tooLargeSend, type ComposeAttachment,
} from './compose-attachments';
import { type ComposeDraft, replyDraftKey } from './compose-draft';
import { addressesOf, quotedMessageUnavailable } from './compose-prefill';
import { EmailService } from './email.service';
import { type EmailComposeDto, type OutgoingEmailRequest } from './email.types';
import { sendFailureText } from './send-via';

/** The most lines the box grows to; past them it scrolls inside itself. */
export const QUICK_REPLY_MAX_LINES = 6;
/** The pause after typing before the draft is saved, as the compose window waits. */
export const QUICK_REPLY_SAVE_MS = 600;

/**
 * The quick reply: a chat-like box pinned at the bottom of the message pane, outside the message's scroll. One line,
 * "Write a reply...", that grows with the text to about six lines and then scrolls inside. It goes to the sender (the
 * Reply-To when there is one) with Re:, as the server's reply prefill gives them; the server appends the quote, which
 * is not shown. Plain text, attachments with the size meter, Send and Expand. Ctrl or Cmd+Enter sends; Enter is a new
 * line. The text is that message's reply draft, saved after a pause in the same store and under the same key as the
 * compose window's reply, so Expand (or Reply while the box holds text) hands that one draft to the window: the box
 * then says the reply is open there, with a way to bring the window up.
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
                            (click)="showWindow.emit()">Show it</button>
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
    readonly expand = output<void>();
    /** Bring the compose window holding this reply up. */
    readonly showWindow = output<void>();
    /** A reply went. */
    readonly sent = output<void>();

    readonly text = signal('');
    readonly attachments = signal<ComposeAttachment[]>([]);
    readonly prefill = signal<EmailComposeDto | null>(null);
    readonly prefillFailed = signal(false);
    readonly sending = signal(false);
    readonly quoteRefused = signal(false);
    readonly sendRefused = signal<{ limitBytes: number; sizeBytes: number } | null>(null);
    /** The draft store says the window holds this reply (it was expanded, or written there). */
    private readonly storedInWindow = signal(false);
    readonly inWindow = computed(() => this.windowHolds() || this.storedInWindow());
    readonly bodyBytes = computed(() => new TextEncoder().encode(this.text()).length);
    readonly canSend = computed(() => !this.sending() && this.prefill() !== null
        && (this.text().trim() !== '' || storedAttachments(this.attachments()).length > 0)
        && !this.attachments().some(a => a.status === 'uploading' || a.status === 'attaching' || a.status === 'refused'));

    private readonly email = inject(EmailService);
    private readonly drafts = inject(DraftStoreService);
    private readonly toast = inject(ToastService);
    private readonly injector = inject(Injector);
    private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private prefillSeq = 0;
    /** The message the box shows, for the save that is still owed when it changes. */
    private shown: { mailboxId: string; messageId: string } | null = null;

    constructor() {
        inject(DestroyRef).onDestroy(() => this.flush());
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
        this.flush();
        this.save();
        this.expand.emit();
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
        const key = replyDraftKey(this.mailboxId(), this.messageId());
        this.sendRefused.set(null);
        this.quoteRefused.set(false);
        this.sending.set(true);
        this.email.reply(this.messageId(), request).subscribe({
            next: () => {
                this.sending.set(false);
                if (this.saveTimer !== null) {
                    clearTimeout(this.saveTimer);
                    this.saveTimer = null;
                }
                this.drafts.clear(key);
                this.text.set('');
                this.attachments.set([]);
                this.fit();
                this.toast.success('Reply sent.');
                this.sent.emit();
            },
            error: (e: unknown) => {
                this.sending.set(false);
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
            },
        });
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
            this.shown = { mailboxId, messageId };
            this.prefill.set(null);
            this.quoteRefused.set(false);
            this.sendRefused.set(null);
            this.readPrefill();
        }
        const draft = this.drafts.load<ComposeDraft>(replyDraftKey(mailboxId, messageId));
        const window = windowHolds || (draft !== null && draft.place !== 'quick');
        this.storedInWindow.set(!windowHolds && window);
        if (window) {
            this.text.set('');
            this.attachments.set([]);
        } else if (moved || draft !== null) {
            this.text.set(draft?.text ?? '');
            this.attachments.set(restoredAttachments(draft?.attachments));
        }
        afterNextRender(() => this.fit(), { injector: this.injector });
    }

    /** The box's text and files as this message's reply draft; an empty box keeps no draft. */
    private save(): void {
        if (this.storedInWindow() || this.windowHolds()) {
            return;
        }
        const key = replyDraftKey(this.mailboxId(), this.messageId());
        const files = storedAttachments(this.attachments());
        if (this.text().trim() === '' && files.length === 0) {
            if (this.drafts.load<ComposeDraft>(key)?.place === 'quick') {
                this.drafts.clear(key);
            }
            return;
        }
        const answer = this.prefill();
        this.drafts.save(key, {
            to: answer !== null ? addressesOf(answer.to) : [],
            cc: [],
            bcc: [],
            subject: answer?.subject ?? '',
            text: this.text(),
            html: '',
            rich: false,
            attachments: files,
            quote: true,
            place: 'quick',
        } satisfies ComposeDraft);
    }
}
