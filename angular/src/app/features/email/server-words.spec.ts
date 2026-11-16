import { HttpErrorResponse } from '@angular/common/http';
import { NOT_AVAILABLE, refusalWords, SOMETHING_WENT_WRONG } from './server-words';

const failure = (status: number, error: unknown): HttpErrorResponse => new HttpErrorResponse({ status, error });

describe('refusalWords: a declared problem says its detail, whatever the status', () => {
    it('says the detail of a declared problem as given, a refusal and a fault alike', () => {
        expect(refusalWords(failure(409, { type: '/errors/email/no-trash', detail: 'Said for a refusal.' }))).toBe('Said for a refusal.');
        expect(refusalWords(failure(502, {
            type: '/errors/email/send-refused',
            detail: 'Microsoft refused the message: 550 5.1.1 mailbox unavailable',
        }))).toBe('Microsoft refused the message: 550 5.1.1 mailbox unavailable');
    });

    it('reads a problem that came as text', () => {
        expect(refusalWords(failure(503, JSON.stringify({ type: '/errors/email/server-search-unavailable', detail: 'Said as text.' }))))
            .toBe('Said as text.');
    });

    it('keeps the detail as plain text, markup and all', () => {
        expect(refusalWords(failure(422, { type: '/errors/x', detail: '<b>not bold</b>' }))).toBe('<b>not bold</b>');
    });

    it('says the first field message of a validation refusal, never its top-level detail', () => {
        expect(refusalWords(failure(422, {
            type: '/validation_errors/0',
            detail: 'name: Name is too long.',
            violations: [{ propertyPath: 'name', message: '' }, { propertyPath: 'name', message: 'Name is too long.' }],
        }))).toBe('Name is too long.');
        expect(refusalWords(failure(422, { type: '/validation_errors/0', detail: 'Said by the server.', violations: [] })))
            .withContext('no field message: the detail').toBe('Said by the server.');
    });

    it('says the first field message of an undeclared validation refusal, and only of a 422', () => {
        expect(refusalWords(failure(422, {
            type: 'about:blank',
            title: 'Unprocessable Content',
            violations: [{ propertyPath: 'name', message: 'Name is too long.', code: 'c1' }],
        }))).toBe('Name is too long.');
        expect(refusalWords(failure(422, { type: 'about:blank', violations: [{ propertyPath: 'name', message: '' }] })))
            .withContext('no field message, undeclared').toBe(SOMETHING_WENT_WRONG);
        expect(refusalWords(failure(400, { type: 'about:blank', violations: [{ propertyPath: 'name', message: 'Not a 422.' }] })))
            .withContext('not a 422').toBe(SOMETHING_WENT_WRONG);
    });

    it('says the one generic sentence for a declared problem with nothing to say', () => {
        expect(refusalWords(failure(409, { type: '/errors/email/no-trash' }))).toBe(NOT_AVAILABLE);
        expect(refusalWords(failure(502, { type: '/errors/email/x', detail: '   ' }))).toBe(NOT_AVAILABLE);
    });

    it('never says the text of an undeclared problem, whatever the status', () => {
        expect(refusalWords(failure(500, { type: 'about:blank', detail: 'SQLSTATE internals' }))).toBe(SOMETHING_WENT_WRONG);
        expect(refusalWords(failure(404, { detail: 'No type given.' }))).toBe(SOMETHING_WENT_WRONG);
        expect(refusalWords(failure(400, { type: '', detail: 'Blank type.' }))).toBe(SOMETHING_WENT_WRONG);
        expect(refusalWords(failure(502, 'Bad gateway'))).toBe(SOMETHING_WENT_WRONG);
    });

    it("never says a framework's server fault, whose detail may be the exception's own text", () => {
        expect(refusalWords(failure(500, { type: '/errors/500', detail: 'SQLSTATE[42P01]: relation "x" does not exist' }))).toBe(SOMETHING_WENT_WRONG);
        expect(refusalWords(failure(503, { type: '/errors/503', detail: 'Internal Server Error' }))).toBe(SOMETHING_WENT_WRONG);
        expect(refusalWords(failure(409, { type: '/errors/409', detail: 'Said for 409.' })))
            .withContext("a framework's 4xx type stays declared").toBe('Said for 409.');
        expect(refusalWords(failure(502, { type: '/errors/email/send-refused', detail: 'Said for 502.' })))
            .withContext("a module's own 5xx type stays declared").toBe('Said for 502.');
    });

    it('says the generic sentence for a network failure and anything that is not an answer', () => {
        expect(refusalWords(failure(0, new ProgressEvent('error')))).toBe(SOMETHING_WENT_WRONG);
        expect(refusalWords(new Error('thrown'))).toBe(SOMETHING_WENT_WRONG);
        expect(refusalWords(null)).toBe(SOMETHING_WENT_WRONG);
    });
});
