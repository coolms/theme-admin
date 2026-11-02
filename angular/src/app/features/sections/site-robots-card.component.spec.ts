import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { SiteRobotsCardComponent, type SiteRobotsTxt } from './site-robots-card.component';

/**
 * A site's robots.txt card: the default said as such, a save sent whole with the version it was read at, a save from
 * an older version refused in words, and the groups and findings as the server read them.
 */
describe('SiteRobotsCardComponent', () => {
    const READ = '/api/v1/web/robots-txt?site=docs';
    const WRITE = '/api/v1/web/robots-txt';

    const answer = (over: Partial<SiteRobotsTxt> = {}): SiteRobotsTxt => ({
        site: 'docs',
        text: 'User-agent: *\nAllow: /\n',
        version: null,
        groups: [{ agents: ['*'], rules: [['allow', '/']] }],
        host: 'docs.example.test',
        rendered: 'User-agent: *\nAllow: /\n',
        findings: [],
        ...over,
    });

    function render() {
        TestBed.configureTestingModule({
            imports: [SiteRobotsCardComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'It went wrong.' } },
                { provide: ToastService, useValue: { success: () => undefined } },
            ],
        });
        const fixture = TestBed.createComponent(SiteRobotsCardComponent);
        fixture.componentRef.setInput('slug', 'docs');
        fixture.detectChanges();
        const http = TestBed.inject(HttpTestingController);
        const text = () => (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';

        return { fixture, http, text };
    }

    it('says when the site serves the default, and shows its groups', () => {
        const { fixture, http, text } = render();
        http.expectOne(READ).flush(answer());
        fixture.detectChanges();

        expect(text()).toContain('serves the default robots.txt');
        expect(text()).toContain('*: allow /');
    });

    it('saves the whole text with the version it was read at', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer({ version: 'v1' }));
        fixture.detectChanges();
        fixture.componentInstance.draft = 'User-agent: GPTBot\nDisallow: /\n';

        fixture.componentInstance.save();
        const sent = http.expectOne(WRITE);

        expect(sent.request.method).toBe('POST');
        expect(sent.request.body).toEqual({ site: 'docs', text: 'User-agent: GPTBot\nDisallow: /\n', version: 'v1' });
        sent.flush(answer({ version: 'v2', text: 'User-agent: GPTBot\nDisallow: /\n' }));
        expect(fixture.componentInstance.robots()?.version).toBe('v2');
    });

    it('says in words that a save from an older version was refused', () => {
        const { fixture, http, text } = render();
        http.expectOne(READ).flush(answer({ version: 'v1' }));
        fixture.detectChanges();
        fixture.componentInstance.draft = 'User-agent: *\nDisallow: /x\n';

        fixture.componentInstance.save();
        http.expectOne(WRITE).flush({ title: 'Precondition Failed' }, { status: 412, statusText: 'Precondition Failed' });
        fixture.detectChanges();

        expect(text()).toContain('Someone saved the robots.txt meanwhile');
    });

    it('reads the current version again after a refused save, keeping the typed text, and the next save names it', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer({ version: 'v1' }));
        fixture.detectChanges();
        const typed = 'User-agent: *\nDisallow: /mine\n';
        fixture.componentInstance.draft = typed;
        fixture.componentInstance.save();
        http.expectOne(WRITE).flush({}, { status: 412, statusText: 'Precondition Failed' });
        expect(fixture.componentInstance.stale()).toBeTrue();

        fixture.componentInstance.readAgain();
        http.expectOne(READ).flush(answer({ version: 'v2', text: 'User-agent: *\nDisallow: /theirs\n' }));

        expect(fixture.componentInstance.draft).toBe(typed);
        expect(fixture.componentInstance.stale()).toBeFalse();
        fixture.componentInstance.save();
        expect(http.expectOne(WRITE).request.body.version).toBe('v2');
    });

    it('shows the findings, errors and warnings apart, with their lines', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer({
            findings: [
                { error: true, line: 2, message: 'A rule before any User-agent line applies to no one.' },
                { error: false, line: 3, message: 'crawl-delay is not in RFC 9309: most crawlers ignore it.' },
            ],
        }));
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;

        expect(root.querySelector('.robots__findings .robots__error')?.textContent).toContain('Line 2:');
        expect(root.querySelector('.robots__findings .robots__warning')?.textContent).toContain('Line 3:');
    });
});
