import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';

import { ModuleSettingsService } from './module-settings.service';
import { ModuleSettingsBlockDto } from './module-settings.types';

/**
 * A settings block's `data` is a MAP, and that is the whole hazard here.
 *
 * Without an explicit `Accept`, API Platform negotiates `application/ld+json`
 * and renders a map as a Hydra Collection with the KEYS STRIPPED — a 200 that
 * carries every value and no way to name one. The settings form would then load
 * empty over values that ARE saved, and the next Save would write those blanks
 * back. The platform has already paid for this once on
 * `PATCH /auth/me/settings/{section}`, where it hid for the endpoint's whole
 * life because every caller merged the echo into a cache without reading a named
 * field off it.
 *
 * So the fake backend below decides its shape from the REQUEST, the way the real
 * one does. The spec never picks the good shape — the header the service sends
 * does — which is what makes these regression tests rather than a restatement of
 * the fixed code. Delete `Accept: application/json` from any call and its test
 * goes red on a value the UI actually reads.
 */
describe('ModuleSettingsService', () => {
    const MANIFEST = { apiBase: '/api/v1' };

    const BLOCK: ModuleSettingsBlockDto = {
        key: 'dynamic_chat.prechat',
        module: 'dynamic-chat',
        label: 'Pre-chat form policy',
        moduleLabel: 'Dynamic Chat',
        moduleIcon: 'chat-left-dots',
        moduleRoute: 'dynamic-chat',
        formId: 'dynamic_chat_prechat_settings',
        data: { countries: ['BY', 'PL'], require_contact: 'either' },
        defaults: { require_contact: 'either', default_country: 'US' },
        effective: { default_country: 'US', countries: ['BY', 'PL'], require_contact: 'either' },
        storedAt: '/app/config/modules/settings/dynamic_chat.prechat.yaml',
    };

    /**
     * The saved values win, the shipped ones fill the gaps, and the form gets
     * the result -- rendering only `data` is what left a settings screen blank
     * for a module running on its defaults.
     */
    function expectEffective(block: ModuleSettingsBlockDto): void {
        expect(block.effective).toEqual({ default_country: 'US', require_contact: 'saved', countries: ['BY'] });
        expect(block.data).toEqual({ require_contact: 'saved', countries: ['BY'] });
        expect(block.defaults).toEqual({ require_contact: 'either', default_country: 'US' });
    }

    let settings: ModuleSettingsService;
    let http: HttpTestingController;

    /**
     * API Platform's content negotiation for a resource carrying a map,
     * modelled: ask for plain JSON and the map survives; leave it to negotiate
     * and `data` comes back as a keyless Hydra Collection.
     */
    function flushBlock(req: TestRequest, block: ModuleSettingsBlockDto): void {
        if ('application/json' === req.request.headers.get('Accept')) {
            req.flush(block);
            return;
        }
        req.flush({
            ...block,
            '@context': '/api/contexts/ModuleSettings',
            '@type': 'ModuleSettings',
            data: {
                '@type': 'Collection',
                member: Object.values(block.data),
                totalItems: Object.keys(block.data).length,
            },
        });
    }

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => MANIFEST } },
            ],
        });

        settings = TestBed.inject(ModuleSettingsService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('reads a block with its map keys intact', () => {
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        flushBlock(http.expectOne('/api/v1/module-settings/dynamic_chat.prechat'), BLOCK);

        // Named-field reads: exactly what the settings form does, and exactly
        // what a Hydra Collection cannot answer.
        expect(got!.data['countries']).toEqual(['BY', 'PL']);
        expect(got!.data['require_contact']).toBe('either');
    });

    it('lists blocks with their map keys intact', () => {
        let got: ModuleSettingsBlockDto[] = [];
        settings.list().subscribe(b => (got = b));

        const req = http.expectOne('/api/v1/module-settings');
        expect(req.request.headers.get('Accept')).toBe('application/json');
        req.flush([BLOCK]);

        expect(got.length).toBe(1);
        expect(got[0].data['countries']).toEqual(['BY', 'PL']);
    });

    it('saves under `data` and keeps the persisted echo readable', () => {
        let echo: ModuleSettingsBlockDto | null = null;
        settings.save('dynamic_chat.prechat', { countries: ['BY'] }).subscribe(b => (echo = b));

        const req = http.expectOne('/api/v1/module-settings/dynamic_chat.prechat');
        expect(req.request.method).toBe('PUT');
        // The resource's writable group is `data`; a bare map would denormalize
        // into nothing and save an empty block over a good one.
        expect(req.request.body).toEqual({ data: { countries: ['BY'] } });

        flushBlock(req, { ...BLOCK, data: { countries: ['BY'] } });

        expect(echo!.data['countries']).toEqual(['BY']);
    });

    it('resets a block with DELETE', () => {
        let done = false;
        settings.reset('dynamic_chat.prechat').subscribe(() => (done = true));

        const req = http.expectOne('/api/v1/module-settings/dynamic_chat.prechat');
        expect(req.request.method).toBe('DELETE');
        req.flush(null);

        expect(done).toBeTrue();
    });

    it('percent-encodes the key so it cannot escape its path segment', () => {
        settings.get('a/../b').subscribe();

        http.expectOne('/api/v1/module-settings/a%2F..%2Fb').flush(BLOCK);
    });

    it('turns an unedited block\'s empty PHP array into a map', () => {
        // PHP has one array type, so an empty settings map encodes as `[]`. The
        // DTO promises a map; without normalising, the first consumer to treat
        // `data` as one is right by the type and wrong at runtime.
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat')
            .flush({ ...BLOCK, data: [] });

        expect(Array.isArray(got!.data)).toBeFalse();
        expect(got!.data).toEqual({});
    });

    it('composes the values in force from the shipped defaults and the saved ones', () => {
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat').flush({
            ...BLOCK,
            data: { require_contact: 'saved', countries: ['BY'] },
            defaults: { require_contact: 'either', default_country: 'US' },
        });

        expectEffective(got!);
    });

    it('falls back to the shipped values for a block nobody has edited', () => {
        // The bug this exists for: the screen for a module running happily on
        // its defaults rendered blank, and a REQUIRED select read "-- Select --"
        // for a value the system definitely had.
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat')
            .flush({ ...BLOCK, data: [], defaults: { require_contact: 'either' } });

        expect(got!.effective).toEqual({ require_contact: 'either' });
        expect(got!.data).toEqual({}, 'still says nothing is saved');
    });

    it('treats missing defaults as none, so an older server still renders', () => {
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        const { defaults: _dropped, ...withoutDefaults } = BLOCK;
        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat').flush(withoutDefaults);

        expect(got!.defaults).toEqual({});
        expect(got!.effective).toEqual(BLOCK.data);
    });

    it('filters the collection to one module', () => {
        const other: ModuleSettingsBlockDto = { ...BLOCK, key: 'navi.x', module: 'navi' };

        let got: ModuleSettingsBlockDto[] = [];
        settings.forModule('dynamic-chat').subscribe(b => (got = b));

        http.expectOne('/api/v1/module-settings').flush([BLOCK, other]);

        expect(got.map(b => b.key)).toEqual(['dynamic_chat.prechat']);
    });
});
