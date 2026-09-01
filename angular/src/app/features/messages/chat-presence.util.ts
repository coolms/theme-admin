/**
 * Connection-presence bookkeeping for the shared `presence.chat` channel
 * — who is online, derived from Centrifugo's own join/leave pushes
 * instead of a 20-second poll.
 *
 * The unit of presence Centrifugo reports is a CLIENT (one connection), not a
 * user: the same person with the Messages page open in two tabs is two clients
 * with the same `user`. So the map is keyed by client id and the online set is
 * projected from it — which is the whole reason this is a testable unit rather
 * than a `Set<string>` in the service. Keying by user id directly loses the
 * count, and then closing ONE of two tabs greys out someone who is still there.
 */

/** One connected client, as Centrifugo reports it (`ClientInfo`). */
export interface PresenceClient {
    /** Centrifugo's per-connection id — the identity a `leave` carries. */
    readonly client: string;
    /** The user behind the connection: the JWT `sub`, i.e. our RFC-4122 user id. */
    readonly user: string;
}

/** clientId -> userId. */
export type PresenceClients = ReadonlyMap<string, string>;

export const NO_PRESENCE: PresenceClients = new Map<string, string>();

/**
 * Rebuild from an authoritative snapshot — the `presence()` read taken on
 * subscribe, which is the only way to learn about people who were already
 * connected before this client arrived.
 */
export function seedPresence(clients: Iterable<PresenceClient>): PresenceClients {
    const next = new Map<string, string>();
    for (const c of clients) {
        if (c.client !== '' && c.user !== '') {
            next.set(c.client, c.user);
        }
    }

    return next;
}

/** A `join` push: remember this connection. Idempotent. */
export function withPresenceClient(current: PresenceClients, client: PresenceClient): PresenceClients {
    if (client.client === '' || client.user === '' || current.get(client.client) === client.user) {
        return current;
    }
    const next = new Map(current);
    next.set(client.client, client.user);

    return next;
}

/**
 * A `leave` push: forget ONE connection.
 *
 *  The user stays online until their LAST client leaves — that is what makes
 * a second tab, or a reconnect that briefly overlaps the old connection, not
 * flicker the dot.
 */
export function withoutPresenceClient(current: PresenceClients, clientId: string): PresenceClients {
    if (!current.has(clientId)) {
        return current;
    }
    const next = new Map(current);
    next.delete(clientId);

    return next;
}

/** The distinct users behind the connected clients — what the dots read. */
export function onlineUserIds(clients: PresenceClients): ReadonlySet<string> {
    return new Set(clients.values());
}
