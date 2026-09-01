import { advanceReadOverride, mayMarkRead, ReadOverrides } from './mark-read.util';
import { ChatConversationDto } from './messages.types';

/**
 * Mark-read rules — shared after the page and the quick panel were found
 * to disagree about both of them.
 */
describe('mark read', () => {
    const conv = (over: Partial<ChatConversationDto> = {}): ChatConversationDto =>
        ({ id: 'c1', kind: 'direct', title: null, status: 'active', lastSeq: 0, updatedAt: null, ...over } as ChatConversationDto);

    describe('mayMarkRead', () => {
        it('allows an active viewer with something to claim', () => {
            expect(mayMarkRead(conv({ viewerState: 'active' }), 5)).toBe(true);
        });

        it('refuses seq 0 — claiming nothing is how a client claims EVERYTHING', () => {
            // : the seq is the client's high-water. Zero means "I have
            // received nothing", and sending it invited the server to use its own
            // lastSeq instead.
            expect(mayMarkRead(conv(), 0)).toBe(false);
            expect(mayMarkRead(conv(), -1)).toBe(false);
        });

        it('refuses an owner-EXCLUDED viewer', () => {
            //  The drift. They are read-only up to a frozen ceiling, the server
            // refuses the call, and hides the control — so the quick panel
            // was issuing a request that existed only to be rejected.
            expect(mayMarkRead(conv({ viewerState: 'excluded' }), 5)).toBe(false);
        });

        it('allows a viewer whose state is not resolved', () => {
            // Absent is not excluded — a payload without the field must not stop
            // an ordinary member marking their messages read.
            expect(mayMarkRead(conv({ viewerState: undefined }), 5)).toBe(true);
            expect(mayMarkRead(conv({ viewerState: null }), 5)).toBe(true);
        });

        it('allows it when the conversation ROW is missing entirely', () => {
            //  Deliberate, and the same rule one test up: a row we do not have
            // is not a row that says "excluded". Since the inbox is paged
            //, a deep-linked conversation can be open while its row has
            // not loaded — refusing here would leave those messages permanently
            // unread. The seq being claimed is still the CLIENT's own high-water,
            // so nothing is over-claimed.
            expect(mayMarkRead(null, 5)).toBe(true);
            expect(mayMarkRead(undefined, 5)).toBe(true);
        });

        it('still refuses a missing conversation when there is nothing to claim', () => {
            expect(mayMarkRead(null, 0)).toBe(false);
        });
    });

    describe('advanceReadOverride', () => {
        it('records the cursor for a conversation', () => {
            expect(advanceReadOverride({}, 'c1', 7)).toEqual({ c1: 7 });
        });

        it('MOVES FORWARD ONLY, so a slower surface cannot undo a faster one', () => {
            //  Two surfaces mark the same conversation read; the responses can
            // land in either order.
            const at9: ReadOverrides = { c1: 9 };
            expect(advanceReadOverride(at9, 'c1', 3)).toEqual({ c1: 9 });
        });

        it('returns the SAME object when nothing moved, so signals do not churn', () => {
            const at9: ReadOverrides = { c1: 9 };
            expect(advanceReadOverride(at9, 'c1', 9)).toBe(at9);
        });

        it('does not disturb other conversations', () => {
            expect(advanceReadOverride({ c1: 4, c2: 8 }, 'c1', 6)).toEqual({ c1: 6, c2: 8 });
        });

        it('does not mutate the map it was given', () => {
            const before: ReadOverrides = { c1: 4 };
            advanceReadOverride(before, 'c1', 9);
            expect(before).toEqual({ c1: 4 });
        });
    });
});
