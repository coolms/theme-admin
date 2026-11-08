import { EnvironmentInjector, createEnvironmentInjector, signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CentrifugoClientService } from '@coolms/ui-angular';
import { EmailLiveEventsService } from './email-live-events.service';
import { type EmailFolderDto, type EmailMessageDto } from './email.types';
import { MailLiveFollower, type MailView, readMessagesChanged } from './mail-messages-changed';

const MAILBOX = 'mb-1';

function folders(): EmailFolderDto[] {
    return [
        { folder: 'INBOX', total: 3, unseen: 2, serverTotal: 3, serverUnseen: 2 },
        { folder: 'Archive', total: 10, unseen: 0, serverTotal: 10, serverUnseen: 0 },
        { folder: 'Trash', total: 1, unseen: 0, serverTotal: 1, serverUnseen: 0 },
    ];
}

function messages(): EmailMessageDto[] {
    return [
        { id: 'm1', folder: 'INBOX', seen: false, flagged: false },
        { id: 'm2', folder: 'INBOX', seen: false, flagged: false },
        { id: 'm3', folder: 'INBOX', seen: true, flagged: false },
    ];
}

/**
 * One admin tab: the realtime service as the page uses it, its own view of the open INBOX, and its own follower, whose
 * re-read takes the open folder's list as the server has it now, and is counted.
 */
class Client {
    view: MailView;
    readonly follower: MailLiveFollower;
    reads = 0;
    private readonly injector: EnvironmentInjector;

    constructor(server: FakeServer) {
        this.follower = new MailLiveFollower(() => {
            this.reads++;
            this.view = { ...this.view, messages: server.listOf(this.view.folder) };
        }, 300);
        this.view = {
            mailboxId: MAILBOX, folder: 'INBOX', messages: messages(), thread: [], openMessage: null,
            folders: folders(), mailboxUnread: { [MAILBOX]: 2 },
        };
        this.injector = createEnvironmentInjector([
            EmailLiveEventsService,
            { provide: CentrifugoClientService, useValue: server.client() },
        ], TestBed.inject(EnvironmentInjector));
        this.injector.get(EmailLiveEventsService).watch('user-1').subscribe(evt => {
            if (evt.type === 'mail.messages.changed') {
                this.view = this.follower.apply(this.view, evt);
            }
        });
    }

    row(id: string): EmailMessageDto | undefined {
        return this.view.messages.find(m => m.id === id);
    }

    folder(name: string): EmailFolderDto | undefined {
        return this.view.folders.find(f => f.folder === name);
    }

    destroy(): void {
        this.follower.stop();
        this.injector.destroy();
    }
}

/**
 * The realtime server: every publication on the person's channel reaches every client subscribed to it. It also holds
 * the mailbox's messages, as a list read answers them.
 */
class FakeServer {
    private readonly handlers: ((ctx: { data: unknown }) => void)[] = [];
    mailbox: EmailMessageDto[] = [...messages(), { id: 'r1', folder: 'Trash', seen: true, flagged: false }];

    listOf(folder: string): EmailMessageDto[] {
        return this.mailbox.filter(m => m.folder === folder);
    }

    client(): object {
        const subscription = {
            state: 'subscribed',
            on: (event: string, h: (ctx: { data: unknown }) => void) => {
                if (event === 'publication') {
                    this.handlers.push(h);
                }
            },
            off: () => undefined,
            subscribe: () => undefined,
            unsubscribe: () => undefined,
        };

        return { isConnected: signal(true), connect: () => Promise.resolve(), getOrCreateSubscription: () => subscription };
    }

    publish(data: unknown): void {
        for (const h of this.handlers) {
            h({ data });
        }
    }

    get subscribers(): number {
        return this.handlers.length;
    }
}

function changed(seq: number, changes: unknown[], counts: Record<string, unknown> = {}, mailboxUnseen = 2, origin = 'action'): unknown {
    return { type: 'mail.messages.changed', mailboxId: MAILBOX, origin, seq, at: '2026-11-09T01:40:00.000000+03:00', changes, counts, mailboxUnseen };
}

