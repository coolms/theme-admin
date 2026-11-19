import { HttpErrorResponse, type HttpResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, type Subscription } from 'rxjs';
import { EmailService } from './email.service';
import { SOMETHING_WENT_WRONG, refusalWords } from './server-words';

/** What the reading pane shows of a message's original: the source while it loads, once read, or why it could not be read. */
export type MessageSourceState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'shown'; readonly text: string; readonly truncated: boolean }
    | { readonly kind: 'gone'; readonly text: string }
    | { readonly kind: 'missing'; readonly text: string }
    | { readonly kind: 'unavailable'; readonly text: string }
    | { readonly kind: 'failed'; readonly text: string };

/** The original's sentences. */
export const MESSAGE_SOURCE_WORDS = {
    truncated: 'Showing the first 1 MB; download for the full source',
    gone: 'The original of this message is gone: it is no longer stored here, nor on the mail server.',
    missing: 'This message is not there any more.',
    unavailable: 'The mail server could not be read for the original just now.',
    failed: 'Could not open the message.',
    copied: 'Copied.',
    copyLoading: 'The source is still loading; copy it once it shows.',
    copyNone: 'There is no source to copy.',
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
 * Download message (.eml): the whole message from the server, saved under the answer's file name, else `<id>.eml`.
 * Resolves to null once saved, else to the sentence saying why not.
 */
export async function downloadMessageEml(email: EmailService, messageId: string): Promise<string | null> {
    let answer: HttpResponse<Blob>;
    try {
        answer = await firstValueFrom(email.downloadMessageSource(messageId));
    } catch (e: unknown) {
        if (!(e instanceof HttpErrorResponse)) {
            return SOMETHING_WENT_WRONG;
        }
        const body: unknown = e.error instanceof Blob ? await e.error.text().catch(() => null) : e.error;
        return refusalWords(new HttpErrorResponse({ status: e.status, error: body }));
    }
    const blob = answer.body;
    if (blob === null) {
        return MESSAGE_SOURCE_WORDS.downloadFailed;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadNameOf(answer.headers.get('Content-Disposition'), `${messageId}.eml`);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return null;
}

/**
 * A message's original in the reading pane, in place of the message: text only, set as the `<pre>`'s textContent, so
 * no HTML is parsed, no link is made from text and no image loads. Every line wraps inside the pane, the longest
 * header included: nothing scrolls sideways. Its actions (Show message, Copy source, Download message) are the pane's
 * row, from the server's tree; Copy source copies exactly the text shown.
 */
@Component({
    selector: 'app-message-source',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (state(); as s) {
            @if (s.kind === 'shown' && s.truncated) {
                <p class="mso__line" data-test="source-truncated">{{ words.truncated }}</p>
            }
        }
        @switch (state().kind) {
            @case ('loading') {
                <p class="mso__note" role="status" data-test="source-loading">Loading original…</p>
            }
            @case ('gone') {
                <p class="mso__note" data-test="source-gone">{{ failedText() }}</p>
            }
            @case ('missing') {
                <p class="mso__note" data-test="source-missing">{{ failedText() }}</p>
            }
            @case ('unavailable') {
                <p class="mso__note" data-test="source-unavailable">
                    {{ failedText() }}
                    <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm" data-test="source-retry" (click)="load()">Retry</button>
                </p>
            }
            @case ('failed') {
                <p class="mso__note" data-test="source-failed">{{ failedText() }}</p>
            }
            @case ('shown') {
                <pre class="mso__source" data-test="source-text" tabindex="0" aria-label="Original source" [textContent]="shownText()"></pre>
            }
        }
    `,
    styles: [`
        :host { display: block; min-width: 0; max-width: 100%; }
        .mso__line {
            margin: 0; padding: 8px 16px;
            font-size: .8125rem; color: var(--cms-text-muted); border-bottom: 1px solid var(--cms-border);
        }
        .mso__note { margin: 0; padding: 16px; }
        .mso__source {
            margin: 0; padding: 16px; max-width: 100%; box-sizing: border-box;
            font-family: var(--cms-font-mono, monospace); font-size: .8125rem;
            white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; overflow: visible;
        }
        @media (max-width: 575.98px) {
            .mso__line, .mso__source { padding: 8px; }
        }
    `],
})
export class MessageSourceComponent {
    /** The message whose original is shown. */
    readonly messageId = input.required<string>();

    private readonly email = inject(EmailService);
    private readonly destroyRef = inject(DestroyRef);
    protected readonly words = MESSAGE_SOURCE_WORDS;

    readonly state = signal<MessageSourceState>({ kind: 'loading' });
    /** What a failed read says: the server's detail for a declared problem, the generic sentence for an undeclared one. */
    protected readonly failedText = computed(() => {
        const s = this.state();
        return 'text' in s && s.kind !== 'shown' ? s.text : '';
    });
    private reading: Subscription | null = null;

    constructor() {
        // Read once per message: another message's original is read afresh.
        effect(() => {
            this.messageId();
            untracked(() => this.load());
        });
    }

    /** The text shown: exactly what Copy source copies. */
    shownText(): string {
        const s = this.state();
        return s.kind === 'shown' ? s.text : '';
    }

    /** Reads the source; again after a 502, by Retry. */
    load(): void {
        this.reading?.unsubscribe();
        this.state.set({ kind: 'loading' });
        this.reading = this.email.getMessageSource(this.messageId()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (answer: HttpResponse<string>) => this.state.set({
                kind: 'shown',
                text: answer.body ?? '',
                truncated: answer.headers.get('X-Raw-Truncated') === 'true',
            }),
            error: (e: unknown) => this.state.set({
                kind: e instanceof HttpErrorResponse ? sourceFailureOf(e.status, e.error) : 'failed',
                text: refusalWords(e),
            }),
        });
    }

    /** Copy source: the text shown, or why there is none to copy. Resolves to the sentence saying what happened. */
    async copy(): Promise<string> {
        const s = this.state();
        if (s.kind === 'loading') {
            return MESSAGE_SOURCE_WORDS.copyLoading;
        }
        if (s.kind !== 'shown') {
            return MESSAGE_SOURCE_WORDS.copyNone;
        }
        try {
            await navigator.clipboard.writeText(s.text);
            return MESSAGE_SOURCE_WORDS.copied;
        } catch {
            return MESSAGE_SOURCE_WORDS.copyFailed;
        }
    }
}
