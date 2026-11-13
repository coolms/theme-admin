import { HttpErrorResponse } from '@angular/common/http';
import { type ToastService } from '@coolms/ui-angular';
import { type Observable } from 'rxjs';
import { type EmailArchiveResultDto, type EmailBulkResultDto, type EmailMessageOutcomeDto } from './email.types';
import { inChunks, problemOf } from './trash';

/** How long a refusal with Retry stays offered. */
export const ARCHIVE_RETRY_MS = 8000;

/** One archived message and the folder it is in now, as the server answered. */
export interface ArchivedMessage {
    readonly id: string;
    readonly folder: string;
}

const messages = (n: number): string => (n === 1 ? '1 message' : `${n} messages`);

export function archivedText(n: number): string {
    return `Archived ${messages(n)}.`;
}

/** The mail server did not complete it: nothing changed, and it can be asked again. */
export function archiveFailedText(n: number): string {
    return n === 1
        ? 'The mail server did not complete the archive. Nothing was changed.'
        : `The mail server did not complete the archive of ${messages(n)}. Nothing was changed for them.`;
}

/** Why a message cannot be archived, in the page's words per reason; never the server's detail. */
export function archiveReasonText(reason: string | null): string {
    switch (reason) {
        case 'no-archive-folder':
            return "This mailbox's server has no folder marked as its archive.";
        case 'not-archivable-from-here':
            return 'Messages in this folder cannot be archived.';
        case 'not-in-inbox':
            return 'On this server only messages in the Inbox can be archived.';
        case 'all-mail-hidden':
            return "Archive needs All Mail shown over IMAP: in Gmail settings, Labels, All Mail, Show in IMAP.";
        case 'folders-not-listed':
            return "This mailbox's folders have not been read from the server yet. Try again after it syncs.";
        case 'retired-copy':
            return 'This copy is out of date. Reload the folder.';
        case 'not-on-server':
            return 'The mail server no longer has this message.';
        case 'not-found':
            return 'This message no longer exists.';
        case 'failed':
            return 'The mail server did not complete the archive.';
    }
    return 'The mail server did not archive it.';
}

/** One summary for the refused of a bulk archive: how many, and why (the first refusal's reason, as Delete says). */
export function archiveRefusedText(refused: readonly EmailMessageOutcomeDto[], asked: number): string {
    const n = refused.length;
    const why = archiveReasonText(problemOf(refused[0]?.reason ?? null));
    const head = n === asked
        ? (n === 1 ? 'The message was not archived.' : `None of the ${n} messages were archived.`)
        : `${messages(n)} of ${asked} not archived.`;

    return `${head} ${why}`;
}

/** What the archive needs of the page: the server's calls, the toasts, and the list. */
export interface ArchivePorts {
    archiveMessage(id: string): Observable<EmailArchiveResultDto>;
    archiveMessages(ids: readonly string[]): Observable<EmailBulkResultDto>;
    readonly toast: Pick<ToastService, 'show' | 'success' | 'error'>;
    busy(on: boolean): void;
    /** Archive was chosen: these rows leave the list at once, before the server answers. */
    take(ids: readonly string[]): void;
    /** The server refused these, or did not complete them: back as they were, in their places, the open one open again. */
    putBack(ids: readonly string[]): void;
    /**
     * These were archived, each into the folder named: a row leaves the list unless that is the folder shown.
     * `asked`: every row the archive was asked for.
     */
    archived(done: readonly ArchivedMessage[], asked: readonly string[]): void;
}

const statusOf = (e: unknown): number | null => (e instanceof HttpErrorResponse ? e.status : null);

/** The `reason` member of a 422 `/errors/email/cannot-archive`, or null for any other answer. */
export function cannotArchiveReason(e: unknown): string | null {
    if (!(e instanceof HttpErrorResponse) || e.status !== 422 || problemOf(e) !== 'cannot-archive') {
        return null;
    }
    const reason = (e.error as { reason?: unknown } | null)?.reason;

    return typeof reason === 'string' ? reason : '';
}

/**
 * Archive as the mail server archives: one message by its own call, several checked by one bulk call. The rows leave
 * the list at once; the page decides no folder, and the server answers where each one is now. A refused row comes back
 * and the refusal is said in the page's words; a server that did not complete it is offered Retry, never retried by
 * itself.
 */
export class ArchiveFlow {
    constructor(private readonly ports: ArchivePorts) {}

    archive(ids: readonly string[]): void {
        if (ids.length > 0) {
            this.ports.take(ids);
        }
        if (ids.length === 1) {
            this.archiveOne(ids[0]);
        } else if (ids.length > 1) {
            this.archiveMany(ids);
        }
    }

    private archiveOne(id: string): void {
        const { toast } = this.ports;
        this.ports.busy(true);
        this.ports.archiveMessage(id).subscribe({
            next: answer => {
                this.ports.busy(false);
                this.ports.archived([{ id, folder: answer.folder }], [id]);
                toast.success(archivedText(1));
            },
            error: (e: unknown) => {
                this.ports.busy(false);
                this.ports.putBack([id]);
                const reason = cannotArchiveReason(e);
                if (reason !== null) {
                    toast.error(archiveReasonText(reason));
                } else if (statusOf(e) === 502) {
                    this.offerRetry(archiveFailedText(1), [id]);
                } else {
                    toast.error('Could not archive the message.');
                }
            },
        });
    }

    private archiveMany(ids: readonly string[]): void {
        const { toast } = this.ports;
        this.ports.busy(true);
        inChunks(ids, chunk => this.ports.archiveMessages(chunk)).subscribe({
            next: ({ results }) => {
                this.ports.busy(false);
                const done = results
                    .filter(r => r.outcome === 'archived')
                    .map(r => ({ id: r.id, folder: r.folder ?? '' }));
                const refused = results.filter(r => r.outcome === 'refused');
                if (done.length > 0) {
                    this.ports.archived(done, ids);
                }
                // One notice: the refusal's (which counts the archived) in place of "Archived".
                if (refused.length === 0) {
                    if (done.length > 0) {
                        toast.success(archivedText(done.length));
                    }
                    return;
                }
                this.ports.putBack(refused.map(r => r.id));
                const failed = refused.filter(r => problemOf(r.reason ?? null) === 'failed');
                if (failed.length === refused.length) {
                    this.offerRetry(archiveFailedText(failed.length), failed.map(r => r.id));
                } else {
                    toast.error(archiveRefusedText(refused, ids.length));
                }
            },
            error: () => {
                this.ports.busy(false);
                this.ports.putBack(ids);
                toast.error(`Could not archive ${messages(ids.length)}.`);
            },
        });
    }

    private offerRetry(message: string, ids: readonly string[]): void {
        this.ports.toast.show(
            { type: 'error', message, action: { label: 'Retry', run: () => this.archive(ids) } },
            ARCHIVE_RETRY_MS,
        );
    }
}
