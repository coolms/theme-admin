import { HttpErrorResponse } from '@angular/common/http';
import { type ToastInput } from '@coolms/ui-angular';
import { of, throwError, type Observable } from 'rxjs';
import { ArchiveFlow, archiveRefusedText, type ArchivedMessage, type ArchivePorts } from './archive';
import { type EmailArchiveResultDto, type EmailBulkResultDto } from './email.types';

const cannot = (reason: string, detail: string | null = "This mailbox's server has no folder marked as its archive."): HttpErrorResponse => new HttpErrorResponse({
    status: 422,
    error: { type: '/errors/email/cannot-archive', title: 'This message cannot be archived here', status: 422, reason, ...(detail === null ? {} : { detail }) },
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

    it('a 422 says the server\'s detail as given, changes nothing, and offers no Retry', () => {
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
            { id: 'a', outcome: 'archived', folder: 'Archive' }, { id: 'b', outcome: 'refused', folder: 'INBOX', reason: 'no-archive-folder', reasonText: "This mailbox's server has no folder marked as its archive." },
        ] }) });
        some.flow.archive(['a', 'b']);
        expect(some.seen.taken).toEqual([['a', 'b']]);
        expect(some.seen.putBack).toEqual([['b']]);
    });

    it('a refusal says the server\'s detail as given, never words for its reason; without one, Not available right now', () => {
        const said = page({ one: () => throwError(() => cannot('some-new-reason', 'Said by the server.')) });
        said.flow.archive(['a']);
        expect(said.seen.errors).toEqual(['Said by the server.']);
        const none = page({ one: () => throwError(() => cannot('not-in-inbox', null)) });
        none.flow.archive(['a']);
        expect(none.seen.errors).toEqual(['Not available right now']);
    });

    it('a 502 says the generic sentence, never its text, and offers Retry, which is never pressed by itself', () => {
        let calls = 0;
        const { flow, seen } = page({ one: () => (++calls === 1 ? throwError(() => notCompleted()) : of({ id: 'a', folder: 'Archive' })) });
        flow.archive(['a']);
        expect(seen.archived).toEqual([]);
        expect(seen.errors).toEqual([]);
        expect(seen.shown.length).toBe(1);
        expect(seen.shown[0].input.type).toBe('error');
        expect(seen.shown[0].input.message).toBe('Something went wrong. Try again.');
        expect(seen.shown[0].input.action?.label).toBe('Retry');
        expect(seen.singles).withContext('not retried by itself').toEqual(['a']);

        seen.shown[0].input.action?.run();
        expect(seen.singles).toEqual(['a', 'a']);
        expect(seen.archived).toEqual([[{ id: 'a', folder: 'Archive' }]]);
    });

    it('several: one bulk call; the archived leave, the refused stay with one summary of how many and why', () => {
        const { flow, seen } = page({ many: () => of({ results: [
            { id: 'a', outcome: 'archived', folder: 'Archive' },
            { id: 'b', outcome: 'refused', folder: 'Drafts', reason: 'not-archivable-from-here', reasonText: 'Messages in this folder cannot be archived.' },
            { id: 'c', outcome: 'archived', folder: 'Archive' },
            { id: 'd', outcome: 'refused', folder: 'Drafts', reason: 'not-archivable-from-here', reasonText: 'Messages in this folder cannot be archived.' },
        ] }) });
        flow.archive(['a', 'b', 'c', 'd']);
        expect(seen.singles).toEqual([]);
        expect(seen.bulks).toEqual([['a', 'b', 'c', 'd']]);
        expect(seen.archived).toEqual([[{ id: 'a', folder: 'Archive' }, { id: 'c', folder: 'Archive' }]]);
        expect(seen.successes).withContext('one notice: the refusal, which counts the archived').toEqual([]);
        expect(seen.errors).toEqual(['2 messages of 4 not archived. Messages in this folder cannot be archived.']);
    });

    it('several, none archivable: nothing leaves and the summary says none were', () => {
        const { flow, seen } = page({ many: ids => of({ results: ids.map(id => ({ id, outcome: 'refused' as const, folder: 'INBOX', reason: 'no-archive-folder', reasonText: "This mailbox's server has no folder marked as its archive." })) }) });
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
        expect(seen.shown[0].input.message).toBe('Something went wrong. Try again.');
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

describe('archiveRefusedText: the refused of a bulk archive in the server\'s sentence', () => {
    it('says how many and the server\'s sentence as given', () => {
        expect(archiveRefusedText([{ id: 'a', outcome: 'refused', reason: 'all-mail-hidden', reasonText: 'Said by the server.' }], 3))
            .toBe('1 message of 3 not archived. Said by the server.');
        // From a server that gives no sentence: the one generic sentence, never words for the code.
        expect(archiveRefusedText([{ id: 'a', outcome: 'refused', reason: 'all-mail-hidden' }], 3))
            .toBe('1 message of 3 not archived. Not available right now');
    });
});
