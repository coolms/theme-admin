import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { CmsPaneSplitterComponent } from '@coolms/ui-angular';

import type { FolderRow } from './folder-tree.util';
import { MailFolderRailComponent } from './mail-folder-rail.component';
import {
    MAIL_PANE_CACHE_KEYS,
    MailPanesDirective,
    foldersMinFor,
    mailPaneCount,
    mailPaneCountFor,
    mailPaneLayout,
} from './mail-panes.directive';

const PREFS_URL = '/api/v1/auth/me/preferences';
const ME_URL = '/api/v1/auth/me';

const dtoRow = (dto: Partial<FolderRow['folder']> & { folder: string }, name: string, over: Partial<FolderRow> = {}): FolderRow =>
    ({ folder: { total: 3, unseen: 0, ...dto }, name, depth: 0, selectable: true, ...over });

/** Short names and small counts: the rows need less than 200px. */
const SMALL: FolderRow[] = [
    dtoRow({ folder: 'INBOX', role: 'inbox', total: 12, unseen: 1 }, 'Inbox'),
    dtoRow({ folder: 'Sent', role: 'sent', total: 4 }, 'Sent'),
];

/** A sub-folder three levels down with five-digit counts: its row needs more than 200px. */
const WIDE: FolderRow[] = [
    ...SMALL,
    dtoRow({ folder: 'Projects' }, 'Projects', { selectable: false }),
    dtoRow({ folder: 'Projects/Clients/Archive/Mango', total: 125000, unseen: 9000, serverTotal: 125000, serverUnseen: 12345 },
        'Mango', { depth: 3 }),
];

