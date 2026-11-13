import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type Observable, type Subscription, catchError, map, of, switchMap, timer } from 'rxjs';

import { type FolderJobAction, type FolderJobDto } from './email.types';
import { type MailFolderJobEvent } from './mail-folder-actions';

/** The first read of a running job without realtime, and the longest wait between two: each wait doubles. */
export const POLL_FIRST_MS = 2000;
export const POLL_MAX_MS = 30000;
/** How long, and how many, ends heard for jobs not (yet) followed are kept: one may be heard before its 202. */
export const HEARD_KEEP_MS = 5 * 60000;
const HEARD_KEEP_MAX = 20;

/** What the jobs need from the page. */
export interface FolderJobsDeps {
    /** Starts Mark all as read on a folder: the job, or the one already running for it. */
    readonly start: (mailboxId: string, folder: string) => Observable<FolderJobDto>;
    /** Starts Empty on a folder with the preview's numbers: the job, or the one already running for it. */
    readonly empty: (mailboxId: string, folder: string, uidCeiling: number, uidValidity: number) => Observable<FolderJobDto>;
    /** Reads a job. */
    readonly read: (mailboxId: string, jobId: string) => Observable<FolderJobDto>;
    /** Whether realtime is connected now: its event tells a job's end, and the job is read only now and then. */
    readonly realtime: () => boolean;
    /** Each time realtime connects again: an end told while it was down is lost, so each followed job is read once. */
    readonly reconnects: () => Observable<unknown>;
    /** A job ended: `mine` when this page started it (only then is a failure said). */
    readonly ended: (job: FolderJobDto, mine: boolean) => void;
    /** A job this page started can no longer be read (the server keeps jobs a day): the folders are read again. */
    readonly lost: (job: FolderJobDto) => void;
    /** The server refused to start the job. */
    readonly refused: (err: unknown, mailboxId: string, folder: string, action: FolderJobAction) => void;
}

const keyOf = (mailboxId: string, folder: string): string => `${mailboxId}\n${folder}`;

/** A job read: the answer, a wait (realtime is up and a read is not due, or the read failed), or gone (404). */
type ReadAnswer = FolderJobDto | 'wait' | 'gone';

/**
 * The folder jobs this page started (Mark all as read, Empty), from the click to their end. A job's folder is busy with it
 * from the server's 202 until its end is known:
 *  - mail.folders.job tells it. One heard before its 202 answered (a small folder's job ends that fast) is kept a few
 *    minutes, and the 202 of that job then ends it at once with the outcome heard.
 *  - The job is read at POLL_FIRST_MS, then at twice the wait each time, up to POLL_MAX_MS: at every tick while
 *    realtime is down, and at least every POLL_MAX_MS while it is up, so a lost end event never leaves a row busy.
 *  - Each time realtime connects again, every followed job is read once.
 * Asked again while it runs, the server answers the same job, which is followed once.
 */
export class MailFolderJobs {
    /** The running jobs this page started, by mailbox and folder. */
    readonly running = signal<ReadonlyMap<string, FolderJobDto>>(new Map());
    private readonly polls = new Map<string, Subscription>();
    /** When each followed job was last read (or followed). */
    private readonly lastRead = new Map<string, number>();
    /** Ends heard for jobs not followed, by jobId: one may be this page's, heard before its 202. */
    private readonly heardEnds = new Map<string, { readonly job: FolderJobDto; readonly at: number }>();
    private reconnecting: Subscription | null = null;

    constructor(private readonly deps: FolderJobsDeps) {}

    /** The job this page knows runs on the folder, or null. */
    busyIn(mailboxId: string | null, folder: string): FolderJobAction | null {
        return mailboxId === null ? null : this.running().get(keyOf(mailboxId, folder))?.action ?? null;
    }

    markRead(mailboxId: string, folder: string): void {
        this.begin(this.deps.start(mailboxId, folder), mailboxId, folder, 'mark-read');
    }

    /** Empty, with the numbers of the preview the person confirmed. */
    empty(mailboxId: string, folder: string, uidCeiling: number, uidValidity: number): void {
        this.begin(this.deps.empty(mailboxId, folder, uidCeiling, uidValidity), mailboxId, folder, 'empty');
    }

    private begin(call: Observable<FolderJobDto>, mailboxId: string, folder: string, action: FolderJobAction): void {
        call.subscribe({
            next: job => this.follow(job),
            error: (err: unknown) => this.deps.refused(err, mailboxId, folder, action),
        });
    }

    /**
     * A job's end heard in realtime: one this page follows ends; any other is told as someone else's, and kept in
     * case its 202 has not answered yet.
     */
    heard(evt: MailFolderJobEvent): void {
        const { type: _type, ...job } = evt;
        if (this.follows(job.jobId)) {
            this.end(job, true);
            return;
        }
        this.keepHeard(job);
        this.end(job, false);
    }

