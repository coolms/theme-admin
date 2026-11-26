import { Location } from '@angular/common';
import { type Provider } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap, type Params } from '@angular/router';
import { BehaviorSubject, NEVER } from 'rxjs';

import { CHAT_PATH, CONVERSATION_PARAM } from './chat-address';

/** One history entry: the conversation the address names (null for the list alone) and its query. */
export interface ChatAddressEntry {
    readonly conversationId: string | null;
    readonly query: Params;
}

/**
 * The chat page's address and the browser's history, for specs: the page's route parameters and query follow the
 * current entry; `navigate` pushes or replaces an entry as the router would, `back` steps back as the browser does.
 * Each change of entry reaches the page after the caller returns, as the router's does.
 */
export class ChatAddressFake {
    readonly entries: ChatAddressEntry[];
    index = 0;
    /** Every navigation the page asked for. */
    readonly navigations: Array<{ readonly commands: unknown[]; readonly replaceUrl: boolean }> = [];

    private readonly params: BehaviorSubject<ParamMap>;
    private readonly query: BehaviorSubject<ParamMap>;

    constructor(conversationId: string | null = null, query: Params = {}) {
        this.entries = [{ conversationId, query }];
        this.params = new BehaviorSubject(this.paramsOf(this.entries[0]));
        this.query = new BehaviorSubject(convertToParamMap(query));
    }

    /** The current entry. */
    get current(): ChatAddressEntry {
        return this.entries[this.index];
    }

    readonly router = {
        events: NEVER,
        navigate: (commands: unknown[], extras: { replaceUrl?: boolean } = {}): Promise<boolean> => {
            const replaceUrl = extras.replaceUrl === true;
            this.navigations.push({ commands, replaceUrl });
            if (commands[0] !== CHAT_PATH || commands.length > 2) {
                throw new Error('not the chat page: ' + JSON.stringify(commands));
            }
            const entry: ChatAddressEntry = { conversationId: commands.length === 2 ? String(commands[1]) : null, query: {} };
            if (replaceUrl) {
                this.entries[this.index] = entry;
            } else {
                this.entries.splice(this.index + 1, this.entries.length, entry);
                this.index += 1;
            }
            this.emitSoon();
            return Promise.resolve(true);
        },
    };

    readonly location = {
        back: (): void => {
            if (this.index > 0) {
                this.index -= 1;
                this.emitSoon();
            }
        },
    };

    /** The browser's Back, as the person presses it. */
    back(): void {
        this.location.back();
    }

    /** The router, the location and the page's route, standing for the real ones. */
    get providers(): Provider[] {
        return [
            { provide: Router, useValue: this.router },
            { provide: Location, useValue: this.location },
            { provide: ActivatedRoute, useValue: { paramMap: this.params.asObservable(), queryParamMap: this.query.asObservable() } },
        ];
    }

    private paramsOf(entry: ChatAddressEntry): ParamMap {
        return convertToParamMap(entry.conversationId === null ? {} : { [CONVERSATION_PARAM]: entry.conversationId });
    }

    private emitSoon(): void {
        queueMicrotask(() => {
            const entry = this.current;
            this.params.next(this.paramsOf(entry));
            this.query.next(convertToParamMap(entry.query));
        });
    }
}
