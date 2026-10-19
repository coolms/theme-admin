import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { designerMessages } from '@coolms/designer';

import { DesignerI18nService, lookupOrder } from './designer-i18n.service';

/**
 * The designer's strings come from the platform's catalogues, most specific first -- the locale the PLATFORM
 * resolved, its parent, the platform's default -- and then the designer's own bundled base catalogue (2026-10-14).
 *
 * The properties worth pinning are mostly the unhappy ones: a catalogue that cannot be read, a locale probe that
 * fails, an untranslated key -- each must leave the editor reading the next catalogue down, ending at the base
 * one, rather than showing a key or an empty label.
 */
describe('DesignerI18nService', () => {
    let svc: DesignerI18nService;
    let http: HttpTestingController;

    const LOCALE_URL = '/api/v1/i18n/current-locale';
    const catalogueUrl = (locale: string): string => `/api/v1/i18n/catalogues/workflow:${locale}`;
    const UNDO = 'designer.toolbar.undo';
    const REDO = 'designer.toolbar.redo';
    const SAVE = 'designer.toolbar.save';
    const ZOOM = 'designer.toolbar.zoomIn';

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
        svc = TestBed.inject(DesignerI18nService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    type Entry = { key: string; baseline: string; override: string | null };
    const catalogue = (entries: Entry[]): { entries: Entry[] } => ({ entries });

    /**
     * Let the pending promise chain advance. The catalogue requests are not issued until the locale probe
     * RESOLVES, so flushing both in one synchronous run finds no second request.
     */
    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    /** Answer the locale probe, then each catalogue it triggers, in the order given. */
    async function resolveAs(
        locale: string,
        defaultLocale: string,
        catalogues: Record<string, { entries: Entry[] } | 'fail'>,
    ): Promise<void> {
        http.expectOne(LOCALE_URL).flush({ locale, supportedLocales: [locale, defaultLocale], defaultLocale });
        await tick();
        for (const [l, answer] of Object.entries(catalogues)) {
            const req = http.expectOne(catalogueUrl(l));
            if (answer === 'fail') {
                req.flush('boom', { status: 500, statusText: 'Server Error' });
            } else {
                req.flush(answer);
            }
        }
    }

    it('asks the platform which locale it resolved, and reads its catalogue, its parent\'s and the default\'s', async () => {
        const loading = svc.ensureLoaded();

        const probe = http.expectOne(LOCALE_URL);
        expect(probe.request.method).toBe('GET');
        probe.flush({ locale: 'uk-UA', supportedLocales: ['uk-UA', 'uk', 'de'], defaultLocale: 'de' });
        await tick();

        // The locales it was TOLD drive the catalogues it reads, most specific first.
        http.expectOne(catalogueUrl('uk-UA')).flush(catalogue([{ key: UNDO, baseline: 'Undo', override: 'Скасувати' }]));
        http.expectOne(catalogueUrl('uk')).flush(catalogue([
            { key: UNDO, baseline: 'Undo', override: 'parent-undo' },
            { key: REDO, baseline: 'Redo', override: 'Повторити' },
        ]));
        http.expectOne(catalogueUrl('de')).flush(catalogue([
            { key: REDO, baseline: 'Redo', override: 'default-redo' },
            { key: SAVE, baseline: 'Save', override: 'Speichern' },
        ]));
        await loading;

        expect(svc.translate(UNDO)).withContext('the locale over its parent').toBe('Скасувати');
        expect(svc.translate(REDO)).withContext('the parent over the default').toBe('Повторити');
        expect(svc.translate(SAVE)).withContext('the default').toBe('Speichern');
        expect(svc.translate(ZOOM)).withContext('the designer\'s base catalogue, last').toBe(designerMessages[ZOOM] as string);
    });

    it('takes a catalogue\'s baseline where it has no override', async () => {
        const loading = svc.ensureLoaded();
        await resolveAs('uk', 'uk', { uk: catalogue([{ key: REDO, baseline: 'Redo (server)', override: null }]) });
        await loading;

        expect(svc.translate(REDO)).toBe('Redo (server)');
    });

    it('reads the platform\'s catalogue for the base language too, so an operator\'s override counts', async () => {
        const loading = svc.ensureLoaded();
        // The same locale twice is asked for once.
        await resolveAs('base', 'base', { base: catalogue([{ key: UNDO, baseline: 'Undo', override: 'Undo it' }]) });
        await loading;

        expect(svc.translate(UNDO)).toBe('Undo it');
    });

    it('interpolates into the TRANSLATED text', async () => {
        const loading = svc.ensureLoaded();
        await resolveAs('uk', 'uk', {
            uk: catalogue([{ key: 'designer.command.connect', baseline: 'Connect', override: "З'єднати %source% та %target%" }]),
        });
        await loading;

        expect(svc.translate('designer.command.connect', { source: 'a', target: 'b' })).toBe("З'єднати a та b");
    });

    it('reads the base catalogue before anything is loaded', () => {
        expect(svc.translate(UNDO)).toBe(designerMessages[UNDO] as string);
        http.expectNone(() => true);
    });

    it('skips a catalogue that cannot be read, and goes on to the next', async () => {
        const loading = svc.ensureLoaded();
        await resolveAs('uk', 'de', {
            uk: 'fail',
            de: catalogue([{ key: UNDO, baseline: 'Undo', override: 'Rückgängig' }]),
        });
        await loading;

        // A failed request degrades to the next catalogue; it never throws or blanks the labels.
        expect(svc.translate(UNDO)).toBe('Rückgängig');
        expect(svc.translate(ZOOM)).toBe(designerMessages[ZOOM] as string);
    });

    it('reads the base catalogue when the locale probe itself fails', async () => {
        const loading = svc.ensureLoaded();
        http.expectOne(LOCALE_URL).flush('nope', { status: 500, statusText: 'Server Error' });
        await loading;

        // Not knowing the locale must not mean guessing one.
        http.expectNone(() => true);
        expect(svc.translate(UNDO)).toBe(designerMessages[UNDO] as string);
    });

    it('loads once, however many editors mount', async () => {
        const first = svc.ensureLoaded();
        await resolveAs('uk', 'uk', { uk: catalogue([]) });
        await first;

        await svc.ensureLoaded();
        await svc.ensureLoaded();
        http.expectNone(() => true);
    });

    it('de-duplicates concurrent loads', async () => {
        const a = svc.ensureLoaded();
        const b = svc.ensureLoaded();

        // Two editors mounting together must not race two probes.
        await resolveAs('uk', 'uk', { uk: catalogue([{ key: UNDO, baseline: 'Undo', override: 'Скасувати' }]) });
        await Promise.all([a, b]);

        expect(svc.translate(UNDO)).toBe('Скасувати');
    });
});

describe('lookupOrder', () => {
    it('is the locale, its parent, then the default', () => {
        expect(lookupOrder('uk-UA', 'de')).toEqual(['uk-UA', 'uk', 'de']);
        expect(lookupOrder('pt_BR', 'de')).toEqual(['pt_BR', 'pt', 'de']);
    });

    it('names each locale once', () => {
        expect(lookupOrder('uk', 'uk')).toEqual(['uk']);
        expect(lookupOrder('uk-UA', 'uk')).toEqual(['uk-UA', 'uk']);
    });
});
