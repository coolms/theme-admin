import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';
import type { Observable, Subscription } from 'rxjs';

import type { ServerMessageOpenedDto, ServerSearchHitDto } from './email.types';
import { MailHitRowComponent } from './mail-hit-row.component';
import type { OpeningRow } from './message-opening';
import { MailServerSearch, matchesText, serverSearchRefusal, sizeText } from './mail-server-search';
import { refusalWords } from './server-words';
import { deletedText } from './your-mailbox';

/** The section's sentences, so one section lists a search's hits or a folder's older mail. */
export interface ServerSectionWords {
    /** While the first page is read. */
    working: string;
    /** While a later page is read, at the section's end. */
    workingMore: string;
    empty: string;
    allLocal: string;
    rateLimited: string;
    invalid: string;
    error: string;
}

export const SEARCH_WORDS: ServerSectionWords = {
    working: 'Looking for more results…',
    workingMore: 'Loading more results…',
    empty: 'No more results.',
    allLocal: 'Everything found is in the results above.',
    rateLimited: 'Too many searches.',
    invalid: 'This search is empty or too long.',
    error: 'More results couldn\'t be loaded. Try again later.',
};

export const OLDER_WORDS: ServerSectionWords = {
    working: 'Loading older mail…',
    workingMore: 'Loading older mail…',
    empty: 'No older mail.',
    allLocal: 'This older mail is already in the list above.',
    rateLimited: 'Too many pages asked for.',
    invalid: 'This folder no longer exists.',
    error: 'Older mail couldn\'t be loaded.',
};

/** A message to open in the reader: its stored id, the folder it is in, and whether it was read. */
export interface ServerHitOpened {
    id: string;
    folder: string;
    seen: boolean;
    /** What the hit's row shows, for the message pane's header while the message loads. */
    header?: OpeningRow;
}

/** A hit being stored from the mail server: the pane opens at once with its header; cancel aborts the store. */
export interface ServerHitOpening {
    header: OpeningRow;
    cancel: () => void;
}

/** A hit that could not be stored: the sentence for the pane, and Try again where trying again can help. */
export interface ServerHitFailed {
    text: string;
    retry: (() => void) | null;
}

/**
 * One mailbox's "More results" section: the hits its server search found, headers only, under the local results.
 * A hit the local results already show is not shown again; a hit the platform holds opens as stored; any other opens
 * through `opener`, which answers null where opening one is not offered. Each refusal is said in its own words. The
 * next page is read when the section's end comes into view, with a row saying so; a page not read is asked for again
 * only by Try again, or after a rate limit's countdown.
 */
