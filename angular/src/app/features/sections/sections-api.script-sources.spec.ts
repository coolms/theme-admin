import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import type { ApiManifest } from '@coolms/core-angular';

import { SectionsApiService } from './sections-api.service';

/**
 * A site's allow-list is read and changed at the address the manifest names in the section module's own block
 * (`modules.section.siteScriptSources`); a server from before that block names none, and the address is then the
 * section's own plus `/script-sources`.
 */
describe('a site\'s allow-list is asked for where the manifest says', () => {
    const SECTIONS = {
        list: '/api/v1/sections', create: '/api/v1/sections', item: '/api/v1/sections/{id}',
        update: '/api/v1/sections/{id}', delete: '/api/v1/sections/{id}',
    };

    function service(manifest: Partial<ApiManifest>): { api: SectionsApiService; http: HttpTestingController } {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1', sections: SECTIONS, ...manifest }) } },
            ],
        });
        return { api: TestBed.inject(SectionsApiService), http: TestBed.inject(HttpTestingController) };
    }

    it('reads, adds and removes at the address the section module names', () => {
        const { api, http } = service({ modules: { section: { siteScriptSources: '/api/v2/sites/{id}/allowed-files' } } });

        api.listScriptSources('s-1').subscribe();
        api.addScriptSource('s-1', { kind: 'script', url: 'https://cdn.example.net/a.js', integrity: 'sha384-x' }).subscribe();
        api.removeScriptSource('s-1', 'f-9').subscribe();

        http.expectOne((r) => r.method === 'GET' && r.url === '/api/v2/sites/s-1/allowed-files');
        http.expectOne((r) => r.method === 'POST' && r.url === '/api/v2/sites/s-1/allowed-files');
        http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/v2/sites/s-1/allowed-files/f-9');
        http.verify();
    });

    it('falls back to the section\'s own address when the manifest names none', () => {
        const { api, http } = service({ modules: {} });

        api.listScriptSources('s-1').subscribe();

        http.expectOne((r) => r.method === 'GET' && r.url === '/api/v1/sections/s-1/script-sources');
        http.verify();
    });
});
