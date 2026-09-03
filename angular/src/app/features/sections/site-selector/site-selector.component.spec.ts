import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideStore, Store } from '@ngxs/store';
import { of } from 'rxjs';
import { SiteSelectorComponent } from './site-selector.component';
import { SectionState } from '../section.state';
import { LoadSections, SetCurrentSection } from '../section.actions';
import { ApiService, SiteSectionDto } from '../../../api/api.service';
import { ErrorHandlerService, UserPreferencesService } from '@coolms/core-angular';
describe('SiteSelectorComponent', () => {
    let fixture: ComponentFixture<SiteSelectorComponent>;
    let store: Store;

    const sections: SiteSectionDto[] = [
        { '@id': '/a', id: '1', slug: 'default',   label: 'Default',   isActive: true },
        { '@id': '/b', id: '2', slug: 'marketing', label: 'Marketing', isActive: true },
    ];

    function setup(initialSections: SiteSectionDto[] = sections): void {
        const apiStub = jasmine.createSpyObj<ApiService>('ApiService', ['getSections']);
        apiStub.getSections.and.returnValue(of(initialSections));

        const prefs = jasmine.createSpyObj<UserPreferencesService>(
            'UserPreferencesService',
            ['getPageState', 'setPageState'],
        );
        prefs.getPageState.and.returnValue(null);

        TestBed.configureTestingModule({
            imports: [SiteSelectorComponent],
            providers: [
                provideStore([SectionState]),
                { provide: ApiService, useValue: apiStub },
                { provide: ErrorHandlerService, useValue: { humanize: (e: unknown) => String(e) } },
                { provide: UserPreferencesService, useValue: prefs },
            ],
        });
        store = TestBed.inject(Store);
    }

 it('hides the dropdown when only a single section is available', () => {
        setup([sections[0]]);
        fixture = TestBed.createComponent(SiteSelectorComponent);
 // Seed state directly so we don't need to wait on the LoadSections
 // observable; component visibility derives from the seeded list.
        store.reset({ ...store.snapshot(), sections: { sections: [sections[0]], currentSectionSlug: null, loading: false, error: null } });
        fixture.detectChanges();
        const select = fixture.nativeElement.querySelector('select');
        expect(select).toBeNull();
    });

 it('renders the dropdown with all sections when multiple sections exist', () => {
        setup();
        fixture = TestBed.createComponent(SiteSelectorComponent);
        store.reset({ ...store.snapshot(), sections: { sections, currentSectionSlug: null, loading: false, error: null } });
        fixture.detectChanges();
        const options = fixture.nativeElement.querySelectorAll('option');
 // the empty option + 2 sections
        expect(options.length).toBe(3);
        expect(options[1].textContent).toContain('Default');
        expect(options[2].textContent).toContain('Marketing');
    });

 it('dispatches SetCurrentSection on selection', () => {
        setup();
        const dispatchSpy = spyOn(TestBed.inject(Store), 'dispatch').and.callThrough();
        fixture = TestBed.createComponent(SiteSelectorComponent);
        store.reset({ ...store.snapshot(), sections: { sections, currentSectionSlug: null, loading: false, error: null } });
        fixture.detectChanges();
        const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
        select.value = 'marketing';
        select.dispatchEvent(new Event('change'));
        const called = dispatchSpy.calls.allArgs().some(args =>
            args[0] instanceof SetCurrentSection && (args[0] as SetCurrentSection).slug === 'marketing',
        );
        expect(called).toBe(true);
    });

 // The persisted slug must reach the BOX, not just the store. The control
 // is bound with [value] while its options come from an @for below it, so
 // Angular applies the binding at the select's own index -- before the
 // repeater has created any option to match. The browser then resets the
 // select to its first option, and the binding never runs again because the
 // bound value itself has not changed. The result is a control reporting no
 // site while X-CoolMS-Section is being stamped with one.
 it('shows the persisted section on first render, before any interaction', () => {
        setup();
        fixture = TestBed.createComponent(SiteSelectorComponent);
        store.reset({ ...store.snapshot(), sections: { sections, currentSectionSlug: 'marketing', loading: false, error: null } });
        fixture.detectChanges();
        const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
        expect(select.value).toBe('marketing');
 // selectedIndex is what the operator actually reads: -1 or 0 both mean
 // the box disagrees with the store, and 0 is the misleading one because
 // it names the empty option as though it had been chosen.
        expect(select.selectedIndex).toBe(2);
    });

 it('dispatches LoadSections on init when list is empty', () => {
        setup([]);
        const dispatchSpy = spyOn(TestBed.inject(Store), 'dispatch').and.callThrough();
        fixture = TestBed.createComponent(SiteSelectorComponent);
        fixture.detectChanges();
        const called = dispatchSpy.calls.allArgs().some(args => args[0] instanceof LoadSections);
        expect(called).toBe(true);
    });
});