@Component({
    selector: 'app-mail-server-search',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MailHitRowComponent],
    template: `
        <section class="mss" data-test="server-search" [attr.aria-label]="heading()">
            <div class="mss__head">
                <span class="mss__title">{{ heading() }}</span>
                @if (matchesNote(); as note) {
                    <span class="mss__matches" data-test="server-search-matches">{{ note }}</span>
                }
            </div>

            @for (h of rows(); track h.ref) {
                <app-mail-hit-row testId="server-hit" [from]="h.senderText || h.from?.name || h.from?.address" [date]="h.date"
                                  [subject]="h.subject" [chips]="chipsOf(h)" [size]="size(h)" [kept]="h.local"
                                  [unread]="h.seen === false" (chosen)="open(h)" />
                @if (notice()?.ref === h.ref) {
                    <p class="mss__note mss__note--row" role="status" data-test="server-hit-notice">{{ notice()?.text }}</p>
                }
            }

            @if (gone()) {
                <p class="mss__note" role="status" data-test="server-hit-gone">{{ goneText() }}</p>
            }

            @switch (shown().kind) {
                @case ('searching') {
                    <p class="mss__note" role="status">{{ words().working }}</p>
                    @if (capabilityState() === 'unknown') {
                        <p class="mss__note" data-test="server-search-unknown">
                            It is not known yet whether this mailbox can be searched for more; this first search decides.
                        </p>
                    }
                }
                @case ('answered') {
                    <!-- Said at the end only: while a page remains, the pages so far are not the whole answer. -->
                    @if (search().next() === null) {
                        @if (search().hits().length === 0) {
                            <p class="mss__note" data-test="server-search-empty">{{ words().empty }}</p>
                        } @else if (rows().length === 0) {
                            <p class="mss__note" data-test="server-search-all-local">{{ words().allLocal }}</p>
                        }
                    }
                }
                @case ('unsupported') {
                    <div class="mss__state mss__state--warn" role="status" data-test="server-search-unsupported">
                        <p class="mss__state-text">This mailbox can't be searched for more, so only the mail kept here was searched.</p>
                        @if (reasonOf(shown()); as r) {
                            <p class="mss__state-detail">It answered: {{ r }}</p>
                        }
                    </div>
                }
                @case ('unavailable') {
                    <div class="mss__state mss__state--warn" role="status" data-test="server-search-unavailable">
                        <p class="mss__state-text">This mailbox can't be reached now, so it wasn't searched for more.</p>
                        @if (reasonOf(shown()); as r) {
                            <p class="mss__state-detail">{{ r }}</p>
                        }
                    </div>
                }
                @case ('rate-limited') {
                    <div class="mss__state mss__state--warn" role="status" data-test="server-search-rate-limited">
                        @if (secondsOf(shown()) > 0) {
                            <p class="mss__state-text" data-test="server-search-countdown">
                                {{ words().rateLimited }} Try again in {{ secondsOf(shown()) }} s.
                            </p>
                        } @else {
                            <p class="mss__state-text">{{ words().rateLimited }}</p>
                            <button type="button" class="cms-btn cms-btn-sm" data-test="server-search-retry" (click)="search().retry()">Try again</button>
                        }
                    </div>
                }
                @case ('failed') {
                    <div class="mss__state mss__state--error" role="status" data-test="server-search-failed">
                        <p class="mss__state-text">{{ words().error }}</p>
                        <button type="button" class="cms-btn cms-btn-sm" data-test="server-search-retry" (click)="search().retry()">Try again</button>
                    </div>
                }
                @case ('query-invalid') {
                    <div class="mss__state mss__state--warn" role="status" data-test="server-search-query-invalid">
                        <p class="mss__state-text">{{ words().invalid }}</p>
                    </div>
                }
                @case ('error') {
                    <div class="mss__state mss__state--error" role="status" data-test="server-search-error">
                        <p class="mss__state-text">{{ words().error }}</p>
                        <button type="button" class="cms-btn cms-btn-sm" data-test="server-search-retry" (click)="search().retry()">Try again</button>
                    </div>
                }
            }

            @if (search().loadingMore()) {
                <p class="mss__note" role="status" data-test="server-search-loading">{{ words().workingMore }}</p>
            } @else if (search().next() !== null && shown().kind === 'answered') {
                <!-- The section's end: in view, the next page is read. Drawn anew after each page. -->
                <div #end class="mss__end" data-test="server-search-end" aria-hidden="true"></div>
            }
            @if (search().capped()) {
                <p class="mss__note" data-test="server-search-capped">
                    There are more results than can be shown: add a word to narrow the search.
                </p>
            }
        </section>
    `,
    styles: [`
        :host { display: block; }
        .mss { border-top: 1px solid var(--cms-border); }
        .mss__head {
            display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 8px 12px 6px;
            background: var(--cms-surface-alt); border-bottom: 1px solid var(--cms-border);
        }
        .mss__title { font-size: .8125rem; font-weight: 600; color: var(--cms-text); }
        .mss__matches { font-size: .6875rem; color: var(--cms-text-muted); }
        .mss__note { margin: 0; padding: 8px 12px; font-size: .75rem; color: var(--cms-text-muted); }
        .mss__note--row { padding-top: 4px; border-bottom: 1px solid var(--cms-border); }
        .mss__state {
            display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 8px 12px; padding: 8px 10px;
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md); font-size: .8125rem;
        }
        .mss__state--warn {
            background: var(--cms-warning-subtle); border-color: var(--cms-warning-subtle-border); color: var(--cms-warning-text);
        }
        .mss__state--error {
            background: var(--cms-danger-subtle); border-color: var(--cms-danger-subtle-border); color: var(--cms-danger-text);
        }
        .mss__state-text { margin: 0; flex: 1 1 100%; }
        .mss__state-detail { margin: 0; flex: 1 1 auto; font-size: .75rem; overflow-wrap: anywhere; }
        .mss__end { height: 1px; }
    `],
})
export class MailServerSearchComponent {
    readonly search = input.required<MailServerSearch>();
    readonly heading = input('More results');
    /** What the section says, by what it lists: a search's hits, or a folder's older mail. */
    readonly words = input<ServerSectionWords>(SEARCH_WORDS);
    /** The mailbox as a sentence names it, for a message deleted in it. */
    readonly mailboxWords = input('your mailbox');
    /** The ids of the messages the local results show: a hit among them is not shown again. */
    readonly localIds = input<ReadonlySet<string>>(new Set<string>());
    readonly folderName = input<(path: string) => string>((path: string) => path);
    /** Opens a hit the platform does not hold; null while that is not offered. */
    readonly opener = input<(hit: ServerSearchHitDto) => Observable<ServerMessageOpenedDto> | null>(() => null);
    readonly opened = output<ServerHitOpened>();
    /** A hit's store has begun: the host opens the message pane at once and may cancel the store. */
    readonly opening = output<ServerHitOpening>();
    /** A hit's store failed: the host says why in the message pane. */
    readonly openFailed = output<ServerHitFailed>();

