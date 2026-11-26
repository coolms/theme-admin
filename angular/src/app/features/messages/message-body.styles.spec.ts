/** A chat message's formatted body under the global styles: a blank line looks the same in either form it arrives in. */
describe('cms-message-body', () => {
    const drawn: HTMLElement[] = [];
    afterEach(() => drawn.splice(0).forEach(e => e.remove()));

    /** The height of a body drawn from this HTML, at one width. */
    function height(html: string): number {
        const body = document.createElement('span');
        body.className = 'cms-message-body';
        body.style.width = '300px';
        body.innerHTML = html;
        document.body.appendChild(body);
        drawn.push(body);

        return body.getBoundingClientRect().height;
    }
    const line = (): number => height('<p>a</p>');

    it('draws a blank line typed in a paragraph and a new paragraph alike', () => {
        expect(height('<p>a</p><p>b</p>')).toBe(height('<p>a<br><br>b</p>'));
        expect(height('<p>a</p><p>b</p>')).toBeCloseTo(3 * line(), 0);
    });

    it('keeps a single line break one line, with no gap', () => {
        expect(height('<p>a<br>b</p>')).toBeCloseTo(2 * line(), 0);
    });

    it('draws an empty paragraph as the one empty line, never adding a gap of its own', () => {
        expect(height('<p>a</p><p></p><p>b</p>')).toBe(height('<p>a<br><br>b</p>'));
        expect(height('<p>a</p><p></p><p></p><p>b</p>')).toBe(height('<p>a<br><br><br>b</p>'));
    });

    it('starts and ends on the text: no margin before the first paragraph or after the last', () => {
        expect(height('<p>a</p>')).toBe(height('a'));
    });
});
