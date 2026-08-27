import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Store } from '@ngxs/store';
import type {
    ClientInfo,
    JoinContext,
    LeaveContext,
    PublicationContext,
    Subscription,
} from 'centrifuge';
import { AuthState } from '@coolms/core-angular';
import { CentrifugoClientService } from '@coolms/ui-angular';

/** A distinct *other* user currently present in the document. */
export interface EditorPeer {
    /** The peer's user UUID (Centrifugo presence `user` = JWT `sub`). */
    readonly userId: string;
    /** Display label — the connection token's `info.displayName`, falling back to `info.username`. */
    readonly name: string;
}

/** A peer's save broadcast (`{type:'saved'}` on the doc channel). */
export interface PeerSaveEvent {
    readonly nodeId: string;
    readonly by: string | null;
    readonly byName: string | null;
}

/**
 * Collaborative-editing presence + activity for one open document
 * (Track B #8, ledger #804). Wraps the singleton
 * {@see CentrifugoClientService} for the per-document channel
 * `editor.doc.{nodeId}` — the typed editor sibling of
 * `VfsLiveEventsService`, but stateful (it owns one active channel at a
 * time and exposes reactive presence) rather than Observable-per-call.
 *
 * Provided **per page-editor instance** (not root) so its `ngOnDestroy`
 * tears the channel down when the editor dialog closes.
 *
 * Presence is sourced from Centrifugo's native presence snapshot
 * (seeded on `subscribed`) plus incremental `join`/`leave` events. The
 * connection token carries `info.displayName` (friendly label) and
 * `info.username`, so each presence entry's `connInfo` yields the
 * display label without any extra lookup — see {@link nameOf}.
 * The local user is excluded from {@link peers} (the bar shows who
 * *else* is here) and from the save banner (own saves are suppressed by
 * comparing the broadcast `by` against the current user id).
 *
 * Realtime is strictly best-effort: every failure path degrades
 * silently because the REST load/save flow stays authoritative.
 */
@Injectable()
export class EditorCollabService implements OnDestroy {
    private readonly client = inject(CentrifugoClientService);
    private readonly store = inject(Store);

    /** Constant for an editor session; used for self-exclusion + self-save suppression. */
    private readonly currentUserId = this.store.selectSnapshot(AuthState.currentUser)?.id ?? null;

    /** clientId → ClientInfo for everyone present on the active channel. */
    private readonly clients = signal<Map<string, ClientInfo>>(new Map());

    /** Distinct *other* users present in the active document (self + multi-tab deduped). */
    readonly peers = computed<EditorPeer[]>(() => {
        const byUser = new Map<string, EditorPeer>();
        for (const info of this.clients().values()) {
            if (info.user === this.currentUserId) {
                continue; // never list yourself
            }
            if (byUser.has(info.user)) {
                continue; // one avatar per user, even across tabs
            }
            byUser.set(info.user, { userId: info.user, name: this.nameOf(info) });
        }
        return [...byUser.values()];
    });

    /** Latest unacknowledged peer save; `null` when none / acknowledged. */
    readonly peerSaved = signal<PeerSaveEvent | null>(null);

    private channel: string | null = null;
    private sub: Subscription | null = null;
    private onSubscribed: (() => void) | null = null;
    private onJoin: ((ctx: JoinContext) => void) | null = null;
    private onLeave: ((ctx: LeaveContext) => void) | null = null;
    private onPublication: ((ctx: PublicationContext) => void) | null = null;

