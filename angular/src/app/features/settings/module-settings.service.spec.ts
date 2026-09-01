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
        locked: {},
 // Added with per-site overrides. The service defaults a wire payload
 // that omits them to exactly this pair, so the fixture matches what
 // the normaliser produces rather than inventing a shape.
        siteScopable: false,
        scope: null,
        storedAt: '/app/config/modules/settings/dynamic_chat.prechat.yaml',
    };

    /**
     * The values in force reach the form, and `data` / `defaults` stay separate
     * beside them -- the Reset button needs to know whether anything is saved,
     * which `effective` alone cannot say.
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

 it('carries the values in force through to the form', () => {
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat').flush({
            ...BLOCK,
            data: { require_contact: 'saved', countries: ['BY'] },
            defaults: { require_contact: 'either', default_country: 'US' },
            effective: { default_country: 'US', require_contact: 'saved', countries: ['BY'] },
        });

        expectEffective(got!);
    });

 it('takes the server at its word instead of recomposing the merge', () => {
 // The whole reason `effective` moved server-side. A key saved as `null`
 // means CLEARED, and a spread here would agree -- but the PHP consumers
 // merged with a per-key type guard and went on using the shipped value,
 // so the screen described a configuration that was not running.
 //
 // Feeding an `effective` that a naive `{ ...defaults, ...data }` could
 // not produce is what makes this test able to fail: recompose here and
 // `require_contact` comes back 'either', not null.
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat').flush({
            ...BLOCK,
            data: { require_contact: null },
            defaults: { require_contact: 'either', default_country: 'US' },
            effective: { require_contact: null, default_country: 'US' },
        });

        expect(got!.effective).toEqual({ require_contact: null, default_country: 'US' });
    });

 it('shows a block nobody has edited running on its shipped values', () => {
 // The bug this exists for: the screen for a module running happily on
 // its defaults rendered blank, and a REQUIRED select read "-- Select --"
 // for a value the system definitely had. The server composes it now, so
 // what this pins is that an empty `data` still arrives as a map and does
 // not swallow what came with it.
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat')
            .flush({ ...BLOCK, data: [], defaults: { require_contact: 'either' }, effective: { require_contact: 'either' } });

        expect(got!.effective).toEqual({ require_contact: 'either' });
        expect(got!.data).toEqual({}, 'still says nothing is saved');
    });

 it('carries the environment-pinned keys and the variables that own them', () => {
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat')
            .flush({ ...BLOCK, locked: { require_contact: 'PRECHAT_REQUIRE_CONTACT' } });

 // The variable NAME is the payload, not a boolean: a greyed field with no
 // explanation reads as a bug, and the operator needs to know where the
 // value actually comes from.
        expect(got!.locked).toEqual({ require_contact: 'PRECHAT_REQUIRE_CONTACT' });
    });

 it('drops a lock entry that does not name a variable', () => {
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat')
            .flush({ ...BLOCK, locked: { a: 'REAL_VAR', b: true, c: '', d: null } });

 // A lock we cannot explain would disable a control and say nothing about
 // why — worse than not locking it.
        expect(got!.locked).toEqual({ a: 'REAL_VAR' });
    });

 it('treats a block with no locks as fully editable', () => {
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        const { locked: _dropped, ...withoutLocked } = BLOCK;
        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat').flush(withoutLocked);

        expect(got!.locked).toEqual({});
    });

 it('turns a field the server OMITTED into null, not undefined', () => {
 // **The wire never sends `null` — it sends nothing.** API Platform
 // defaults `skip_null_values` to true, so a null property is dropped from
 // the JSON entirely while the DTO still promises `string | null`. A
 // consumer written to that promise with an explicit `null !== x` test
 // then lets `undefined` through.
 //
 // Not hypothetical: it took the whole settings screen down with
 // "Cannot read properties of undefined (reading 'replace')" the moment
 // the first block without a `moduleRoute` existed.
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('web.page_cache').subscribe(b => (got = b));

        const { moduleRoute: _r, moduleLabel: _l, moduleIcon: _i, storedAt: _s, ...omitted } = BLOCK;
        http.expectOne('/api/v1/module-settings/web.page_cache').flush(omitted);

        expect(got!.moduleRoute).toBeNull();
        expect(got!.moduleLabel).toBeNull();
        expect(got!.moduleIcon).toBeNull();
        expect(got!.storedAt).toBeNull();
    });

 it('leaves the values in force EMPTY when the server sent none', () => {
 // Deliberate, and the opposite of resilient. Recomposing the merge as a
 // fallback would put the second implementation back exactly where the
 // server is already misbehaving. A blank form gets reported; a plausible
 // wrong one does not.
        let got: ModuleSettingsBlockDto | null = null;
        settings.get('dynamic_chat.prechat').subscribe(b => (got = b));

        const { effective: _dropped, ...withoutEffective } = BLOCK;
        http.expectOne('/api/v1/module-settings/dynamic_chat.prechat').flush(withoutEffective);

        expect(got!.effective).toEqual({});
        expect(got!.data).toEqual(BLOCK.data, 'the saved values still arrive');
    });

 it('filters the collection to one module', () => {
        const other: ModuleSettingsBlockDto = { ...BLOCK, key: 'navi.x', module: 'navi' };

        let got: ModuleSettingsBlockDto[] = [];
        settings.forModule('dynamic-chat').subscribe(b => (got = b));

        http.expectOne('/api/v1/module-settings').flush([BLOCK, other]);

        expect(got.map(b => b.key)).toEqual(['dynamic_chat.prechat']);
    });
});
