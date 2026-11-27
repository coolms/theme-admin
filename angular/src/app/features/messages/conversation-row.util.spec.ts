import { TestBed } from '@angular/core/testing';
import { DateTimeFormatService, UserCalendarPreferencesService } from '@coolms/ui-angular';

import {
    conversationAvatar,
    conversationLabel,
    counterpartOf,
    byLastMessage,
    lastMessageTs,
    presenceDot,
    rowPreview,
    rowWhen,
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
 // DRIFT #1. Self-notes has no title and no other participants, so
 // without this branch it falls through to "Conversation" -- which is
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
 // -- only the server knows an excluded viewer's history ceiling.
            expect(unreadFor(conv({ viewerUnread: 3, lastSeq: 99, viewerLastReadSeq: 0 }), me)).toBe(3);
        });

 it('prefers the viewer cursor over the roster lookup', () => {
 // -- an EXCLUDED viewer is absent from `participants`, so the
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

 describe('lastMessageTs', () => {
 it('uses the last message time', () => {
            expect(lastMessageTs(conv({ lastMessageAt: '2026-08-13T10:00:00Z' })))
                .toBe(Date.parse('2026-08-13T10:00:00Z'));
        });

 it('with no message is when it was started, never when it last changed', () => {
            expect(lastMessageTs(conv({ lastMessageAt: null, createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-20T10:00:00Z' })))
                .toBe(Date.parse('2026-08-01T10:00:00Z'));
        });

 it('is 0 when neither is present or parseable, so the row sorts last', () => {
            expect(lastMessageTs(conv({ lastMessageAt: null, createdAt: null, updatedAt: '2026-08-20T10:00:00Z' }))).toBe(0);
            expect(lastMessageTs(conv({ lastMessageAt: 'not a date' }))).toBe(0);
        });
    });

 describe('byLastMessage', () => {
 it('is the latest message first, whatever changed later, and by id where two are of one instant', () => {
            const rows = [
                conv({ id: 'a', lastMessageAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-30T10:00:00Z' }),
                conv({ id: 'b', lastMessageAt: '2026-08-02T10:00:00Z', updatedAt: '2026-08-02T10:00:00Z' }),
                conv({ id: 'c', lastMessageAt: null, createdAt: '2026-08-03T10:00:00Z' }),
                conv({ id: 'd', lastMessageAt: '2026-08-02T10:00:00Z' }),
            ];
            expect(rows.sort(byLastMessage).map(c => c.id)).toEqual(['c', 'd', 'b', 'a']);
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
 // DRIFT #2, and the behavioural one. The quick panel required a
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

    /**
     * The row's "when" through the estate's formatter. Each case that names a
     * clock or a day also asserts the browser's own rendering DIFFERS -- without
     * that the case is vacuous on a machine already in the profile's zone,
     * satisfied by the very behaviour it exists to reject.
     */
 describe('rowWhen', () => {
        /** Deliberately not the container's zone, so a browser-zone render cannot pass. */
        const PROFILE_TZ = 'Asia/Tokyo';

        /** Noon on Tuesday 15 September 2026 in Tokyo; 03:00 of the same day in UTC. */
        const NOW = new Date('2026-09-15T03:00:00.000Z');

        const weekdayOf = (utcDay: Date): string =>
            utcDay.toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });

        let dtf: DateTimeFormatService;
        let chosen = false;

        beforeEach(() => {
            chosen = false;
            TestBed.configureTestingModule({
                providers: [{
                    provide:  UserCalendarPreferencesService,
                    useValue: {
                        ensureLoaded: () => undefined,
                        tz:           () => PROFILE_TZ,
                        dateFormat:   () => 'yyyy-MM-dd',
                        timeFormat:   () => '24h',
                        language:     () => 'en-GB',
                        dateFormatChosen: () => chosen,
                    },
                }],
            });
            dtf = TestBed.inject(DateTimeFormatService);
        });

 it('renders today\'s clock the PROFILE\'s way, not the browser locale and not the browser zone', () => {
            // 01:30 UTC is 10:30 in Tokyo, and still Tuesday there. A 24h
            // profile in Tokyo must say 10:30.
            const iso = '2026-09-15T01:30:00.000Z';

            // What the page did before: browser locale, browser zone.
            const browserWould = new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            expect(browserWould)
                .withContext('this spec is vacuous unless the browser renders it differently')
                .not.toBe('10:30');

            expect(rowWhen(iso, dtf, NOW)).toBe('10:30');
            expect(rowWhen(iso, dtf, NOW)).not.toMatch(/AM|PM/);
        });

 it('takes TODAY from the profile\'s zone, so an instant the browser still files under yesterday is a clock', () => {
            // 16:30 UTC on Monday the 14th is 01:30 on Tuesday the 15th in Tokyo.
            const iso = '2026-09-14T16:30:00.000Z';

            expect(new Date(iso).getDate())
                .withContext('this spec is vacuous unless the browser puts the instant on another day')
                .not.toBe(15);

            expect(rowWhen(iso, dtf, NOW)).toBe('01:30');
        });

 it('says Yesterday for the profile\'s previous day', () => {
            expect(rowWhen('2026-09-14T01:30:00.000Z', dtf, NOW)).toBe('Yesterday');
        });

 it('names the weekday within the week, on the profile\'s day', () => {
            // 16:30 UTC on Thursday the 10th is Friday the 11th in Tokyo.
            const iso = '2026-09-10T16:30:00.000Z';

            expect(new Date(iso).getDate())
                .withContext('this spec is vacuous unless the browser puts the instant on another day')
                .not.toBe(11);

            expect(rowWhen(iso, dtf, NOW)).toBe(weekdayOf(new Date(Date.UTC(2026, 8, 11))));
            expect(rowWhen(iso, dtf, NOW)).not.toBe(weekdayOf(new Date(Date.UTC(2026, 8, 10))));
        });

 it('names the date beyond a week, on the profile\'s day', () => {
            // 16:30 UTC on 31 August is 1 September in Tokyo.
            const shown = rowWhen('2026-08-31T16:30:00.000Z', dtf, NOW);

            expect(shown).not.toContain('31');
            expect(shown).toMatch(/\b1\b/);
        });

 it('says the time even within a minute, and nothing for an unparseable instant', () => {
            expect(rowWhen(new Date(NOW.getTime() - 30_000).toISOString(), dtf, NOW)).toBe('11:59');
            expect(rowWhen('not a date', dtf, NOW)).toBe('');
        });

 it('says the day and month this year, and the chosen format only for a date before this year', () => {
            expect(rowWhen('2026-03-02T03:00:00.000Z', dtf, NOW)).toBe('2 Mar');
            expect(rowWhen('2025-03-02T03:00:00.000Z', dtf, NOW)).toBe('2 Mar 2025');
            chosen = true;
            expect(rowWhen('2026-03-02T03:00:00.000Z', dtf, NOW)).withContext('this year: day and month, chosen or not').toBe('2 Mar');
            expect(rowWhen('2025-03-02T03:00:00.000Z', dtf, NOW)).withContext('before this year: the chosen format').toBe('2025-03-02');
        });
    });

    describe('conversationAvatar', () => {
        const visitor = (name: string | null) =>
            ({ participantId: 'p-visitor', userId: null, displayName: name, lastReadSeq: 0, kind: 'human', role: 'member' });

        it('a live chat takes the visitor\'s name, not an id, from the agent who is me', () => {
            const c = conv({ id: '019efb47-07fc', kind: 'dynamic_chat', title: 'Phone Only',
                participants: [visitor('Phone Only'), participant(me, null)] } as Partial<ChatConversationDto>);
            expect(conversationAvatar(c, me).firstName).toBe('Phone Only');
        });

        it('a live chat takes the visitor before another agent, seen by someone not in it', () => {
            const c = conv({ kind: 'dynamic_chat', title: 'T',
                participants: [participant('agent', 'Agent Ann'), visitor('Smoke Visitor')] } as Partial<ChatConversationDto>);
            expect(conversationAvatar(c, me).firstName).toBe('Smoke Visitor');
        });

        it('a live chat whose participants have no name takes its title', () => {
            const c = conv({ kind: 'dynamic_chat', title: 'Test Visitor',
                participants: [visitor(null), participant(me, null)] } as Partial<ChatConversationDto>);
            expect(conversationAvatar(c, me).firstName).toBe('Test Visitor');
        });

        it('a direct conversation takes the other person\'s name', () => {
            const c = conv({ title: 'ignored', participants: [participant(me, 'Me'), participant('u2', 'Lena Novak')] } as Partial<ChatConversationDto>);
            expect(conversationAvatar(c, me).firstName).toBe('Lena Novak');
        });

        it('a group or a channel takes its title, not a member', () => {
            const c = conv({ kind: 'group', title: 'Design team',
                participants: [participant(me, 'Me'), participant('u2', 'Priya Shah')] } as Partial<ChatConversationDto>);
            expect(conversationAvatar(c, me).firstName).toBe('Design team');
        });

        it('with no name and no title there is no name at all, so the avatar shows "?"', () => {
            const c = conv({ id: '019efd7a-d4d1', kind: 'group', title: '  ', participants: [participant(me, null)] } as Partial<ChatConversationDto>);
            expect(conversationAvatar(c, me).firstName).toBeNull();
            expect(conversationAvatar(conv({ id: '019e', participants: [] } as Partial<ChatConversationDto>), me).firstName).toBeNull();
            expect(conversationAvatar(null, me).firstName).toBeNull();
        });

        it('notes take my own name', () => {
            const c = conv({ kind: 'self_notes', participants: [participant(me, 'Dana')] } as Partial<ChatConversationDto>);
            expect(conversationAvatar(c, me).firstName).toBe('Dana');
        });
    });
});
