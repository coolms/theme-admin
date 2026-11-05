import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SidebarStateService } from '@coolms/core-angular';
import { Store } from '@ngxs/store';

import { ConsoleSettingsService } from './console-settings.service';

const READ = '/api/v1/auth/me/settings/declared?host=console';
const SAVE = '/api/v1/auth/me/settings/console';

function key(name: string, value: unknown, own: unknown = null, locked = false): Record<string, unknown> {
    return { key: name, value, own, locked };
}

describe('ConsoleSettingsService', () => {
    let http: HttpTestingController;
    let service: ConsoleSettingsService;
    let collapsed: ReturnType<typeof signal<boolean>>;

    function answer(keys: ReadonlyArray<Record<string, unknown>>, version: string | null = 'v1'): void {
        service.load().subscribe();
        http.expectOne(READ).flush([{ section: 'console', version, keys }]);
        TestBed.flushEffects();
    }

    beforeEach(() => {
        collapsed = signal(false);
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                {
                    provide: SidebarStateService,
                    useValue: { collapsed, toggle: () => collapsed.update(v => !v) },
                },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        service = TestBed.inject(ConsoleSettingsService);
    });

    afterEach(() => http.verify());

    it('leaves the pages as they were when nothing could be read, and writes nothing', () => {
        service.load().subscribe();
        http.expectOne(READ).flush('no', { status: 500, statusText: 'Server Error' });
        collapsed.set(true);
        TestBed.flushEffects();

        expect(service.pageSize()).toBe(50);
        expect(service.explorerView()).toBeNull();
        expect(service.vfsView()).toBeNull();
    });

    it('answers the value in force', () => {
        answer([key('pageSize', 100), key('viewMode', 'tiles')]);

        expect(service.pageSize()).toBe(100);
        expect(service.explorerView()).toBe('large');
        expect(service.vfsView()).toBe('grid');
    });

    it('maps list to each vocabulary, and page to none', () => {
        answer([key('viewMode', 'list')]);
        expect(service.explorerView()).toBe('details');
        expect(service.vfsView()).toBe('list');

        answer([key('viewMode', 'page')]);
        expect(service.explorerView()).toBeNull();
        expect(service.vfsView()).toBeNull();
    });

    it('a value the server holds wins over the device, with no write', () => {
        collapsed.set(true);

        answer([key('sidebarCollapsed', false, false)]);

        expect(collapsed()).toBe(false);
    });

    it('with none held, the device state that differs is saved once, naming the version', () => {
        collapsed.set(true);

        answer([key('sidebarCollapsed', false)]);

        expect(collapsed()).toBe(true);
        const save = http.expectOne(SAVE);
        expect(save.request.method).toBe('PATCH');
        expect(save.request.headers.get('If-Match')).toBe('"v1"');
        expect(save.request.body).toEqual({ sidebarCollapsed: true });
        save.flush({}, { headers: { ETag: '"v2"' } });
        TestBed.flushEffects();
    });

    it('with none held and the device at the default, writes nothing', () => {
        answer([key('sidebarCollapsed', false)]);

        expect(collapsed()).toBe(false);
    });

    it('a toggle is saved over the version the last save answered', () => {
        answer([key('sidebarCollapsed', false, false)]);

        collapsed.set(true);
        TestBed.flushEffects();
        http.expectOne(SAVE).flush({}, { headers: { ETag: '"v2"' } });
        TestBed.flushEffects();

        collapsed.set(false);
        TestBed.flushEffects();
        const second = http.expectOne(SAVE);
        expect(second.request.headers.get('If-Match')).toBe('"v2"');
        second.flush({}, { headers: { ETag: '"v3"' } });
        TestBed.flushEffects();
    });

    it('a toggle made during a save is saved after it, not over a stale version', () => {
        answer([key('sidebarCollapsed', false, false)]);

        collapsed.set(true);
        TestBed.flushEffects();
        const first = http.expectOne(SAVE);
        collapsed.set(false);
        TestBed.flushEffects();
        collapsed.set(true);
        TestBed.flushEffects();
        http.expectNone(SAVE);
        collapsed.set(false);
        TestBed.flushEffects();

        first.flush({}, { headers: { ETag: '"v2"' } });
        TestBed.flushEffects();
        const second = http.expectOne(SAVE);
        expect(second.request.headers.get('If-Match')).toBe('"v2"');
        expect(second.request.body).toEqual({ sidebarCollapsed: false });
        second.flush({}, { headers: { ETag: '"v3"' } });
        TestBed.flushEffects();
    });

    it('a locked key is applied and never written', () => {
        collapsed.set(true);

        answer([key('sidebarCollapsed', false, true, true)]);
        expect(collapsed()).toBe(false);

        collapsed.set(true);
        TestBed.flushEffects();
    });

    it('saved on another device since: that value stands', () => {
        answer([key('sidebarCollapsed', false, false)]);

        collapsed.set(true);
        TestBed.flushEffects();
        http.expectOne(SAVE).flush('', { status: 412, statusText: 'Precondition Failed' });
        http.expectOne(READ).flush([
            { section: 'console', version: 'v9', keys: [key('sidebarCollapsed', false, false)] },
        ]);
        TestBed.flushEffects();

        expect(collapsed()).toBe(false);
    });

    it('a save that fails is not tried again until the next change', () => {
        answer([key('sidebarCollapsed', false, false)]);

        collapsed.set(true);
        TestBed.flushEffects();
        http.expectOne(SAVE).flush('', { status: 500, statusText: 'Server Error' });
        TestBed.flushEffects();

        expect(collapsed()).toBe(true);
    });

    it('a section that is not declared makes no write', () => {
        collapsed.set(true);

        service.load().subscribe();
        http.expectOne(READ).flush([{ section: 'region', version: 'v1', keys: [] }]);
        TestBed.flushEffects();

        expect(service.pageSize()).toBe(50);
    });
});
