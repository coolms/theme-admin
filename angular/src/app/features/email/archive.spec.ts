import { HttpErrorResponse } from '@angular/common/http';
import { type ToastInput } from '@coolms/ui-angular';
import { of, throwError, type Observable } from 'rxjs';
import { ArchiveFlow, archiveReasonText, type ArchivedMessage, type ArchivePorts } from './archive';
import { type EmailArchiveResultDto, type EmailBulkResultDto } from './email.types';

const cannot = (reason: string): HttpErrorResponse => new HttpErrorResponse({
    status: 422,
    error: { type: '/errors/email/cannot-archive', title: 'This message cannot be archived here', status: 422, reason },
});
const notCompleted = (): HttpErrorResponse => new HttpErrorResponse({ status: 502, error: { detail: 'not completed' } });

/** The page as the flow sees it, recording what it was asked. */
function page(answers: { one?: () => Observable<EmailArchiveResultDto>; many?: (ids: readonly string[]) => Observable<EmailBulkResultDto> } = {}) {
    const seen = {
        singles: [] as string[],
        bulks: [] as (readonly string[])[],
        shown: [] as { input: ToastInput; duration: number | undefined }[],
        successes: [] as string[],
        errors: [] as string[],
        archived: [] as (readonly ArchivedMessage[])[],
        taken: [] as (readonly string[])[],
        putBack: [] as (readonly string[])[],
    };
    const ports: ArchivePorts = {
        archiveMessage: id => {
            seen.singles.push(id);
            return answers.one ? answers.one() : of({ id, folder: 'Archive' });
        },
        archiveMessages: ids => {
            seen.bulks.push(ids);
            return answers.many ? answers.many(ids) : of({ results: ids.map(id => ({ id, outcome: 'archived' as const, folder: 'Archive' })) });
        },
        toast: {
            show: (input, duration) => {
                seen.shown.push({ input, duration });
                return 1;
            },
            success: message => void seen.successes.push(message),
            error: message => void seen.errors.push(message),
        },
        busy: () => undefined,
        take: ids => void seen.taken.push(ids),
        putBack: ids => void seen.putBack.push(ids),
        archived: done => void seen.archived.push(done),
    };
    return { flow: new ArchiveFlow(ports), seen };
}

