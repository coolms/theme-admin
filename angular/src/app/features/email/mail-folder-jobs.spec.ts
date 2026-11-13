import { HttpErrorResponse } from '@angular/common/http';
import { discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { type Observable, Subject, of, throwError } from 'rxjs';

import { type FolderJobDto } from './email.types';
import { type MailFolderJobEvent } from './mail-folder-actions';
import { MailFolderJobs, POLL_FIRST_MS, POLL_MAX_MS } from './mail-folder-jobs';

const job = (over: Partial<FolderJobDto> = {}): FolderJobDto => ({
    jobId: 'j1', mailboxId: 'mb1', folder: 'Projects', action: 'mark-read', outcome: 'running', count: 0, reason: null,
    ...over,
});

const heard = (over: Partial<FolderJobDto>): MailFolderJobEvent =>
    ({ ...job(over), type: 'mail.folders.job', outcome: over.outcome === 'failed' ? 'failed' : 'done' });

/** Mark all as read as a job: busy from the 202 to its end, told in realtime, or read while realtime is down. */
describe('MailFolderJobs', () => {
    let started: Array<[string, string]>;
    let reads: string[];
    let readAnswers: Array<() => Observable<FolderJobDto>>;
    let realtime: boolean;
    let ended: Array<[FolderJobDto, boolean]>;
    let lost: FolderJobDto[];
    let refused: unknown[];
    let startAnswer: () => Observable<FolderJobDto>;
    let reconnects: Subject<void>;

    function jobs(): MailFolderJobs {
        started = [];
        reads = [];
        ended = [];
        lost = [];
        refused = [];
        reconnects = new Subject<void>();
        return new MailFolderJobs({
            start: (mailboxId, folder) => {
                started.push([mailboxId, folder]);
                return startAnswer();
            },
            read: (_mailboxId, jobId) => {
                reads.push(jobId);
                return (readAnswers.shift() ?? ((): Observable<FolderJobDto> => of(job())))();
            },
            realtime: () => realtime,
            reconnects: () => reconnects,
            ended: (j, mine) => ended.push([j, mine]),
            lost: j => lost.push(j),
            refused: err => refused.push(err),
        });
    }

    beforeEach(() => {
        readAnswers = [];
        realtime = true;
        startAnswer = () => of(job());
    });

    it('posts, shows the folder busy, and ends on mail.folders.job done: nothing more is read', fakeAsync(() => {
        const j = jobs();
        j.markRead('mb1', 'Projects');

        expect(started).toEqual([['mb1', 'Projects']]);
        expect(j.busyIn('mb1', 'Projects')).toBe('mark-read');
        expect(j.busyIn('mb2', 'Projects')).withContext('another mailbox').toBeNull();

        j.heard(heard({ outcome: 'done', count: 12 }));

        expect(j.busyIn('mb1', 'Projects')).toBeNull();
        expect(ended.length).toBe(1);
        expect(ended[0][0].outcome).toBe('done');
        expect(ended[0][1]).withContext('started here').toBeTrue();
        tick(POLL_MAX_MS * 4);
        expect(reads).toEqual([]);
    }));

    it('ends on mail.folders.job failed, with its reason, for each reason', fakeAsync(() => {
        for (const reason of ['server-failed', 'folder-not-found', 'renumbered']) {
            const j = jobs();
            j.markRead('mb1', 'Projects');
            j.heard(heard({ outcome: 'failed', reason }));

            expect(j.busyIn('mb1', 'Projects')).withContext(reason).toBeNull();
            expect(ended.map(([e, mine]) => [e.outcome, e.reason, mine])).withContext(reason)
                .toEqual([['failed', reason, true]]);
        }
        flush();
    }));

    it('a job someone else started is told as theirs', fakeAsync(() => {
        const j = jobs();
        j.heard(heard({ jobId: 'other', outcome: 'failed', reason: 'server-failed' }));

        expect(ended[0][1]).toBeFalse();
    }));

    it('without realtime, reads the job with a growing wait, and stops at its end', fakeAsync(() => {
        realtime = false;
        readAnswers = [() => of(job()), () => of(job()), () => of(job({ outcome: 'done', count: 5 }))];
        const j = jobs();
        j.markRead('mb1', 'Projects');

        tick(POLL_FIRST_MS - 1);
        expect(reads.length).withContext('not before the first wait').toBe(0);
        tick(1);
        expect(reads.length).toBe(1);
        tick(POLL_FIRST_MS * 2 - 1);
        expect(reads.length).withContext('the second wait is twice the first').toBe(1);
        tick(1);
        expect(reads.length).toBe(2);
        expect(j.busyIn('mb1', 'Projects')).toBe('mark-read');
        tick(POLL_FIRST_MS * 4);
        expect(reads.length).toBe(3);
        expect(j.busyIn('mb1', 'Projects')).toBeNull();
        expect(ended.map(([e]) => [e.outcome, e.count])).toEqual([['done', 5]]);

        tick(POLL_MAX_MS * 4);
        expect(reads.length).withContext('nothing read after the end').toBe(3);
    }));

    it('with realtime up, the job is read only every POLL_MAX_MS; once realtime is down, at each wait', fakeAsync(() => {
        const j = jobs();
        j.markRead('mb1', 'Projects');
        tick(POLL_MAX_MS - 1);
        expect(reads).withContext('realtime up: no read before the longest wait').toEqual([]);
        tick(1);
        expect(reads.length).toBe(1);

        realtime = false;
        tick(POLL_MAX_MS);
        expect(reads.length).withContext('read within the longest wait once realtime is down').toBe(2);
        j.stop();
        discardPeriodicTasks();
    }));

    it('realtime connected but the end event lost: the slow read ends the job', fakeAsync(() => {
        readAnswers = [() => of(job({ outcome: 'done', count: 4 }))];
        const j = jobs();
        j.markRead('mb1', 'Projects');
        tick(POLL_MAX_MS);

        expect(reads).toEqual(['j1']);
        expect(j.busyIn('mb1', 'Projects')).toBeNull();
        expect(ended.map(([e, mine]) => [e.outcome, mine])).toEqual([['done', true]]);
        tick(POLL_MAX_MS * 4);
        expect(reads.length).toBe(1);
    }));

    it('a reconnect reads each followed job once', fakeAsync(() => {
        const j = jobs();
        j.markRead('mb1', 'Projects');
        tick(POLL_FIRST_MS);
        expect(reads).toEqual([]);

        reconnects.next();
        expect(reads).withContext('one read on the reconnect').toEqual(['j1']);
        expect(j.busyIn('mb1', 'Projects')).withContext('still running').toBe('mark-read');

        readAnswers = [() => of(job({ outcome: 'failed', reason: 'server-failed' }))];
        reconnects.next();
        expect(reads.length).toBe(2);
        expect(j.busyIn('mb1', 'Projects')).toBeNull();
        expect(ended[0][0].reason).toBe('server-failed');
        reconnects.next();
        expect(reads.length).withContext('nothing followed: nothing read').toBe(2);
        flush();
    }));

    it('an end heard before the 202 answers ends the job at once: done, not busy', fakeAsync(() => {
        const answer = new Subject<FolderJobDto>();
        startAnswer = () => answer;
        const j = jobs();
        j.markRead('mb1', 'Projects');
        j.heard(heard({ outcome: 'done', count: 2 }));
        answer.next(job());

        expect(j.busyIn('mb1', 'Projects')).toBeNull();
        expect(ended.map(([e, mine]) => [e.outcome, mine])).toEqual([['done', false], ['done', true]]);
        tick(POLL_MAX_MS * 4);
        expect(reads).withContext('nothing followed').toEqual([]);
    }));

    it('a failure heard before the 202 answers ends the job as this page\'s, with its reason', fakeAsync(() => {
        const answer = new Subject<FolderJobDto>();
        startAnswer = () => answer;
        const j = jobs();
        j.markRead('mb1', 'Projects');
        j.heard(heard({ outcome: 'failed', reason: 'renumbered' }));
        answer.next(job());

        expect(j.busyIn('mb1', 'Projects')).toBeNull();
        expect(ended[1][1]).withContext('mine: its failure is said').toBeTrue();
        expect(ended[1][0].outcome).toBe('failed');
        expect(ended[1][0].reason).toBe('renumbered');
        flush();
    }));

    it('a job the server no longer keeps is let go, and the folders are read again', fakeAsync(() => {
        realtime = false;
        readAnswers = [() => throwError(() => new HttpErrorResponse({ status: 404 }))];
        const j = jobs();
        j.markRead('mb1', 'Projects');
        tick(POLL_FIRST_MS);

        expect(lost.length).toBe(1);
        expect(j.busyIn('mb1', 'Projects')).toBeNull();
        tick(POLL_MAX_MS * 2);
        expect(reads.length).toBe(1);
    }));

    it('a repeated click is answered with the same job, followed once', fakeAsync(() => {
        realtime = false;
        const j = jobs();
        j.markRead('mb1', 'Projects');
        j.markRead('mb1', 'Projects');

        expect(started.length).toBe(2);
        expect(j.running().size).toBe(1);
        tick(POLL_FIRST_MS);
        expect(reads).withContext('one job, one read').toEqual(['j1']);
        j.stop();
        flush();
    }));

    it('a job the server answers already ended is not busy at all', fakeAsync(() => {
        startAnswer = () => of(job({ outcome: 'done', count: 0 }));
        const j = jobs();
        j.markRead('mb1', 'Projects');

        expect(j.busyIn('mb1', 'Projects')).toBeNull();
        expect(ended.length).toBe(1);
    }));

    it('a refusal to start is handed to the page, and nothing is busy', fakeAsync(() => {
        const busy = new HttpErrorResponse({ status: 409, error: { type: '/errors/email/folder-busy', action: 'empty' } });
        startAnswer = () => throwError(() => busy);
        const j = jobs();
        j.markRead('mb1', 'Projects');

        expect(refused).toEqual([busy]);
        expect(j.busyIn('mb1', 'Projects')).toBeNull();
    }));
});
