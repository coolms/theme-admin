import { HttpErrorResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { type EmailBulkResultDto } from './email.types';
import { inChunks, isTrashFolder, permanentQuestion, problemOf, trashOutcome, trashRefusalText, trashRetentionText } from './trash';

describe('Trash: the move, its undo and the permanent delete', () => {
    it('drops the moved and the gone rows; only the moved can be undone; the refused stay', () => {
        const o = trashOutcome([
            { id: 'a', outcome: 'moved', folder: 'Trash' },
            { id: 'b', outcome: 'gone' },
            { id: 'c', outcome: 'refused', reason: 'no-move' },
        ]);
        expect(o.removed).toEqual(['a', 'b']);
        expect(o.undoable).toEqual(['a']);
        expect(o.refused.map(r => r.id)).toEqual(['c']);
    });

    it("reads a bulk outcome's bare kind, as the server sends it, and the Trash folder by its own name", () => {
        expect(problemOf('already-in-trash')).toBe('already-in-trash');
        expect(problemOf('no-move')).toBe('no-move');
        expect(problemOf('Not a kind')).toBeNull();
        expect(isTrashFolder('Trash')).toBeTrue();
        expect(isTrashFolder('[Gmail]/Trash')).toBeTrue();
        expect(isTrashFolder('INBOX.Trash')).toBeTrue();
        expect(isTrashFolder('INBOX')).toBeFalse();
        expect(isTrashFolder('Trash/Old')).toBeFalse();
    });

    it('sends more than 200 ids in chunks of 200, one after the other, and joins their results in order', () => {
        const sent: number[] = [];
        const ids = Array.from({ length: 450 }, (_, i) => `m${i}`);
        let joined: EmailBulkResultDto | null = null;
        inChunks(ids, chunk => {
            sent.push(chunk.length);
            return of({ results: chunk.map(id => ({ id, outcome: 'moved' as const })) });
        }).subscribe(r => (joined = r));
        expect(sent).toEqual([200, 200, 50]);
        expect(joined!.results.map(r => r.id)).toEqual(ids);
    });

    it('reads the problem type from a 409, and nothing from anything else', () => {
        expect(problemOf('/errors/email/already-in-trash')).toBe('already-in-trash');
        expect(problemOf(new HttpErrorResponse({ status: 409, error: { type: '/errors/email/no-trash', detail: 'x' } }))).toBe('no-trash');
        expect(problemOf(new HttpErrorResponse({ status: 500, error: 'boom' }))).toBeNull();
        expect(problemOf('/errors/other/no-trash')).toBeNull();
        expect(problemOf(null)).toBeNull();
    });

    it('says why nothing changed in its own words per problem, and never the server detail', () => {
        const texts = ['no-trash', 'no-move', 'no-uidplus', 'origin-gone', null].map(p => trashRefusalText('delete', p, 1));
        expect(new Set(texts).size).toBe(texts.length);
        expect(trashRefusalText('restore', 'not-in-trash', 2)).toBe('2 messages no longer in Trash, so not restored.');
        expect(trashRefusalText('permanent', 'not-in-trash', 1)).toBe('Only messages in Trash can be deleted permanently.');
        expect(trashRefusalText('restore', 'odd', 1)).toBe('Could not restore 1 message.');
        // The served kinds, in the words agreed with the server's side.
        expect(trashRefusalText('permanent', 'permanent-deletion', 1)).toBe('Permanent delete isn\'t available yet.');
        expect(trashRefusalText('delete', 'retired-copy', 1)).toBe('This copy is out of date. Reload the folder.');
        expect(trashRefusalText('delete', 'renumbered', 1)).toBe('This folder changed on the server. Try again after it refreshes.');
        expect(trashRefusalText('restore', 'not-found', 1)).toBe('This message no longer exists.');
        expect(trashRefusalText('delete', 'not-found', 3)).toBe('3 messages no longer exist.');
    });

    it("the Trash view says when the server empties it only where that is known", () => {
        expect(trashRetentionText(30)).toBe('The mail server deletes messages in Trash after 30 days.');
        expect(trashRetentionText(null)).toBeNull();
        expect(trashRetentionText(undefined)).toBeNull();
        expect(trashRetentionText(0)).toBeNull();
    });

    it('the permanent delete asks, naming how many', () => {
        expect(permanentQuestion(1).title).toBe('Delete this message permanently?');
        expect(permanentQuestion(4).title).toBe('Delete 4 messages permanently?');
    });
});
