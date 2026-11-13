import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type Observable, type Subscription, catchError, map, of, switchMap, timer } from 'rxjs';

import { type FolderJobAction, type FolderJobDto } from './email.types';
import { type MailFolderJobEvent } from './mail-folder-actions';

/** The first read of a running job without realtime, and the longest wait between two: each wait doubles. */
export const POLL_FIRST_MS = 2000;
export const POLL_MAX_MS = 30000;

/** What the jobs need from the page. */
export interface FolderJobsDeps {
    /** Starts Mark all as read on a folder: the job, or the one already running for it. */
    readonly start: (mailboxId: string, folder: string) => Observable<FolderJobDto>;
    /** Reads a job. */
    readonly read: (mailboxId: string, jobId: string) => Observable<FolderJobDto>;
    /** Whether realtime is connected now: its event tells a job's end, and nothing is polled. */
    readonly realtime: () => boolean;
    /** A job ended: `mine` when this page started it (only then is a failure said). */
    readonly ended: (job: FolderJobDto, mine: boolean) => void;
    /** A job this page started can no longer be read (the server keeps jobs a day): the folders are read again. */
    readonly lost: (job: FolderJobDto) => void;
    /** The server refused to start the job. */
    readonly refused: (err: unknown, mailboxId: string, folder: string) => void;
}

const keyOf = (mailboxId: string, folder: string): string => `${mailboxId}\n${folder}`;

/**
 * The folder jobs this page started (Mark all as read), from the click to their end. A job's folder is busy with it
 * from the server's 202 until mail.folders.job tells its end; without realtime the job is read at POLL_FIRST_MS, then
 * at twice the wait each time, up to POLL_MAX_MS, until it is no longer running. Asked again while it runs, the server
 * answers the same job, which is followed once.
 */
export class MailFolderJobs {
    /** The running jobs this page started, by mailbox and folder. */
    readonly running = signal<ReadonlyMap<string, FolderJobDto>>(new Map());
    private readonly polls = new Map<string, Subscription>();

    constructor(private readonly deps: FolderJobsDeps) {}

    /** The job this page knows runs on the folder, or null. */
    busyIn(mailboxId: string | null, folder: string): FolderJobAction | null {
        return mailboxId === null ? null : this.running().get(keyOf(mailboxId, folder))?.action ?? null;
    }

    markRead(mailboxId: string, folder: string): void {
        this.deps.start(mailboxId, folder).subscribe({
            next: job => this.follow(job),
            error: (err: unknown) => this.deps.refused(err, mailboxId, folder),
        });
    }

    /** A job's end heard in realtime: one this page follows ends; any other is told as someone else's. */
    heard(evt: MailFolderJobEvent): void {
        const { type: _type, ...job } = evt;
        this.end(job, this.follows(job.jobId));
    }

    /** Stops every poll; nothing more is told. */
    stop(): void {
        this.polls.forEach(sub => sub.unsubscribe());
        this.polls.clear();
    }

    private follows(jobId: string): boolean {
        return [...this.running().values()].some(j => j.jobId === jobId);
    }

    private follow(job: FolderJobDto): void {
        if (job.outcome !== 'running') {
            this.end(job, true);
            return;
        }
        const next = new Map(this.running());
        next.set(keyOf(job.mailboxId, job.folder), job);
        this.running.set(next);
        if (!this.polls.has(job.jobId)) {
            this.poll(job, POLL_FIRST_MS);
        }
    }

    private end(job: FolderJobDto, mine: boolean): void {
        this.polls.get(job.jobId)?.unsubscribe();
        this.polls.delete(job.jobId);
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
    }

    /** One wait, then the job read (only while realtime is down), then the next wait, twice as long. */
    private poll(job: FolderJobDto, wait: number): void {
        const sub = timer(wait).pipe(
            switchMap(() => (this.deps.realtime()
                ? of<'wait'>('wait')
                : this.deps.read(job.mailboxId, job.jobId).pipe(
                    map(answer => answer as FolderJobDto | 'wait' | 'gone'),
                    catchError((err: unknown) => of<'wait' | 'gone'>(
                        err instanceof HttpErrorResponse && err.status === 404 ? 'gone' : 'wait')),
                ))),
        ).subscribe(answer => {
            this.polls.delete(job.jobId);
            if (!this.follows(job.jobId)) {
                return;
            }
            if (answer === 'gone') {
                this.forget(job);
                this.deps.lost(job);
                return;
            }
            if (answer !== 'wait' && answer.outcome !== 'running') {
                this.end(answer, true);
                return;
            }
            this.poll(job, Math.min(wait * 2, POLL_MAX_MS));
        });
        // A timer that has already fired synchronously (a test scheduler) leaves nothing to keep.
        if (!sub.closed) {
            this.polls.set(job.jobId, sub);
        }
    }
}
