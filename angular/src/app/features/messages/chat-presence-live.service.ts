import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import type { ClientInfo, JoinContext, LeaveContext, Subscription } from 'centrifuge';

import { CentrifugoClientService } from '@coolms/ui-angular';
import {
    NO_PRESENCE,
    onlineUserIds,
    PresenceClients,
    seedPresence,
    withoutPresenceClient,
    withPresenceClient,
} from './chat-presence.util';

/**
 * Who is online, PUSHED.
 *
 * Every admin client subscribes to the one shared `presence.chat` channel and
 * stays on it; being subscribed is what makes you visible, and Centrifugo's own
 * `join`/`leave` pushes keep everyone else's view current. Nothing is ever
 * published here — the channel's membership IS the data. The initial roster (the
 * people already connected when this client arrived) comes from one `presence()`
 * read on subscribe, which is the only way to learn about them.
 *
 * ## What this replaced
 *
 * `GET /chat/presence?userIds=…` on a 20-second timer, per visible tab, each
 * call costing the server a round trip to Centrifugo. It was the one poll that
 * could not be gated on the socket because nothing pushed it —
 * which made a left-open tab the most expensive idle client in the product. It
 * survives as the FALLBACK for exactly the case that argument was really about:
 * the socket being down. See the callers' `isConnected()` gate.
 *
 * ## Semantics
 *
 * "Online" means the same thing it did: this person has the admin shell open
 * somewhere. That holds because {@link start} is called from the always-mounted
 * topbar, not from the Messages page — presence must not blink off when someone
 * navigates to Pages.
 *
 * Best-effort throughout: every failure path degrades to "nobody known to be
 * online", which renders as no dots rather than as an error. A presence hiccup
 * must never break a page.
 */
@Injectable({ providedIn: 'root' })
export class ChatPresenceLiveService {
    private readonly client = inject(CentrifugoClientService);

    /** clientId -> userId for everyone currently on the channel. */
    private readonly clients = signal<PresenceClients>(NO_PRESENCE);

    /** The distinct users currently connected — one entry per person, not per tab. */
    readonly online: Signal<ReadonlySet<string>> = computed(() => onlineUserIds(this.clients()));

    /**
     * Whether this service is the authority right now. FALSE until the channel
     * is actually subscribed, so a consumer knows to keep its REST fallback
     * running rather than render "nobody is online" from an empty push set.
     */
    private readonly _live = signal(false);
    readonly live: Signal<boolean> = this._live.asReadonly();

    private sub: Subscription | null = null;
    private starting = false;

    /**
     * Join the presence channel. Idempotent — the topbar calls it on sign-in and
     * it is safe to call again.
     */
    start(): void {
        if (this.sub !== null || this.starting) {
            return;
        }
        this.starting = true;
        this.client.connect()
            .then(() => {
                const sub = this.client.getOrCreateSubscription('presence.chat');
                this.sub = sub;
                this.starting = false;

                sub.on('join', (ctx: JoinContext) => this.onJoin(ctx.info));
                sub.on('leave', (ctx: LeaveContext) => this.onLeave(ctx.info.client));
                // A reconnect re-fires `subscribed`, and the roster we hold is
                // then stale by exactly the length of the outage — re-seed rather
                // than resume, or everyone who left while we were away stays lit.
                sub.on('subscribed', () => this.seed(sub));
                sub.on('unsubscribed', () => {
                    this._live.set(false);
                    this.clients.set(NO_PRESENCE);
                });

                if (sub.state !== 'subscribed') {
                    sub.subscribe();
                } else {
                    this.seed(sub); // shared subscription already up — `subscribed` will not fire again
                }
            })
            .catch(() => {
                this.starting = false;
                // No transport: consumers keep polling. Nothing to report.
            });
    }

    /** Leave the channel and forget the roster (sign-out, app teardown). */
    stop(): void {
        this.sub?.unsubscribe();
        this.sub = null;
        this.starting = false;
        this._live.set(false);
        this.clients.set(NO_PRESENCE);
    }

    private seed(sub: Subscription): void {
        sub.presence()
            .then(res => {
                this.clients.set(seedPresence(Object.values(res.clients)));
                this._live.set(true);
            })
            .catch(() => {
                // Presence momentarily unavailable. Stay NOT live so the REST
                // fallback keeps answering — join/leave alone would report only
                // the people who arrive from now on, which reads as "everyone
                // else went offline".
                this._live.set(false);
            });
    }

    private onJoin(info: ClientInfo): void {
        this.clients.update(m => withPresenceClient(m, { client: info.client, user: info.user }));
    }

    private onLeave(clientId: string): void {
        this.clients.update(m => withoutPresenceClient(m, clientId));
    }
}
