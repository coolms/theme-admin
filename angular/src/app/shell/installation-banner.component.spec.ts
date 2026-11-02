import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { InstallationBannerComponent } from './installation-banner.component';

/**
 * The banner across the admin while the installation is not marked as production, and nothing once it is, or for
 * anyone the server does not answer.
 */
describe('InstallationBannerComponent', () => {
    const URL = '/api/v1/application/installation';

    function render(): { text: () => string; http: HttpTestingController; fixture: ReturnType<typeof TestBed.createComponent<InstallationBannerComponent>> } {
        TestBed.configureTestingModule({
            imports: [InstallationBannerComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
            ],
        });
        const fixture = TestBed.createComponent(InstallationBannerComponent);
        fixture.detectChanges();
        const http = TestBed.inject(HttpTestingController);

        return { text: () => (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '', http, fixture };
    }

    it('says so while the installation was never marked, naming the command', () => {
        const { text, http, fixture } = render();
        http.expectOne(URL).flush({ production: false, answered: false });
        fixture.detectChanges();

        expect(text()).toContain('has not been marked as production');
        expect(text()).toContain('every site is kept out of search results');
        expect(text()).toContain('coolms:application:production on');
    });

    it('says it is not marked when it was answered no', () => {
        const { text, http, fixture } = render();
        http.expectOne(URL).flush({ production: false, answered: true });
        fixture.detectChanges();

        expect(text()).toContain('is not marked as production');
    });

    it('shows nothing once the installation is production', () => {
        const { text, http, fixture } = render();
        http.expectOne(URL).flush({ production: true, answered: true });
        fixture.detectChanges();

        expect(text()).toBe('');
    });

    it('shows nothing to someone the server refuses', () => {
        const { text, http, fixture } = render();
        http.expectOne(URL).flush({ title: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
        fixture.detectChanges();

        expect(text()).toBe('');
    });
});
