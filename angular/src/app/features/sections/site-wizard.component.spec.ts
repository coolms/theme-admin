import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogRef } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideStore, Store } from '@ngxs/store';
import { of } from 'rxjs';
import { SiteWizardComponent } from './site-wizard.component';
import { SectionState } from './section.state';
import { ApplyNginxChanges, CreateSection } from './section.actions';
import { SectionsApiService } from './sections-api.service';
import { ErrorHandlerService, UserPreferencesService } from '@coolms/core-angular';

describe('SiteWizardComponent', () => {
    let fixture: ComponentFixture<SiteWizardComponent>;
    let store: Store;
    let http: HttpTestingController;
    let closed: jasmine.Spy;

    function setup(): void {
        const apiStub = jasmine.createSpyObj<SectionsApiService>(
            'SectionsApiService',
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
                { provide: SectionsApiService, useValue: apiStub },
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
        wizard.host.set('');
        wizard.prefix.set('');
        expect(wizard.stepValid()).toBe(false);
        wizard.prefix.set('/shop');
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
        wizard.host.set('shop.example.com');
        wizard.prefix.set('/');
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

    // The review names the address as it is NOW. `addressSummary` is a computed, and it read
    // host and prefix as plain fields: it ran when the review first showed and never again, so
    // going back and changing the host left the review naming the old one (the 2026-09-28
    // sweep). Done as the person does it -- the inputs and the Back/Next buttons -- and read
    // off the page.
    it('names the address as changed after going back from the review', async () => {
        setup();
        const page = fixture.nativeElement as HTMLElement;
        const button = (label: string): HTMLButtonElement =>
            [...page.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)!;
        const settle = async (): Promise<void> => {
            await fixture.whenStable();
            fixture.detectChanges();
        };
        const type = async (selector: string, value: string): Promise<void> => {
            const input = page.querySelector<HTMLInputElement>(selector)!;
            input.value = value;
            input.dispatchEvent(new Event('input'));
            await settle();
        };
        const wizard = fixture.componentInstance;
        // Identity by the component (its fields are plain and not what this is about), then
        // the address and everything after through the page.
        wizard.slug = 'marketing';
        wizard.label = 'Marketing';
        wizard.next();
        await settle();
        await type('#wiz-host', 'shop.example.com');
        button('Next').click();
        await settle();
        button('Next').click();
        await settle();
        expect(page.textContent).withContext('the review, first time').toContain('shop.example.com at /');

        button('Back').click();
        await settle();
        button('Back').click();
        await settle();
        await type('#wiz-host', 'store.example.com');
        button('Next').click();
        await settle();
        button('Next').click();
        await settle();
        expect(page.textContent).toContain('store.example.com at /');
    });
});
