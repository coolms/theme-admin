import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { ModalComponent, NaviGraphTreeSource, ToastService } from '@coolms/ui-angular';
import { NotificationApiService, type SendTestRequest } from './notification-api.service';
import { SendNotificationDialogComponent } from './send-notification-dialog.component';

/**
 * The manual send dialog: a notification body is plain text, so the dialog offers no format for it and its send
 * carries none. The route picker is left out of the rendering; the rest of the form is rendered as shipped.
 */
describe('SendNotificationDialogComponent -- the body is plain text', () => {
    let sent: SendTestRequest[];
    let asked: string[];
    let fixture: ComponentFixture<SendNotificationDialogComponent>;

    async function render(): Promise<HTMLElement> {
        sent = [];
        asked = [];
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [SendNotificationDialogComponent],
            providers: [
                { provide: DialogRef, useValue: { close: (): void => {} } },
                { provide: ToastService, useValue: { success: (): void => {}, error: (): void => {} } },
                {
                    provide: NotificationApiService,
                    useValue: {
                        listTypes: () => { asked.push('listTypes'); return of([{ value: 'manual', label: 'Manual' }]); },
                        listBodyFormats: () => { asked.push('listBodyFormats'); return of([]); },
                        sendTest: (payload: SendTestRequest) => { sent.push(payload); return of({}); },
                    },
                },
            ],
        });
        TestBed.overrideComponent(SendNotificationDialogComponent, {
            set: {
                imports: [FormsModule, ModalComponent],
                schemas: [CUSTOM_ELEMENTS_SCHEMA],
                providers: [{ provide: NaviGraphTreeSource, useValue: { treeSlug: '' } }],
            },
        });
        fixture = TestBed.createComponent(SendNotificationDialogComponent);
        fixture.detectChanges();
        // The form controls attach their inputs after a turn: typing before that reaches nothing.
        await fixture.whenStable();

        return fixture.nativeElement as HTMLElement;
    }

    function type(el: HTMLElement, selector: string, value: string): void {
        const field = el.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
        field.value = value;
        field.dispatchEvent(new Event('input'));
    }

    it('shows no format control, with a body typed, and asks for no formats', async () => {
        const el = await render();
        type(el, '#cms-send-title', 'Build finished');
        type(el, '#cms-send-body', '**not** markup, only text');
        fixture.detectChanges();

        expect(el.querySelector('#cms-send-body')).withContext('the body field is drawn').not.toBeNull();
        expect(el.querySelector('#cms-send-body-format')).toBeNull();
        expect(el.querySelector('[name="bodyFormat"]')).toBeNull();
        const labels = Array.from(el.querySelectorAll('label')).map((l) => l.textContent?.trim());
        expect(labels).toEqual(['Type', 'Title *', 'Body', 'Link']);
        expect(asked).toEqual(['listTypes']);
    });

    it('sends the title, the body and the type, and no bodyFormat', async () => {
        const el = await render();
        type(el, '#cms-send-title', '  Build finished ');
        type(el, '#cms-send-body', ' **not** markup, only text ');

        (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

        expect(sent.length).withContext('one send').toBe(1);
        expect(sent[0]).toEqual({ type: 'manual', title: 'Build finished', body: '**not** markup, only text' });
        expect(Object.keys(sent[0])).not.toContain('bodyFormat');
    });
});
