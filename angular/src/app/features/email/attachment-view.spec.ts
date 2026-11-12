import { Dialog } from '@angular/cdk/dialog';
import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { attachmentViewKind, openImageAttachment, viewableImageType } from './attachment-view';

/**
 * Which attachments get View, and the image preview: the server's viewAs decides once served, the declared type only
 * for a row without it; the preview shows the bytes under the type the download serves, closes on Escape and gives
 * its object URL back.
 */
describe('attachment view', () => {
    describe('which viewer an attachment opens in', () => {
        it('follows a served viewAs: pdf and image open, none does not', () => {
            expect(attachmentViewKind({ contentType: 'application/pdf', viewAs: 'pdf' })).toBe('pdf');
            expect(attachmentViewKind({ contentType: 'image/png', viewAs: 'image' })).toBe('image');
            expect(attachmentViewKind({ contentType: 'application/zip', viewAs: 'none' })).toBeNull();
        });

        it('ignores the declared type once viewAs is served, either way', () => {
            expect(attachmentViewKind({ contentType: 'application/octet-stream', viewAs: 'pdf' }))
                .withContext('a PDF sent as octet-stream').toBe('pdf');
            expect(attachmentViewKind({ contentType: 'application/octet-stream', viewAs: 'image' })).toBe('image');
            expect(attachmentViewKind({ contentType: 'application/pdf', viewAs: 'none' }))
                .withContext('none never falls back to a declared PDF').toBeNull();
            expect(attachmentViewKind({ contentType: 'image/png', viewAs: 'none' }))
                .withContext('none never falls back to a declared PNG').toBeNull();
            const unknown = { contentType: 'application/pdf', viewAs: 'html' } as unknown as Parameters<typeof attachmentViewKind>[0];
            expect(attachmentViewKind(unknown)).withContext('a value it does not know').toBeNull();
        });

        it('without viewAs, allows only a declared PDF, PNG, JPEG, GIF or WebP, never SVG', () => {
            expect(attachmentViewKind({ contentType: 'application/pdf' })).toBe('pdf');
            for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'IMAGE/PNG']) {
                expect(attachmentViewKind({ contentType: type })).withContext(type).toBe('image');
            }
            for (const type of ['image/svg+xml', 'text/html', 'application/xhtml+xml', 'image/bmp', 'image/tiff',
                'application/octet-stream', 'image/pngx', 'application/pdfx', 'image', '']) {
                expect(attachmentViewKind({ contentType: type })).withContext(type).toBeNull();
            }
        });

        it('never reads the file name', () => {
            const named = { contentType: 'application/octet-stream', filename: 'statement.pdf' };
            expect(attachmentViewKind(named)).toBeNull();
            const svg = { contentType: 'image/svg+xml', filename: 'logo.png' };
            expect(attachmentViewKind(svg)).toBeNull();
        });
    });

    it('previews only a download served as a PNG, JPEG, GIF or WebP image', () => {
        expect(viewableImageType('image/png')).toBe('image/png');
        expect(viewableImageType('image/jpeg; charset=binary')).toBe('image/jpeg');
        expect(viewableImageType('image/gif')).toBe('image/gif');
        expect(viewableImageType('image/webp')).toBe('image/webp');
        for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream', 'application/pdf', '']) {
            expect(viewableImageType(type)).withContext(type).toBeNull();
        }
        expect(viewableImageType(null)).toBeNull();
    });

    describe('the image preview', () => {
        let dialog: Dialog;
        let button: HTMLButtonElement;
        let made: { url: string; blob: Blob }[];
        let revoked: string[];

        beforeEach(() => {
            TestBed.configureTestingModule({});
            dialog = TestBed.inject(Dialog);
            button = document.createElement('button');
            button.textContent = 'View';
            document.body.appendChild(button);
            button.focus();
            made = [];
            revoked = [];
            const create = URL.createObjectURL.bind(URL);
            const revoke = URL.revokeObjectURL.bind(URL);
            spyOn(URL, 'createObjectURL').and.callFake((blob: Blob | MediaSource) => {
                const url = create(blob);
                made.push({ url, blob: blob as Blob });
                return url;
            });
            spyOn(URL, 'revokeObjectURL').and.callFake((url: string) => {
                revoked.push(url);
                revoke(url);
            });
        });
        afterEach(() => {
            dialog.closeAll();
            button.remove();
        });

        const answer = (contentType: string): HttpResponse<Blob> => new HttpResponse({
            body: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'text/html' }),
            headers: new HttpHeaders({ 'Content-Type': contentType }),
        });
        const settle = async (): Promise<void> => {
            for (let i = 0; i < 3; i++) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        };

        it('shows an <img> from a blob URL typed by the download\'s Content-Type, labelled with the name and kind', async () => {
            const ref = openImageAttachment(dialog, answer('image/png'), 'harbour.png', button);
            expect(ref).not.toBeNull();
            ref!.componentRef!.changeDetectorRef.detectChanges();
            await settle();

            expect(made.length).toBe(1);
            expect(made[0].blob.type).withContext('the served type, not the body\'s').toBe('image/png');
            const img = document.querySelector<HTMLImageElement>('[data-test="image-preview-img"]')!;
            expect(img.getAttribute('src')).toBe(made[0].url);
            expect(img.src.startsWith('blob:')).toBeTrue();
            expect(img.alt).toBe('harbour.png');
            const container = document.querySelector<HTMLElement>('.cdk-dialog-container')!;
            expect(container.getAttribute('aria-label')).toBe('harbour.png (PNG image)');
            expect(document.querySelector('[data-test="image-preview-kind"]')!.textContent).toBe('PNG image');
            expect(container.contains(document.activeElement)).withContext('focus moved into the preview').toBeTrue();
            expect(container.querySelector('iframe, object, embed, svg')).toBeNull();
        });

        it('closes on Escape, revokes its URL and gives focus back to View', async () => {
            const ref = openImageAttachment(dialog, answer('image/webp'), 'chart.webp', button)!;
            ref.componentRef!.changeDetectorRef.detectChanges();
            await settle();
            expect(made[0].blob.type).toBe('image/webp');
            let closed = false;
            ref.closed.subscribe(() => (closed = true));

            const esc = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true } as KeyboardEventInit);
            (document.activeElement ?? document.body).dispatchEvent(esc);
            await settle();

            expect(closed).withContext('Escape closed it').toBeTrue();
            expect(revoked).toEqual([made[0].url]);
            expect(document.activeElement).withContext('focus back on View').toBe(button);
        });

        it('shows nothing for a download served as SVG, HTML or anything else', () => {
            for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream']) {
                expect(openImageAttachment(dialog, answer(type), 'logo.png', button)).withContext(type).toBeNull();
            }
            expect(dialog.openDialogs.length).toBe(0);
            expect(made.length).withContext('no object URL made').toBe(0);
        });
    });
});
