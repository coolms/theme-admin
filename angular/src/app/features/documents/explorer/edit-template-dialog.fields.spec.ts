import { HttpErrorResponse } from '@angular/common/http';
import { fieldMessagesOf } from './edit-template-dialog.component';

describe('fieldMessagesOf: a template update\'s validation refusal, by field', () => {
    const refusal = (status: number, error: unknown): HttpErrorResponse => new HttpErrorResponse({ status, error });

    it('reads each field\'s first message by its propertyPath, never by words inside the detail', () => {
        const fields = fieldMessagesOf(refusal(422, {
            type: 'about:blank',
            detail: 'suffix and output format',
            violations: [
                { propertyPath: 'defaultOutputFormat', message: 'This template cannot be made into odt. Choose one of: pdf, docx.' },
                { propertyPath: 'instanceNameSuffix', message: 'The name suffix is not valid template text: unexpected }.' },
                { propertyPath: 'instanceNameSuffix', message: 'A second message for the same field.' },
                { propertyPath: 'contextSchema', message: 'A variable no caller can fill.' },
            ],
        }));
        expect(fields.get('defaultOutputFormat')).toBe('This template cannot be made into odt. Choose one of: pdf, docx.');
        expect(fields.get('instanceNameSuffix')).toBe('The name suffix is not valid template text: unexpected }.');
        expect(fields.get('contextSchema')).toBe('A variable no caller can fill.');
        expect(fields.size).toBe(3);
    });

    it('reads nothing from a refusal that names no field', () => {
        expect(fieldMessagesOf(refusal(422, { type: 'about:blank', detail: 'The output format is wrong.' })).size).toBe(0);
        expect(fieldMessagesOf(refusal(409, { type: '/errors/x', violations: [{ propertyPath: 'instanceNameSuffix', message: 'x' }] })).size).toBe(0);
        expect(fieldMessagesOf(refusal(422, { violations: [{ propertyPath: 'instanceNameSuffix', message: '  ' }] })).size).toBe(0);
    });
});
