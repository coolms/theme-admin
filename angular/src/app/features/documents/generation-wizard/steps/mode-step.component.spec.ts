import { TestBed } from '@angular/core/testing';

import { FilterAudienceEntity } from '../filter-audience-entity';
import { CmsWizardModeStepComponent } from './mode-step.component';

/**
 * The Mode step offers what exists: Single recipient, and Filter entities where the template uses a person's details.
 * No option for something that does not exist yet, and its words use no dash as a separator.
 */
describe('CmsWizardModeStepComponent -- the options it offers', () => {
    function render(usesPerson: boolean): HTMLElement {
        TestBed.configureTestingModule({
            providers: [{ provide: FilterAudienceEntity, useValue: { matches: (t: unknown) => usesPerson && t === 'User', value: () => 'User' } }],
        });
        const fixture = TestBed.createComponent(CmsWizardModeStepComponent);
        fixture.componentRef.setInput('variables', [{ path: 'recipient.name', filters: [], loopAlias: null, entityType: 'User' }]);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }
    const values = (el: HTMLElement): string[] => Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(i => i.value);
    const words = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

    it('offers Single recipient and Filter entities, and nothing that does not exist yet', () => {
        const el = render(true);
        expect(values(el)).toEqual(['single', 'filter']);
        expect(words(el)).not.toContain('Upload CSV');
        expect(words(el)).not.toContain('Coming soon');
    });

    it('says in plain words when Filter entities is not available', () => {
        const el = render(false);
        const filter = el.querySelector<HTMLInputElement>('input[value="filter"]')!;
        expect(filter.disabled).toBeTrue();
        expect(words(el)).toContain('Available when the template uses a person\'s details.');
    });

    it('uses no dash as a separator in its words, Filter available', () => {
        expect(words(render(true))).not.toMatch(/--|—| - /);
    });

    it('uses no dash as a separator in its words, Filter not available', () => {
        expect(words(render(false))).not.toMatch(/--|—| - /);
    });
});