describe('mail.messages.changed -- two admin tabs on the same mailbox', () => {
    let server: FakeServer;
    let a: Client;
    let b: Client;

    beforeEach(async () => {
        server = new FakeServer();
        a = new Client(server);
        b = new Client(server);
        await Promise.resolve();
        await Promise.resolve();
        expect(server.subscribers).withContext('the subject: both tabs listen on the person\'s channel').toBe(2);
    });

    afterEach(() => {
        a.destroy();
        b.destroy();
    });

    it('a message read in one tab is read in both, with the folder count and the mailbox number, without a re-read', () => {
        // Tab A marks m1 read itself first, as the page does; the event then reaches both tabs.
        a.view = { ...a.view, messages: a.view.messages.map(m => m.id === 'm1' ? { ...m, seen: true } : m) };
        server.publish(changed(5, [{ id: 'm1', threadId: 't1', folder: 'INBOX', seen: true, flagged: false }],
            { INBOX: { total: 3, unseen: 1, serverTotal: 3, serverUnseen: 2 } }, 2));

        for (const tab of [a, b]) {
            expect(tab.row('m1')?.seen).toBeTrue();
            expect(tab.folder('INBOX')?.unseen).toBe(1);
            expect(tab.view.messages.length).toBe(3);
        }
        expect(b.view).toEqual(a.view);
    });

    it('a star set elsewhere shows in the row', () => {
        server.publish(changed(6, [{ id: 'm2', threadId: 't2', folder: 'INBOX', seen: false, flagged: true }]));

        expect(a.row('m2')?.flagged).toBeTrue();
        expect(b.row('m2')?.flagged).toBeTrue();
    });

    it('a change older than the one applied to its row is ignored', () => {
        server.publish(changed(9, [{ id: 'm1', threadId: 't1', folder: 'INBOX', seen: true, flagged: false }]));
        server.publish(changed(8, [{ id: 'm1', threadId: 't1', folder: 'INBOX', seen: false, flagged: false }]));

        expect(a.row('m1')?.seen).withContext('the older event came second and must not put the row back to unread').toBeTrue();
        expect(b.row('m1')?.seen).toBeTrue();
    });

    it('counts older than the last applied to their folder are ignored; the mailbox number likewise', () => {
        server.publish(changed(12, [], { INBOX: { total: 3, unseen: 0, serverTotal: 3, serverUnseen: 0 } }, 0, 'sync'));
        server.publish(changed(11, [], { INBOX: { total: 3, unseen: 2, serverTotal: 3, serverUnseen: 2 } }, 2));

        expect(b.folder('INBOX')?.unseen).toBe(0);
        expect(b.view.mailboxUnread[MAILBOX]).toBe(0);
    });

    it('a sync with no changes moves the counts only: the server\'s figures catch up', () => {
        const before = b.view.messages;
        server.publish(changed(20, [], { INBOX: { total: 3, unseen: 1, serverTotal: 3, serverUnseen: 1 } }, 1, 'sync'));

        expect(b.view.messages).toBe(before);
        expect(b.folder('INBOX')?.serverUnseen).toBe(1);
        expect(b.view.mailboxUnread[MAILBOX]).toBe(1);
    });

    it('a message moved out of the open folder leaves its list; one moved in is not placed from the event itself', () => {
        server.publish(changed(30, [
            { id: 'm3', threadId: 't3', folder: 'INBOX', movedTo: 'Archive', seen: true, flagged: false },
            { id: 'x9', threadId: 't9', folder: 'Archive', movedTo: 'INBOX', seen: true, flagged: false },
        ], {
            INBOX: { total: 3, unseen: 2, serverTotal: 3, serverUnseen: 2 },
            Archive: { total: 10, unseen: 0, serverTotal: 10, serverUnseen: 0 },
        }));

        expect(b.row('m3')).withContext('moved to Archive: no longer in the INBOX list').toBeUndefined();
        expect(b.row('x9')).withContext('moved in: the event has no subject or date, so the row waits for the list read, never a guess').toBeUndefined();
        expect(b.view.messages.map(m => m.id)).toEqual(['m1', 'm2']);
    });

    it('a delete is a move to Trash; a purge or a retired row is gone', () => {
        server.publish(changed(40, [{ id: 'm1', threadId: 't1', folder: 'INBOX', movedTo: 'Trash', seen: true, flagged: false }]));
        server.publish(changed(41, [{ id: 'm2', folder: 'INBOX', gone: true }]));

        expect(b.view.messages.map(m => m.id)).toEqual(['m3']);
        expect(a.view.messages.map(m => m.id)).toEqual(['m3']);
    });

    it('a message restored in one tab appears in the other tab open on its folder, with no reload by the person', fakeAsync(() => {
        expect(b.row('r1')).withContext('the subject: the restored message is not in the INBOX list yet').toBeUndefined();
        // Tab A restores r1 from Trash; the server moved it, and the event reaches both tabs.
        server.mailbox = server.mailbox.map(m => m.id === 'r1' ? { ...m, folder: 'INBOX' } : m);
        server.publish(changed(60, [{ id: 'r1', threadId: 't9', folder: 'Trash', movedTo: 'INBOX', seen: true, flagged: false }],
            { INBOX: { total: 4, unseen: 2, serverTotal: 4, serverUnseen: 2 }, Trash: { total: 0, unseen: 0, serverTotal: 0, serverUnseen: 0 } }));
        tick(300);

        expect(b.row('r1')).withContext('B shows the restored message').toBeDefined();
        expect(b.folder('INBOX')?.total).toBe(4);
        expect(b.reads).toBe(1);
    }));

    it('a bulk restore of several messages reads the open folder\'s list exactly once', fakeAsync(() => {
        const ids = ['r1', 'r2', 'r3'];
        server.mailbox = [...server.mailbox.filter(m => !ids.includes(m.id)), ...ids.map(id => ({ id, folder: 'INBOX', seen: true, flagged: false }))];
        // One event per request, and a sync may split a burst over chunks: here, one event and then a second chunk.
        server.publish(changed(70, ids.slice(0, 2).map(id => ({ id, threadId: id, folder: 'Trash', movedTo: 'INBOX', seen: true, flagged: false }))));
        tick(100);
        server.publish(changed(71, ids.slice(2).map(id => ({ id, threadId: id, folder: 'Trash', movedTo: 'INBOX', seen: true, flagged: false }))));
        tick(300);

        expect(b.reads).withContext('one read for the burst, not one per message or per chunk').toBe(1);
        expect(ids.every(id => b.row(id) !== undefined)).toBeTrue();
    }));

    it('an event for another mailbox moves only its number in the switcher', () => {
        const before = b.view.messages;
        server.publish({ ...(changed(50, [{ id: 'm1', threadId: 't1', folder: 'INBOX', seen: true, flagged: false }]) as object), mailboxId: 'mb-2', mailboxUnseen: 7 });

        expect(b.view.messages).toBe(before);
        expect(b.view.mailboxUnread['mb-2']).toBe(7);
        expect(b.view.mailboxUnread[MAILBOX]).toBe(2);
    });
});

