import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { type MailboxFilter } from './mailbox-filters';
import { MailboxFiltersSectionComponent } from './mailbox-filters-section.component';

const filter = (id: string, position: number, over: Partial<MailboxFilter> = {}): MailboxFilter => ({
    id, mailboxId: 'mb-1', name: `Filter ${id}`, enabled: true, position, match: 'all',
    conditions: [{ field: 'from', operator: 'contains', value: `${id}@` }],
    actions: [{ type: 'markRead' }], stopProcessing: false,
    lastMatchedAt: null, matchCount: 0, lastError: null, ...over,
});

/**
 * The Filters pane of a mailbox's settings: its filters in order, each switch, move and delete a write of its own, and
 * the open filter saved with the pane's Save -- checked before it is sent, and a 422 shown where the server names it.
 */
describe('MailboxFiltersSectionComponent -- a mailbox\'s filters', () => {
    let email: jasmine.SpyObj<EmailService>;
    let confirmed: boolean;

    function make(canManage: boolean, rows: MailboxFilter[]) {
        email.listFilters.and.returnValue(of(rows));
        const fixture = TestBed.createComponent(MailboxFiltersSectionComponent);
        fixture.componentRef.setInput('mailboxId', 'mb-1');
        fixture.componentRef.setInput('canManage', canManage);
        fixture.detectChanges();
        return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
    }
    const buttons = (el: HTMLElement, text: string) =>
        Array.from(el.querySelectorAll('button')).filter(b => (b.textContent ?? '').trim() === text || b.getAttribute('aria-label') === text);

    beforeEach(() => {
        confirmed = true;
        email = jasmine.createSpyObj('EmailService', [
            'listFilters', 'createFilter', 'updateFilter', 'deleteFilter', 'reorderFilters', 'listFilterFolders', 'listFolders',
        ]);
        email.listFilterFolders.and.returnValue(of([{ folder: 'INBOX/Accounts', selectable: true }, { folder: '[Gmail]', selectable: false }]));
        TestBed.configureTestingModule({
            imports: [MailboxFiltersSectionComponent],
            providers: [
                { provide: EmailService, useValue: email },
                { provide: ConfirmDialogService, useValue: { open: () => of(confirmed) } },
                { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
            ],
        });
    });

    it('lists the filters in the order they are checked, each with its line, its count and its last error', () => {
        const { el } = make(true, [
            filter('b', 1, { matchCount: 3, lastError: 'The folder INBOX/Old does not exist any more.' }),
            filter('a', 0),
        ]);
        const names = Array.from(el.querySelectorAll('.flt__name')).map(n => n.textContent?.trim());
        expect(names).toEqual(['Filter a', 'Filter b']);
        expect(el.querySelector('.flt__summary')?.textContent).toContain('If From contains "a@": mark as read.');
        expect(el.textContent).toContain('Matched 3 times');
        expect(el.querySelector('.flt__warn')?.textContent).toContain('INBOX/Old');
    });

    it('read-only for whoever does not manage the mailbox: no Add, no row actions, switches disabled, no Save', () => {
        const { c, el } = make(false, [filter('a', 0)]);
        expect(buttons(el, 'Add a filter').length).toBe(0);
        expect(buttons(el, 'Edit').length).toBe(0);
        expect((el.querySelector('.flt__toggle input') as HTMLInputElement).disabled).toBeTrue();
        expect(c.editable()).toBeFalse();
    });

    it('switching a filter off is its own write, and the row takes the answer', () => {
        const { fixture, c } = make(true, [filter('a', 0)]);
        email.updateFilter.and.returnValue(of(filter('a', 0, { enabled: false })));
        c.setEnabled(c.filters()[0], false);
        fixture.detectChanges();
        expect(email.updateFilter).toHaveBeenCalledWith('mb-1', 'a', { enabled: false });
        expect(c.filters()[0].enabled).toBeFalse();
    });

    it('moving one down sends every filter once in the new order, and shows the order answered', () => {
        const { c } = make(true, [filter('a', 0), filter('b', 1), filter('c', 2)]);
        email.reorderFilters.and.returnValue(of([filter('b', 0), filter('a', 1), filter('c', 2)]));
        c.move(c.filters()[0], 1);
        expect(email.reorderFilters).toHaveBeenCalledWith('mb-1', ['b', 'a', 'c']);
        expect(c.filters().map(f => f.id)).toEqual(['b', 'a', 'c']);
    });

    it('a new filter: dirty once changed, checked before sending, and sent clean', () => {
        const { c } = make(true, []);
        c.add();
        expect(c.editable()).toBeTrue();
        expect(c.dirty()).toBeFalse();

        c.save();
        expect(email.createFilter).not.toHaveBeenCalled();
        expect(c.err('name')).toBe('Name the filter.');
        expect(c.err('conditions[0].value')).toBe('Enter what to look for.');

        c.patch({ name: ' Accounts ' });
        c.setCondition(0, { value: ' billing@ ' });
        c.setAction(0, { type: 'move' });
        c.setAction(0, { folder: 'INBOX/Accounts' });
        expect(c.dirty()).toBeTrue();

        email.createFilter.and.returnValue(of(filter('n', 0)));
        email.listFilters.and.returnValue(of([filter('n', 0)]));
        c.save();
        expect(email.createFilter).toHaveBeenCalledWith('mb-1', {
            name: 'Accounts', enabled: true, match: 'all',
            conditions: [{ field: 'from', operator: 'contains', value: 'billing@' }],
            actions: [{ type: 'move', folder: 'INBOX/Accounts' }],
            stopProcessing: false,
        });
        expect(c.editing()).toBeNull();
        expect(c.filters().map(f => f.id)).toEqual(['n']);
    });

    it('the server\'s 422 lands on the field it names, and the editor stays open', () => {
        const { c } = make(true, [filter('a', 0)]);
        c.edit(c.filters()[0]);
        c.patch({ name: 'Renamed' });
        email.updateFilter.and.returnValue(throwError(() => ({ status: 422, error: { violations: [
            { propertyPath: 'conditions[0].operator', message: 'Not an operator the server knows.' },
        ] } })));
        c.save();
        expect(email.updateFilter).toHaveBeenCalledWith('mb-1', 'a', jasmine.objectContaining({ name: 'Renamed' }));
        expect(c.err('conditions[0].operator')).toBe('Not an operator the server knows.');
        expect(c.editing()).not.toBeNull();
    });

    it('after a refused Save, a field put right stops being marked on the edit itself, not at the next Save', () => {
        const { c } = make(true, []);
        c.add();
        c.patch({ name: 'Invoices' });
        c.save();
        expect(c.err('conditions[0].value')).toBe('Enter what to look for.');

        c.setCondition(0, { value: 'billing@' });
        expect(c.err('conditions[0].value')).toBeNull();
        expect(email.createFilter).not.toHaveBeenCalled();

        c.setCondition(0, { value: '' });
        expect(c.err('conditions[0].value')).withContext('emptied again').toBe('Enter what to look for.');
    });

    it('the note on the folder list is said only while an action moves mail', () => {
        email.listFilterFolders.and.returnValue(throwError(() => ({ status: 404 })));
        email.listFolders.and.returnValue(of([{ folder: 'INBOX', total: 1, unseen: 0 }]));
        const { fixture, c, el } = make(true, []);
        c.add();
        fixture.detectChanges();
        expect(c.foldersNote()).toContain('Only folders');
        expect(el.textContent).not.toContain('Only folders');

        c.setAction(0, { type: 'move' });
        fixture.detectChanges();
        expect(el.textContent).toContain('Only folders that already hold mail');
    });

    it('Discard closes the open filter, and nothing is sent', () => {
        const { c } = make(true, [filter('a', 0)]);
        c.edit(c.filters()[0]);
        c.patch({ name: 'Changed' });
        c.discard();
        expect(c.editing()).toBeNull();
        expect(c.dirty()).toBeFalse();
        expect(email.updateFilter).not.toHaveBeenCalled();
    });

    it('the folders offered are the server\'s selectable ones; the rail\'s list stands in, said so, when they cannot be read', () => {
        const first = make(true, []);
        first.c.add();
        expect(first.c.folderOptions()).toEqual(['INBOX/Accounts']);
        expect(first.c.foldersNote()).toBe('');

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [MailboxFiltersSectionComponent],
            providers: [
                { provide: EmailService, useValue: email },
                { provide: ConfirmDialogService, useValue: { open: () => of(true) } },
                { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'failed' } },
            ],
        });
        email.listFilterFolders.and.returnValue(throwError(() => ({ status: 404 })));
        email.listFolders.and.returnValue(of([{ folder: 'INBOX', total: 3, unseen: 1 }]));
        const second = make(true, []);
        second.c.add();
        expect(second.c.folderOptions()).toEqual(['INBOX']);
        expect(second.c.foldersNote()).toContain('Only folders that already hold mail');
    });

    it('delete asks first, and only a yes deletes', () => {
        const { c } = make(true, [filter('a', 0)]);
        confirmed = false;
        c.remove(c.filters()[0]);
        expect(email.deleteFilter).not.toHaveBeenCalled();

        confirmed = true;
        email.deleteFilter.and.returnValue(of(null));
        email.listFilters.and.returnValue(of([]));
        c.remove(c.filters()[0]);
        expect(email.deleteFilter).toHaveBeenCalledWith('mb-1', 'a');
        expect(c.filters()).toEqual([]);
    });
});
