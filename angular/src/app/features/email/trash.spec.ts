import { HttpErrorResponse } from '@angular/common/http';
import { permanentQuestion, problemOf, trashOutcome, trashRefusalText, trashRetentionText } from './trash';

describe('Trash: the move, its undo and the permanent delete', () => {
    it('drops the moved and the gone rows; only the moved can be undone; the refused stay', () => {
        const o = trashOutcome([
            { id: 'a', outcome: 'moved', folder: 'Trash' },
            { id: 'b', outcome: 'gone' },
            { id: 'c', outcome: 'refused', reason: '/errors/email/no-move' },
        ]);
        expect(o.removed).toEqual(['a', 'b']);
        expect(o.undoable).toEqual(['a']);
        expect(o.refused.map(r => r.id)).toEqual(['c']);
    });

    it('reads the problem type from a refused outcome and from a 409, and nothing from anything else', () => {
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
