// A dialog on a phone, under the admin's real stylesheets in a frame 390 wide: a dialog asking for more than the
// viewport has is held inside it, so its fields and its submit stay on screen.
describe('A dialog fits a phone', () => {
    let frame: HTMLIFrameElement;

    async function frameOf(width: number): Promise<Document> {
        frame = document.createElement('iframe');
        frame.style.cssText = `position:fixed;left:0;top:0;border:0;width:${width}px;height:844px`;
        document.body.appendChild(frame);
        const inner = frame.contentDocument as Document;
        const loaded: Promise<unknown>[] = [];
        for (const sheet of document.querySelectorAll('link[rel="stylesheet"], style')) {
            const copy = inner.importNode(sheet, true) as HTMLElement;
            if (copy.tagName === 'LINK') {
                loaded.push(new Promise(done => {
                    copy.addEventListener('load', done);
                    copy.addEventListener('error', done);
                }));
            }
            inner.head.appendChild(copy);
        }
        await Promise.all(loaded);

        return inner;
    }

    function dialogIn(inner: Document, ownWidth: string): DOMRect {
        const overlay = inner.createElement('div');
        overlay.className = 'cdk-overlay-container';
        overlay.style.position = 'static';
        const dialog = inner.createElement('div');
        dialog.className = 'cms-dialog';
        dialog.style.width = ownWidth;
        overlay.appendChild(dialog);
        inner.body.appendChild(overlay);

        return dialog.getBoundingClientRect();
    }

    afterEach(() => frame.remove());

    it('at 390, a dialog asking for 640 is held inside the viewport', async () => {
        const box = dialogIn(await frameOf(390), '640px');

        expect(box.width).toBeLessThanOrEqual(358);
    });

    it('at 320, a dialog asking for nothing is still inside the viewport', async () => {
        const box = dialogIn(await frameOf(320), 'auto');

        expect(box.width).toBeLessThanOrEqual(288);
    });

    it('at 1440, a dialog keeps its limit', async () => {
        const box = dialogIn(await frameOf(1440), '640px');

        expect(box.width).toBe(540);
    });
});
