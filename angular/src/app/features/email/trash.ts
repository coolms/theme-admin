import { HttpErrorResponse } from '@angular/common/http';
import { type ConfirmDialogData, type ToastService } from '@coolms/ui-angular';
import { type Observable } from 'rxjs';
import { type EmailBulkResultDto, type EmailMessageOutcomeDto } from './email.types';

/** How long the Undo of a move to Trash stays offered. The server keeps the undo valid while the message is in Trash. */
export const UNDO_MS = 6000;

/**
 * Whether the server deletes permanently yet. It refuses every permanent delete (409 permanent-deletion) until its
 * permanent slice ships after a mail-library release; until then the page asks nothing and says it isn't available.
 * Flip this when that slice is served.
 */
export const PERMANENT_DELETE_SERVED = false;

/** The folder the page treats as Trash, as the delete step's menu always has. */
export function isTrashFolder(folder: string): boolean {
    return folder === 'Trash';
}

/** What a bulk delete or restore did: the rows to drop (moved or gone), the ones an undo can bring back, the refused. */
export interface TrashOutcome {
    readonly removed: readonly string[];
    readonly undoable: readonly string[];
    readonly refused: readonly EmailMessageOutcomeDto[];
}

export function trashOutcome(results: readonly EmailMessageOutcomeDto[]): TrashOutcome {
    return {
        removed:  results.filter(r => r.outcome === 'moved' || r.outcome === 'gone').map(r => r.id),
        undoable: results.filter(r => r.outcome === 'moved').map(r => r.id),
        refused:  results.filter(r => r.outcome === 'refused'),
    };
}

/** The last part of a problem type (`/errors/email/no-trash` -> `no-trash`), from a refused outcome or a 4xx answer. */
export function problemOf(source: unknown): string | null {
    const type = source instanceof HttpErrorResponse
        ? (source.error as { type?: unknown } | null)?.type
        : typeof source === 'string' ? source : null;
    if (typeof type !== 'string' || !type.includes('/errors/email/')) {
        return null;
    }
    return type.slice(type.lastIndexOf('/') + 1);
}

const messages = (n: number): string => (n === 1 ? '1 message' : `${n} messages`);

export function movedToTrashText(n: number): string {
    return `Moved ${messages(n)} to Trash.`;
}

export function deletedForGoodText(n: number): string {
    return `Deleted ${messages(n)} permanently.`;
}

/** The confirmation a permanent delete asks: the only delete that does. */
export function permanentQuestion(n: number): { title: string; message: string; confirmLabel: string } {
    return {
        title:        n === 1 ? 'Delete this message permanently?' : `Delete ${n} messages permanently?`,
        message:      'It is removed from the mail server and cannot be undone.',
        confirmLabel: 'Delete permanently',
    };
}

/** Why a delete, an undo or a permanent delete changed nothing, in the page's words; never the server's detail. */
export function trashRefusalText(step: 'delete' | 'restore' | 'permanent', problem: string | null, n: number): string {
    switch (problem) {
        case 'no-trash':
            return "This mailbox's server has no Trash folder, so nothing was deleted.";
        case 'no-move':
            return "This mailbox's server cannot move messages, so nothing was deleted.";
        case 'no-uidplus':
            return "This mailbox's server cannot delete single messages permanently, so nothing was deleted.";
        case 'not-in-trash':
            return step === 'restore'
                ? `${messages(n)} no longer in Trash, so not restored.`
                : 'Only messages in Trash can be deleted permanently.';
        case 'origin-gone':
            return `The folder ${n === 1 ? 'it' : 'they'} came from no longer exists: move ${n === 1 ? 'it' : 'them'} out of Trash instead.`;
        case 'permanent-deletion':
            // Refused until the server's permanent slice: "not available", never "try again".
            return 'Permanent delete isn\'t available yet.';
        case 'retired-copy':
            return 'This copy is out of date. Reload the folder.';
        case 'renumbered':
            return 'This folder changed on the server. Try again after it refreshes.';
        case 'not-found':
            return n === 1 ? 'This message no longer exists.' : `${messages(n)} no longer exist.`;
    }
    return step === 'restore'
        ? `Could not restore ${messages(n)}.`
        : `Could not delete ${messages(n)}.`;
}

/** The Trash view's line on when the server empties it: only where it is known for the mailbox's provider. */
export function trashRetentionText(days: number | null | undefined): string | null {
    return typeof days === 'number' && days > 0
        ? `The mail server deletes messages in Trash after ${days} days.`
        : null;
}

