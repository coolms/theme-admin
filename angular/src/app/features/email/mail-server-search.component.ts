import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { Observable } from 'rxjs';

import type { ServerMessageOpenedDto, ServerSearchHitDto } from './email.types';
import { MailHitRowComponent } from './mail-hit-row.component';
import { MailServerSearch, matchesText, serverSearchRefusal, sizeText, type ServerSearchRefusal } from './mail-server-search';

/** The section's sentences, so one section lists a search's hits or a folder's older mail. */
export interface ServerSectionWords {
    working: string;
    empty: string;
    allLocal: string;
    rateLimited: string;
    /** Before a countdown that asks again by itself. */
    againIn: string;
    /** Before a countdown after which the person asks. */
    youCanIn: string;
    /** After the server's name. */
    failed: string;
    invalid: string;
    error: string;
    more: string;
}

export const SEARCH_WORDS: ServerSectionWords = {
    working: 'Searching the mail server…',
    empty: 'The mail server found nothing more.',
    allLocal: 'Everything the mail server found is in the results above.',
    rateLimited: 'Too many server searches in a minute.',
    againIn: 'Searching again in',
    youCanIn: 'You can search again in',
    failed: 'answered the search with an error.',
    invalid: 'The mail server searches for 1 to 200 characters; this search is not one it takes.',
    error: 'Couldn\'t search the mail server.',
    more: 'Load more from the server',
};

export const OLDER_WORDS: ServerSectionWords = {
    working: 'Loading older mail from the server…',
    empty: 'No older mail on the server.',
    allLocal: 'This older mail is already in the list above.',
    rateLimited: 'Too many pages asked of the mail server in a minute.',
    againIn: 'Loading again in',
    youCanIn: 'You can load more in',
    failed: 'answered with an error.',
    invalid: 'The mail server has no such folder.',
    error: 'Couldn\'t load older mail from the server.',
    more: 'Load older from the server',
};

/** A message to open in the reader: its stored id, the folder it is in, and whether it was read. */
export interface ServerHitOpened {
    id: string;
    folder: string;
    seen: boolean;
}

