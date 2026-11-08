import { EnvironmentInjector, createEnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CentrifugoClientService } from '@coolms/ui-angular';
import { EmailLiveEventsService } from './email-live-events.service';
import { type EmailFolderDto, type EmailMessageDto } from './email.types';
import { type MailView, MailSeqMarks, applyMessagesChanged, readMessagesChanged } from './mail-messages-changed';

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

/** One admin tab: the realtime service as the page uses it, its own view of the open INBOX, and its own marks. */
class Client {
    view: MailView;
    readonly marks = new MailSeqMarks();
    private readonly injector: EnvironmentInjector;

    constructor(server: FakeServer) {
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
                this.view = applyMessagesChanged(this.view, evt, this.marks);
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
        this.injector.destroy();
    }
}

/** The realtime server: every publication on the person's channel reaches every client subscribed to it. */
class FakeServer {
    private readonly handlers: ((ctx: { data: unknown }) => void)[] = [];

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

    it('a message moved out of the open folder leaves its list; one moved in is left to the next read', () => {
        server.publish(changed(30, [
            { id: 'm3', threadId: 't3', folder: 'INBOX', movedTo: 'Archive', seen: true, flagged: false },
            { id: 'x9', threadId: 't9', folder: 'Archive', movedTo: 'INBOX', seen: true, flagged: false },
        ], {
            INBOX: { total: 3, unseen: 2, serverTotal: 3, serverUnseen: 2 },
            Archive: { total: 10, unseen: 0, serverTotal: 10, serverUnseen: 0 },
        }));

        expect(b.row('m3')).withContext('moved to Archive: no longer in the INBOX list').toBeUndefined();
        expect(b.row('x9')).withContext('moved in: its subject and date are not in the event, so it is not guessed').toBeUndefined();
        expect(b.view.messages.map(m => m.id)).toEqual(['m1', 'm2']);
    });

    it('a delete is a move to Trash; a purge or a retired row is gone', () => {
        server.publish(changed(40, [{ id: 'm1', threadId: 't1', folder: 'INBOX', movedTo: 'Trash', seen: true, flagged: false }]));
        server.publish(changed(41, [{ id: 'm2', folder: 'INBOX', gone: true }]));

        expect(b.view.messages.map(m => m.id)).toEqual(['m3']);
        expect(a.view.messages.map(m => m.id)).toEqual(['m3']);
    });

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
