import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { type ThemeTemplateDto } from '../themes/themes.types';
import { ThemesApiService } from '../themes/themes-api.service';
import { TemplatePickerComponent } from './template-picker.component';

/**
 * The menu entry's template is CHOSEN, not typed (decided 2026-10-20): a select of the section theme's page
 * templates, "Default (directory index)" first, and the server's 422 on `template` shown under it.
 *
 * Each case reads the rendered <select>, not the component's fields: what an administrator can pick is the subject.
 */
describe('TemplatePickerComponent', () => {
    const tpl = (path: string): ThemeTemplateDto => ({ path, themeSlug: 'coolms-site', label: path });

    let fixture: ComponentFixture<TemplatePickerComponent>;
    let control: FormControl<string | null>;
    let listed: ThemeTemplateDto[] | 'fail';

    const options = (): string[] =>
        [...(fixture.nativeElement as HTMLElement).querySelectorAll('option')]
            .map(o => (o.textContent ?? '').trim());
    const text = (): string => ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

    function render(value: string | null): void {
        control = new FormControl<string | null>(value);
        TestBed.configureTestingModule({
            imports: [TemplatePickerComponent],
            providers: [{
                provide: ThemesApiService,
                useValue: { getThemeTemplates: () => (listed === 'fail' ? throwError(() => new Error('down')) : of(listed)) },
            }],
        });
        fixture = TestBed.createComponent(TemplatePickerComponent);
        fixture.componentRef.setInput('control', control);
        fixture.componentRef.setInput('themeSlug', 'coolms-site');
        fixture.detectChanges();
    }

    beforeEach(() => {
        listed = [tpl('layouts/base.html.dtmpl'), tpl('pages/landing.html.dtmpl'), tpl('pages/privacy.html.dtmpl'),
            tpl('partials/footer.html.dtmpl')];
    });

    it('offers the default first, then the theme\'s page templates only', () => {
        render(null);

        expect(options()).toEqual(['Default (directory index)', 'pages/landing.html.dtmpl', 'pages/privacy.html.dtmpl']);
    });

    it('reads an empty stored template as the default, not as a blank choice', () => {
        render('');

        expect(control.value).toBeNull();
        expect((fixture.nativeElement as HTMLElement).querySelector('select')!.selectedIndex).toBe(0);
    });

    it('keeps a stored template the theme no longer ships, marked, instead of dropping it', () => {
        render('pages/home.html.dtmpl');

        expect(options()).toContain('pages/home.html.dtmpl (not a template of this theme)');
        expect(control.value).toBe('pages/home.html.dtmpl');
    });

    it('does not mark a stored template the list holds', () => {
        render('pages/landing.html.dtmpl');

        expect(options().filter(o => o.includes('not a template'))).toEqual([]);
    });

    it('shows the server\'s refusal under the select, and clears it when another template is chosen', () => {
        render(null);
        control.setValue('pages/landing.html.dtmpl');
        control.setErrors({ server: '"pages/landing.html.dtmpl" is not a template of the theme "coolms-site".' });
        fixture.detectChanges();

        expect(text()).toContain('is not a template of the theme "coolms-site".');

        control.setValue('pages/privacy.html.dtmpl');
        fixture.detectChanges();

        expect(text()).not.toContain('is not a template of the theme');
    });

    it('says so when the list cannot be loaded, and still offers the default', () => {
        listed = 'fail';
        render(null);

        expect(options()).toEqual(['Default (directory index)']);
        expect(text()).toContain('could not be listed');
    });
});