describe('mail.messages.changed -- read strictly', () => {
    it('reads the contract\'s shape', () => {
        const read = readMessagesChanged(changed(1, [
            { id: 'a', threadId: 't', folder: 'INBOX', seen: true, flagged: false },
            { id: 'b', threadId: 't', folder: 'INBOX', movedTo: 'Trash', seen: true, flagged: false },
            { id: 'c', folder: 'Trash', gone: true },
        ], { INBOX: { total: 1, unseen: 0, serverTotal: null, serverUnseen: null } }, 0));

        expect(read?.changes.length).toBe(3);
        expect(read?.counts['INBOX']).toEqual({ total: 1, unseen: 0, serverTotal: null, serverUnseen: null });
    });

    it('is no event at all when any part is not the contract\'s', () => {
        const bad: unknown[] = [
            { ...(changed(1, []) as object), seq: '1' },
            { ...(changed(1, []) as object), origin: 'guess' },
            changed(1, [{ id: 'a', folder: 'INBOX', seen: 'yes', flagged: false }]),
            changed(1, [{ id: 'a', folder: 'INBOX', movedTo: 5, seen: true, flagged: false }]),
            changed(1, [], { INBOX: { total: -1, unseen: 0 } }),
            { ...(changed(1, []) as object), changes: null },
        ];
        for (const raw of bad) {
            expect(readMessagesChanged(raw)).withContext(JSON.stringify(raw)).toBeNull();
        }
    });
});
