import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { DesignerI18nService } from './designer-i18n.service';

/**
 * The designer's strings come from the platform catalogue, for the locale the
 * PLATFORM resolved -- not the one the browser happens to advertise.
 *
 * The properties worth pinning are mostly the unhappy ones: a missing
 * catalogue, a 403, or an untranslated key must all leave the editor reading
 * English rather than showing a key or an empty label.
 */
describe('DesignerI18nService', () => {
    let svc: DesignerI18nService;
    let http: HttpTestingController;

    const LOCALE_URL = '/api/v1/i18n/current-locale';
    const catalogueUrl = (locale: string) => `/api/v1/i18n/catalogues/workflow:${locale}`;

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
        svc = TestBed.inject(DesignerI18nService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    const CATALOGUE = {
        entries: [
            { key: 'designer.toolbar.undo', baseline: 'Undo', override: 'Скасувати' },
            { key: 'designer.toolbar.redo', baseline: 'Redo', override: null },
            {
                key: 'designer.command.connect',
                baseline: 'Connect %source% → %target%',
                override: "З'єднати %source% та %target%",
            },
        ],
    };

    /**
     * Let the pending promise chain advance. The catalogue request is not
     * issued until the locale probe RESOLVES, so flushing both in one
     * synchronous run finds no second request.
     */
    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    /** Answer the locale probe, then the catalogue fetch it triggers. */
    async function resolveAs(
        locale: string,
        catalogue: typeof CATALOGUE = CATALOGUE,
    ): Promise<void> {
        http.expectOne(LOCALE_URL).flush({
            locale,
            supportedLocales: ['en', locale],
            defaultLocale: 'en',
        });
        if (locale !== 'en') {
            await tick();
            http.expectOne(catalogueUrl(locale)).flush(catalogue);
        }
    }

 it('asks the platform which locale it resolved, not the browser', async () => {
        const loading = svc.ensureLoaded();

        const probe = http.expectOne(LOCALE_URL);
        expect(probe.request.method).toBe('GET');
        probe.flush({ locale: 'uk', supportedLocales: ['en', 'uk'], defaultLocale: 'en' });
        await tick();

 // The locale it was TOLD drives the catalogue it fetches.
        http.expectOne(catalogueUrl('uk')).flush(CATALOGUE);
        await loading;

        expect(svc.translate('designer.toolbar.undo', 'Undo')).toBe('Скасувати');
    });

 it('skips the catalogue entirely for an English session', async () => {
        const loading = svc.ensureLoaded();
        await resolveAs('en');
        await loading;

 // The package's fallbacks ARE the English baseline, so a catalogue
 // could only echo them back.
        http.expectNone(catalogueUrl('en'));
        expect(svc.translate('designer.toolbar.undo', 'Undo')).toBe('Undo');
    });

 it('falls back to the baseline when an entry has no override', async () => {
        const loading = svc.ensureLoaded();
        await resolveAs('uk');
        await loading;

        expect(svc.translate('designer.toolbar.redo', 'Redo')).toBe('Redo');
    });

 it('falls back to the call-site English for a key the catalogue lacks', async () => {
        const loading = svc.ensureLoaded();
        await resolveAs('uk');
        await loading;

        const out = svc.translate('designer.palette.kind.task', 'Task');
        expect(out).toBe('Task');
        expect(out).not.toContain('designer.');
    });

 it('interpolates into the TRANSLATED text, not the fallback', async () => {
        const loading = svc.ensureLoaded();
        await resolveAs('uk');
        await loading;

        expect(
            svc.translate('designer.command.connect', 'Connect %source% → %target%', {
                source: 'a',
                target: 'b',
            }),
        ).toBe("З'єднати a та b");
    });

 it('keeps rendering English when the catalogue request fails', async () => {
        const loading = svc.ensureLoaded();
        http.expectOne(LOCALE_URL).flush({
            locale: 'uk',
            supportedLocales: ['en', 'uk'],
            defaultLocale: 'en',
        });
        await tick();
        http.expectOne(catalogueUrl('uk')).flush('denied', {
            status: 403,
            statusText: 'Forbidden',
        });
        await loading;

 // A 403 is a NORMAL case: the catalogue endpoint is admin-gated. It
 // must degrade, never throw or blank the labels.
        expect(svc.translate('designer.toolbar.undo', 'Undo')).toBe('Undo');
    });

 it('keeps rendering English when the locale probe itself fails', async () => {
        const loading = svc.ensureLoaded();
        http.expectOne(LOCALE_URL).flush('nope', { status: 500, statusText: 'Server Error' });
        await loading;

 // Not knowing the locale must not mean guessing one.
        http.expectNone(() => true);
        expect(svc.translate('designer.toolbar.undo', 'Undo')).toBe('Undo');
    });

 it('loads once, however many editors mount', async () => {
        const first = svc.ensureLoaded();
        await resolveAs('uk');
        await first;

        await svc.ensureLoaded();
        await svc.ensureLoaded();
        http.expectNone(() => true);
    });

 it('de-duplicates concurrent loads', async () => {
        const a = svc.ensureLoaded();
        const b = svc.ensureLoaded();

 // Two editors mounting together must not race two probes.
        await resolveAs('uk');
        await Promise.all([a, b]);

        expect(svc.translate('designer.toolbar.undo', 'Undo')).toBe('Скасувати');
    });
});
