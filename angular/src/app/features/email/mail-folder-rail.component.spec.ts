import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { FolderRow } from './folder-tree.util';
import { MailFolderRailComponent } from './mail-folder-rail.component';

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
});
