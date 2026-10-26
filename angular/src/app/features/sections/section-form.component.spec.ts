import { pageTemplateFrom } from './section-form.component';

describe('The section form sends the site page template as the API reads it', () => {
    it('sends a named template, trimmed', () => {
        expect(pageTemplateFrom({ pageTemplate: ' pages/landing.html.dtmpl ' })).toBe('pages/landing.html.dtmpl');
    });

    it('sends an emptied field as the empty string, which clears the template (undefined would keep the old one)', () => {
        expect(pageTemplateFrom({ pageTemplate: '' })).toBe('');
        expect(pageTemplateFrom({ pageTemplate: '   ' })).toBe('');
        expect(pageTemplateFrom({ pageTemplate: null })).toBe('');
        expect(pageTemplateFrom({})).toBe('');
    });
});
