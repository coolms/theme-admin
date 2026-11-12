import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { FolderRow } from './folder-tree.util';
import { MailFolderRailComponent, folderIcon } from './mail-folder-rail.component';

function row(folder: string, name: string, over: Partial<FolderRow> = {}): FolderRow {
    return { folder: { folder, total: 3, unseen: 0 }, name, depth: 0, selectable: true, ...over };
}

/** Rows whose order and names are neither alphabetical nor what a role would be called. */
const ROWS: FolderRow[] = [
    row('INBOX', 'Mail that came in'),
    row('[Gmail]/Sent Mail', 'Gone out'),
    row('Zulu', 'Zulu'),
    row('Projects', 'Projects', { selectable: false }),
    row('Projects/Mango', 'Mango', { depth: 1 }),
    row('Alpha', 'Alpha'),
];

/** The rail, rendered: the rows as given, a heading that opens nothing, and the tree's failure with Retry. */
describe('MailFolderRailComponent', () => {
    let fixture: ComponentFixture<MailFolderRailComponent>;
    let chosen: string[];
    let retried: number;

    function render(rows: readonly FolderRow[], failure: unknown = null, answered = true): HTMLElement {
        TestBed.configureTestingModule({ imports: [MailFolderRailComponent] });
        fixture = TestBed.createComponent(MailFolderRailComponent);
        fixture.componentRef.setInput('rows', rows);
        fixture.componentRef.setInput('selected', 'INBOX');
        fixture.componentRef.setInput('failure', failure);
        fixture.componentRef.setInput('answered', answered);
        chosen = [];
        retried = 0;
        fixture.componentInstance.chosen.subscribe(f => chosen.push(f));
        fixture.componentInstance.retry.subscribe(() => { retried += 1; });
        fixture.detectChanges();

        return fixture.nativeElement as HTMLElement;
    }

    const names = (el: HTMLElement): string[] =>
        Array.from(el.querySelectorAll('.mbx__folder .mbx__folder-name')).map(n => (n.textContent ?? '').trim());

    it('draws the rows in the order given, with the names given', () => {
        const el = render(ROWS);

        expect(names(el)).toEqual(['Mail that came in', 'Gone out', 'Zulu', 'Projects', 'Mango', 'Alpha']);
    });

    it('a folder that only holds folders is not a button, and pressing it opens nothing', () => {
        const el = render(ROWS);
        const holder = el.querySelector<HTMLElement>('[data-test="folder-holder"]');

        expect(holder).not.toBeNull();
        expect(holder?.tagName).toBe('DIV');
        expect(holder?.closest('button')).toBeNull();
        holder?.click();
        expect(chosen).toEqual([]);

        el.querySelectorAll<HTMLButtonElement>('[data-test="folder"]')[4].click();
        expect(chosen).withContext('a folder that opens does').toEqual(['Alpha']);
    });

    it('a tree that could not be read shows the error with Retry, and no rows', () => {
        const el = render(ROWS, new HttpErrorResponse({ status: 500 }));

        expect(el.querySelector('cms-state')).not.toBeNull();
        expect(el.querySelectorAll('.mbx__folder').length).toBe(0);
        expect(el.querySelector('.mbx__rail-note')).toBeNull();

        const retry = Array.from(el.querySelectorAll<HTMLButtonElement>('cms-state button'))
            .find(b => (b.textContent ?? '').includes('Retry'));
        expect(retry).withContext('the error offers Retry').toBeDefined();
        retry?.click();
        expect(retried).toBe(1);
    });

    it('says there are no folders only once the tree has answered', () => {
        expect(render([], null, false).querySelector('.mbx__rail-note')).toBeNull();
        TestBed.resetTestingModule();
        expect(render([], null, true).querySelector('.mbx__rail-note')).not.toBeNull();
    });

    /**
     * Every row carries an icon before its name, chosen by the folder's role from the tree and never by its name;
     * any other role, or none, draws a folder. The icon is decorative, and the row starts at the column's edge, as the
     * name did before, with the names of a level at one x and children indented from there.
     */
    describe('a folder row\'s icon', () => {
        const ICONS = [
            'bi-inbox', 'bi-send', 'bi-file-earmark-text', 'bi-archive', 'bi-archive', 'bi-trash', 'bi-star', 'bi-bookmark',
            'bi-exclamation-octagon', 'bi-folder', 'bi-folder', 'bi-folder', 'bi-folder', 'bi-folder',
        ];
        const roleRow = (folder: string, name: string, role: string | null | undefined, over: Partial<FolderRow> = {}): FolderRow =>
            ({ folder: { folder, total: 3, unseen: 0, ...(role === undefined ? {} : { role }) }, name, depth: 0, selectable: true, ...over });
        const ROLE_ROWS: FolderRow[] = [
            roleRow('INBOX', 'Mail that came in', 'inbox'),
            roleRow('Sent', 'Gone out', 'sent'),
            roleRow('Drafts', 'Unfinished', 'drafts'),
            roleRow('Archive', 'Kept', 'archive'),
            roleRow('[Gmail]/All Mail', 'Everything', 'all'),
            roleRow('Trash', 'Bin', 'trash'),
            roleRow('[Gmail]/Starred', 'Marked', 'flagged'),
            roleRow('[Gmail]/Important', 'Weighty', 'important'),
            roleRow('Junk', 'Unwanted', 'junk'),
            roleRow('[Gmail]', 'Gmail', 'system'),
            roleRow('Odd', 'Odd', 'a-role-nobody-knows'),
            roleRow('Inbox', 'Inbox', null),
            roleRow('Trash2', 'Trash', undefined),
            roleRow('Projects', 'Projects', 'trash', { selectable: false }),
        ];
        const iconOf = (r: Element): string[] =>
            Array.from(r.querySelectorAll('[data-test="folder-icon"]')[0]?.classList ?? []).filter(c => c.startsWith('bi-'));
        const rowsOf = (el: HTMLElement): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('.mbx__folder'));

        it('each role draws its icon; an unknown role, no role, a name that sounds like one, or a heading draws a folder', () => {
            const el = render(ROLE_ROWS);

            expect(rowsOf(el).map(iconOf)).toEqual(ICONS.map(i => [i]));
            expect(folderIcon('inbox')).toBe('bi-inbox');
            expect(folderIcon('a-role-nobody-knows')).toBe('bi-folder');
            expect(folderIcon(null)).toBe('bi-folder');
            expect(folderIcon(undefined)).toBe('bi-folder');
        });

        it('the icon is hidden from assistive technology, and the row is named by its folder name alone', () => {
            const el = render(ROLE_ROWS);

            for (const r of rowsOf(el)) {
                const icon = r.querySelector('[data-test="folder-icon"]') as HTMLElement;
                expect(icon.getAttribute('aria-hidden')).toBe('true');
                expect(icon.textContent).toBe('');
                expect(r.firstElementChild).withContext('the icon comes before the name').toBe(icon);
            }
            const inbox = rowsOf(el)[0];
            expect(inbox.querySelector('.mbx__folder-name')?.textContent?.trim()).toBe('Mail that came in');
            expect(inbox.hasAttribute('aria-label')).toBeFalse();
        });

        it('the icon is the size of the row\'s text, in its colour', () => {
            const el = render(ROLE_ROWS);
            document.body.appendChild(el);
            try {
                for (const r of [rowsOf(el)[0], rowsOf(el)[13]]) {
                    const icon = getComputedStyle(r.querySelector('[data-test="folder-icon"]') as HTMLElement);
                    const name = getComputedStyle(r.querySelector('.mbx__folder-name') as HTMLElement);
                    expect(icon.fontSize).toBe(name.fontSize);
                    expect(icon.color).toBe(name.color);
                }
            } finally {
                el.remove();
            }
        });

        it('the row starts at the column\'s edge; the names of a level line up, and a child is indented 14px from its parent', () => {
            const el = render([
                roleRow('INBOX', 'Mail that came in', 'inbox'),
                roleRow('Projects', 'Projects', null, { selectable: false }),
                roleRow('Projects/Mango', 'Mango', null, { depth: 1 }),
                roleRow('Junk', 'Unwanted', 'junk'),
            ]);
            document.body.appendChild(el);
            try {
                const edge = el.getBoundingClientRect().left;
                const left = (r: HTMLElement, selector: string): number =>
                    (r.querySelector(selector) as HTMLElement).getBoundingClientRect().left;
                const [inbox, holder, child, junk] = rowsOf(el);

                expect(el.getBoundingClientRect().width).withContext('laid out').toBeGreaterThan(0);
                expect(left(inbox, '[data-test="folder-icon"]')).withContext('the icon at the column edge').toBeCloseTo(edge, 1);
                expect(left(holder, '[data-test="folder-icon"]')).toBeCloseTo(edge, 1);
                expect(left(junk, '.mbx__folder-name')).withContext('names of a level at one x').toBeCloseTo(left(inbox, '.mbx__folder-name'), 1);
                expect(left(holder, '.mbx__folder-name')).toBeCloseTo(left(inbox, '.mbx__folder-name'), 1);
                expect(left(child, '[data-test="folder-icon"]')).withContext('a child\'s row from 14px in').toBeCloseTo(edge + 14, 1);
                expect(left(child, '.mbx__folder-name')).toBeCloseTo(left(inbox, '.mbx__folder-name') + 14, 1);
            } finally {
                el.remove();
            }
        });
    });

    /**
     * A row keeps one height at every width: its icon, unread badge and total never shrink or wrap, and only the name
     * gives way (one line, an ellipsis, the full name in the tooltip and as the accessible name). One total per row,
     * the server's once read; how much is stored only in the tooltip. The rail says the width its widest row needs.
     */
    describe('folder rows', () => {
        const dtoRow = (dto: Partial<FolderRow['folder']> & { folder: string }, name: string, over: Partial<FolderRow> = {}): FolderRow =>
            ({ folder: { total: 3, unseen: 0, ...dto }, name, depth: 0, selectable: true, ...over });
        const DEEP = 'Projects/Clients/Archive/Mango';
        const FIT_ROWS: FolderRow[] = [
            dtoRow({ folder: 'INBOX', role: 'inbox', total: 812, unseen: 2, serverTotal: 812, serverUnseen: 2 }, 'Inbox'),
            dtoRow({ folder: '[Gmail]/Important', role: 'important', total: 3688, unseen: 300, serverTotal: 4044, serverUnseen: 396 }, 'Important'),
            dtoRow({ folder: 'GitHub Notifications', total: 120, unseen: 0, serverTotal: 120, serverUnseen: 0 }, 'GitHub Notifications'),
            dtoRow({ folder: 'Zulu' }, 'Zulu'),
            dtoRow({ folder: 'Projects' }, 'Projects', { selectable: false }),
            dtoRow({ folder: DEEP, total: 125000, unseen: 9000, serverTotal: 125000, serverUnseen: 12345 }, 'Mango', { depth: 3 }),
        ];
        const rect = (e: Element): DOMRect => e.getBoundingClientRect();
        const buttons = (el: HTMLElement): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('[data-test="folder"]'));
        const byName = (el: HTMLElement, name: string): HTMLElement =>
            Array.from(el.querySelectorAll<HTMLElement>('.mbx__folder'))
                .find(r => r.querySelector('[data-test="folder-name"]')?.textContent?.trim() === name) as HTMLElement;
        const settle = async (): Promise<void> => {
            await new Promise(r => setTimeout(r, 50));
            fixture.detectChanges();
        };

        /** The rail in the page, its rows as given; the widths it says it needs, in order. */
        async function shown(rows: readonly FolderRow[], width = 400): Promise<{ el: HTMLElement; needs: number[] }> {
            const el = render(rows);
            const needs: number[] = [];
            fixture.componentInstance.need.subscribe(n => needs.push(n));
            el.style.width = `${width}px`;
            document.body.appendChild(el);
            await settle();
            return { el, needs };
        }

        /** The width of 6ch in a row's name font, measured apart. */
        function sixCh(name: HTMLElement): number {
            const probe = document.createElement('span');
            probe.style.cssText = `display: inline-block; width: 6ch; font: ${getComputedStyle(name).font}`;
            document.body.appendChild(probe);
            const w = rect(probe).width;
            probe.remove();
            return w;
        }

        /** Every row's badge and total whole and clear of each other and of the name, every row one line high. */
        function expectRowsKeepTheirShape(el: HTMLElement, oneLine: number, inside: boolean, ctx: string): void {
            for (const r of Array.from(el.querySelectorAll<HTMLElement>('.mbx__folder'))) {
                const label = `${ctx}: ${r.querySelector('[data-test="folder-name"]')?.textContent?.trim()}`;
                expect(r.offsetHeight).withContext(`${label}: one line high`).toBe(oneLine);
                const name = r.querySelector('[data-test="folder-name"]') as HTMLElement;
                expect(getComputedStyle(name).whiteSpace).withContext(label).toBe('nowrap');
                const badge = r.querySelector<HTMLElement>('[data-test="folder-unread"]');
                const total = r.querySelector<HTMLElement>('[data-test="folder-total"]');
                for (const part of [badge, total]) {
                    if (part !== null) {
                        expect(part.scrollWidth).withContext(`${label}: ${part.textContent} whole`).toBeLessThanOrEqual(part.clientWidth);
                    }
                }
                const after = badge ?? total;
                if (after !== null) {
                    expect(rect(name).right).withContext(`${label}: the name stops before the counts`).toBeLessThanOrEqual(rect(after).left + 0.5);
                }
                if (badge !== null && total !== null) {
                    expect(rect(badge).right).withContext(`${label}: the badge clear of the total`).toBeLessThanOrEqual(rect(total).left + 0.5);
                }
                if (inside && total !== null) {
                    expect(rect(total).right).withContext(`${label}: the total inside the row`).toBeLessThanOrEqual(rect(r).right + 0.5);
                }
            }
        }

        afterEach(() => (fixture?.nativeElement as HTMLElement | undefined)?.remove());

        for (const [what, rows] of [
            ['the product owner\'s folders', FIT_ROWS.filter(r => r.folder.folder !== DEEP)],
            ['with a deep sub-folder of five-digit counts', FIT_ROWS],
        ] as const) {
            it(`${what}: at the minimum, and squeezed below it, every badge and total is whole and clear, every row one line high`, async () => {
                const { el, needs } = await shown(rows);
                const oneLine = byName(el, 'Zulu').offsetHeight;
                expect(oneLine).withContext('laid out').toBeGreaterThan(0);
                expect(needs.length).withContext('the rail said what it needs').toBeGreaterThan(0);
                const need = needs[needs.length - 1];

                el.style.width = `${need}px`;
                await settle();
                expectRowsKeepTheirShape(el, oneLine, true, `at its minimum ${need}px`);

                // As the product owner saw it: the column narrower than the rows need.
                el.style.width = '140px';
                await settle();
                expectRowsKeepTheirShape(el, oneLine, false, 'squeezed to 140px');
            });
        }

        it('a long name is one line cut with an ellipsis, the full name in the tooltip and as the accessible name', async () => {
            // The product owner's mailbox: the Important row is the widest, and the rail at what it needs.
            const { el, needs } = await shown(FIT_ROWS.filter(r => r.folder.folder !== DEEP));
            el.style.width = `${needs[needs.length - 1]}px`;
            await settle();
            const row = byName(el, 'GitHub Notifications');
            const name = row.querySelector('[data-test="folder-name"]') as HTMLElement;

            expect(name.scrollWidth).withContext('the name is cut').toBeGreaterThan(name.clientWidth);
            expect(getComputedStyle(name).textOverflow).toBe('ellipsis');
            expect(name.offsetHeight).withContext('one line').toBe(byName(el, 'Zulu').querySelector<HTMLElement>('[data-test="folder-name"]')?.offsetHeight as number);
            expect(row.title.split('\n')[0]).toBe('GitHub Notifications');
            // Named by its content: the icon, badge and total are hidden from it, and nothing overrides it.
            expect(row.hasAttribute('aria-label')).toBeFalse();
            for (const part of Array.from(row.children).filter(c => c !== name)) {
                expect(part.getAttribute('aria-hidden')).withContext(part.className).toBe('true');
            }
            expect(name.textContent?.trim()).toBe('GitHub Notifications');
            expect(byName(el, 'Projects').title).withContext('a heading\'s tooltip is its name').toBe('Projects');
        });

        it('says the widest row\'s need, indent and badge and total with 6ch of name, over every row, and again as counts change', async () => {
            const { el, needs } = await shown(FIT_ROWS);
            fixture.componentRef.setInput('selected', DEEP);
            fixture.detectChanges();
            const need = needs[needs.length - 1];
            expect(need).withContext('the deep sub-folder with five-digit counts needs more than 200px').toBeGreaterThan(200);

            el.style.width = `${need}px`;
            await settle();
            const deepName = byName(el, 'Mango').querySelector('[data-test="folder-name"]') as HTMLElement;
            // The widest row, bold as the open folder: its name gets 6ch, to within the rounding up.
            expect(rect(deepName).width).toBeGreaterThanOrEqual(sixCh(deepName) - 0.5);
            expect(rect(deepName).width).toBeLessThan(sixCh(deepName) + 1.5);

            const before = needs.length;
            fixture.componentRef.setInput('rows', FIT_ROWS.map(r => r.folder.folder === DEEP
                ? { ...r, folder: { ...r.folder, serverUnseen: 1234567, serverTotal: 99999999 } } : r));
            fixture.detectChanges();
            await settle();
            expect(needs.length).toBeGreaterThan(before);
            expect(needs[needs.length - 1]).withContext('bigger counts need more').toBeGreaterThan(need);
        });

        it('shows one total, the server\'s, and says how much is stored only in the tooltip; a heading shows none', async () => {
            const { el } = await shown(FIT_ROWS);
            const totalOf = (name: string): string | null | undefined =>
                byName(el, name).querySelector('[data-test="folder-total"]')?.textContent?.trim();

            expect(totalOf('Important')).toBe((4044).toLocaleString());
            expect(byName(el, 'Important').textContent).not.toContain((3688).toLocaleString());
            expect(byName(el, 'Important').title).toContain(`${(3688).toLocaleString()} of ${(4044).toLocaleString()} stored`);
            expect(byName(el, 'Inbox').title).withContext('fully stored').not.toContain('stored');
            expect(totalOf('Zulu')).withContext('no server count read yet: the platform\'s').toBe('3');
            expect(byName(el, 'Zulu').title).not.toContain(' of ');
            expect(buttons(el).every(b => b.querySelectorAll('[data-test="folder-total"]').length === 1)).toBeTrue();
            expect(byName(el, 'Projects').querySelector('[data-test="folder-total"]')).withContext('a heading').toBeNull();
        });
    });
});
