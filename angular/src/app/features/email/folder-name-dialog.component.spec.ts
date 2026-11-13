import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type Observable, of, throwError } from 'rxjs';

import { type FolderChangeDto } from './email.types';
import { FolderNameDialogComponent, type FolderNameDialogData } from './folder-name-dialog.component';
import { folderChangeRefusalText } from './mail-folder-actions';

/** The folder name dialog: saving asks the server; a refusal is said in place, with no retry of the same ask. */
describe('FolderNameDialogComponent', () => {
    let fixture: ComponentFixture<FolderNameDialogComponent>;
    let asked: Array<[string, string | null]>;
    let answer: () => Observable<FolderChangeDto>;
    let closed: Array<FolderChangeDto | undefined>;

    function render(over: Partial<FolderNameDialogData> = {}): HTMLElement {
        asked = [];
        closed = [];
        const data: FolderNameDialogData = {
            title: 'New folder in Projects',
            confirmLabel: 'Create',
            name: '',
            places: [],
            parent: 'Projects',
            save: (name, parent) => {
                asked.push([name, parent]);
                return answer();
            },
            refusal: folderChangeRefusalText,
            ...over,
        };
        TestBed.configureTestingModule({
            imports: [FolderNameDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: (v?: FolderChangeDto): void => { closed.push(v); } } },
            ],
        });
        fixture = TestBed.createComponent(FolderNameDialogComponent);
        fixture.detectChanges();

        return fixture.nativeElement as HTMLElement;
    }

    const type = (el: HTMLElement, value: string): void => {
        const input = el.querySelector<HTMLInputElement>('[data-test="folder-name-input"]');
        if (input === null) {
            throw new Error('no name field');
        }
        input.value = value;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
    };
    const save = (el: HTMLElement): HTMLButtonElement => {
        const button = el.querySelector<HTMLButtonElement>('[data-test="folder-save"]');
        if (button === null) {
            throw new Error('no save button');
        }
        return button;
    };

    it('creates inside the parent given and closes with the server\'s answer', () => {
        answer = () => of({ folder: 'Projects/Mango', from: null });
        const el = render();

        expect(save(el).disabled).withContext('no name yet').toBeTrue();
        type(el, ' Mango ');
        save(el).click();

        expect(asked).toEqual([['Mango', 'Projects']]);
        expect(closed).toEqual([{ folder: 'Projects/Mango', from: null }]);
    });

    it('a parent that cannot hold folders (\\Noinferiors) is said in place, and the same ask is not offered again', () => {
        answer = () => throwError(() => new HttpErrorResponse({
            status: 422, error: { type: '/errors/email/folder-parent-invalid', title: 'Unprocessable' },
        }));
        const el = render();
        type(el, 'Mango');
        save(el).click();
        fixture.detectChanges();

        const said = el.querySelector('[data-test="folder-refusal"]');
        expect(said?.textContent?.trim()).toBe('The mail server does not allow folders inside this folder.');
        expect(said?.getAttribute('role')).toBe('alert');
        expect(closed).withContext('the dialog stays open').toEqual([]);
        expect(el.querySelector('[data-test="folder-name-input"]')?.getAttribute('aria-invalid')).toBe('true');
        expect(save(el).disabled).withContext('no retry of the same ask').toBeTrue();
        expect(el.textContent).not.toContain('Retry');

        type(el, 'Mango 2');
        expect(save(el).disabled).withContext('a changed name may be asked').toBeFalse();
        expect(asked.length).toBe(1);
    });

    it('a rename offers the places given, and moves the folder where chosen', () => {
        answer = () => of({ folder: 'Zulu', from: 'Projects/Zulu' });
        const el = render({
            title: 'Rename or move Zulu', confirmLabel: 'Save', name: 'Zulu', parent: 'Projects',
            places: [{ parent: null, label: 'Top level' }, { parent: 'Projects', label: 'Projects' }],
        });
        const select = el.querySelector<HTMLSelectElement>('[data-test="folder-place"]');
        expect(Array.from(select?.options ?? []).map(o => o.text.trim())).toEqual(['Top level', 'Projects']);

        if (select !== null) {
            select.value = select.options[0].value;
            select.dispatchEvent(new Event('change'));
        }
        fixture.detectChanges();
        save(el).click();

        expect(asked).toEqual([['Zulu', null]]);
        expect(closed.length).toBe(1);
    });
});
