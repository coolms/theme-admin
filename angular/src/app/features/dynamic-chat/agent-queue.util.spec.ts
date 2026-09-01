import { QueueEntry, countNewConversations, isNewInQueue, sortQueue } from './agent-queue.util';

/**
 * The agent queue's count and order — the first specs the DynamicChat
 * feature has had.
 */
describe('agent queue', () => {
    const entry = (agentStatus: string | undefined, updatedAt: string | null = null): QueueEntry =>
        ({ agentStatus, updatedAt });

    describe('countNewConversations', () => {
        it('counts the conversations waiting for an agent', () => {
            expect(countNewConversations([entry('new'), entry('answered'), entry('new')])).toBe(2);
        });

        it('counts an ABSENT status as not new', () => {
            //  `agentStatus` is optional on the wire. A row the server did not
            // resolve must not inflate the badge and send an agent looking for
            // work that is not there.
            expect(countNewConversations([entry(undefined), entry('new')])).toBe(1);
        });

        it('is zero for an empty queue rather than anything else', () => {
            expect(countNewConversations([])).toBe(0);
        });

        it('does not count a status that merely contains "new"', () => {
            expect(countNewConversations([entry('renewed'), entry('new-ish')])).toBe(0);
        });
    });

    describe('isNewInQueue', () => {
        it('is an exact match on the status', () => {
            expect(isNewInQueue(entry('new'))).toBe(true);
            expect(isNewInQueue(entry('answered'))).toBe(false);
            expect(isNewInQueue(entry(undefined))).toBe(false);
        });
    });

    describe('sortQueue', () => {
        it('puts conversations waiting for an agent first', () => {
            const sorted = sortQueue([
                { id: 'answered', agentStatus: 'answered', updatedAt: '2026-08-13T10:00:00Z' },
                { id: 'waiting', agentStatus: 'new', updatedAt: '2026-08-01T10:00:00Z' },
            ]);

            // Waiting wins even though it is much older — the queue is work to
            // pick up, not a activity feed.
            expect(sorted.map(e => e.id)).toEqual(['waiting', 'answered']);
        });

        it('orders most-recently-active first within the same status', () => {
            const sorted = sortQueue([
                { id: 'older', agentStatus: 'new', updatedAt: '2026-08-01T10:00:00Z' },
                { id: 'newer', agentStatus: 'new', updatedAt: '2026-08-13T10:00:00Z' },
                { id: 'middle', agentStatus: 'new', updatedAt: '2026-08-07T10:00:00Z' },
            ]);

            expect(sorted.map(e => e.id)).toEqual(['newer', 'middle', 'older']);
        });

        it('sorts an unknown activity time LAST rather than first', () => {
            const sorted = sortQueue([
                { id: 'unknown', agentStatus: 'new', updatedAt: null },
                { id: 'known', agentStatus: 'new', updatedAt: '2026-08-01T10:00:00Z' },
            ]);

            expect(sorted.map(e => e.id)).toEqual(['known', 'unknown']);
        });

        it('does NOT mutate the array it was given', () => {
            //  These lists come straight out of a signal other views read, and
            // `Array.prototype.sort` sorts in place.
            const original = [
                { id: 'answered', agentStatus: 'answered', updatedAt: '2026-08-13T10:00:00Z' },
                { id: 'waiting', agentStatus: 'new', updatedAt: '2026-08-01T10:00:00Z' },
            ];

            sortQueue(original);

            expect(original.map(e => e.id)).toEqual(['answered', 'waiting']);
        });

        it('handles an empty queue', () => {
            expect(sortQueue([])).toEqual([]);
        });

        it('keeps waiting-before-answered across a mixed queue', () => {
            const sorted = sortQueue([
                { id: 'a1', agentStatus: 'answered', updatedAt: '2026-08-13T12:00:00Z' },
                { id: 'n1', agentStatus: 'new', updatedAt: '2026-08-13T09:00:00Z' },
                { id: 'a2', agentStatus: 'answered', updatedAt: '2026-08-13T13:00:00Z' },
                { id: 'n2', agentStatus: 'new', updatedAt: '2026-08-13T11:00:00Z' },
            ]);

            expect(sorted.map(e => e.id)).toEqual(['n2', 'n1', 'a2', 'a1']);
        });
    });
});
