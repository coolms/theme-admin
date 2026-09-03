import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogRef } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideStore, Store } from '@ngxs/store';
import { of } from 'rxjs';
import { SiteWizardComponent } from './site-wizard.component';
import { SectionState } from './section.state';
import { ApplyNginxChanges, CreateSection } from './section.actions';
import { ApiService } from '../../api/api.service';
import { ErrorHandlerService, UserPreferencesService } from '@coolms/core-angular';

describe('SiteWizardComponent', () => {
    let fixture: ComponentFixture<SiteWizardComponent>;
    let store: Store;
    let http: HttpTestingController;
    let closed: jasmine.Spy;

    function setup(): void {
        const apiStub = jasmine.createSpyObj<ApiService>(
            'ApiService',
            ['getSections', 'createSection', 'applySections'],
        );
        apiStub.getSections.and.returnValue(of([]));
        apiStub.createSection.and.returnValue(of({ '@id': '/x', id: '9', slug: 'marketing', label: 'Marketing', isActive: true }));
        apiStub.applySections.and.returnValue(of({
            created: ['marketing'], updated: [], unchanged: [], skipped: [],
            outputDir: '/app/var/nginx/sites', reloadCommand: 'nginx -s reload', dryRun: false,
        }));

        const prefs = jasmine.createSpyObj<UserPreferencesService>(
            'UserPreferencesService',
            ['getPageState', 'setPageState'],
        );
        prefs.getPageState.and.returnValue(null);
        closed = jasmine.createSpy('close');

        TestBed.configureTestingModule({
            imports: [SiteWizardComponent],
            providers: [
                provideStore([SectionState]),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: ApiService, useValue: apiStub },
                { provide: DialogRef, useValue: { close: closed } },
                { provide: ErrorHandlerService, useValue: { humanize: (e: unknown) => String(e) } },
                { provide: UserPreferencesService, useValue: prefs },
            ],
        });
        store = TestBed.inject(Store);
        http = TestBed.inject(HttpTestingController);
        fixture = TestBed.createComponent(SiteWizardComponent);
        fixture.detectChanges();
        // The theme list is fetched in the constructor; answer it so no
        // request is left open when verify() runs.
        http.expectOne('/api/v1/options/theme.themes').flush({
            member: [{ value: 'coolms-site', label: 'CoolMS Site' }],
        });
    }

    afterEach(() => http.verify());

    it('will not leave step 1 without a slug and a label', () => {
        setup();
        const wizard = fixture.componentInstance;
        expect(wizard.stepValid()).toBe(false);
        wizard.slug = 'marketing';
        expect(wizard.stepValid()).toBe(false);
        wizard.label = 'Marketing';
        expect(wizard.stepValid()).toBe(true);
    });

    // A section with no host AND no path claims everything, which is what the
    // catch-all `default` section already is -- the API refuses the duplicate
    // claim, and meeting that as a 409 on the last step is a worse way to learn
    // it than being unable to leave the step that asks.
    it('will not leave the address step with neither a host nor a path', () => {
        setup();
        const wizard = fixture.componentInstance;
        wizard.slug = 'marketing';
        wizard.label = 'Marketing';
        wizard.next();
        wizard.host = '';
        wizard.prefix = '';
        expect(wizard.stepValid()).toBe(false);
        wizard.prefix = '/shop';
        expect(wizard.stepValid()).toBe(true);
    });

    //  THE POINT OF THE WIZARD. The flat create form never sent `themeSlug`
    // -- only the edit form did -- so every site created from the admin was born
    // with no theme binding. The create endpoint always accepted it.
    it('sends the chosen theme with CreateSection', () => {
        setup();
        const dispatched = spyOn(TestBed.inject(Store), 'dispatch').and.callThrough();
        const wizard = fixture.componentInstance;
        wizard.slug = 'marketing';
        wizard.label = 'Marketing';
        wizard.host = 'shop.example.com';
        wizard.prefix = '/';
        wizard.themeSlug = 'coolms-site';
        wizard.applyNginx = false;
        wizard.create();

        const create = dispatched.calls.allArgs()
            .map(args => args[0])
            .find((a): a is CreateSection => a instanceof CreateSection);
        expect(create).toBeDefined();
        expect(create!.payload.themeSlug).toBe('coolms-site');
        expect(create!.payload.matchHost).toBe('shop.example.com');
        expect(closed).toHaveBeenCalledWith(true);
    });

    // The vhost is generated through the SAME action the list page's Apply
    // button dispatches, so a second implementation cannot drift from it.
    it('dispatches the existing apply action when asked to generate the vhost', () => {
        setup();
        const dispatched = spyOn(TestBed.inject(Store), 'dispatch').and.callThrough();
        const wizard = fixture.componentInstance;
        wizard.slug = 'marketing';
        wizard.label = 'Marketing';
        wizard.applyNginx = true;
        wizard.create();

        const applied = dispatched.calls.allArgs()
            .map(args => args[0])
            .some(a => a instanceof ApplyNginxChanges);
        expect(applied).toBe(true);
    });
});
