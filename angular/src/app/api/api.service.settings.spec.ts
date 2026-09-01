import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';

import { ApiService } from './api.service';

/**
 * Content negotiation on the settings endpoints.
 *
 * A settings section is a MAP. API Platform's ld+json representation turns a
 * map into a Hydra Collection and puts the values in a `member` ARRAY with the
 * keys stripped, so `updated['theme']` reads `undefined` off a response that
 * looks perfectly successful — 200, right values, wrong shape.
 *
 * `getSettings()` has always forced `Accept: application/json` for this reason.
 * `updateSettings()` did not, and nothing noticed: the PATCH persisted
 * correctly and only the in-memory echo was mangled, which stays invisible
 * until a caller READS a field off it. The per-user accent colour was the first
 * feature to do that, and it silently did nothing.
 *
 * These pin the header on both, because the bug is a missing header and a test
 * that only checked the parsed body would pass against the broken version.
 */
describe('ApiService settings content negotiation', () => {
    let api: ApiService;
    let http: HttpTestingController;

    const manifest = {
        identity: {
            settingsUrl: '/api/v1/auth/me/settings',
            settingsSectionUrl: '/api/v1/auth/me/settings/{section}',
        },
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [
                ApiService,
                { provide: Store, useValue: { selectSnapshot: () => manifest } },
            ],
        });
        api = TestBed.inject(ApiService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('asks for plain JSON when reading settings', () => {
        api.getSettings().subscribe();

        const req = http.expectOne('/api/v1/auth/me/settings');
        expect(req.request.headers.get('Accept')).toBe('application/json');
        req.flush({});
    });

    it('asks for plain JSON when saving a section, so the keys survive', () => {
        api.updateSettings('preferences', { accentColor: '#3366ff' }).subscribe();

        const req = http.expectOne('/api/v1/auth/me/settings/preferences');
        expect(req.request.method).toBe('PATCH');
        // Without this the response comes back as {"member":[…]} and every
        // caller that reads a named field off it gets undefined.
        expect(req.request.headers.get('Accept')).toBe('application/json');
        // The merge-patch content type must survive alongside it — API Platform
        // rejects the PATCH outright without it.
        expect(req.request.headers.get('Content-Type')).toBe('application/merge-patch+json');
        req.flush({});
    });

    it('returns the saved section as a keyed object', () => {
        let received: Record<string, unknown> | undefined;
        api.updateSettings('preferences', {}).subscribe(r => (received = r));

        http.expectOne('/api/v1/auth/me/settings/preferences')
            .flush({ theme: 'dark', accentColor: '#3366ff' });

        expect(received?.['theme']).toBe('dark');
        expect(received?.['accentColor']).toBe('#3366ff');
    });
});
