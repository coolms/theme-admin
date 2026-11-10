import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { frameContentHeight, MessageFrameFit, openableUrl } from './message-frame-fit';
import { MAIL_FRAME_IMAGES_PAGE, MAIL_FRAME_PAGE, MessageFrameComponent } from './message-frame.component';

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
            <div [style.width.px]="width()"><app-message-frame [html]="html()" [images]="images()" /></div>
        </div>
    `,
})
class HostComponent {
    readonly width = signal(400);
    readonly html = signal<string | null>(null);
    readonly images = signal(false);
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
    /** The frame once its page has loaded and the message is in its body (the page itself may load first or after). */
    const written = async (id = 'last'): Promise<HTMLIFrameElement> => {
        for (let i = 0; i < 100; i++) {
            f.detectChanges();
            const frame = iframe();
            if (frame.contentDocument?.getElementById(id)) {
                await frames();
                return frame;
            }
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('the message was never written into the frame page');
    };
    const loaded = async (): Promise<HTMLIFrameElement> => {
        f.componentInstance.html.set(BODY);
        return written();
    };
    const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const click = (frame: HTMLIFrameElement, id: string): boolean => {
        const doc = frame.contentDocument!;
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        return doc.getElementById(id)!.dispatchEvent(event);
    };

    it('loads the admin mail frame page, sandboxed exactly, never with allow-scripts', () => {
        f.detectChanges();
        expect(iframe().getAttribute('src')).toBe('/admin/mail-frame.html');
        expect(MAIL_FRAME_PAGE).toBe('/admin/mail-frame.html');
        expect(iframe().hasAttribute('srcdoc')).toBeFalse();
        expect(iframe().getAttribute('sandbox')).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
        expect(iframe().getAttribute('sandbox')!.split(' ')).not.toContain('allow-scripts');
    });

    it('switches to the images page once Load images is chosen, and writes the message into it again', async () => {
        await loaded();
        f.componentInstance.images.set(true);
        f.detectChanges();
        expect(iframe().getAttribute('src')).toBe('/admin/mail-frame-images.html');
        expect(MAIL_FRAME_IMAGES_PAGE).toBe('/admin/mail-frame-images.html');
        expect(iframe().getAttribute('sandbox')).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
        const frame = await written();
        expect(frame.contentDocument!.getElementById('last')?.textContent).toBe('Last line.');
    });

    it('writes the message into the page after it loads, links already set to open apart', async () => {
        const frame = await loaded();
        const doc = frame.contentDocument!;
        expect(doc.getElementById('web')!.getAttribute('rel')).toBe('noopener noreferrer');
        expect(doc.getElementById('area')!.getAttribute('rel')).toBe('noopener noreferrer');
        expect(doc.getElementById('cms-mail-frame-style')).not.toBeNull();

        f.componentInstance.html.set('<p id="other">Another message.</p>');
        const again = await written('other');
        expect(again.contentDocument!.getElementById('last')).toBeNull();
    });

    it('fits again when an image fails after the first fit, so the end is not clipped', async () => {
        const frame = await loaded();
        const doc = frame.contentDocument!;
        // Only the image listener left to see a change: the page's own fit stopped, and a fit followed again with no
        // observer to call on, so only an image's error event can bring the height up to the new end.
        f.debugElement.query(el => el.name === 'app-message-frame').componentInstance.fit.stop();
        const globals = window as unknown as Record<string, unknown>;
        const observers = { resize: globals['ResizeObserver'], mutation: globals['MutationObserver'] };
        globals['ResizeObserver'] = undefined;
        globals['MutationObserver'] = undefined;
        const fit = new MessageFrameFit();
        try {
            fit.follow(frame);
        } finally {
            globals['ResizeObserver'] = observers.resize;
            globals['MutationObserver'] = observers.mutation;
        }
        const fitted = frame.getBoundingClientRect().height;
        const img = doc.createElement('img');
        img.width = 100;
        img.height = 400;
        img.style.display = 'block';
        doc.body.appendChild(img);
        await frames();
        expect(frame.getBoundingClientRect().height).withContext('nothing has refitted yet').toBeCloseTo(fitted, 0);

        img.dispatchEvent(new Event('error'));
        await frames();

        expect(frame.getBoundingClientRect().height).toBeGreaterThan(fitted + 300);
        expect(doc.documentElement.scrollHeight).toBeLessThanOrEqual(frame.clientHeight);
        fit.stop();
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

    it('falls back when the pane widens again, and a short message takes a short frame', async () => {
        const frame = await loaded();
        const wide = frame.getBoundingClientRect().height;
        f.componentInstance.width.set(200);
        f.detectChanges();
        await frames();
        await frames();
        const narrow = frame.getBoundingClientRect().height;
        expect(narrow).toBeGreaterThan(wide);

        f.componentInstance.width.set(400);
        f.detectChanges();
        await frames();
        await frames();
        expect(Math.abs(frame.getBoundingClientRect().height - wide)).withContext('back to the wide height').toBeLessThanOrEqual(2);

        f.componentInstance.html.set('<p id="short">Short.</p>');
        await written('short');
        await frames();
        expect(frame.getBoundingClientRect().height).withContext('a short message').toBeLessThan(100);
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
        expect(frame.contentDocument!.location.pathname).withContext('the frame never navigates').toBe('/admin/mail-frame.html');
    });

    it('opens an image-map area as a link, with noopener and noreferrer', async () => {
        const frame = await loaded();

        const followed = click(frame, 'area');

        expect(followed).withContext('the default was prevented').toBeFalse();
        expect(opened).toEqual([['https://example.com/area', '_blank', 'noopener,noreferrer']]);
        expect(frame.contentDocument!.location.pathname).withContext('the frame never navigates').toBe('/admin/mail-frame.html');
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
