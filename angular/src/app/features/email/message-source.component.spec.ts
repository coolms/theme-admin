import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { EmailService } from './email.service';
import {
    downloadMessageEml,
    downloadNameOf,
    MESSAGE_SOURCE_WORDS,
    MessageSourceComponent,
    sourceFailureOf,
} from './message-source.component';

/**
 * A message's original in the reading pane: the source shown as text only and wrapped inside the pane, the truncated
 * line, Copy source, Download message, and the refusals with their sentences -- against the HTTP layer.
 */
describe('MessageSourceComponent', () => {
    const ID = 'm-1';
    const RAW = `/api/v1/email/messages/${ID}/raw`;
    let http: HttpTestingController;
    let fixture: ComponentFixture<MessageSourceComponent>;

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
    afterEach(() => (fixture?.nativeElement as HTMLElement | undefined)?.remove());

    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const q = <T extends HTMLElement = HTMLElement>(test: string): T | null => el().querySelector<T>(`[data-test="${test}"]`);
    async function settle(): Promise<void> {
        fixture.detectChanges();
        await new Promise<void>(resolve => setTimeout(resolve));
        fixture.detectChanges();
    }
    function open(id = ID, width?: number): void {
        fixture = TestBed.createComponent(MessageSourceComponent);
        if (width !== undefined) {
            el().style.width = `${width}px`;
        }
        document.body.appendChild(el());
        fixture.componentRef.setInput('messageId', id);
        fixture.detectChanges();
    }
    const viewRequest = (url = RAW): TestRequest => http.expectOne(r => r.url === url && !r.params.has('download'));
    async function shown(text: string, truncated = false): Promise<void> {
        viewRequest().flush(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Raw-Truncated': String(truncated) } });
        await settle();
    }
    async function refused(status: number, type: string, detail?: string): Promise<void> {
        viewRequest().flush(JSON.stringify({ type, status, ...(detail === undefined ? {} : { detail }) }), {
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
        expect(el().querySelectorAll('script, img, a, b').length).toBe(0);
        expect((window as unknown as Record<string, unknown>)['__sourcePwned']).toBeUndefined();
    });

    it('wraps every line inside the pane, the longest header included: nothing wider than the pane', async () => {
        const long = 'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=example.test; s=selector; h=' + 'From:To:Subject:'.repeat(30)
            + '; bh=' + 'A'.repeat(400);
        open(ID, 320);
        await shown(`${long}\r\nReceived: from a long chain of relays\r\n\r\nbody`);
        const pre = q<HTMLPreElement>('source-text')!;
        expect(pre.getBoundingClientRect().width).withContext('the source is the pane\'s width').toBeLessThanOrEqual(320.5);
        expect(pre.scrollWidth).withContext('no line runs past the pane').toBeLessThanOrEqual(pre.clientWidth + 1);
        expect(el().scrollWidth).withContext('nothing scrolls sideways').toBeLessThanOrEqual(320 + 1);
    });

    it('says the source was cut only when the server says so', async () => {
        open();
        await shown('Received: one', true);
        expect(q('source-truncated')?.textContent?.trim()).toBe('Showing the first 1 MB; download for the full source');
        el().remove();
        open();
        await shown('Received: one', false);
        expect(q('source-truncated')).toBeNull();
    });

    it('reads another message\'s original afresh when the message changes', async () => {
        open();
        await shown('Received: first');
        fixture.componentRef.setInput('messageId', 'm-2');
        fixture.detectChanges();
        expect(q('source-loading')).withContext('loading the second').not.toBeNull();
        viewRequest('/api/v1/email/messages/m-2/raw').flush('Received: second', { headers: { 'Content-Type': 'text/plain' } });
        await settle();
        expect(q('source-text')!.textContent).toBe('Received: second');
    });

    it('Copy source copies exactly the text shown, and says why not while it loads or when there is none', async () => {
        const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
        open();
        expect(await fixture.componentInstance.copy()).toBe(MESSAGE_SOURCE_WORDS.copyLoading);
        await shown('From: a@example.test\r\n\r\nbody � end');
        expect(await fixture.componentInstance.copy()).toBe(MESSAGE_SOURCE_WORDS.copied);
        expect(write).toHaveBeenCalledOnceWith(q('source-text')!.textContent!);
        el().remove();
        open();
        await refused(404, '/errors/email/message-source-gone');
        expect(await fixture.componentInstance.copy()).toBe(MESSAGE_SOURCE_WORDS.copyNone);
        expect(write).toHaveBeenCalledTimes(1);
    });

    it('Download message asks for ?download=1 and saves the whole .eml under the name the server gives', async () => {
        const clicked: string[] = [];
        spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
            clicked.push(this.download);
        });
        const saved = downloadMessageEml(TestBed.inject(EmailService), ID);
        const req = http.expectOne(r => r.url === RAW && r.params.get('download') === '1');
        expect(req.request.responseType).toBe('blob');
        req.flush(new Blob(['Received: one\r\n...the rest'], { type: 'message/rfc822' }), {
            headers: { 'Content-Disposition': 'attachment; filename="Desk move on Friday.eml"' },
        });
        expect(await saved).toBeNull();
        expect(clicked).toEqual(['Desk move on Friday.eml']);
    });

    it('Download message says a refusal in the server\'s words', async () => {
        const saved = downloadMessageEml(TestBed.inject(EmailService), ID);
        http.expectOne(r => r.url === RAW && r.params.get('download') === '1').flush(
            new Blob([JSON.stringify({ type: '/errors/email/message-source-gone', status: 404, detail: 'Said for the download.' })]),
            { status: 404, statusText: 'gone' });
        expect(await saved).toBe('Said for the download.');
    });

    it('says a source that is gone (404 source-gone) in the server\'s words, with no Retry', async () => {
        open();
        await refused(404, '/errors/email/message-source-gone', 'Said by the server.');
        expect(q('source-gone')?.textContent?.trim()).toBe('Said by the server.');
        expect(q('source-retry')).toBeNull();
        expect(q('source-text')).toBeNull();
    });

    it('says an undeclared 502 in the generic sentence, never its text', async () => {
        open();
        await refused(502, 'about:blank', 'internals');
        expect(q('source-failed')?.textContent?.trim()).toBe('Something went wrong. Try again.');
    });

    it('says a server that could not be read (502 source-unavailable) in its detail, and Retry reads again', async () => {
        open();
        await refused(502, '/errors/email/message-source-unavailable', 'Said for 502.');
        expect(q('source-unavailable')?.textContent).toContain('Said for 502.');
        expect(q('source-gone')).toBeNull();
        q<HTMLButtonElement>('source-retry')!.click();
        await settle();
        await shown('Received: again');
        expect(q('source-text')!.textContent).toBe('Received: again');
        expect(q('source-unavailable')).toBeNull();
    });

    it('says the server\'s detail for any other refusal, and Not available right now without one', async () => {
        open();
        await refused(403, '/errors/403', 'Said for 403.');
        expect(q('source-failed')?.textContent?.trim()).toBe('Said for 403.');
        el().remove();
        open();
        await refused(404, '/errors/not-found');
        expect(q('source-missing')?.textContent?.trim()).toBe('Not available right now');
        expect(q('source-gone')).toBeNull();
        expect(q('source-failed')).toBeNull();
    });

    it('reads a refusal by status and type together, and a download name from either form of the header', () => {
        expect(sourceFailureOf(404, '{"type":"/errors/email/message-source-gone"}')).toBe('gone');
        expect(sourceFailureOf(502, { type: '/errors/email/message-source-unavailable' })).toBe('unavailable');
        expect(sourceFailureOf(404, '{"type":"/errors/404"}')).toBe('missing');
        expect(sourceFailureOf(404, { type: '/errors/not-found' })).toBe('missing');
        expect(sourceFailureOf(404, 'Not Found')).toBe('missing');
        expect(sourceFailureOf(403, { type: '/errors/403' })).toBe('failed');
        expect(sourceFailureOf(502, 'Bad gateway')).toBe('failed');
        expect(downloadNameOf('attachment; filename="R_sum_.eml"; filename*=UTF-8\'\'R%C3%A9sum%C3%A9.eml', 'x.eml')).toBe('Résumé.eml');
        expect(downloadNameOf('attachment; filename="Plain.eml"', 'x.eml')).toBe('Plain.eml');
        expect(downloadNameOf(null, 'x.eml')).toBe('x.eml');
    });
});
