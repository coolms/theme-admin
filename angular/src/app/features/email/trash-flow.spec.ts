import { HttpErrorResponse } from '@angular/common/http';
import { type ToastInput } from '@coolms/ui-angular';
import { of, throwError, type Observable } from 'rxjs';
import { type EmailBulkResultDto } from './email.types';
import { TrashFlow, UNDO_MS, type TrashPorts } from './trash';

/** The page as the flow sees it, recording what it was asked. */
function page(answers: { delete?: Observable<EmailBulkResultDto>; permanent?: Observable<EmailBulkResultDto>; restore?: Observable<EmailBulkResultDto>; confirm?: boolean } = {}) {
    const seen = {
        deletes: [] as { ids: readonly string[]; permanent: boolean }[],
        restores: [] as (readonly string[])[],
        asked: 0,
        shown: [] as { input: ToastInput; duration: number | undefined }[],
        successes: [] as string[],
        errors: [] as string[],
        dropped: [] as (readonly string[])[],
        restored: 0,
    };
    const ports: TrashPorts = {
        deleteMessages: (ids, permanent = false) => {
            seen.deletes.push({ ids, permanent });
            return (permanent ? answers.permanent : answers.delete) ?? of({ results: ids.map(id => ({ id, outcome: 'moved' as const, folder: 'Trash' })) });
        },
        restoreMessages: ids => {
            seen.restores.push(ids);
            return answers.restore ?? of({ results: ids.map(id => ({ id, outcome: 'moved' as const, folder: 'INBOX' })) });
        },
        confirm: () => {
            seen.asked++;
            return of(answers.confirm ?? true);
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
        drop: ids => void seen.dropped.push(ids),
        restored: () => void seen.restored++,
    };
    return { flow: new TrashFlow(ports), seen };
}

describe('Delete, as ruled: to Trash at once with Undo; for good only from Trash, after asking', () => {
    it('moves to Trash without asking, drops the rows, and offers Undo for a few seconds', () => {
        const { flow, seen } = page();
        flow.moveToTrash(['a', 'b']);
        expect(seen.asked).toBe(0);
        expect(seen.deletes).toEqual([{ ids: ['a', 'b'], permanent: false }]);
        expect(seen.dropped).toEqual([['a', 'b']]);
        expect(seen.shown.length).toBe(1);
        expect(seen.shown[0].input.message).toBe('Moved 2 messages to Trash.');
        expect(seen.shown[0].input.action?.label).toBe('Undo');
        expect(seen.shown[0].duration).toBe(UNDO_MS);
    });

    it('Undo brings back exactly the moved ones and has the list read again', () => {
        const { flow, seen } = page({ delete: of({ results: [{ id: 'a', outcome: 'moved' }, { id: 'b', outcome: 'gone' }] }) });
        flow.moveToTrash(['a', 'b']);
        expect(seen.dropped).toEqual([['a', 'b']]);
        seen.shown[0].input.action?.run();
        expect(seen.restores).toEqual([['a']]);
        expect(seen.restored).toBe(1);
    });

    it('an Undo the server refuses says why, and reads nothing again', () => {
        const { flow, seen } = page({ restore: of({ results: [{ id: 'a', outcome: 'refused', reason: '/errors/email/origin-gone' }] }) });
        flow.moveToTrash(['a']);
        seen.shown[0].input.action?.run();
        expect(seen.restored).toBe(0);
        expect(seen.errors).toEqual(['The folder it came from no longer exists: move it out of Trash instead.']);
    });

    it('a refused message stays and is said why; with nothing moved, no Undo is offered', () => {
        const { flow, seen } = page({ delete: of({ results: [{ id: 'a', outcome: 'refused', reason: '/errors/email/no-move' }] }) });
        flow.moveToTrash(['a']);
        expect(seen.dropped).toEqual([[]]);
        expect(seen.shown).toEqual([]);
        expect(seen.errors).toEqual(["This mailbox's server cannot move messages, so nothing was deleted."]);
    });

    it('a mailbox with no Trash: Delete says so and deletes nothing', () => {
        const noTrash = throwError(() => new HttpErrorResponse({ status: 409, error: { type: '/errors/email/no-trash' } }));
        const { flow, seen } = page({ delete: noTrash });
        flow.moveToTrash(['a']);
        expect(seen.dropped).toEqual([]);
        expect(seen.deletes.filter(d => d.permanent)).toEqual([]);
        expect(seen.errors).toEqual(["This mailbox's server has no Trash folder, so nothing was deleted."]);
    });

    it('a message already in Trash is offered the permanent delete, which asks', () => {
        const { flow, seen } = page({ delete: of({ results: [{ id: 'a', outcome: 'refused', reason: '/errors/email/already-in-trash' }] }), confirm: false });
        flow.moveToTrash(['a']);
        expect(seen.errors).toEqual([]);
        expect(seen.asked).toBe(1);
        expect(seen.deletes.filter(d => d.permanent)).toEqual([]);
    });

    it('the permanent delete asks first; declined, nothing is sent', () => {
        const { flow, seen } = page({ confirm: false });
        flow.deletePermanently(['a']);
        expect(seen.asked).toBe(1);
        expect(seen.deletes).toEqual([]);
    });

    it('confirmed, it deletes for good, drops the rows, and offers no Undo', () => {
        const { flow, seen } = page({ permanent: of({ results: [{ id: 'a', outcome: 'gone' }] }) });
        flow.deletePermanently(['a']);
        expect(seen.deletes).toEqual([{ ids: ['a'], permanent: true }]);
        expect(seen.dropped).toEqual([['a']]);
        expect(seen.shown).toEqual([]);
        expect(seen.successes).toEqual(['Deleted 1 message permanently.']);
    });
});
