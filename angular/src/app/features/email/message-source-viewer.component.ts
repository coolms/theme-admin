import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse, type HttpResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { type Subscription } from 'rxjs';
import { EmailService } from './email.service';

/** Which message's original to show, and its subject for the viewer's header. */
export interface MessageSourceViewerData {
    readonly messageId: string;
    readonly subject: string;
}

/** What the viewer shows: the source while it loads, once read, or why it could not be read. */
export type MessageSourceState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'shown'; readonly text: string; readonly truncated: boolean }
    | { readonly kind: 'gone' }
    | { readonly kind: 'missing' }
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'failed' };

/** The viewer's sentences. */
export const MESSAGE_SOURCE_WORDS = {
    truncated: 'Showing the first 1 MB; download for the full source',
    gone: 'The original of this message is gone: it is no longer stored here, nor on the mail server.',
    missing: 'This message was not found.',
    unavailable: 'The mail server could not be read for the original just now.',
    failed: 'Could not open the message.',
    copied: 'Copied.',
    copyFailed: 'Could not copy; select the text and copy it.',
    downloadFailed: 'Could not download the original.',
} as const;

/**
 * The kind of a refusal of the source: 404 source-gone and 502 source-unavailable by their type; any other 404 is a
 * message not found (a missing message and one the reader may not see answer alike); anything else failed.
 */
export function sourceFailureOf(status: number, body: unknown): 'gone' | 'missing' | 'unavailable' | 'failed' {
    let parsed = body;
    if (typeof body === 'string') {
        try {
            parsed = JSON.parse(body) as unknown;
        } catch {
            parsed = null;
        }
    }
    const type = parsed !== null && typeof parsed === 'object' ? (parsed as { type?: unknown }).type : null;
    if (status === 404 && type === '/errors/email/message-source-gone') {
        return 'gone';
    }
    if (status === 404) {
        return 'missing';
    }
    if (status === 502 && type === '/errors/email/message-source-unavailable') {
        return 'unavailable';
    }
    return 'failed';
}

/** The file name a download answer names (`filename*=UTF-8''...` first, then `filename="..."`), else the fallback. */
export function downloadNameOf(disposition: string | null, fallback: string): string {
    const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded !== undefined) {
        try {
            return decodeURIComponent(encoded.trim());
        } catch {
            // A malformed escape: the plain name below.
        }
    }
    const plain = disposition?.match(/filename="([^"]*)"/i)?.[1];
    return plain !== undefined && plain !== '' ? plain : fallback;
}

/**
 * "Show original": a message's source in a full-screen viewer over the page. The source is text only, set as the
 * `<pre>`'s textContent: no HTML is parsed, no link is made from text, no image loads. Long lines wrap. One scroll
 * region, under the header (the subject, Copy, Download, Close). Copy copies exactly the text shown; Download saves the
 * whole message as .eml from the server. A CDK dialog, as the file viewer: focus stays inside while it is open,
 * Escape closes it, and focus goes back to where it was (More actions, when chosen there).
 */
