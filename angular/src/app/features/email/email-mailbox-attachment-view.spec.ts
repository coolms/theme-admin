import { Dialog } from '@angular/cdk/dialog';
import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngxs/store';
import { NEVER, Subject, of } from 'rxjs';
import { AppConfigState, ErrorHandlerService, NaviGraphService } from '@coolms/core-angular';
import { ViewerModalComponent, type ViewerModalData } from '@coolms/document-viewer-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DateTimeFormatService,
    DraftStoreService,
    ToastService,
} from '@coolms/ui-angular';
import { ContactsService } from '../contacts/contacts.service';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { AttachmentImagePreviewComponent, type AttachmentImagePreviewData } from './attachment-image-preview.component';
import { EmailLiveEventsService } from './email-live-events.service';
import { EmailMailboxPageComponent } from './email-mailbox.page';
import { EmailService } from './email.service';
import {
    type EmailAttachmentDto,
    type EmailMailboxDto,
    type EmailMessageDetailDto,
    type EmailMessageDto,
} from './email.types';
import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesService } from './mail-preferences.service';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';

const LISTED: EmailMessageDto[] = [{ id: 'm1', folder: 'INBOX', subject: 'Quarterly figures' }];

function att(index: number, filename: string, contentType: string, viewAs?: EmailAttachmentDto['viewAs']): EmailAttachmentDto {
    const row: EmailAttachmentDto = { index, filename, contentType, sizeBytes: 2048, inline: false };
    return viewAs === undefined ? row : { ...row, viewAs };
}

/**
 * View on the open message's attachments: offered by the server's viewAs (by the declared type only while it is not
 * served), next to Download and Save to my files on every attachment. A PDF opens in the app's PDF viewer from bytes
 * fetched with the session; an image in the preview; nothing opens a tab or a window.
 */