    readonly shown = computed(() => this.search().shown());
    /** The mailbox's server search as last learned; `unknown` says the first search decides. */
    readonly capabilityState = computed(() => this.search().capabilityState());
    readonly rows = computed(() => {
        const local = this.localIds();

        return this.search().hits().filter(h => !(h.local && typeof h.localId === 'string' && local.has(h.localId)));
    });
    readonly matchesNote = computed(() => (this.search().view().kind === 'answered' ? matchesText(this.search().matches()) : null));
    /** A word under one row: opening it is not offered yet, or did not work. */
    readonly notice = signal<{ ref: string; text: string } | null>(null);
    /** The message last opened was gone from the server, and its row left the list. */
    readonly gone = signal(false);
    readonly goneText = computed(() => deletedText(this.mailboxWords()));
    /** The section's end, drawn while a next page may be read. */
    private readonly end = viewChild<ElementRef<HTMLElement>>('end');

    constructor() {
        // Clipped by whatever scrolls the section, so it is in view only where the person sees it.
        effect(onCleanup => {
            const end = this.end()?.nativeElement;
            const search = this.search();
            if (end === undefined || typeof IntersectionObserver === 'undefined') {
                return;
            }
            const observer = new IntersectionObserver(seen => {
                if (seen.some(entry => entry.isIntersecting)) {
                    search.readOn();
                }
            });
            observer.observe(end);
            onCleanup(() => observer.disconnect());
        });
    }

    open(hit: ServerSearchHitDto): void {
        this.notice.set(null);
        this.gone.set(false);
        const header: OpeningRow = {
            subject: hit.subject ?? null,
            fromName: hit.from?.name ?? null,
            fromAddress: hit.from?.address ?? null,
            senderText: hit.senderText,
            sentAt: hit.date ?? null,
        };
        if (hit.local && typeof hit.localId === 'string' && hit.localId !== '') {
            this.opened.emit({ id: hit.localId, folder: hit.folder, seen: hit.seen ?? true, header });
            return;
        }
        const call = this.opener()(hit);
        if (call === null) {
            return;
        }
        // Said before the store is asked for, so even an answer at once comes after it; a cancel drops the answer.
        let cancelled = false;
        let store: Subscription | null = null;
        this.opening.emit({
            header,
            cancel: () => {
                cancelled = true;
                store?.unsubscribe();
            },
        });
        // A host may cancel inside the emit, before the store is asked for.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
            return;
        }
        store = call.subscribe({
            next: stored => {
                if (cancelled) { return; }
                this.search().markLocal(hit.ref, stored.id);
                this.opened.emit({ id: stored.id, folder: stored.folder, seen: hit.seen ?? true, header });
            },
            error: (error: unknown) => {
                if (cancelled) { return; }
                const refusal = serverSearchRefusal(error);
                if (refusal.reason === 'gone' || (error instanceof HttpErrorResponse && error.status === 404)) {
                    this.search().drop(hit.ref);
                    this.gone.set(true);
                    this.openFailed.emit({ text: this.goneText(), retry: null });
                    return;
                }
                const text = refusalWords(error);
                this.notice.set({ ref: hit.ref, text });
                this.openFailed.emit({ text, retry: () => this.open(hit) });
            },
        });
    }

    /** Gmail's labels where it names them, else the folder. */
    chipsOf(hit: ServerSearchHitDto): string[] {
        return hit.labels !== undefined && hit.labels.length > 0 ? hit.labels : [this.folderName()(hit.folder)];
    }

    size(hit: ServerSearchHitDto): string {
        return sizeText(hit.sizeBytes);
    }

    reasonOf(view: { kind: string; reason?: string | null }): string | null {
        return view.reason ?? null;
    }

    secondsOf(view: { kind: string; seconds?: number }): number {
        return view.seconds ?? 0;
    }
}

/** Why opening a server hit did not work: the server's detail as given, or the generic sentence for a fault. */
export function openFailureText(error: unknown): string {
    return refusalWords(error);
}
