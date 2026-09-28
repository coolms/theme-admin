import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { DocumentAggregatorService } from './document-aggregator.service';
import { DocumentUploadDialog } from './document-upload.dialog';
import { FormatInfoService } from './format-info.service';

/**
 * Upload is offered only with a file AND a folder. `canSubmit` is a computed, and it read
 * the folder as a plain field: after the file was chosen it never re-ran, so emptying the
 * folder left Upload enabled (the 2026-09-28 sweep). The spec chooses a file, empties the
 * folder, and reads the PAGE.
 */
describe('DocumentUploadDialog', () => {
    let fixture: ComponentFixture<DocumentUploadDialog>;

    beforeEach(async () => {
        TestBed.configureTestingModule({
            imports: [DocumentUploadDialog],
            providers: [
                { provide: DialogRef, useValue: { close: () => undefined } },
                { provide: DIALOG_DATA, useValue: { folderPath: '/documents/' } },
                { provide: Dialog, useValue: { open: () => undefined } },
                { provide: DocumentAggregatorService, useValue: {} },
                { provide: FormatInfoService, useValue: { acceptString: () => '' } },
            ],
        });
        fixture = TestBed.createComponent(DocumentUploadDialog);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    const page = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const upload = (): HTMLButtonElement =>
        [...page().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Upload')!;
    const settle = async (): Promise<void> => {
        await fixture.whenStable();
        fixture.detectChanges();
    };

    it('withdraws Upload when the folder is emptied after a file was chosen', async () => {
        const file = page().querySelector<HTMLInputElement>('input[type=file]')!;
        const chosen = new DataTransfer();
        chosen.items.add(new File(['x'], 'contract.docx'));
        file.files = chosen.files;
        file.dispatchEvent(new Event('change'));
        await settle();
        expect(upload().disabled).withContext('a file and the default folder: Upload is offered').toBeFalse();

        const folder = page().querySelector<HTMLInputElement>('.cms-document-upload__field input')!;
        folder.value = '';
        folder.dispatchEvent(new Event('input'));
        await settle();
        expect(upload().disabled).toBeTrue();
    });
});