    /**
     * Point presence + save-watch at a document node. Idempotent for the
     * same node; switching nodes (locale-tab change) tears the previous
     * channel down first so only one channel is ever live.
     */
    watch(nodeId: string): void {
        const channel = `editor.doc.${nodeId}`;
        if (channel === this.channel) {
            return;
        }
        this.stop();
        this.channel = channel;

        this.client.connect()
            .then(() => {
                // Bail if the caller switched/stopped during the async connect.
                if (this.channel !== channel) {
                    return;
                }
                const sub = this.client.getOrCreateSubscription(channel);
                this.sub = sub;

                this.onJoin = (ctx): void => this.upsertClient(ctx.info);
                this.onLeave = (ctx): void => this.removeClient(ctx.info.client);
                this.onPublication = (ctx): void => this.handlePublication(ctx);
                this.onSubscribed = (): void => this.seedPresence(sub, channel);

                sub.on('join', this.onJoin);
                sub.on('leave', this.onLeave);
                sub.on('publication', this.onPublication);
                sub.on('subscribed', this.onSubscribed);

                if (sub.state !== 'subscribed') {
                    sub.subscribe();
                } else {
                    // Already subscribed (shared sub) — `subscribed` won't fire again.
                    this.seedPresence(sub, channel);
                }
            })
            .catch(() => {
                // Best-effort: presence is a nicety, not a correctness guarantee.
            });
    }

    /** Dismiss the current peer-saved banner (Reload or ×). */
    acknowledgeSaved(): void {
        this.peerSaved.set(null);
    }

    /** Detach listeners + unsubscribe from the active channel, resetting state. */
    stop(): void {
        const sub = this.sub;
        if (sub !== null) {
            if (this.onJoin !== null) sub.off('join', this.onJoin);
            if (this.onLeave !== null) sub.off('leave', this.onLeave);
            if (this.onPublication !== null) sub.off('publication', this.onPublication);
            if (this.onSubscribed !== null) sub.off('subscribed', this.onSubscribed);
            sub.unsubscribe();
        }
        this.sub = null;
        this.channel = null;
        this.onJoin = null;
        this.onLeave = null;
        this.onPublication = null;
        this.onSubscribed = null;
        this.clients.set(new Map());
        this.peerSaved.set(null);
    }

    ngOnDestroy(): void {
        this.stop();
    }

    /** Authoritative snapshot at subscribe time; `join`/`leave` carry it forward. */
    private seedPresence(sub: Subscription, channel: string): void {
        sub.presence()
            .then(res => {
                if (this.channel !== channel) {
                    return; // switched away mid-flight
                }
                const next = new Map<string, ClientInfo>();
                for (const [clientId, info] of Object.entries(res.clients)) {
                    next.set(clientId, info);
                }
                this.clients.set(next);
            })
            .catch(() => {
                // Presence may be momentarily unavailable; join/leave keep us live.
            });
    }

    private upsertClient(info: ClientInfo): void {
        this.clients.update(m => {
            const next = new Map(m);
            next.set(info.client, info);
            return next;
        });
    }

    private removeClient(clientId: string): void {
        this.clients.update(m => {
            if (!m.has(clientId)) {
                return m;
            }
            const next = new Map(m);
            next.delete(clientId);
            return next;
        });
    }

    private handlePublication(ctx: PublicationContext): void {
        const data = ctx.data as Record<string, unknown> | null;
        if (data === null || typeof data !== 'object' || data['type'] !== 'saved') {
            return;
        }
        const by = typeof data['by'] === 'string' ? data['by'] : null;
        if (by !== null && by === this.currentUserId) {
            return; // your own save — no "reload?" prompt
        }
        this.peerSaved.set({
            nodeId: typeof data['nodeId'] === 'string' ? data['nodeId'] : '',
            by,
            byName: typeof data['byName'] === 'string' ? data['byName'] : null,
        });
    }

    private nameOf(info: ClientInfo): string {
        const conn = info.connInfo as { displayName?: unknown; username?: unknown } | undefined;
        // Prefer the connection token's friendly `info.displayName`; fall
        // back to `info.username` for tokens issued before that claim
        // existed (or users whose username already is the friendly label).
        if (typeof conn?.displayName === 'string' && conn.displayName.length > 0) {
            return conn.displayName;
        }
        return typeof conn?.username === 'string' && conn.username.length > 0
            ? conn.username
            : 'Someone';
    }
}