@Component({
    selector: 'app-message-source-viewer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="mso">
            <div class="mso__head">
                <h2 class="mso__title" [title]="data.subject">{{ data.subject }}</h2>
                <div class="mso__actions">
                    <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm" data-test="source-copy"
                            [disabled]="state().kind !== 'shown'" (click)="copy()">
                        <i class="bi bi-clipboard" aria-hidden="true"></i> Copy
                    </button>
                    <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm" data-test="source-download"
                            [attr.aria-busy]="downloading() ? 'true' : null" (click)="download()">
                        <i class="bi bi-download" aria-hidden="true"></i> Download
                    </button>
                    <button type="button" class="cms-dialog-close" data-test="source-close" aria-label="Close" (click)="close()">
                        <i class="bi bi-x-lg" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
            @if (state(); as s) {
                @if (s.kind === 'shown' && s.truncated) {
                    <p class="mso__line" data-test="source-truncated">{{ words.truncated }}</p>
                }
            }
            <p class="mso__status" role="status" data-test="source-status">{{ status() }}</p>
            <div class="mso__body" data-test="source-scroll">
                @switch (state().kind) {
                    @case ('loading') {
                        <p class="mso__note">Loading…</p>
                    }
                    @case ('gone') {
                        <p class="mso__note" data-test="source-gone">{{ words.gone }}</p>
                    }
                    @case ('missing') {
                        <p class="mso__note" data-test="source-missing">{{ words.missing }}</p>
                    }
                    @case ('unavailable') {
                        <p class="mso__note" data-test="source-unavailable">
                            {{ words.unavailable }}
                            <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm" data-test="source-retry" (click)="load()">Retry</button>
                        </p>
                    }
                    @case ('failed') {
                        <p class="mso__note" data-test="source-failed">{{ words.failed }}</p>
                    }
                    @case ('shown') {
                        <pre class="mso__source" data-test="source-text" tabindex="0" aria-label="Original source" [textContent]="shownText()"></pre>
                    }
                }
            </div>
        </div>
    `,
    styles: [`
        :host { display: flex; flex: 1; min-width: 0; min-height: 0; }
        .mso {
            display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0;
            background: var(--cms-surface); color: var(--cms-text);
        }
        .mso__head {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 16px; border-bottom: 1px solid var(--cms-border);
        }
        .mso__title {
            flex: 1 1 auto; min-width: 0; margin: 0; font-size: 1rem; font-weight: 600;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mso__actions { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
        .mso__line, .mso__status:not(:empty) {
            margin: 0; padding: 8px 16px;
            font-size: .8125rem; color: var(--cms-text-muted); border-bottom: 1px solid var(--cms-border);
        }
        .mso__status:empty { margin: 0; padding: 0; }
        .mso__body { flex: 1; min-height: 0; overflow: auto; }
        .mso__note { margin: 0; padding: 16px; }
        .mso__source {
            margin: 0; padding: 16px; font-family: var(--cms-font-mono, monospace); font-size: .8125rem;
            white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible;
        }
        @media (max-width: 575.98px) {
            .mso__head { padding-inline: 8px; }
            .mso__source { padding: 8px; }
        }
    `],
})
export class MessageSourceViewerComponent {
    protected readonly data = inject<MessageSourceViewerData>(DIALOG_DATA);
    private readonly ref = inject<DialogRef<void>>(DialogRef);
    private readonly email = inject(EmailService);
    private readonly destroyRef = inject(DestroyRef);

    protected readonly words = MESSAGE_SOURCE_WORDS;
    readonly state = signal<MessageSourceState>({ kind: 'loading' });
    /** A short word on what Copy or Download did, read out politely. */
    readonly status = signal('');
    readonly downloading = signal(false);
    private reading: Subscription | null = null;

    constructor() {
        this.load();
    }

    /** The text shown: exactly what Copy copies. */
    shownText(): string {
        const s = this.state();
        return s.kind === 'shown' ? s.text : '';
    }

    /** Reads the source; again after a 502, by Retry. */
    load(): void {
        this.reading?.unsubscribe();
        this.state.set({ kind: 'loading' });
        this.status.set('');
        this.reading = this.email.getMessageSource(this.data.messageId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (answer: HttpResponse<string>) => this.state.set({
                kind: 'shown',
                text: answer.body ?? '',
                truncated: answer.headers.get('X-Raw-Truncated') === 'true',
            }),
            error: (e: unknown) => this.state.set({
                kind: e instanceof HttpErrorResponse ? sourceFailureOf(e.status, e.error) : 'failed',
            }),
        });
    }

    async copy(): Promise<void> {
        if (this.state().kind !== 'shown') {
            return;
        }
        try {
            await navigator.clipboard.writeText(this.shownText());
            this.status.set(MESSAGE_SOURCE_WORDS.copied);
        } catch {
            this.status.set(MESSAGE_SOURCE_WORDS.copyFailed);
        }
    }

    /** The whole message as .eml, from the server: the answer's file name, else the subject's. */
    download(): void {
        if (this.downloading()) {
            return;
        }
        this.downloading.set(true);
        this.status.set('');
        this.email.downloadMessageSource(this.data.messageId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (answer: HttpResponse<Blob>) => {
                this.downloading.set(false);
                const blob = answer.body;
                if (blob === null) {
                    this.status.set(MESSAGE_SOURCE_WORDS.downloadFailed);
                    return;
                }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = downloadNameOf(answer.headers.get('Content-Disposition'), `${this.data.messageId}.eml`);
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 0);
            },
            error: (e: unknown) => {
                this.downloading.set(false);
                void this.downloadRefusal(e);
            },
        });
    }

    close(): void {
        this.ref.close();
    }

    /** A refused download, said as the viewer says the source's own refusals. */
    private async downloadRefusal(e: unknown): Promise<void> {
        if (!(e instanceof HttpErrorResponse)) {
            this.status.set(MESSAGE_SOURCE_WORDS.downloadFailed);
            return;
        }
        const body: unknown = e.error instanceof Blob ? await e.error.text().catch(() => null) : e.error;
        const kind = sourceFailureOf(e.status, body);
        this.status.set(kind === 'failed' ? MESSAGE_SOURCE_WORDS.downloadFailed : MESSAGE_SOURCE_WORDS[kind]);
    }
}

/** Opens a message's original over the page, full screen. */
export function openMessageSource(dialog: Dialog, data: MessageSourceViewerData): DialogRef<void, MessageSourceViewerComponent> {
    return dialog.open<void, MessageSourceViewerData, MessageSourceViewerComponent>(MessageSourceViewerComponent, {
        data,
        ariaLabel: `Original of ${data.subject}`,
        panelClass: 'cms-source-viewer-panel',
        ariaModal: true,
        hasBackdrop: true,
        restoreFocus: true,
    });
}