describe('Archive: the server archives, the page says what it answered', () => {
    it('one message: its own call, no body asked of the page, and the folder the server answered', () => {
        const { flow, seen } = page({ one: () => of({ id: 'a', folder: '[Gmail]/All Mail' }) });
        flow.archive(['a']);
        expect(seen.singles).toEqual(['a']);
        expect(seen.bulks).toEqual([]);
        expect(seen.archived).toEqual([[{ id: 'a', folder: '[Gmail]/All Mail' }]]);
        expect(seen.successes).toEqual(['Archived 1 message.']);
    });

    it('a 422 says why in the page\'s words for its reason, changes nothing, and offers no Retry', () => {
        const { flow, seen } = page({ one: () => throwError(() => cannot('no-archive-folder')) });
        flow.archive(['a']);
        expect(seen.archived).toEqual([]);
        expect(seen.errors).toEqual(["This mailbox's server has no folder marked as its archive."]);
        expect(seen.shown).toEqual([]);
    });

    it('takes the rows out at once; a 422 or a 502 puts them back, a bulk refusal only the refused ones', () => {
        const refused = page({ one: () => throwError(() => cannot('no-archive-folder')) });
        refused.flow.archive(['a']);
        expect(refused.seen.taken).toEqual([['a']]);
        expect(refused.seen.putBack).toEqual([['a']]);
        const failed = page({ one: () => throwError(() => notCompleted()) });
        failed.flow.archive(['a']);
        expect(failed.seen.putBack).toEqual([['a']]);
        const some = page({ many: () => of({ results: [
            { id: 'a', outcome: 'archived', folder: 'Archive' }, { id: 'b', outcome: 'refused', folder: 'INBOX', reason: 'no-archive-folder' },
        ] }) });
        some.flow.archive(['a', 'b']);
        expect(some.seen.taken).toEqual([['a', 'b']]);
        expect(some.seen.putBack).toEqual([['b']]);
    });

    it('a sentence for each reason the server names, and one for a reason it may add', () => {
        const sentences: Record<string, string> = {
            'no-archive-folder':        "This mailbox's server has no folder marked as its archive.",
            'not-archivable-from-here': 'Messages in this folder cannot be archived.',
            'not-in-inbox':             'On this server only messages in the Inbox can be archived.',
            'all-mail-hidden':          'This Gmail account does not show All Mail to mail apps, so archived mail would be in no folder here.',
            'folders-not-listed':       "This mailbox's folders have not been read from the server yet. Try again after it syncs.",
            'retired-copy':             'This copy is out of date. Reload the folder.',
            'not-on-server':            'The mail server no longer has this message.',
            'not-found':                'This message no longer exists.',
            'failed':                   'The mail server did not complete the archive.',
        };
        for (const [reason, sentence] of Object.entries(sentences)) {
            const { flow, seen } = page({ one: () => throwError(() => cannot(reason)) });
            flow.archive(['a']);
            expect(seen.errors).withContext(reason).toEqual([sentence]);
        }
        const { flow, seen } = page({ one: () => throwError(() => cannot('some-new-reason')) });
        flow.archive(['a']);
        expect(seen.errors).withContext('a reason not listed').toEqual(['The mail server did not archive it.']);
        expect(archiveReasonText(null)).toBe('The mail server did not archive it.');
    });

    it('a 502 says the mail server did not complete it and offers Retry, which is never pressed by itself', () => {
        let calls = 0;
        const { flow, seen } = page({ one: () => (++calls === 1 ? throwError(() => notCompleted()) : of({ id: 'a', folder: 'Archive' })) });
        flow.archive(['a']);
        expect(seen.archived).toEqual([]);
        expect(seen.errors).toEqual([]);
        expect(seen.shown.length).toBe(1);
        expect(seen.shown[0].input.type).toBe('error');
        expect(seen.shown[0].input.message).toBe('The mail server did not complete the archive. Nothing was changed.');
        expect(seen.shown[0].input.action?.label).toBe('Retry');
        expect(seen.singles).withContext('not retried by itself').toEqual(['a']);

        seen.shown[0].input.action?.run();
        expect(seen.singles).toEqual(['a', 'a']);
        expect(seen.archived).toEqual([[{ id: 'a', folder: 'Archive' }]]);
    });

    it('several: one bulk call; the archived leave, the refused stay with one summary of how many and why', () => {
        const { flow, seen } = page({ many: () => of({ results: [
            { id: 'a', outcome: 'archived', folder: 'Archive' },
            { id: 'b', outcome: 'refused', folder: 'Drafts', reason: 'not-archivable-from-here' },
            { id: 'c', outcome: 'archived', folder: 'Archive' },
            { id: 'd', outcome: 'refused', folder: 'Drafts', reason: 'not-archivable-from-here' },
        ] }) });
        flow.archive(['a', 'b', 'c', 'd']);
        expect(seen.singles).toEqual([]);
        expect(seen.bulks).toEqual([['a', 'b', 'c', 'd']]);
        expect(seen.archived).toEqual([[{ id: 'a', folder: 'Archive' }, { id: 'c', folder: 'Archive' }]]);
        expect(seen.successes).withContext('one notice: the refusal, which counts the archived').toEqual([]);
        expect(seen.errors).toEqual(['2 messages of 4 not archived. Messages in this folder cannot be archived.']);
    });

    it('several, none archivable: nothing leaves and the summary says none were', () => {
        const { flow, seen } = page({ many: ids => of({ results: ids.map(id => ({ id, outcome: 'refused' as const, folder: 'INBOX', reason: 'no-archive-folder' })) }) });
        flow.archive(['a', 'b']);
        expect(seen.archived).toEqual([]);
        expect(seen.successes).toEqual([]);
        expect(seen.errors).toEqual(["None of the 2 messages were archived. This mailbox's server has no folder marked as its archive."]);
    });

    it('several the server failed to write: Retry for exactly those, never by itself', () => {
        let calls = 0;
        const { flow, seen } = page({ many: ids => of({ results: ++calls === 1
            ? [{ id: 'a', outcome: 'archived' as const, folder: 'Archive' }, { id: 'b', outcome: 'refused' as const, folder: 'INBOX', reason: 'failed' }, { id: 'c', outcome: 'refused' as const, folder: 'INBOX', reason: 'failed' }]
            : ids.map(id => ({ id, outcome: 'archived' as const, folder: 'Archive' })) }) });
        flow.archive(['a', 'b', 'c']);
        expect(seen.archived).toEqual([[{ id: 'a', folder: 'Archive' }]]);
        expect(seen.shown.length).toBe(1);
        expect(seen.shown[0].input.message).toBe('The mail server did not complete the archive of 2 messages. Nothing was changed for them.');
        expect(seen.bulks.length).toBe(1);
        seen.shown[0].input.action?.run();
        expect(seen.bulks[1]).toEqual(['b', 'c']);
    });

    it('a bulk call that fails as a whole refuses its ids as not completed, with Retry', () => {
        const { flow, seen } = page({ many: () => throwError(() => notCompleted()) });
        flow.archive(['a', 'b']);
        expect(seen.archived).toEqual([]);
        expect(seen.shown[0].input.action?.label).toBe('Retry');
    });
});