/** What the Trash flow needs of the page: the server's calls, the confirmation, the toasts, and the list. */
export interface TrashPorts {
    deleteMessages(ids: readonly string[], permanent?: boolean): Observable<EmailBulkResultDto>;
    restoreMessages(ids: readonly string[]): Observable<EmailBulkResultDto>;
    confirm(question: ConfirmDialogData): Observable<boolean>;
    readonly toast: Pick<ToastService, 'show' | 'success' | 'error'>;
    busy(on: boolean): void;
    /** These rows left the folder (moved or gone): out of the list. */
    drop(ids: readonly string[]): void;
    /** These came back from Trash: the list is read again to show them. */
    restored(): void;
}

const firstProblem = (refused: readonly EmailMessageOutcomeDto[]): string | null => problemOf(refused[0]?.reason ?? null);

/**
 * Delete as decided on 2026-10-24: outside Trash it moves to Trash at once, no question, with Undo for a few
 * seconds; only a permanent delete, from Trash, asks. A refused message stays and is said why, in the page's words.
 */
export class TrashFlow {
    /** `permanentServed`: whether the server deletes permanently yet (the page passes nothing: today's answer). */
    constructor(private readonly ports: TrashPorts, private readonly permanentServed: boolean = PERMANENT_DELETE_SERVED) {}

    /** Moves to Trash and offers Undo. Messages already in Trash (the folder said otherwise) go to the permanent delete. */
    moveToTrash(ids: readonly string[]): void {
        if (ids.length === 0) {
            return;
        }
        const { toast } = this.ports;
        this.ports.busy(true);
        this.ports.deleteMessages(ids).subscribe({
            next: ({ results }) => {
                this.ports.busy(false);
                const outcome = trashOutcome(results);
                this.ports.drop(outcome.removed);
                const undoable = outcome.undoable;
                if (undoable.length > 0) {
                    toast.show({ type: 'success', message: movedToTrashText(undoable.length), action: { label: 'Undo', run: () => this.undo(undoable) } }, UNDO_MS);
                }
                const inTrash = outcome.refused.filter(r => problemOf(r.reason ?? null) === 'already-in-trash');
                const refused = outcome.refused.filter(r => !inTrash.includes(r));
                if (refused.length > 0) {
                    toast.error(trashRefusalText('delete', firstProblem(refused), refused.length));
                }
                if (inTrash.length > 0) {
                    this.deletePermanently(inTrash.map(r => r.id));
                }
            },
            error: (e: unknown) => {
                this.ports.busy(false);
                toast.error(trashRefusalText('delete', problemOf(e), ids.length));
            },
        });
    }

    /** Deletes messages in Trash for good: the one delete that asks first. */
    deletePermanently(ids: readonly string[]): void {
        if (ids.length === 0) {
            return;
        }
        const { toast } = this.ports;
        if (!this.permanentServed) {
            // Never a confirmation for something the server refuses every time.
            toast.error(trashRefusalText('permanent', 'permanent-deletion', ids.length));
            return;
        }
        this.ports.confirm({ ...permanentQuestion(ids.length), danger: true }).subscribe(yes => {
            if (!yes) {
                return;
            }
            this.ports.busy(true);
            this.ports.deleteMessages(ids, true).subscribe({
                next: ({ results }) => {
                    this.ports.busy(false);
                    const outcome = trashOutcome(results);
                    this.ports.drop(outcome.removed);
                    if (outcome.removed.length > 0) {
                        toast.success(deletedForGoodText(outcome.removed.length));
                    }
                    if (outcome.refused.length > 0) {
                        toast.error(trashRefusalText('permanent', firstProblem(outcome.refused), outcome.refused.length));
                    }
                },
                error: (e: unknown) => {
                    this.ports.busy(false);
                    toast.error(trashRefusalText('permanent', problemOf(e), ids.length));
                },
            });
        });
    }

    /** The Undo: back from Trash to the folder each came from. */
    private undo(ids: readonly string[]): void {
        this.ports.restoreMessages(ids).subscribe({
            next: ({ results }) => {
                const outcome = trashOutcome(results);
                if (outcome.undoable.length > 0) {
                    this.ports.restored();
                }
                if (outcome.refused.length > 0) {
                    this.ports.toast.error(trashRefusalText('restore', firstProblem(outcome.refused), outcome.refused.length));
                }
            },
            error: (e: unknown) => this.ports.toast.error(trashRefusalText('restore', problemOf(e), ids.length)),
        });
    }
}
