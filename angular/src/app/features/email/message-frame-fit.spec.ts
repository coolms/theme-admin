import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { messageFrameDoc } from './message-frame-doc';
import { frameContentHeight, openableUrl } from './message-frame-fit';
import { MessageFrameComponent } from './message-frame.component';

const BODY = '<p>First line.</p>'
    + '<p>A line long enough to wrap when the frame is narrow, again and again.</p>'.repeat(30)
    + '<p><a id="web" href="https://example.com/x?y=1">a web link</a> '
    + '<a id="mail" href="mailto:anna@example.com">a mail link</a> '
    + '<a id="js" href="javascript:window.parent.__mailScriptRan=true">a script link</a> '
    + '<a id="data" href="data:text/html,hi">a data link</a></p>'
    + '<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" usemap="#m" width="100" height="40" alt="map">'
    + '<map name="m"><area id="area" shape="rect" coords="0,0,100,40" href="https://example.com/area" alt="area"></map></p>'
    + '<p id="last">Last line.</p><script>window.parent.__mailScriptRan = true;</script>';

@Component({
    standalone: true,
    imports: [MessageFrameComponent],
    // As in the message pane: the frame inside a scroll region whose scrollbar always has its room, so the frame
    // growing never narrows it (a narrower frame would be measured again in the same frame).
    template: `
        <div style="height: 300px; overflow-y: auto; scrollbar-gutter: stable">
            <div [style.width.px]="width()"><app-message-frame [doc]="doc" /></div>
        </div>
    `,
})
class HostComponent {
    readonly width = signal(400);
    doc: SafeHtml | null = null;
}

/**
 * The message frame: sandboxed to same-origin alone, as tall as its document so it never scrolls itself, measured
 * from outside; no script from the mail runs; its links open through the page, in a new tab with no opener and no
 * referrer, http(s) and mailto only. Rendered: a real frame in the test page.
 */
