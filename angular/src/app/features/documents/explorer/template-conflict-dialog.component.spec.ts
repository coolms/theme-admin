import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { TemplateConflictDialogComponent } from './template-conflict-dialog.component';

/**
 * The name check follows what is typed. `nameError` and `canConfirm` are computeds, and they
 * read the new name as a plain field: `canConfirm` never re-ran after its first answer, so the
 * confirm button stayed enabled for the existing name; `nameError` re-ran only when "touched"
 * first turned true, so after the first keystroke it kept that keystroke's answer (the
 * 2026-09-28 sweep). The specs type and read the PAGE.
 */
describe('TemplateConflictDialogComponent', () => {
    let fixture: ComponentFixture<TemplateConflictDialogComponent>;

    beforeEach(async () => {
        TestBed.configureTestingModule({
            imports: [TemplateConflictDialogComponent],
            providers: [
                { provide: DialogRef, useValue: { close: () => undefined } },
                {
                    provide: DIALOG_DATA,
                    useValue: {
                        existing: { id: '1', name: 'invoice.docx' },
                        suggestedName: 'invoice (2).docx',
                        proposedFile: new File(['x'], 'invoice.docx'),
                        folderPath: '/documents/',
                    },
                },
            ],
        });
        fixture = TestBed.createComponent(TemplateConflictDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    const page = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const confirm = (): HTMLButtonElement => page().querySelector<HTMLButtonElement>('.cms-btn-primary')!;
    const type = async (value: string): Promise<void> => {
        const input = page().querySelector<HTMLInputElement>('.cms-template-conflict-dialog__name-field input')!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
        await fixture.whenStable();
        fixture.detectChanges();
    };

    it('disables confirming the existing name as the new one', async () => {
        expect(confirm().disabled).withContext('the suggested name may be confirmed').toBeFalse();
        await type('invoice.docx');
        expect(confirm().disabled).toBeTrue();
    });

    it('names the problem with every keystroke, not only the first', async () => {
        await type('x');
        expect(page().textContent).withContext('a different name is fine').not.toContain('must differ');
        await type('invoice.docx');
        expect(page().textContent).toContain('New name must differ from the existing template.');
    });
});