describe('EmailMailboxPageComponent -- attachment view', () => {
    let fixture: ComponentFixture<EmailMailboxPageComponent>;
    let opened: { component: unknown; data: unknown; config: Record<string, unknown>; closed: Subject<void> }[];
    let fetched: { messageId: string; index: number }[];
    let answer: HttpResponse<Blob>;
    let errors: string[];

    beforeEach(() => {
        opened = [];
        fetched = [];
        errors = [];
        answer = new HttpResponse({ body: new Blob(['%PDF-1.7']), headers: new HttpHeaders({ 'Content-Type': 'application/pdf' }) });
        TestBed.configureTestingModule({
            imports: [EmailMailboxPageComponent],
            providers: [
                {
                    provide: EmailService,
                    useValue: {
                        listMailboxes: () => of([{ id: 'mb1', label: 'Work' } as EmailMailboxDto]),
                        listFolders: () => of([]),
                        folderTree: () => of([]),
                        listMessages: () => of(LISTED),
                        listInboundWorkflowOptions: () => of([]),
                        listOAuthProviders: () => of([]),
                        fetchAttachmentResponse: (messageId: string, index: number) => {
                            fetched.push({ messageId, index });
                            return of(answer);
                        },
                    },
                },
                { provide: MailPreferencesService, useValue: { readOrDefaults: () => of(MAIL_PREFERENCE_DEFAULTS) } },
                {
                    provide: ToastService,
                    useValue: { error: (text: string): void => void errors.push(text), success: (): void => {}, info: (): void => {} },
                },
                { provide: Router, useValue: { events: NEVER, navigate: () => Promise.resolve(true) } },
                {
                    provide: ActivatedRoute,
                    useValue: { queryParamMap: NEVER, snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } },
                },
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: (selector: unknown) => selector === AppConfigState.manifest
                            ? { navi: { graphBySlug: '/navi/{slug}' } }
                            : null,
                    },
                },
                { provide: NaviGraphService, useValue: { loadTree: () => of([]), isVisible: () => true, matchesShowWhen: () => false } },
                {
                    provide: Dialog,
                    useValue: {
                        open: (component: unknown, config: Record<string, unknown>) => {
                            const closed = new Subject<void>();
                            opened.push({ component, data: config['data'], config, closed });
                            return { closed };
                        },
                    },
                },
                { provide: ConfirmDialogService, useValue: {} },
                { provide: DraftStoreService, useValue: {} },
                { provide: ContactsService, useValue: {} },
                { provide: DateTimeFormatService, useValue: { auto: () => '', date: () => '', time: () => '', dateTime: () => '' } },
                { provide: ErrorHandlerService, useValue: {} },
                { provide: EmailLiveEventsService, useValue: { watch: () => NEVER } },
                { provide: ContextMenuService, useValue: {} },
                { provide: CrumbNamesService, useValue: { setTail: (): void => {} } },
            ],
        });
        TestBed.overrideComponent(EmailMailboxPageComponent, {
            set: { providers: [{ provide: MailboxSettingsModal, useValue: { attach: (): void => {} } }] },
        });
        fixture = TestBed.createComponent(EmailMailboxPageComponent);
        document.body.appendChild(fixture.nativeElement);
        fixture.detectChanges();
    });
    afterEach(() => (fixture.nativeElement as HTMLElement).remove());

    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

    function show(rows: EmailAttachmentDto[]): void {
        fixture.componentInstance.selectedMessage.set({ ...LISTED[0], bodyText: 'Figures attached.' } as EmailMessageDetailDto);
        fixture.componentInstance.attachments.set(rows);
        fixture.detectChanges();
    }
    const chip = (name: string): HTMLElement => Array.from(el().querySelectorAll<HTMLElement>('.mbx__attachment'))
        .find(c => c.querySelector('.mbx__attachment-name')?.textContent?.trim() === name)!;
    const viewOf = (name: string): HTMLButtonElement | null =>
        chip(name).querySelector<HTMLButtonElement>('[data-test="attachment-view"]');

    it('shows View for viewAs pdf and image, hides it for none, and keeps Download and Save on every attachment', () => {
        show([
            att(0, 'report.pdf', 'application/pdf', 'pdf'),
            att(1, 'photo.jpg', 'image/jpeg', 'image'),
            att(2, 'archive.zip', 'application/zip', 'none'),
        ]);
        expect(viewOf('report.pdf')).not.toBeNull();
        expect(viewOf('photo.jpg')).not.toBeNull();
        expect(viewOf('archive.zip')).toBeNull();
        for (const name of ['report.pdf', 'photo.jpg', 'archive.zip']) {
            expect(chip(name).querySelector('[title="Download"]')).withContext(`Download on ${name}`).not.toBeNull();
            expect(chip(name).querySelector('[title="Save to my files"]')).withContext(`Save on ${name}`).not.toBeNull();
        }
        expect(viewOf('report.pdf')!.getAttribute('aria-label')).toBe('View report.pdf');
    });

    it('shows View for viewAs pdf on a part declared application/octet-stream; none hides it on a declared PDF', () => {
        show([
            att(0, 'scan', 'application/octet-stream', 'pdf'),
            att(1, 'invoice.pdf', 'application/pdf', 'none'),
            att(2, 'logo.png', 'image/png', 'none'),
        ]);
        expect(viewOf('scan')).withContext('the decision ignores the declared type').not.toBeNull();
        expect(viewOf('invoice.pdf')).withContext('no fallback to the declared type').toBeNull();
        expect(viewOf('logo.png')).withContext('no fallback to the declared type').toBeNull();
    });

    it('without viewAs, shows View only for a declared PDF, PNG, JPEG, GIF or WebP, never SVG', () => {
        show([
            att(0, 'a.pdf', 'application/pdf'),
            att(1, 'b.png', 'image/png'),
            att(2, 'c.jpg', 'image/jpeg'),
            att(3, 'd.gif', 'image/gif'),
            att(4, 'e.webp', 'image/webp'),
            att(5, 'f.svg', 'image/svg+xml'),
            att(6, 'g.html', 'text/html'),
            att(7, 'h.pdf', 'application/octet-stream'),
        ]);
        for (const name of ['a.pdf', 'b.png', 'c.jpg', 'd.gif', 'e.webp']) {
            expect(viewOf(name)).withContext(name).not.toBeNull();
        }
        for (const name of ['f.svg', 'g.html', 'h.pdf']) {
            expect(viewOf(name)).withContext(name).toBeNull();
        }
    });

    it('opens a PDF in the PDF viewer from bytes fetched with the session, never a window, labelled PDF', () => {
        const windowOpen = spyOn(window, 'open');
        const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
        show([att(3, 'scan', 'application/octet-stream', 'pdf')]);
        viewOf('scan')!.click();

        expect(fetched).toEqual([{ messageId: 'm1', index: 3 }]);
        expect(opened.length).toBe(1);
        expect(opened[0].component).toBe(ViewerModalComponent);
        const data = opened[0].data as ViewerModalData;
        expect(data.mimeType).toBe('application/pdf');
        expect(data.fileUrl.startsWith('blob:')).withContext('an object URL of the fetched bytes').toBeTrue();
        expect(data.downloadUrl).toBe(data.fileUrl);
        expect(data.title).toBe('scan (PDF)');
        expect(opened[0].config['ariaLabel']).toBe('scan (PDF)');
        expect(opened[0].config['restoreFocus']).withContext('focus back on View').toBe(viewOf('scan'));
        expect(windowOpen).not.toHaveBeenCalled();

        opened[0].closed.next();
        expect(revoke).toHaveBeenCalledWith(data.fileUrl);
    });

    it('opens an image in the preview under the download\'s type, the kind in its label, the chip keeping the declared type', () => {
        const windowOpen = spyOn(window, 'open');
        answer = new HttpResponse({ body: new Blob(['GIF89a']), headers: new HttpHeaders({ 'Content-Type': 'image/gif' }) });
        show([att(1, 'diagram', 'application/octet-stream', 'image')]);
        expect(chip('diagram').querySelector('.mbx__attachment-icon')!.classList)
            .withContext('the chip still reads the declared type').not.toContain('bi-file-earmark-image');
        viewOf('diagram')!.click();

        expect(opened.length).toBe(1);
        expect(opened[0].component).toBe(AttachmentImagePreviewComponent);
        const data = opened[0].data as AttachmentImagePreviewData;
        expect(data.url.startsWith('blob:')).toBeTrue();
        expect(data.kind).toBe('GIF image');
        expect(opened[0].config['ariaLabel']).toBe('diagram (GIF image)');
        expect(windowOpen).not.toHaveBeenCalled();
    });

    it('opens nothing when an image\'s download is not served as a PNG, JPEG, GIF or WebP image', () => {
        answer = new HttpResponse({ body: new Blob(['<svg/>']), headers: new HttpHeaders({ 'Content-Type': 'image/svg+xml' }) });
        show([att(1, 'logo.png', 'image/png')]);
        viewOf('logo.png')!.click();

        expect(fetched.length).toBe(1);
        expect(opened.length).toBe(0);
        expect(errors).toEqual(['Couldn\'t show "logo.png" here. Download it instead.']);
    });

    it('opens no PDF viewer when a viewAs pdf download is not served as application/pdf', () => {
        const createUrl = spyOn(URL, 'createObjectURL').and.callThrough();
        answer = new HttpResponse({ body: new Blob(['%PDF-1.7']), headers: new HttpHeaders({ 'Content-Type': 'application/octet-stream' }) });
        show([att(2, 'statement.pdf', 'application/pdf', 'pdf')]);
        viewOf('statement.pdf')!.click();

        expect(fetched).toEqual([{ messageId: 'm1', index: 2 }]);
        expect(opened.length).withContext('no viewer opened').toBe(0);
        expect(createUrl).withContext('no object URL made').not.toHaveBeenCalled();
        expect(errors).toEqual(['Couldn\'t show "statement.pdf" here. Download it instead.']);
    });
});
