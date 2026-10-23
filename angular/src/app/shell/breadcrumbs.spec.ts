import { resolveCrumbs, type CrumbSources } from './breadcrumbs';

/**
 * Breadcrumbs never show ids or route parameters. Each crumb is named by the page,
 * by its route, or by the admin menu -- or it is left out.
 */
describe('resolveCrumbs', () => {
    const ID = '01a16831-8e71-7887-8ef9-3639976eb635';
    const nav: Record<string, string> = { '/email': 'Email', '/settings': 'Settings' };
    const sources = (over: Partial<CrumbSources> = {}): CrumbSources => ({
        navTitle: p => nav[p],
        named: () => undefined,
        pageTitle: null,
        ...over,
    });
    const labels = (segments: string[], levels: { end: number; label?: string }[], s: CrumbSources): string[] =>
        resolveCrumbs(segments, levels, s).map(c => c.label);

    it('names the mailbox settings page Home / Email / {mailbox} / Settings, with no id and no path word', () => {
        const crumbs = resolveCrumbs(['email', 'mailboxes', ID, 'settings'], [{ end: 1 }, { end: 4, label: 'Settings' }],
            sources({ named: p => (p === `/email/mailboxes/${ID}` ? { label: 'Work mail', link: ['/email', { mailbox: ID }] } : undefined) }));
        expect(crumbs.map(c => c.label)).toEqual(['Home', 'Email', 'Work mail', 'Settings']);
        expect(crumbs[2].link).toEqual(['/email', { mailbox: ID }]);
        expect(crumbs.map(c => c.label).join(' ')).not.toContain('01a16831');
        expect(crumbs.map(c => c.label)).not.toContain('Mailboxes');
    });

    it('leaves an id out when nothing names it, never showing it raw', () => {
        const got = labels(['email', 'mailboxes', ID, 'settings'], [{ end: 1 }, { end: 4, label: 'Settings' }], sources());
        expect(got).toEqual(['Home', 'Email', 'Settings']);
    });

    it('names the Email page Home / Email / {mailbox} with the selected mailbox as the tail', () => {
        expect(labels(['email'], [{ end: 1 }], sources({ tail: { label: 'Work mail' } }))).toEqual(['Home', 'Email', 'Work mail']);
    });

    it('lets the page\'s resolved title name the last crumb, replacing or adding it', () => {
        expect(labels(['email'], [{ end: 1 }], sources({ pageTitle: 'Inbox zero' }))).toEqual(['Home', 'Inbox zero']);
        expect(labels(['records', ID], [{ end: 2 }], sources({ pageTitle: 'Product Test' }))).toEqual(['Home', 'Product Test']);
    });

    it('prefers a resolved name over the route, and the route over the menu', () => {
        expect(labels(['email'], [{ end: 1, label: 'Mail' }], sources())).toEqual(['Home', 'Mail']);
        expect(labels(['email'], [{ end: 1, label: 'Mail' }], sources({ named: () => ({ label: 'Named' }) })))
            .toEqual(['Home', 'Named']);
    });

    it('shows Home alone for the root', () => {
        expect(labels([], [], sources())).toEqual(['Home']);
    });
});