describe('MessageFrameComponent', () => {
    let f: ComponentFixture<HostComponent>;
    let opened: unknown[][];

    beforeEach(() => {
        opened = [];
        spyOn(window, 'open').and.callFake((...args: unknown[]) => {
            opened.push(args);
            return null;
        });
        TestBed.configureTestingModule({ imports: [HostComponent] });
        f = TestBed.createComponent(HostComponent);
        document.body.appendChild(f.nativeElement);
    });
    afterEach(() => {
        (f.nativeElement as HTMLElement).remove();
        delete (window as unknown as Record<string, unknown>)['__mailScriptRan'];
    });

    const iframe = () => (f.nativeElement as HTMLElement).querySelector('iframe')!;
    const loaded = async (): Promise<HTMLIFrameElement> => {
        f.componentInstance.doc = TestBed.inject(DomSanitizer).bypassSecurityTrustHtml(messageFrameDoc(BODY, false));
        f.detectChanges();
        const frame = iframe();
        await new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
        await frames();
        return frame;
    };
    const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const click = (frame: HTMLIFrameElement, id: string): boolean => {
        const doc = frame.contentDocument!;
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        return doc.getElementById(id)!.dispatchEvent(event);
    };

    it('is sandboxed to exactly allow-same-origin', () => {
        f.detectChanges();
        expect(iframe().getAttribute('sandbox')).toBe('allow-same-origin');
    });

    it('is as tall as its document, so it never scrolls itself', async () => {
        const frame = await loaded();
        const doc = frame.contentDocument!;

        expect(frame.getBoundingClientRect().height).toBeGreaterThan(600);
        expect(frame.clientHeight).toBeGreaterThanOrEqual(frameContentHeight(doc));
        expect(frame.clientHeight).toBeLessThanOrEqual(frameContentHeight(doc) + 2);
        expect(doc.documentElement.scrollHeight).withContext('nothing to scroll inside').toBeLessThanOrEqual(frame.clientHeight);
        expect(doc.getElementById('last')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(frame.clientHeight);
        expect(getComputedStyle(doc.documentElement).overflowY).toBe('hidden');
    });

    it('follows a document whose height changes again and again, with no resize loop', async () => {
        const errors: string[] = [];
        const onError = (event: ErrorEvent): void => {
            errors.push(String(event.message));
        };
        window.addEventListener('error', onError, true);
        try {
            const frame = await loaded();
            const doc = frame.contentDocument!;
            for (let round = 0; round < 12; round++) {
                const block = doc.createElement('div');
                block.id = 'grown';
                block.style.height = (round % 2 === 0 ? 400 + round * 37 : 3) + 'px';
                doc.getElementById('grown')?.remove();
                doc.body.appendChild(block);
                await frames();
                await frames();
                expect(Math.abs(frame.clientHeight - frameContentHeight(doc))).withContext('round ' + round).toBeLessThanOrEqual(2);
                expect(doc.documentElement.scrollHeight).withContext('round ' + round).toBeLessThanOrEqual(frame.clientHeight);
            }
            expect(errors).withContext('window errors').toEqual([]);
        } finally {
            window.removeEventListener('error', onError, true);
        }
    });

    it('grows again when its width narrows and the text wraps taller', async () => {
        const frame = await loaded();
        const wide = frame.getBoundingClientRect().height;

        f.componentInstance.width.set(200);
        f.detectChanges();
        await frames();
        await frames();

        expect(frame.getBoundingClientRect().height).toBeGreaterThan(wide);
        expect(frame.contentDocument!.documentElement.scrollHeight).toBeLessThanOrEqual(frame.clientHeight);
    });

    it('runs no script from the mail', async () => {
        await loaded();
        expect((window as unknown as Record<string, unknown>)['__mailScriptRan']).toBeUndefined();
    });

    it('opens a web link in a new tab with no opener and no referrer, and the frame does not follow it', async () => {
        const frame = await loaded();

        const followed = click(frame, 'web');

        expect(followed).withContext('the default was prevented').toBeFalse();
        expect(opened).toEqual([['https://example.com/x?y=1', '_blank', 'noopener,noreferrer']]);
        expect(frame.contentDocument!.location.href).withContext('the frame never navigates').toBe('about:srcdoc');
    });

    it('opens an image-map area as a link, with noopener and noreferrer', async () => {
        const frame = await loaded();

        const followed = click(frame, 'area');

        expect(followed).withContext('the default was prevented').toBeFalse();
        expect(opened).toEqual([['https://example.com/area', '_blank', 'noopener,noreferrer']]);
        expect(frame.contentDocument!.location.href).withContext('the frame never navigates').toBe('about:srcdoc');
    });

    it('opens a mailto link the same way', async () => {
        const frame = await loaded();
        click(frame, 'mail');
        expect(opened).toEqual([['mailto:anna@example.com', '_blank', 'noopener,noreferrer']]);
    });

    it('does nothing for a javascript: or a data: link', async () => {
        const frame = await loaded();

        expect(click(frame, 'js')).withContext('javascript: not followed').toBeFalse();
        expect(click(frame, 'data')).withContext('data: not followed').toBeFalse();

        expect(opened).toEqual([]);
        expect((window as unknown as Record<string, unknown>)['__mailScriptRan']).toBeUndefined();
    });

    it('opens http(s) and mailto only', () => {
        expect(openableUrl('https://example.com/')).toBe('https://example.com/');
        expect(openableUrl('http://example.com/')).toBe('http://example.com/');
        expect(openableUrl('mailto:a@example.com')).toBe('mailto:a@example.com');
        expect(openableUrl('javascript:alert(1)')).toBeNull();
        expect(openableUrl('data:text/html,x')).toBeNull();
        expect(openableUrl('file:///etc/passwd')).toBeNull();
        expect(openableUrl('not a url')).toBeNull();
    });
});
