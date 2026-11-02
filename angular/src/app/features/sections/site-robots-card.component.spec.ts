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
        groups: [{ agents: ['*'], rules: [['allow', '/']], agentLines: [0], ruleLines: [1] }],
        host: 'docs.example.test',
        rendered: 'User-agent: *\nAllow: /\n',
        findings: [],
        crawlers: [
            { agent: 'Googlebot', purpose: 'search', operator: 'Google' },
            { agent: 'GPTBot', purpose: 'ai-training', operator: 'OpenAI' },
            { agent: 'Claude-User', purpose: 'ai-answers', operator: 'Anthropic' },
        ],
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

    it('says when the site serves the default, and shows its groups in the form', async () => {
        const { fixture, http, text } = render();
        http.expectOne(READ).flush(answer());
        fixture.detectChanges();
        // ngModel writes an input's value after the change detection that created it.
        await fixture.whenStable();
        const root = fixture.nativeElement as HTMLElement;

        expect(text()).toContain('serves the default robots.txt');
        expect((root.querySelector('#agent-0') as HTMLInputElement | null)?.value ?? null).toBe('*');
    });

    // The text, saved whole.
    function asText(fixture: ReturnType<typeof render>['fixture']): void {
        fixture.componentInstance.mode.set('text');
        fixture.detectChanges();
    }

    it('saves the whole text with the version it was read at', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer({ version: 'v1' }));
        asText(fixture);
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
        asText(fixture);
        fixture.componentInstance.draft = 'User-agent: *\nDisallow: /x\n';

        fixture.componentInstance.save();
        http.expectOne(WRITE).flush({ title: 'Precondition Failed' }, { status: 412, statusText: 'Precondition Failed' });
        fixture.detectChanges();

        expect(text()).toContain('Someone saved the robots.txt meanwhile');
    });

    it('reads the current version again after a refused save, keeping the typed text, and the next save names it', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer({ version: 'v1' }));
        asText(fixture);
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

    // The form, saved line by line.
    const two = (): Partial<SiteRobotsTxt> => ({
        version: 'v1',
        text: '# ours\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /old # was\n',
        groups: [{ agents: ['GPTBot', 'CCBot'], rules: [['disallow', '/old']], agentLines: [1, 2], ruleLines: [3] }],
    });

    it('sends only the rule that changed, its value and its field, with the version', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer(two()));
        fixture.detectChanges();
        const rule = fixture.componentInstance.form[0].rules[0];
        rule.value = '/new';
        rule.kind = 'allow';

        fixture.componentInstance.save();

        expect(http.expectOne(WRITE).request.body).toEqual({
            site: 'docs', version: 'v1', changes: [{ line: 3, value: '/new', field: 'allow' }], group: null,
        });
    });

    it('sends a removed crawler as its line with no value, and nothing for the lines left alone', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer(two()));
        fixture.detectChanges();
        fixture.componentInstance.form[0].agents[1].removed = true;

        fixture.componentInstance.save();

        expect(http.expectOne(WRITE).request.body.changes).toEqual([{ line: 2, value: null }]);
    });

    it('adds a group from a listed crawler and a typed one, with its rules', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer(two()));
        fixture.detectChanges();
        const card = fixture.componentInstance;
        card.addAgent('Claude-User');
        card.addAgent('my-bot ');
        card.addAgent('claude-user');
        card.added.rules.push({ kind: 'disallow', value: ' /private ' });

        card.save();

        expect(http.expectOne(WRITE).request.body).toEqual({
            site: 'docs', version: 'v1', changes: [],
            group: { agents: ['Claude-User', 'my-bot'], rules: [{ field: 'disallow', value: '/private' }] },
        });
    });

    it('lists the built-in crawlers by what they read a site for', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer(two()));
        fixture.detectChanges();
        const groups = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('#robots-pick optgroup'))
            .map((g) => g.getAttribute('label'));

        expect(groups).toEqual(['Search engines', 'AI training', 'AI assistants and answers']);
    });

    it('cannot save a form that changes nothing', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer(two()));
        fixture.detectChanges();

        expect(fixture.componentInstance.changed(fixture.componentInstance.robots()!)).toBeFalse();
        fixture.componentInstance.form[0].rules[0].value = '/old ';
        expect(fixture.componentInstance.changed(fixture.componentInstance.robots()!)).toBeFalse();
    });

    it('after a refused form save, reads the current file again into the form', () => {
        const { fixture, http } = render();
        http.expectOne(READ).flush(answer(two()));
        fixture.detectChanges();
        fixture.componentInstance.form[0].rules[0].value = '/mine';
        fixture.componentInstance.save();
        http.expectOne(WRITE).flush({}, { status: 412, statusText: 'Precondition Failed' });

        fixture.componentInstance.readAgain();
        http.expectOne(READ).flush(answer({ ...two(), version: 'v2' }));

        expect(fixture.componentInstance.form[0].rules[0].value).toBe('/old');
        expect(fixture.componentInstance.robots()?.version).toBe('v2');
    });
});
