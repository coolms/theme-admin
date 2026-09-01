import {
    conversationLabel,
    counterpartOf,
    lastActivityTs,
    presenceDot,
    rowPreview,
    unreadFor,
} from './conversation-row.util';
import { ChatConversationDto } from './messages.types';

/**
 * How a conversation row is projected.
 *
 * Three of these rules had DRIFTED between the page and the quick panel before
 * they were shared. Each drift gets a test naming what the two used to disagree
 * about, because that is the failure this file exists to prevent recurring.
 */
describe('conversation row', () => {
    const me = 'user-me';

    const conv = (over: Partial<ChatConversationDto> = {}): ChatConversationDto => ({
        id: 'c1', kind: 'direct', title: null, status: 'active',
        lastSeq: 0, updatedAt: null, ...over,
    } as ChatConversationDto);

    const participant = (userId: string | null, displayName: string | null, lastReadSeq = 0) =>
        ({ participantId: 'p-' + userId, userId, displayName, lastReadSeq, kind: 'human', role: 'member' });

    describe('conversationLabel', () => {
        it('prefers an explicit title', () => {
            expect(conversationLabel(conv({ title: 'QA Channel' }), me)).toBe('QA Channel');
        });

        it('names a self-notes room "Notes"', () => {
            //  DRIFT #1. Self-notes has no title and no other participants, so
            // without this branch it falls through to "Conversation" — which is
            // what the quick panel showed while the page said "Notes".
            expect(conversationLabel(conv({ kind: 'self_notes' }), me)).toBe('Notes');
        });

        it('names a self-notes room "Notes" even though it has no title', () => {
            expect(conversationLabel(conv({ kind: 'self_notes', title: null, participants: [] }), me)).toBe('Notes');
        });

        it('lists the OTHER participants when there is no title', () => {
            expect(conversationLabel(conv({
                participants: [participant(me, 'Me'), participant('u2', 'Ada'), participant('u3', 'Grace')],
            }), me)).toBe('Ada, Grace');
        });

        it('falls back to the user id when a participant has no display name', () => {
            expect(conversationLabel(conv({ participants: [participant('u2', null)] }), me)).toBe('u2');
        });

        it('says "Conversation" when there is nobody else to name', () => {
            expect(conversationLabel(conv({ participants: [participant(me, 'Me')] }), me)).toBe('Conversation');
        });

        it('treats a whitespace-only title as no title', () => {
            expect(conversationLabel(conv({ title: '   ', participants: [participant('u2', 'Ada')] }), me)).toBe('Ada');
        });

        it('is empty for no conversation', () => {
            expect(conversationLabel(null, me)).toBe('');
        });
    });

    describe('unreadFor', () => {
        it('takes the SERVER number when there is one', () => {
            // — only the server knows an excluded viewer's history ceiling.
            expect(unreadFor(conv({ viewerUnread: 3, lastSeq: 99, viewerLastReadSeq: 0 }), me)).toBe(3);
        });

        it('prefers the viewer cursor over the roster lookup', () => {
            // — an EXCLUDED viewer is absent from `participants`, so the
            // roster lookup yielded 0 and showed everything as unread forever.
            expect(unreadFor(conv({ lastSeq: 10, viewerLastReadSeq: 7, participants: [] }), me)).toBe(3);
        });

        it('falls back to the roster cursor when the viewer field is absent', () => {
            expect(unreadFor(conv({ lastSeq: 10, participants: [participant(me, 'Me', 6)] }), me)).toBe(4);
        });

        it('treats an unknown viewer as having read nothing', () => {
            expect(unreadFor(conv({ lastSeq: 5, participants: [] }), me)).toBe(5);
        });

        it('lets an in-flight local mark-read win over the server number', () => {
            // The optimistic override is the one thing the server cannot know yet.
            expect(unreadFor(conv({ viewerUnread: 4, lastSeq: 10 }), me, 10)).toBe(0);
        });

        it('never returns a negative when the cursor is ahead of lastSeq', () => {
            expect(unreadFor(conv({ lastSeq: 2, viewerLastReadSeq: 9 }), me)).toBe(0);
        });

        it('is zero for no conversation', () => {
            expect(unreadFor(null, me)).toBe(0);
        });
    });

    describe('rowPreview', () => {
        it('marks your own last message', () => {
            expect(rowPreview(conv({ lastMessagePreview: 'hello', lastMessageMine: true }))).toBe('You: hello');
        });

        it('shows a peer message as-is', () => {
            expect(rowPreview(conv({ lastMessagePreview: 'hello', lastMessageMine: false }))).toBe('hello');
        });

        it('says so when there are no messages yet', () => {
            expect(rowPreview(conv({ lastMessagePreview: null }))).toBe('No messages yet');
            expect(rowPreview(conv({ lastMessagePreview: '   ' }))).toBe('No messages yet');
        });
    });

    describe('lastActivityTs', () => {
        it('uses the last message time', () => {
            expect(lastActivityTs(conv({ lastMessageAt: '2026-08-13T10:00:00Z' })))
                .toBe(Date.parse('2026-08-13T10:00:00Z'));
        });

        it('falls back to updatedAt for a conversation with no messages', () => {
            expect(lastActivityTs(conv({ lastMessageAt: null, updatedAt: '2026-08-01T10:00:00Z' })))
                .toBe(Date.parse('2026-08-01T10:00:00Z'));
        });

        it('is 0 when neither is present or parseable, so the row sorts last', () => {
            expect(lastActivityTs(conv({ lastMessageAt: null, updatedAt: null }))).toBe(0);
            expect(lastActivityTs(conv({ lastMessageAt: 'not a date' }))).toBe(0);
        });
    });

    describe('presenceDot', () => {
        const online = new Set(['u2']);

        it('shows online for a connected user with no self-set status', () => {
            expect(presenceDot('u2', null, online)).toBe('online');
        });

        it('shows nothing for a user who is not connected', () => {
            expect(presenceDot('u3', null, online)).toBeNull();
        });

        it('reports busy/away EVEN WHEN the connection layer says nothing', () => {
            //  DRIFT #2, and the behavioural one. The quick panel required a
            // live connection first, so someone who set Busy and closed their tab
            // showed a busy dot on the page and NO dot in the panel. Connection
            // presence can be unavailable for operational reasons; "who is
            // away/busy" stays legible regardless.
            expect(presenceDot('u3', 'busy', online)).toBe('busy');
            expect(presenceDot('u3', 'away', online)).toBe('away');
        });

        it('honours "appear offline" even while connected', () => {
            expect(presenceDot('u2', 'offline', online)).toBeNull();
        });

        it('shows nothing for an anonymous participant', () => {
            expect(presenceDot(null, null, online)).toBeNull();
            expect(presenceDot(undefined, null, online)).toBeNull();
        });
    });

    describe('counterpartOf', () => {
        it('finds the first participant who is not the viewer', () => {
            expect(counterpartOf(conv({
                participants: [participant(me, 'Me'), participant('u2', 'Ada')],
            }), me)?.userId).toBe('u2');
        });

        it('skips anonymous participants with no user id', () => {
            expect(counterpartOf(conv({
                participants: [participant(null, 'Visitor'), participant('u2', 'Ada')],
            }), me)?.userId).toBe('u2');
        });

        it('is undefined when the viewer is alone', () => {
            expect(counterpartOf(conv({ participants: [participant(me, 'Me')] }), me)).toBeUndefined();
        });
    });
});
