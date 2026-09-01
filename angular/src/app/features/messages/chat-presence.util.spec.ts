import {
    NO_PRESENCE,
    onlineUserIds,
    PresenceClient,
    seedPresence,
    withoutPresenceClient,
    withPresenceClient,
} from './chat-presence.util';

/**
 * Connection presence from join/leave pushes.
 *
 * The rule that earns this file: presence is per CONNECTION, the dot is per
 * PERSON. Everything below is about not confusing the two.
 */
describe('chat presence', () => {
    const c = (client: string, user: string): PresenceClient => ({ client, user });
    const users = (m: ReturnType<typeof seedPresence>): string[] => [...onlineUserIds(m)].sort();

    describe('seedPresence', () => {
        it('rebuilds from the snapshot taken on subscribe', () => {
            const map = seedPresence([c('c1', 'alice'), c('c2', 'bob')]);

            expect(users(map)).toEqual(['alice', 'bob']);
        });

        it('is how anyone already connected is ever learned about', () => {
            // join/leave only reports transitions AFTER we subscribed, so without
            // the snapshot every peer who was already here would be invisible.
            expect(users(seedPresence([]))).toEqual([]);
        });

        it('ignores entries missing a client or user id', () => {
            expect(users(seedPresence([c('', 'alice'), c('c1', ''), c('c2', 'bob')]))).toEqual(['bob']);
        });
    });

    describe('withPresenceClient', () => {
        it('adds a joining connection', () => {
            expect(users(withPresenceClient(NO_PRESENCE, c('c1', 'alice')))).toEqual(['alice']);
        });

        it('returns the SAME map when nothing changed, so signals do not churn', () => {
            const map = seedPresence([c('c1', 'alice')]);

            expect(withPresenceClient(map, c('c1', 'alice'))).toBe(map);
        });

        it('does not mutate the map it was given', () => {
            const map = seedPresence([c('c1', 'alice')]);
            withPresenceClient(map, c('c2', 'bob'));

            expect(users(map)).toEqual(['alice']);
        });
    });

    describe('withoutPresenceClient', () => {
        it('removes a leaving connection', () => {
            const map = withoutPresenceClient(seedPresence([c('c1', 'alice')]), 'c1');

            expect(users(map)).toEqual([]);
        });

        it('KEEPS the user online while another of their connections remains', () => {
            //  The one that matters. Two tabs, close one — Alice is still here.
            // Keying presence by user id instead of client id loses exactly this.
            const map = withoutPresenceClient(seedPresence([c('c1', 'alice'), c('c2', 'alice')]), 'c1');

            expect(users(map)).toEqual(['alice']);
        });

        it('drops the user only when their last connection goes', () => {
            let map = seedPresence([c('c1', 'alice'), c('c2', 'alice')]);
            map = withoutPresenceClient(map, 'c1');
            map = withoutPresenceClient(map, 'c2');

            expect(users(map)).toEqual([]);
        });

        it('ignores a leave for a connection it never saw', () => {
            const map = seedPresence([c('c1', 'alice')]);

            expect(withoutPresenceClient(map, 'nope')).toBe(map);
        });
    });

    describe('onlineUserIds', () => {
        it('reports one entry per PERSON, however many connections they hold', () => {
            const map = seedPresence([c('c1', 'alice'), c('c2', 'alice'), c('c3', 'bob')]);

            expect(onlineUserIds(map).size).toBe(2);
        });
    });
});