    /** Stops every poll and the watch on reconnects; nothing more is told. */
    stop(): void {
        this.polls.forEach(sub => sub.unsubscribe());
        this.polls.clear();
        this.reconnecting?.unsubscribe();
        this.reconnecting = null;
    }

    private follows(jobId: string): boolean {
        return [...this.running().values()].some(j => j.jobId === jobId);
    }

    private follow(job: FolderJobDto): void {
        const heard = this.takeHeard(job.jobId);
        if (heard !== null) {
            this.end(heard, true);
            return;
        }
        if (job.outcome !== 'running') {
            this.end(job, true);
            return;
        }
        const next = new Map(this.running());
        next.set(keyOf(job.mailboxId, job.folder), job);
        this.running.set(next);
        if (!this.polls.has(job.jobId)) {
            this.lastRead.set(job.jobId, Date.now());
            this.poll(job, POLL_FIRST_MS);
        }
        this.reconnecting ??= this.deps.reconnects().subscribe(() => this.readAll());
    }

    private end(job: FolderJobDto, mine: boolean): void {
        this.polls.get(job.jobId)?.unsubscribe();
        this.polls.delete(job.jobId);
        this.lastRead.delete(job.jobId);
        this.forget(job);
        this.deps.ended(job, mine);
    }

    private forget(job: FolderJobDto): void {
        const key = keyOf(job.mailboxId, job.folder);
        if (this.running().get(key)?.jobId === job.jobId) {
            const next = new Map(this.running());
            next.delete(key);
            this.running.set(next);
        }
        if (this.running().size === 0) {
            this.reconnecting?.unsubscribe();
            this.reconnecting = null;
        }
    }

    private keepHeard(job: FolderJobDto): void {
        const now = Date.now();
        this.heardEnds.forEach((kept, id) => {
            if (now - kept.at > HEARD_KEEP_MS) {
                this.heardEnds.delete(id);
            }
        });
        this.heardEnds.set(job.jobId, { job, at: now });
        while (this.heardEnds.size > HEARD_KEEP_MAX) {
            const oldest = this.heardEnds.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.heardEnds.delete(oldest);
        }
    }

    /** The end heard for this job while it was not followed, still fresh; taken, so it is used once. */
    private takeHeard(jobId: string): FolderJobDto | null {
        const kept = this.heardEnds.get(jobId);
        this.heardEnds.delete(jobId);
        return kept !== undefined && Date.now() - kept.at <= HEARD_KEEP_MS ? kept.job : null;
    }

    /** Reads a job; a failed read is a wait, a 404 is gone. */
    private read(job: FolderJobDto): Observable<ReadAnswer> {
        this.lastRead.set(job.jobId, Date.now());
        return this.deps.read(job.mailboxId, job.jobId).pipe(
            map((answer): ReadAnswer => answer),
            catchError((err: unknown) => of<ReadAnswer>(err instanceof HttpErrorResponse && err.status === 404 ? 'gone' : 'wait')),
        );
    }

    /** What a read said, applied: true when the job is no longer followed. */
    private apply(job: FolderJobDto, answer: ReadAnswer): boolean {
        if (!this.follows(job.jobId)) {
            return true;
        }
        if (answer === 'gone') {
            this.polls.get(job.jobId)?.unsubscribe();
            this.polls.delete(job.jobId);
            this.lastRead.delete(job.jobId);
            this.forget(job);
            this.deps.lost(job);
            return true;
        }
        if (answer !== 'wait' && answer.outcome !== 'running') {
            this.end(answer, true);
            return true;
        }
        return false;
    }

    /** Realtime connected again: every followed job is read once, its waits going on as they were. */
    private readAll(): void {
        for (const job of [...this.running().values()]) {
            this.read(job).subscribe(answer => this.apply(job, answer));
        }
    }

    /**
     * One wait, then the job read -- while realtime is down, or when POLL_MAX_MS have passed since its last read --
     * then the next wait, twice as long.
     */
    private poll(job: FolderJobDto, wait: number): void {
        const sub = timer(wait).pipe(
            switchMap(() => (this.deps.realtime() && Date.now() - (this.lastRead.get(job.jobId) ?? 0) < POLL_MAX_MS
                ? of<ReadAnswer>('wait')
                : this.read(job))),
        ).subscribe(answer => {
            this.polls.delete(job.jobId);
            if (!this.apply(job, answer)) {
                this.poll(job, Math.min(wait * 2, POLL_MAX_MS));
            }
        });
        // A timer that has already fired synchronously (a test scheduler) leaves nothing to keep.
        if (!sub.closed) {
            this.polls.set(job.jobId, sub);
        }
    }
}