/**
 * One mailbox's "More on the server" section: the hits its server search found, headers only, under the local results.
 * A hit the local results already show is not shown again; a hit the platform holds opens as stored; any other opens
 * through `opener`, which answers null where opening one is not offered. Each refusal is said in its own words.
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
                <app-mail-hit-row testId="server-hit" [from]="h.from?.name || h.from?.address" [date]="h.date"
                                  [subject]="h.subject" [chips]="chipsOf(h)" [size]="size(h)" [kept]="h.local"
                                  [unread]="h.seen === false" (chosen)="open(h)" />
                @if (notice()?.ref === h.ref) {
                    <p class="mss__note mss__note--row" role="status" data-test="server-hit-notice">{{ notice()?.text }}</p>
                }
            }

            @if (gone()) {
                <p class="mss__note" role="status" data-test="server-hit-gone">No longer on the server.</p>
            }

            @switch (shown().kind) {
                @case ('searching') {
                    <p class="mss__note" role="status">{{ words().working }}</p>
                    @if (capabilityState() === 'unknown') {
                        <p class="mss__note" data-test="server-search-unknown">
                            It is not known yet whether this mail server can search; this first search decides.
                        </p>
                    }
                }
                @case ('answered') {
                    @if (search().hits().length === 0) {
                        <p class="mss__note" data-test="server-search-empty">{{ words().empty }}</p>
                    } @else if (rows().length === 0) {
                        <p class="mss__note" data-test="server-search-all-local">{{ words().allLocal }}</p>
                    }
                }
                @case ('unsupported') {
                    <div class="mss__state mss__state--warn" role="status" data-test="server-search-unsupported">
                        <p class="mss__state-text">This mail server can't search older mail.</p>
                        @if (reasonOf(shown()); as r) {
                            <p class="mss__state-detail">It answered: {{ r }}</p>
                        }
                    </div>
                }
                @case ('unavailable') {
                    <div class="mss__state mss__state--warn" role="status" data-test="server-search-unavailable">
                        <p class="mss__state-text">Can't reach the mail server right now.</p>
                        @if (reasonOf(shown()); as r) {
                            <p class="mss__state-detail">{{ r }}</p>
                        }
                    </div>
                }
                @case ('rate-limited') {
                    <div class="mss__state mss__state--warn" role="status" data-test="server-search-rate-limited">
                        <p class="mss__state-text">{{ words().rateLimited }}</p>
                        @if (secondsOf(shown()) > 0) {
                            <p class="mss__state-detail" data-test="server-search-countdown">
                                {{ willRetry(shown()) ? words().againIn : words().youCanIn }} {{ secondsOf(shown()) }} s.
                            </p>
                        } @else {
                            <button type="button" class="cms-btn cms-btn-sm" data-test="server-search-retry" (click)="search().retry()">Retry</button>
                        }
                    </div>
                }
                @case ('failed') {
                    <div class="mss__state mss__state--error" role="status" data-test="server-search-failed">
                        <p class="mss__state-text">
                            {{ serverOf(shown()) ?? 'The mail server' }} {{ words().failed }}
                        </p>
                        <button type="button" class="cms-btn cms-btn-sm" data-test="server-search-retry" (click)="search().retry()">Retry</button>
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
                        <button type="button" class="cms-btn cms-btn-sm" data-test="server-search-retry" (click)="search().retry()">Retry</button>
                    </div>
                }
            }

            @if (search().next() !== null && shown().kind === 'answered') {
                <button type="button" class="mss__more" data-test="server-search-more"
                        [disabled]="search().loadingMore()" (click)="search().more()">
                    {{ search().loadingMore() ? 'Loading…' : words().more }}
                </button>
            }
            @if (search().capped()) {
                <p class="mss__note" data-test="server-search-capped">Showing the first 500.</p>
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
        .mss__more {
            display: block; margin: 10px 12px; padding: 8px; width: calc(100% - 24px); border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius); background: var(--cms-surface); color: var(--cms-text); cursor: pointer; font: inherit;
        }
    `],
})
export class MailServerSearchComponent {
    readonly search = input.required<MailServerSearch>();
    readonly heading = input('More on the server');
    /** What the section says, by what it lists: a search's hits, or a folder's older mail. */
    readonly words = input<ServerSectionWords>(SEARCH_WORDS);
    /** The ids of the messages the local results show: a hit among them is not shown again. */
    readonly localIds = input<ReadonlySet<string>>(new Set<string>());
    readonly folderName = input<(path: string) => string>((path: string) => path);
    /** Opens a hit the platform does not hold; null while that is not offered. */
    readonly opener = input<(hit: ServerSearchHitDto) => Observable<ServerMessageOpenedDto> | null>(() => null);
    readonly opened = output<ServerHitOpened>();

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

    open(hit: ServerSearchHitDto): void {
        this.notice.set(null);
        this.gone.set(false);
        if (hit.local && typeof hit.localId === 'string' && hit.localId !== '') {
            this.opened.emit({ id: hit.localId, folder: hit.folder, seen: hit.seen ?? true });
            return;
        }
        const call = this.opener()(hit);
        if (call === null) {
            return;
        }
        call.subscribe({
            next: stored => {
                this.search().markLocal(hit.ref, stored.id);
                this.opened.emit({ id: stored.id, folder: stored.folder, seen: hit.seen ?? true });
            },
            error: (error: unknown) => {
                const refusal = serverSearchRefusal(error);
                if (refusal.reason === 'gone' || (error instanceof HttpErrorResponse && error.status === 404)) {
                    this.search().drop(hit.ref);
                    this.gone.set(true);
                    return;
                }
                this.notice.set({ ref: hit.ref, text: openFailureText(refusal) });
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

    serverOf(view: { kind: string; server?: string | null }): string | null {
        return view.server ?? null;
    }

    secondsOf(view: { kind: string; seconds?: number }): number {
        return view.seconds ?? 0;
    }

    willRetry(view: { kind: string; willRetry?: boolean }): boolean {
        return view.willRetry === true;
    }
}

/** Why opening a server hit did not work, in the page's words. */
function openFailureText(refusal: ServerSearchRefusal): string {
    switch (refusal.reason) {
        case 'unavailable':
            return `Can't reach the mail server right now${refusal.said !== null ? `: ${refusal.said}` : ''}.`;
        case 'failed':
            return `${refusal.server ?? 'The mail server'} couldn't open this message.`;
        default:
            return 'Couldn\'t open this message from the mail server.';
    }
}
