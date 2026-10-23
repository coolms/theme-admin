/**
 * The top bar's breadcrumb, built from names, never from the URL. Each prefix of the path is a candidate crumb, and it is shown only if something
 * names it:
 *   1. a name the page resolved for that path (an object's display name: a mailbox, a record);
 *   2. the route that ends there, by its `data.crumb`;
 *   3. the admin menu's item for that path (the module's own title, e.g. Email).
 * A prefix nothing names is left out -- an id, a parameter, or a path word like "mailboxes" is never shown raw. The
 * page's resolved title, when it has one, names the whole path (the last crumb); a page may also add one crumb after
 * itself for what is selected inside it (the Email page's mailbox).
 */
export interface Crumb {
    readonly path: string;
    readonly label: string;
    /** Where the crumb leads when that is not its path (a resolved object's page). */
    readonly link?: readonly unknown[];
}

/** A route in the matched chain: the number of URL segments consumed through it, and its declared crumb. */
export interface CrumbLevel {
    readonly end: number;
    readonly label?: string;
}

export interface CrumbSources {
    readonly navTitle: (path: string) => string | undefined;
    readonly named: (path: string) => { readonly label: string; readonly link?: readonly unknown[] } | undefined;
    readonly pageTitle: string | null;
    readonly tail?: { readonly label: string; readonly link?: readonly unknown[] } | null;
}

export function resolveCrumbs(segments: readonly string[], levels: readonly CrumbLevel[], sources: CrumbSources): Crumb[] {
    const crumbs: Crumb[] = [{ path: '/', label: 'Home' }];
    for (let i = 1; i <= segments.length; i++) {
        const path = '/' + segments.slice(0, i).join('/');
        const named = sources.named(path);
        if (named) {
            crumbs.push({ path, label: named.label, ...(named.link ? { link: named.link } : {}) });
            continue;
        }
        const declared = levels.find(l => l.end === i)?.label ?? sources.navTitle(path);
        if (declared) {
            crumbs.push({ path, label: declared });
        }
    }
    const full = '/' + segments.join('/');
    if (sources.pageTitle) {
        const last = crumbs[crumbs.length - 1];
        if (crumbs.length > 1 && last.path === full) {
            crumbs[crumbs.length - 1] = { ...last, label: sources.pageTitle };
        } else {
            crumbs.push({ path: full, label: sources.pageTitle });
        }
    }
    if (sources.tail) {
        crumbs.push({ path: full + '#', label: sources.tail.label, ...(sources.tail.link ? { link: sources.tail.link } : {}) });
    }
    return crumbs;
}
