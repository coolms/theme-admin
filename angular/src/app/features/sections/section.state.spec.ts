import { TestBed } from '@angular/core/testing';
import { provideStore, Store } from '@ngxs/store';
import { of } from 'rxjs';
import { SectionState } from './section.state';
import { LoadSections, SetCurrentSection } from './section.actions';
import { ApiService, SiteSectionDto } from '../../api/api.service';
import { ErrorHandlerService, UserPreferencesService } from '@coolms/core-angular';
describe('SectionState (H7 currentSection)', () => {
    let store: Store;
    let prefs: jasmine.SpyObj<UserPreferencesService>;

    const sectionDefault: SiteSectionDto = {
        '@id': '/api/v1/sections/1',
        id: '1',
        slug: 'default',
        label: 'Default',
        isActive: true,
    };
    const sectionMarketing: SiteSectionDto = {
        '@id': '/api/v1/sections/2',
        id: '2',
        slug: 'marketing',
        label: 'Marketing',
        isActive: true,
    };

    beforeEach(() => {
        const apiStub  = jasmine.createSpyObj<ApiService>('ApiService', ['getSections']);
        apiStub.getSections.and.returnValue(of([sectionDefault, sectionMarketing]));
        prefs = jasmine.createSpyObj<UserPreferencesService>(
            'UserPreferencesService',
            ['getPageState', 'setPageState'],
        );
        prefs.getPageState.and.returnValue(null);

        TestBed.configureTestingModule({
            providers: [
                provideStore([SectionState]),
                { provide: ApiService, useValue: apiStub },
                { provide: ErrorHandlerService, useValue: { humanize: (e: unknown) => String(e) } },
                { provide: UserPreferencesService, useValue: prefs },
            ],
        });
        store = TestBed.inject(Store);
    });

 it('defaults currentSectionSlug to null', () => {
        expect(store.selectSnapshot(SectionState.currentSectionSlug)).toBeNull();
    });

 it('SetCurrentSection persists and updates state', () => {
        store.dispatch(new SetCurrentSection('marketing'));
        expect(store.selectSnapshot(SectionState.currentSectionSlug)).toBe('marketing');
        expect(prefs.setPageState).toHaveBeenCalledWith('section', { currentSlug: 'marketing' });
    });

 it('LoadSections hydrates current slug from prefs when valid', () => {
        prefs.getPageState.and.returnValue({ currentSlug: 'marketing' });
        store.dispatch(new LoadSections());
        expect(store.selectSnapshot(SectionState.currentSectionSlug)).toBe('marketing');
        expect(store.selectSnapshot(SectionState.availableSections).length).toBe(2);
    });

 it('LoadSections clears stale slug not present in fresh list', () => {
        prefs.getPageState.and.returnValue({ currentSlug: 'gone' });
        store.dispatch(new LoadSections());
        expect(store.selectSnapshot(SectionState.currentSectionSlug)).toBeNull();
    });

 it('currentSection selector returns the matched DTO or null', () => {
        store.dispatch(new LoadSections());
        store.dispatch(new SetCurrentSection('marketing'));
        expect(store.selectSnapshot(SectionState.currentSection)?.slug).toBe('marketing');
        store.dispatch(new SetCurrentSection(null));
        expect(store.selectSnapshot(SectionState.currentSection)).toBeNull();
    });
});
