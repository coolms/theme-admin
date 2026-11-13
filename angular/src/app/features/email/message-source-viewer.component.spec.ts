import { Dialog } from '@angular/cdk/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import {
    downloadNameOf,
    MESSAGE_SOURCE_WORDS,
    openMessageSource,
    sourceFailureOf,
} from './message-source-viewer.component';

/**
 * "Show original": the source shown as text only, the truncated line, Copy, Download, the two refusals with their
 * sentences, and the dialog's keys -- rendered through the CDK dialog, as the page opens it, against the HTTP layer.
 */
describe('MessageSourceViewerComponent', () => {
    const ID = 'm-1';
    const RAW = `/api/v1/email/messages/${ID}/raw`;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => null } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => {
        TestBed.inject(Dialog).closeAll();
        TestBed.inject(OverlayContainer).ngOnDestroy();
    });

    const overlay = (): HTMLElement => TestBed.inject(OverlayContainer).getContainerElement();
    const q = <T extends HTMLElement = HTMLElement>(test: string): T | null =>
        overlay().querySelector<T>(`[data-test="${test}"]`);
    async function settle(): Promise<void> {
        TestBed.inject(ApplicationRef).tick();
        await new Promise<void>(resolve => setTimeout(resolve));
        TestBed.inject(ApplicationRef).tick();
    }
    function open(subject = 'Desk move on Friday'): void {
        openMessageSource(TestBed.inject(Dialog), { messageId: ID, subject });
        TestBed.inject(ApplicationRef).tick();
    }
    const viewRequest = (): TestRequest => http.expectOne(r => r.url === RAW && !r.params.has('download'));
    async function shown(text: string, truncated = false): Promise<void> {
        viewRequest().flush(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Raw-Truncated': String(truncated) } });
        await settle();
    }
    async function refused(status: number, type: string): Promise<void> {
        viewRequest().flush(JSON.stringify({ type, status }), {
            status, statusText: 'refused', headers: { 'Content-Type': 'application/problem+json' },
        });
        await settle();
    }

    it('shows an HTML-looking source as literal text: textContent, nothing created in the page', async () => {
        const source = [
            'Subject: <b>hello</b>',
            '<script>window.__sourcePwned = 1</script>',
            '<img src="x" onerror="window.__sourcePwned = 2">',
            '<a href="https://example.test/">a link</a> https://example.test/plain',
        ].join('\r\n');
        open();
        await shown(source);
        const pre = q<HTMLPreElement>('source-text')!;
        expect(pre.tagName).toBe('PRE');
        expect(pre.textContent).toBe(source);
        expect(pre.childElementCount).withContext('elements parsed from the source').toBe(0);
        expect(overlay().querySelectorAll('script, img, a, b').length).toBe(0);
        expect((window as unknown as Record<string, unknown>)['__sourcePwned']).toBeUndefined();
        expect(overlay().querySelector('.mso__title')!.textContent!.trim()).toBe('Desk move on Friday');
    });

    it('says the source was cut only when the server says so', async () => {
        open();
        await shown('Received: one', true);
        expect(q('source-truncated')?.textContent?.trim()).toBe('Showing the first 1 MB; download for the full source');
        TestBed.inject(Dialog).closeAll();
        await settle();
        open();
        await shown('Received: one', false);
        expect(q('source-truncated')).toBeNull();
    });

    it('Copy copies exactly the text shown', async () => {
        const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
        open();
        await shown('From: a@example.test\r\n\r\nbody \uFFFD end');
        q<HTMLButtonElement>('source-copy')!.click();
        await settle();
        expect(write).toHaveBeenCalledOnceWith(q('source-text')!.textContent!);
        expect(q('source-status')!.textContent!.trim()).toBe(MESSAGE_SOURCE_WORDS.copied);
    });

    it('Download asks for ?download=1 and saves the whole .eml under the name the server gives', async () => {
        const clicked: string[] = [];
        spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
            clicked.push(this.download);
        });
        open();
        await shown('Received: one', true);
        q<HTMLButtonElement>('source-download')!.click();
        const req = http.expectOne(r => r.url === RAW && r.params.get('download') === '1');
        expect(req.request.responseType).toBe('blob');
        req.flush(new Blob(['Received: one\r\n...the rest'], { type: 'message/rfc822' }), {
            headers: { 'Content-Disposition': 'attachment; filename="Desk move on Friday.eml"' },
        });
        await settle();
        expect(clicked).toEqual(['Desk move on Friday.eml']);
    });

    it('offers Download while the source cannot be read', async () => {
        open();
        await refused(404, '/errors/email/message-source-gone');
        expect(q<HTMLButtonElement>('source-download')!.disabled).toBeFalse();
    });

    it('says a source that is gone (404 source-gone) in its own sentence, with no Retry', async () => {
        open();
        await refused(404, '/errors/email/message-source-gone');
        expect(q('source-gone')?.textContent?.trim()).toBe(MESSAGE_SOURCE_WORDS.gone);
        expect(q('source-retry')).toBeNull();
        expect(q('source-text')).toBeNull();
    });

    it('says a server that could not be read (502 source-unavailable) in its own sentence, and Retry reads again', async () => {
        open();
        await refused(502, '/errors/email/message-source-unavailable');
        expect(q('source-unavailable')?.textContent).toContain(MESSAGE_SOURCE_WORDS.unavailable);
        expect(q('source-gone')).toBeNull();
        q<HTMLButtonElement>('source-retry')!.click();
        await settle();
        await shown('Received: again');
        expect(q('source-text')!.textContent).toBe('Received: again');
        expect(q('source-unavailable')).toBeNull();
    });

    it('says the page\'s sentence for any other refusal, and not found for any other 404', async () => {
        open();
        await refused(403, '/errors/403');
        expect(q('source-failed')?.textContent?.trim()).toBe(MESSAGE_SOURCE_WORDS.failed);
        TestBed.inject(Dialog).closeAll();
        await settle();
        open();
        await refused(404, '/errors/not-found');
        expect(q('source-missing')?.textContent?.trim()).toBe(MESSAGE_SOURCE_WORDS.missing);
        expect(MESSAGE_SOURCE_WORDS.missing).withContext('the phrasing the app uses for what is gone').toBe('This message is not there any more.');
        expect(q('source-gone')).toBeNull();
        expect(q('source-failed')).toBeNull();
    });

    it('keeps focus inside while open; Escape closes it and focus goes back to the opener', async () => {
        const opener = document.createElement('button');
        opener.textContent = 'More actions';
        document.body.appendChild(opener);
        opener.focus();
        open();
        await shown('Received: one');
        await settle();
        const container = overlay().querySelector<HTMLElement>('.cdk-dialog-container')!;
        expect(container.contains(document.activeElement)).withContext('focus moved into the viewer').toBeTrue();
        expect(container.getAttribute('aria-modal')).toBe('true');
        expect(overlay().querySelectorAll('.cdk-focus-trap-anchor').length).withContext('the focus trap').toBe(2);

        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
        await settle();
        await settle();
        expect(overlay().querySelector('app-message-source-viewer')).toBeNull();
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });

    it('Close closes it too', async () => {
        open();
        await shown('Received: one');
        q<HTMLButtonElement>('source-close')!.click();
        await settle();
        await settle();
        expect(overlay().querySelector('app-message-source-viewer')).toBeNull();
    });

    it('reads a refusal by status and type together, and a download name from either form of the header', () => {
        expect(sourceFailureOf(404, '{"type":"/errors/email/message-source-gone"}')).toBe('gone');
        expect(sourceFailureOf(502, { type: '/errors/email/message-source-unavailable' })).toBe('unavailable');
        expect(sourceFailureOf(404, '{"type":"/errors/404"}')).toBe('missing');
        expect(sourceFailureOf(404, { type: '/errors/not-found' })).toBe('missing');
        expect(sourceFailureOf(404, 'Not Found')).toBe('missing');
        expect(sourceFailureOf(403, { type: '/errors/403' })).toBe('failed');
        expect(sourceFailureOf(502, 'Bad gateway')).toBe('failed');
        expect(downloadNameOf('attachment; filename="R_sum_.eml"; filename*=UTF-8\'\'R%C3%A9sum%C3%A9.eml', 'x.eml')).toBe('R\u00e9sum\u00e9.eml');
        expect(downloadNameOf('attachment; filename="Plain.eml"', 'x.eml')).toBe('Plain.eml');
        expect(downloadNameOf(null, 'x.eml')).toBe('x.eml');
    });
});
