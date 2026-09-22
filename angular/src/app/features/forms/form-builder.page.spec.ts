import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Store } from '@ngxs/store';
import { FormBuilderPageComponent } from './form-builder.page';

/**
 * The builder's Fields / Layout tabs are the admin's own markup, not the
 * shared strip, so the strip's spec proves nothing about them. Three distinct
 * colours on the root, and the active tab must read the SELECTED token: a
 * rule that read the accent directly would pass with the theme's alias in
 * place, and a rule that read the primary was the defect (a blue underline on
 * an amber page, 2026-09-21). The label keeps the text colour -- the underline
 * carries the selection, as on the strip.
 */
describe('FormBuilderPageComponent -- the tabs read the selected-item token', () => {
    const SELECTED = 'rgb(16, 185, 129)';
    const ACCENT   = 'rgb(245, 166, 35)';
    const PRIMARY  = 'rgb(37, 99, 235)';
    const TEXT     = 'rgb(17, 24, 39)';

    let fixture: ComponentFixture<FormBuilderPageComponent>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [FormBuilderPageComponent],
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
                provideRouter([]),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'new' }) } } },
            ],
        });
        const root = document.documentElement.style;
        root.setProperty('--cms-selected', SELECTED);
        root.setProperty('--cms-accent', ACCENT);
        root.setProperty('--cms-primary', PRIMARY);
        root.setProperty('--cms-text', TEXT);
        fixture = TestBed.createComponent(FormBuilderPageComponent);
        fixture.detectChanges();
    });

    afterEach(() => {
        const root = document.documentElement.style;
        for (const t of ['--cms-selected', '--cms-accent', '--cms-primary', '--cms-text']) root.removeProperty(t);
    });

    it('underlines the active tab in --cms-selected and keeps its label in the text colour', () => {
        const tabs = fixture.nativeElement.querySelectorAll('.fb__tab') as NodeListOf<HTMLElement>;
        expect(tabs.length).toBe(2);
        const active = fixture.nativeElement.querySelector('.fb__tab--active') as HTMLElement;
        expect(active.textContent?.trim()).toBe('Fields');
        const style = getComputedStyle(active);
        expect(style.borderBottomColor).toBe(SELECTED);
        expect(style.color).toBe(TEXT);
    });

    it('moves the underline with the selection', () => {
        (fixture.nativeElement.querySelectorAll('.fb__tab')[1] as HTMLElement).click();
        fixture.detectChanges();
        const active = fixture.nativeElement.querySelector('.fb__tab--active') as HTMLElement;
        expect(active.textContent?.trim()).toBe('Layout');
        expect(getComputedStyle(active).borderBottomColor).toBe(SELECTED);
        const idle = fixture.nativeElement.querySelector('.fb__tab:not(.fb__tab--active)') as HTMLElement;
        expect(getComputedStyle(idle).borderBottomColor).toBe('rgba(0, 0, 0, 0)');
    });
});