/** The mail page's grid as the page binds it: the rail in its padded, scrolling column, two splitters. */
@Component({
    selector: 'spec-mail-folder-column-host',
    standalone: true,
    imports: [MailPanesDirective, CmsPaneSplitterComponent, MailFolderRailComponent],
    template: `
        <div class="grid" appMailPanes #panes="appMailPanes" style="display: flex; width: 1400px; height: 400px">
            <aside class="rail" #railPane
                   style="width: 230px; flex: 0 0 230px; min-width: 200px; padding: 0 12px 12px 16px; overflow-y: auto; box-sizing: border-box">
                <app-mail-folder-rail [rows]="rows()" selected="INBOX" [answered]="true"
                                      (need)="panes.foldersNeedIn($event, railPane)" />
            </aside>
            <cms-pane-splitter [minWidth]="panes.foldersMin()" [maxWidth]="panes.layout().foldersMax"
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
class SpecFolderColumnHost {
    readonly rows = signal<readonly FolderRow[]>(SMALL);
}

/**
 * The folder column is never narrower than its content needs -- the widest row's indent, icon, badge and total with
 * 6ch of name, over every folder -- or 200px, whichever is larger. The splitter stops there; a saved width under it is
 * drawn at it and written back only when the person moves the splitter.
 */
describe('Mail folder column minimum', () => {
    describe('the layout', () => {
        it('takes the rows\' need over 200px, rounded up, and 200px otherwise', () => {
            expect(foldersMinFor(150)).toBe(200);
            expect(foldersMinFor(200)).toBe(200);
            expect(foldersMinFor(260.2)).toBe(261);
            expect(foldersMinFor(Number.NaN)).toBe(200);
        });

        it('draws a chosen width under the minimum at it, never caps the column under it, and counts it for three panes', () => {
            expect(mailPaneLayout(1400, { folders: 210, list: 340 }, 260).folders).toBe(260);
            expect(mailPaneLayout(1400, { folders: 210, list: 340 }, 150).folders).toBe(210);
            expect(mailPaneLayout(1400, { folders: 300, list: 340 }, 420).foldersMax).toBe(420);
            expect(mailPaneCount(854)).toBe(3);
            expect(mailPaneCountFor(854, 260)).toBe(2);
            expect(mailPaneCountFor(914, 260)).toBe(3);
        });
    });

    describe('on the page', () => {
        let fixture: ComponentFixture<SpecFolderColumnHost>;
        let http: HttpTestingController;

        const rail = (): HTMLElement => fixture.nativeElement.querySelector('.rail');
        const folderSplitter = (): HTMLElement => fixture.nativeElement.querySelector('cms-pane-splitter');
        const panes = (): MailPanesDirective =>
            fixture.debugElement.query(e => e.nativeElement?.classList?.contains('grid')).injector.get(MailPanesDirective);
        const settle = async (): Promise<void> => {
            for (let i = 0; i < 3; i++) {
                await new Promise(r => setTimeout(r, 30));
                fixture.detectChanges();
            }
        };
        const key = (el: HTMLElement, k: string): void => {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: k, cancelable: true }));
            fixture.detectChanges();
        };
        /** What the column needs for its rows, read off the rail: its need plus the column's padding and scrollbar. */
        const columnNeed = (): number => {
            const aside = rail();
            const host = aside.querySelector('app-mail-folder-rail') as HTMLElement;
            const widest = Math.max(...Array.from(host.querySelectorAll<HTMLElement>('.mbx__measure-row'))
                .map(r => r.getBoundingClientRect().width - 9));
            const style = getComputedStyle(aside);
            return widest + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + (aside.offsetWidth - aside.clientWidth);
        };

        function clearCache(): void {
            localStorage.removeItem(MAIL_PANE_CACHE_KEYS.folders);
            localStorage.removeItem(MAIL_PANE_CACHE_KEYS.list);
        }

        async function render(rows: readonly FolderRow[]): Promise<void> {
            TestBed.configureTestingModule({
                imports: [SpecFolderColumnHost],
                providers: [
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: Store, useValue: { selectSnapshot: () => ({ auth: { me: ME_URL, preferencesUrl: PREFS_URL } }) } },
                ],
            });
            http = TestBed.inject(HttpTestingController);
            fixture = TestBed.createComponent(SpecFolderColumnHost);
            fixture.componentInstance.rows.set(rows);
            document.body.appendChild(fixture.nativeElement);
            fixture.detectChanges();
            await fixture.whenStable();
            await settle();
        }

        beforeEach(clearCache);
        afterEach(() => {
            clearCache();
            (fixture?.nativeElement as HTMLElement | undefined)?.remove();
            fixture?.destroy();
        });

        it('is 200px where the rows need less: Home stops the splitter there', async () => {
            await render(SMALL);
            expect(columnNeed()).withContext('the rows need less than 200px').toBeLessThan(200);
            expect(panes().foldersMin()).toBe(200);

            key(folderSplitter(), 'Home');
            expect(rail().offsetWidth).toBe(200);
            http.match(r => r.method === 'PATCH').forEach(r => r.flush(null));
        });

        it('is the widest row\'s need where that is more: Home stops there, and every row fits', async () => {
            await render(WIDE);
            const need = columnNeed();
            expect(need).withContext('the deep sub-folder needs more than 200px').toBeGreaterThan(200);
            expect(panes().foldersMin()).toBe(Math.ceil(need));

            key(folderSplitter(), 'Home');
            expect(rail().offsetWidth).toBe(Math.ceil(need));
            for (const row of Array.from(rail().querySelectorAll<HTMLElement>('[data-test="folder"]'))) {
                const total = row.querySelector('[data-test="folder-total"]') as HTMLElement;
                expect(total.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right + 0.5);
            }
            http.match(r => r.method === 'PATCH').forEach(r => r.flush(null));
        });

        it('grows when the counts grow', async () => {
            await render(WIDE);
            const before = panes().foldersMin();
            fixture.componentInstance.rows.set(WIDE.map(r => r.depth === 3
                ? { ...r, folder: { ...r.folder, serverUnseen: 1234567, serverTotal: 99999999 } } : r));
            fixture.detectChanges();
            await settle();
            expect(panes().foldersMin()).toBeGreaterThan(before);
            expect(rail().offsetWidth).toBe(panes().foldersMin());
        });

        it('a saved width under the minimum is drawn at it, and written back only when the splitter moves', async () => {
            localStorage.setItem(MAIL_PANE_CACHE_KEYS.folders, '200');
            await render(WIDE);
            http.expectOne(r => r.method === 'GET' && r.url === ME_URL)
                .flush({ id: 'u1', roles: [], uiPrefs: { 'admin:mail:panes': { columnWidths: { folders: 205, list: 340 } } } });
            await settle();
            const min = panes().foldersMin();
            expect(min).toBeGreaterThan(205);

            expect(rail().offsetWidth).withContext('shown at the minimum').toBe(min);
            expect(localStorage.getItem(MAIL_PANE_CACHE_KEYS.folders)).withContext('the saved width as it was').toBe('205');
            expect(http.match(r => r.method === 'PATCH')).withContext('nothing written on load').toEqual([]);

            key(folderSplitter(), 'ArrowRight');
            const req = http.expectOne(PREFS_URL);
            expect(req.request.method).toBe('PATCH');
            expect((req.request.body as { uiPrefs: Record<string, { columnWidths: { folders: number } }> })
                .uiPrefs['admin:mail:panes'].columnWidths.folders).toBe(min + 16);
            req.flush(null);
            expect(localStorage.getItem(MAIL_PANE_CACHE_KEYS.folders)).toBe(String(min + 16));
        });
    });
});
