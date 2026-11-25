import { HttpErrorResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { type EmailBulkResultDto } from './email.types';
import { inChunks, isTrashFolder, permanentQuestion, PERMANENT_NOT_SERVED, problemOf, trashOutcome, trashRefusedText, trashRetentionText } from './trash';
import { refusalWords } from './server-words';

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

    it('says why nothing changed in the server\'s words: a declared problem its detail, an undeclared fault the generic sentence', () => {
        const refused = new HttpErrorResponse({ status: 409, error: { type: '/errors/email/no-trash', detail: 'Said by the server.' } });
        expect(refusalWords(refused)).toBe('Said by the server.');
        expect(refusalWords(new HttpErrorResponse({ status: 409, error: { type: '/errors/email/no-trash' } }))).toBe('Not available right now');
        expect(refusalWords(new HttpErrorResponse({ status: 502, error: { type: 'about:blank', detail: 'IMAP said NO [internals]' } }))).toBe('Something went wrong. Try again.');
        expect(PERMANENT_NOT_SERVED).toBe('Permanent delete isn\'t available yet.');
    });

    it("the Trash view says when the server empties it only where that is known", () => {
        expect(trashRetentionText(30)).toBe('Messages in Trash are deleted in your mailbox after 30 days.');
        expect(trashRetentionText(30, 'your Gmail mailbox')).toBe('Messages in Trash are deleted in your Gmail mailbox after 30 days.');
        expect(trashRetentionText(null)).toBeNull();
        expect(trashRetentionText(undefined)).toBeNull();
        expect(trashRetentionText(0)).toBeNull();
    });

    it('the permanent delete asks, naming how many', () => {
        expect(permanentQuestion(1).title).toBe('Delete this message permanently?');
        expect(permanentQuestion(1).message).toBe('It is deleted in your mailbox and cannot be undone.');
        expect(permanentQuestion(4).title).toBe('Delete 4 messages permanently?');
    });
});

describe('trashRefusedText: the refused of a bulk step in the server\'s sentence', () => {
    it('says how many and the server\'s sentence as given; without a sentence, the call\'s own refusal', () => {
        expect(trashRefusedText('delete', [{ id: 'a', outcome: 'refused', reason: 'no-move', reasonText: 'Said by the server.' }]))
            .toBe('The message was not moved to Trash. Said by the server.');
        expect(trashRefusedText('restore', [
            { id: 'a', outcome: 'refused', reasonText: 'Said.' }, { id: 'b', outcome: 'refused', reasonText: 'Said.' },
        ])).toBe('2 messages were not restored. Said.');
        expect(trashRefusedText('delete', [{ id: 'a', outcome: 'refused', reason: 'failed' }])).toBe('The message was not moved to Trash. Not available right now');
    });
});
