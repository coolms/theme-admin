import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { BACKGROUND_REQUEST } from '@coolms/core-angular';
import { CmsPaneSplitterComponent } from '@coolms/ui-angular';
import {
    MAIL_PANE_CACHE_KEYS,
    MailPanesDirective,
    clampPaneWidth,
    mailPaneLayout,
    mailPanesSaveBody,
    serverPaneWidths,
} from './mail-panes.directive';

const PREFS_URL = '/api/v1/auth/me/preferences';
const ME_URL = '/api/v1/auth/me';

/** The mail page's three panes and two splitters, bound as the page binds them. */
@Component({
    selector: 'spec-mail-panes-host',
    standalone: true,
    imports: [MailPanesDirective, CmsPaneSplitterComponent],
    template: `
        <div class="grid" appMailPanes #panes="appMailPanes" [style.width.px]="width()" style="display: flex; height: 300px">
            <aside class="rail" style="width: 230px; flex: 0 0 230px; min-width: 200px"></aside>
            <cms-pane-splitter [minWidth]="panes.limits.folders.min" [maxWidth]="panes.layout().foldersMax"
                               [width]="panes.layout().folders" [ariaLabel]="panes.words.folders"
                               (widthChange)="panes.resized('folders', $event)" />
            <section class="list" style="width: 340px; flex: 0 0 340px"></section>
            <cms-pane-splitter [minWidth]="panes.limits.list.min" [maxWidth]="panes.layout().listMax"
                               [width]="panes.layout().list" [ariaLabel]="panes.words.list"
                               (widthChange)="panes.resized('list', $event)" />
            <section class="detail" style="flex: 1; min-width: 0"></section>
        </div>
    `,
})
class SpecMailPanesHost {
    readonly width = signal(1400);
}

