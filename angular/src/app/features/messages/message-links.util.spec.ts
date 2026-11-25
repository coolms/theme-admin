import { linkifyMessageHtml } from './message-links.util';

const links = (html: string): Array<[string | null, string | null]> => {
    const body = new DOMParser().parseFromString(linkifyMessageHtml(html), 'text/html').body;
    return Array.from(body.querySelectorAll('a')).map(a => [a.getAttribute('href'), a.textContent]);
};

describe('linkifyMessageHtml', () => {
    it('links the web and mail addresses of a message, in a new tab', () => {
        expect(links('<p>See https://example.com/a and write to s.taylor@example.test.</p>')).toEqual([
            ['https://example.com/a', 'https://example.com/a'], ['mailto:s.taylor@example.test', 's.taylor@example.test'],
        ]);
        const a = new DOMParser().parseFromString(linkifyMessageHtml('<p>https://example.com/a</p>'), 'text/html').querySelector('a')!;
        expect([a.target, a.rel]).toEqual(['_blank', 'noopener noreferrer']);
    });

    it('the at sign the server wrote as an entity is read as one', () => {
        expect(links('<p>s.taylor&#64;example.test</p>')).toEqual([['mailto:s.taylor@example.test', 's.taylor@example.test']]);
    });

    it('never javascript: or data:, and markup written in a message stays text', () => {
        for (const text of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) expect(links('<p>' + text + '</p>')).toEqual([]);
        const html = linkifyMessageHtml('<p>&lt;img src=x onerror=alert(1)&gt; https://example.com/&lt;b&gt;</p>');
        const body = new DOMParser().parseFromString(html, 'text/html').body;
        expect(body.querySelector('img, b')).toBeNull();
        expect(body.textContent).toBe('<img src=x onerror=alert(1)> https://example.com/<b>');
    });

    it('an existing link, code and pre are left alone; #channel inside an address stays part of it', () => {
        expect(links('<p><a href="https://example.com/x">https://example.com/y</a></p>')).toEqual([['https://example.com/x', 'https://example.com/y']]);
        expect(links('<p><code>https://example.com/c</code></p><pre>https://example.com/p</pre>')).toEqual([]);
        expect(links('<p>https://example.com/#general</p>')).toEqual([['https://example.com/#general', 'https://example.com/#general']]);
    });

    it('a message without an address is returned as it was', () => {
        for (const html of ['', '<p>hello</p>', '<p>a@b &amp; c</p>']) expect(linkifyMessageHtml(html)).toBe(html);
    });
});
