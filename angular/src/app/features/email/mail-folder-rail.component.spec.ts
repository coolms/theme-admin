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
});
