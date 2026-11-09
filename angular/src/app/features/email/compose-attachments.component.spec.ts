import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpEventType, HttpResponse, type HttpEvent } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable, Subject, firstValueFrom, of, throwError } from 'rxjs';
import {
    CmsFilesPickerComponent,
    CmsFilesPickerService,
    FilesPickerDenied,
    VfsTreeService,
    type FilesPickerChoice,
    type FilesPickerOptions,
} from '@coolms/ui-angular';
import { ComposeAttachmentsComponent } from './compose-attachments.component';
import { encodedBytes, readyAttachment, type ComposeAttachment } from './compose-attachments';
import { EmailService } from './email.service';
import type { DriveAttachResultDto, OutgoingAttachmentDto } from './email.types';

/**
 * The composer's attachments, rendered: a chip per file with its upload's progress, a Drive file attached by node id
 * with a refusal shown by name, Remove (DELETE on the server), and the size used, with what is left only when the
 * mailbox has a limit. The picker, the mail API and the VFS listing are stubs.
 */
describe('ComposeAttachmentsComponent', () => {
    let uploads: Array<{ file: File; answer: Subject<HttpEvent<OutgoingAttachmentDto>> }>;
    let driveCalls: string[][];
    let driveAnswer: () => Observable<DriveAttachResultDto>;
    let removed: string[];
    let pickerOptions: FilesPickerOptions | null;
    let pickerAnswer: readonly FilesPickerChoice[] | undefined;
    let listed: string[];
    let listAnswer: () => Observable<unknown>;
    let changed: number;

    function create(limit: number | null = null, initial: ComposeAttachment[] = []): ComponentFixture<ComposeAttachmentsComponent> {
        const f = TestBed.createComponent(ComposeAttachmentsComponent);
        f.componentRef.setInput('mailboxId', 'mb1');
        f.componentRef.setInput('limitBytes', limit);
        f.componentRef.setInput('bodyBytes', 0);
        f.componentRef.setInput('attachments', initial);
        f.componentInstance.changed.subscribe(() => changed++);
        f.detectChanges();

        return f;
    }

    const chips = (f: ComponentFixture<unknown>): HTMLElement[] =>
        Array.from((f.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-test="attachment-chip"]'));
    const chipNamed = (f: ComponentFixture<unknown>, name: string): HTMLElement => {
        const chip = chips(f).find((c) => c.querySelector('[data-test="attachment-name"]')?.textContent?.trim() === name);
        if (!chip) throw new Error('no chip ' + name);

        return chip;
    };
    const sizeLine = (f: ComponentFixture<unknown>): string =>
        (f.nativeElement as HTMLElement).querySelector('[data-test="attachment-size"]')!.textContent!.trim();
    const dto = (id: string, filename: string, sizeBytes: number): OutgoingAttachmentDto =>
        ({ id, filename, sizeBytes, mimeType: 'text/plain', encodedBytes: encodedBytes(sizeBytes) });

    beforeEach(() => {
        uploads = [];
        driveCalls = [];
        driveAnswer = () => of({ attachments: [] });
        removed = [];
        pickerOptions = null;
        pickerAnswer = undefined;
        listed = [];
        listAnswer = () => of({ member: [], hasMore: false, nextCursor: null });
        changed = 0;
        TestBed.configureTestingModule({
            imports: [ComposeAttachmentsComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        uploadAttachment: (_mb: string, file: File) => {
                            const answer = new Subject<HttpEvent<OutgoingAttachmentDto>>();
                            uploads.push({ file, answer });

                            return answer;
                        },
                        attachFromDrive: (_mb: string, nodes: string[]) => {
                            driveCalls.push(nodes);

                            return driveAnswer();
                        },
                        removeAttachment: (_mb: string, id: string) => {
                            removed.push(id);

                            return of(undefined);
                        },
                    },
                },
                {
                    provide: CmsFilesPickerService,
                    useValue: { open: (o: FilesPickerOptions) => { pickerOptions = o; return Promise.resolve(pickerAnswer); } },
                },
                {
                    provide: VfsTreeService,
                    useValue: { listChildren: (path: string) => { listed.push(path); return listAnswer(); } },
                },
                { provide: Store, useValue: { selectSnapshot: () => ({ id: 'u1' }) } },
            ],
        });
    });

    it('shows an upload as a chip with its progress, then attached with its size', () => {
        const f = create();
        f.componentInstance.uploadFiles([new File(['x'.repeat(1500)], 'report.pdf', { type: 'application/pdf' })]);
        f.detectChanges();
        const chip = chipNamed(f, 'report.pdf');
        expect(chip.getAttribute('data-status')).toBe('uploading');

        uploads[0].answer.next({ type: HttpEventType.UploadProgress, loaded: 750, total: 1500 });
        f.detectChanges();
        expect(chip.querySelector('[data-test="attachment-progress"]')!.getAttribute('aria-valuenow')).toBe('50');

        uploads[0].answer.next(new HttpResponse({ status: 201, body: dto('a1', 'report.pdf', 1500) }));
        f.detectChanges();
        expect(chipNamed(f, 'report.pdf').getAttribute('data-status')).toBe('ready');
        expect(chipNamed(f, 'report.pdf').querySelector('[data-test="attachment-progress"]')).toBeNull();
        expect(chipNamed(f, 'report.pdf').textContent).toContain('1.5 KB');
        expect(f.componentInstance.attachments().map((a) => a.id)).toEqual(['a1']);
        expect(changed).toBe(1);
    });

    it('shows a refused upload on its chip', () => {
        const f = create();
        f.componentInstance.uploadFiles([new File(['x'], 'bad.bin')]);
        uploads[0].answer.error(new HttpErrorResponse({ status: 422 }));
        f.detectChanges();
        expect(chipNamed(f, 'bad.bin').getAttribute('data-status')).toBe('refused');
        expect(chipNamed(f, 'bad.bin').querySelector('[data-test="attachment-refusal"]')!.textContent).toContain('larger than 25 MB');
    });

    it('refuses a file that would go over the limit before uploading it', () => {
        const f = create(1000);
        f.componentInstance.uploadFiles([new File(['x'.repeat(900)], 'big.txt')]);
        f.detectChanges();
        expect(uploads.length).toBe(0);
        expect(chipNamed(f, 'big.txt').querySelector('[data-test="attachment-refusal"]')!.textContent).toContain('over the mailbox');
    });

    it('attaches the files chosen in the picker by node id, and shows a refusal by name', async () => {
        const f = create(25_000_000);
        pickerAnswer = [
            { id: 'n1', name: 'plan.docx', kind: 'file', size: 3000, mimeType: 'application/msword', space: 'home', path: 'Docs' },
            { id: 'n2', name: 'gone.txt', kind: 'file', size: 10, mimeType: 'text/plain', space: 'home', path: '' },
        ];
        driveAnswer = () => of({ attachments: [
            { node: 'n1', ...dto('d1', 'plan.docx', 3000), source: 'drive' },
            { node: 'n2', refused: 'not-found' },
        ] });
        await f.componentInstance.chooseFromFiles();
        f.detectChanges();

        expect(driveCalls).toEqual([['n1', 'n2']]);
        expect(chipNamed(f, 'plan.docx').getAttribute('data-status')).toBe('ready');
        const gone = chipNamed(f, 'gone.txt');
        expect(gone.getAttribute('data-status')).toBe('refused');
        expect(gone.querySelector('[data-test="attachment-refusal"]')!.textContent).toContain('Not found, or you may not read it.');

        // The picker was given the budget, a file costing its encoded body and part headers, and "Attach files" at 0.
        expect(pickerOptions!.budget!.limitBytes).toBe(25_000_000);
        expect(pickerOptions!.budget!.cost!({ id: 'x', name: 'x', kind: 'file', size: 3000 })).toBe(4000 + 2 * Math.ceil(4000 / 76) + 200);
        expect(pickerOptions!.confirmLabel!(0)).toBe('Attach files');
        expect(pickerOptions!.confirmLabel!(2)).toBe('Attach 2 files');
    });

    it('gives the picker a cost of the encoded size plus the part headers: a file exactly at the edge fits, 1 byte less of limit does not', async () => {
        // 3000 bytes: base64 4000, line breaks 2 * ceil(4000 / 76) = 106, part headers 200 -- 4306 in all.
        const edgeFile = { id: 'n1', name: 'edge.bin', kind: 'file' as const, size: 3000, mimeType: 'application/octet-stream' };
        const reasonAt = async (limit: number): Promise<string | null> => {
            const host = create(limit);
            await host.componentInstance.chooseFromFiles();
            const picker = TestBed.createComponent(CmsFilesPickerComponent);
            picker.componentRef.setInput('options', { ...pickerOptions!, list: () => of({ entries: [edgeFile] }) });
            picker.detectChanges();
            const row = (picker.nativeElement as HTMLElement).querySelector('[data-test="fp-row"]')!;

            return row.getAttribute('aria-disabled');
        };
        expect(pickerOptions).toBeNull();
        expect(await reasonAt(4306)).toBeNull();
        // The base64 alone (4106) would still fit in 4305; with the part headers it does not.
        expect(await reasonAt(4305)).toBe('true');
    });

    it('lists the person\'s own files under their home, and a refused folder as denied', async () => {
        const f = create();
        await f.componentInstance.chooseFromFiles();
        expect(pickerOptions!.spaces.map((s) => s.id)).toEqual(['home', 'all']);

        listAnswer = () => throwError(() => new HttpErrorResponse({ status: 403 }));
        const answer = pickerOptions!.list('home', 'Docs');
        await expectAsync(firstValueFrom(answer as Observable<unknown>)).toBeRejectedWith(jasmine.any(FilesPickerDenied));
        expect(listed).toEqual(['/home/u1/Docs']);
    });

    it('removes a file from the message and from the server', () => {
        const f = create(null, [readyAttachment(dto('a1', 'notes.txt', 10), 'upload')]);
        chipNamed(f, 'notes.txt').querySelector<HTMLElement>('[data-test="attachment-remove"]')!.click();
        f.detectChanges();
        expect(chips(f).length).toBe(0);
        expect(removed).toEqual(['a1']);
        expect(f.componentInstance.attachments()).toEqual([]);
    });

    it('shows only the size used when the mailbox has no limit, and what is left when it has one', () => {
        const file = readyAttachment(dto('a1', 'notes.txt', 3000), 'upload');
        // 3000 bytes encode to 4000 + 2 * ceil(4000 / 76) = 4106, and its part headers make 4306.
        const open = create(null, [file]);
        expect(sizeLine(open)).toBe('4.3 KB used');
        expect(sizeLine(open)).not.toContain('left');

        const limited = create(25_000_000, [file]);
        expect(sizeLine(limited)).toContain('of 25 MB used');
        expect(sizeLine(limited)).toContain('left');
    });

    it('offers From device and From files under Attach files', () => {
        const f = create();
        (f.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-test="attach-menu"]')!.click();
        f.detectChanges();
        const items = Array.from((f.nativeElement as HTMLElement).querySelectorAll('[role="menuitem"]')).map((i) => i.textContent!.trim());
        expect(items).toEqual(['From device', 'From files']);
    });
});