describe('Mail pane widths', () => {
    describe('the layout', () => {
        it('draws the chosen widths when the grid has room, the splitters free up to their limits', () => {
            expect(mailPaneLayout(1400, { folders: 230, list: 340 }))
                .toEqual({ folders: 230, list: 340, foldersMax: 380, listMax: 620 });
        });

        it('caps each splitter so the message pane keeps 360px', () => {
            // 1200 - 14 splitters - 360 message = 826 for the two panes.
            expect(mailPaneLayout(1200, { folders: 230, list: 340 }))
                .toEqual({ folders: 230, list: 340, foldersMax: 380, listMax: 596 });
        });

        it('narrowing: the list gives way first, down to its minimum, then the folder column', () => {
            // 900: 526 for the panes; the list gives 44, the folders nothing.
            expect(mailPaneLayout(900, { folders: 230, list: 340 }))
                .toEqual({ folders: 230, list: 296, foldersMax: 230, listMax: 296 });
            // 860: 486; the list at its minimum 280, the folders give way to 206; at 700 both at their minimums.
            expect(mailPaneLayout(860, { folders: 230, list: 340 }))
                .toEqual({ folders: 206, list: 280, foldersMax: 206, listMax: 280 });
            expect(mailPaneLayout(700, { folders: 230, list: 340 }))
                .toEqual({ folders: 200, list: 280, foldersMax: 200, listMax: 280 });
        });

        it('keeps chosen widths in their limits, and an unmeasured grid uses the static limits', () => {
            expect(mailPaneLayout(0, { folders: 9999, list: 1 }))
                .toEqual({ folders: 380, list: 280, foldersMax: 380, listMax: 620 });
        });
    });

    describe('the server shape', () => {
        it('saves exactly { uiPrefs: { admin:mail:panes: { columnWidths: { folders, list } } } }, rounded', () => {
            expect(JSON.stringify(mailPanesSaveBody({ folders: 262.4, list: 400 })))
                .toBe('{"uiPrefs":{"admin:mail:panes":{"columnWidths":{"folders":262,"list":400}}}}');
        });

        it('reads the saved widths clamped to today\'s limits, ignoring what is not a width', () => {
            expect(serverPaneWidths({ 'admin:mail:panes': { columnWidths: { folders: 50, list: 9000 } } }))
                .toEqual({ folders: 200, list: 620 });
            expect(serverPaneWidths({ 'admin:mail:panes': { columnWidths: { folders: 'x', list: 300 } } }))
                .toEqual({ list: 300 });
            expect(serverPaneWidths({ 'workspace:mail:panes': { columnWidths: { folders: 300 } } })).toEqual({});
            expect(serverPaneWidths(undefined)).toEqual({});
            expect(serverPaneWidths([])).toEqual({});
            expect(clampPaneWidth('list', '')).toBeNull();
        });
    });

    describe('on the page', () => {
        let fixture: ComponentFixture<SpecMailPanesHost>;
        let http: HttpTestingController;

        const rail = (): HTMLElement => fixture.nativeElement.querySelector('.rail');
        const list = (): HTMLElement => fixture.nativeElement.querySelector('.list');
        const splitters = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('cms-pane-splitter'));
        const answer = (uiPrefs: Record<string, unknown>): void => {
            http.expectOne(r => r.method === 'GET' && r.url === ME_URL).flush({ id: 'u1', roles: [], uiPrefs });
            fixture.detectChanges();
        };
        const key = (el: HTMLElement, k: string): void => {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: k, cancelable: true }));
            fixture.detectChanges();
        };

        function clearCache(): void {
            localStorage.removeItem(MAIL_PANE_CACHE_KEYS.folders);
            localStorage.removeItem(MAIL_PANE_CACHE_KEYS.list);
        }

        async function render(width = 1400): Promise<void> {
            TestBed.configureTestingModule({
                imports: [SpecMailPanesHost],
                providers: [
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: Store, useValue: { selectSnapshot: () => ({ auth: { me: ME_URL, preferencesUrl: PREFS_URL } }) } },
                ],
            });
            http = TestBed.inject(HttpTestingController);
            fixture = TestBed.createComponent(SpecMailPanesHost);
            fixture.componentInstance.width.set(width);
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();
        }

        beforeEach(clearCache);
        afterEach(() => {
            clearCache();
            fixture?.destroy();
        });

        it('names the splitters Resize folders and Resize list', async () => {
            await render();
            expect(splitters().map(s => s.getAttribute('aria-label'))).toEqual(['Resize folders', 'Resize list']);
            expect(splitters().map(s => s.getAttribute('role'))).toEqual(['separator', 'separator']);
            expect(http.match(r => r.method === 'PATCH')).toEqual([]);
        });

        it('reads the cache first, then the server\'s value wins when it arrives, clamped', async () => {
            localStorage.setItem(MAIL_PANE_CACHE_KEYS.folders, '300');
            localStorage.setItem(MAIL_PANE_CACHE_KEYS.list, '400');
            await render();
            expect(rail().offsetWidth).toBe(300);
            expect(list().offsetWidth).toBe(400);

            answer({ 'admin:mail:panes': { columnWidths: { folders: 120, list: 9000 } } });

            expect(rail().offsetWidth).toBe(200);
            expect(list().offsetWidth).toBe(620);
            expect(splitters()[1].getAttribute('aria-valuenow')).toBe('620');
            // The cache follows, so the next load starts where the server is.
            expect(localStorage.getItem(MAIL_PANE_CACHE_KEYS.folders)).toBe('200');
            expect(localStorage.getItem(MAIL_PANE_CACHE_KEYS.list)).toBe('620');
            http.verify();
        });

        it('keeps the cache when the server has no widths saved', async () => {
            localStorage.setItem(MAIL_PANE_CACHE_KEYS.list, '400');
            await render();
            answer({ 'grid-users': { columns: ['name'] } });
            expect(rail().offsetWidth).toBe(230);
            expect(list().offsetWidth).toBe(400);
        });

        it('saves both widths for the person when a key ends: PATCH merge-patch, exact body, in the background', async () => {
            await render();
            key(splitters()[1], 'ArrowRight');

            const req = http.expectOne(PREFS_URL);
            expect(req.request.method).toBe('PATCH');
            expect(req.request.headers.get('Content-Type')).toBe('application/merge-patch+json');
            expect(JSON.stringify(req.request.body))
                .toBe('{"uiPrefs":{"admin:mail:panes":{"columnWidths":{"folders":230,"list":356}}}}');
            expect(req.request.context.get(BACKGROUND_REQUEST)).toBeTrue();
            req.flush(null);
            expect(localStorage.getItem(MAIL_PANE_CACHE_KEYS.list)).toBe('356');
            expect(http.match(r => r.method === 'PATCH')).toEqual([]);
        });

        it('a move made before the server answers is not undone by the answer', async () => {
            await render();
            key(splitters()[0], 'End');
            http.expectOne(PREFS_URL).flush(null);
            answer({ 'admin:mail:panes': { columnWidths: { folders: 210, list: 300 } } });
            expect(rail().offsetWidth).toBe(380);
            expect(list().offsetWidth).toBe(340);
        });

        it('keeps the message pane at 360px: End on the list stops there, and a narrower grid takes the list first', async () => {
            await render(1200);
            key(splitters()[1], 'End');
            expect(list().offsetWidth).toBe(596);
            http.expectOne(PREFS_URL).flush(null);
            const detail = (): HTMLElement => fixture.nativeElement.querySelector('.detail');
            expect(detail().offsetWidth).toBe(360);

            fixture.componentInstance.width.set(1100);
            fixture.detectChanges();
            await new Promise(r => setTimeout(r, 50));
            fixture.detectChanges();
            expect(rail().offsetWidth).toBe(230);
            expect(list().offsetWidth).toBe(496);
            expect(detail().offsetWidth).toBe(360);
            // The person's choice stays: the room back, the list is back at it.
            fixture.componentInstance.width.set(1400);
            fixture.detectChanges();
            await new Promise(r => setTimeout(r, 50));
            fixture.detectChanges();
            expect(list().offsetWidth).toBe(596);
            expect(http.match(r => r.method === 'PATCH')).toEqual([]);
        });
    });
});
