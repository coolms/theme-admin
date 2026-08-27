/**
 * Discovering the admin UI kit's design tokens from the LIVE stylesheet.
 *
 * Everything here is pure so it can be tested without a browser; the component
 * is the only part that needs one.
 *
 * ## Why discover rather than list
 *
 * The obvious styleguide hard-codes the token names it shows. That guarantees
 * drift in one direction only — the page keeps claiming a palette the
 * stylesheet has moved on from — and a styleguide that lies is worse than none,
 * because it is the thing people trust when they ask "what is the accent
 * colour?". Reading the names back out of the CSSOM means a token added to
 * `styles.scss` appears here with no second edit, and a token deleted stops
 * being advertised.
 */

/** One design token, as the stylesheet currently defines it. */
export interface UiKitToken {
    /** Custom-property name, e.g. `--cms-accent`. */
    name: string;
    /** Resolved value, e.g. `#F5A623` — after `var()` indirection. */
    value: string;
    /** Whether the resolved value looks like something worth showing a swatch for. */
    isColour: boolean;
}

/** A named run of tokens sharing a prefix, e.g. everything `--cms-sidebar-*`. */
export interface UiKitTokenGroup {
    title: string;
    tokens: UiKitToken[];
}

/** The prefix every kit token carries. */
export const TOKEN_PREFIX = '--cms-';

/**
 * Collect `--cms-*` custom-property NAMES declared anywhere in the document's
 * stylesheets.
 *
 * A cross-origin stylesheet throws on `.cssRules` access, and the admin loads
 * several third-party sheets (Bootstrap, xterm, KaTeX), so each sheet is
 * guarded individually — one unreadable sheet must not cost the whole scan.
 * Third-party sheets declare no `--cms-*` anyway, which is exactly why the
 * prefix filter is the selection rule rather than "the first sheet".
 */
export function discoverTokenNames(sheets: readonly CSSStyleSheet[]): string[] {
    const names = new Set<string>();

    for (const sheet of sheets) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            // Cross-origin: unreadable by design, and never ours.
            continue;
        }

        for (const rule of Array.from(rules)) {
            if (!isStyleRule(rule)) continue;
            for (const property of Array.from(rule.style)) {
                if (property.startsWith(TOKEN_PREFIX)) {
                    names.add(property);
                }
            }
        }
    }

    return Array.from(names).sort();
}

/** `CSSStyleRule` without relying on the global being present in every runtime. */
function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
    return 'style' in rule && typeof (rule as CSSStyleRule).selectorText === 'string';
}

/**
 * Whether a resolved value should render as a colour swatch.
 *
 * Deliberately shape-based rather than a colour parser: the kit's non-colour
 * tokens are sizes, radii and shadows, and mistaking one for a colour costs
 * only an empty swatch. A `var(...)` that failed to resolve is NOT a colour —
 * showing a swatch for it would hide a broken reference.
 */
export function looksLikeColour(value: string): boolean {
    const v = value.trim().toLowerCase();

    return v.startsWith('#')
        || v.startsWith('rgb')
        || v.startsWith('hsl')
        || /^(transparent|currentcolor)$/.test(v);
}

/**
 * Group tokens by their FIRST segment — `--cms-sidebar-bg` under "sidebar" —
 * so the page reads as the palette's own structure rather than one long
 * alphabetical list.
 *
 * Always the first segment, with no special case for single-segment names, and
 * that is the whole subtlety. An earlier rule filed `--cms-accent` under a
 * catch-all "base" because it has no second segment, while `--cms-accent-hover`,
 * `-light`, `-text` and `-fg` all landed under "accent" — **splitting a family
 * from its own head**, so the one token a reader is looking for was the one not
 * next to its variants. A group of one is a much smaller cost than that.
 */
export function groupTokens(tokens: readonly UiKitToken[]): UiKitTokenGroup[] {
    const groups = new Map<string, UiKitToken[]>();

    for (const token of tokens) {
        const rest = token.name.slice(TOKEN_PREFIX.length);
        const key = rest.split('-')[0];
        const bucket = groups.get(key);
        if (bucket) {
            bucket.push(token);
        } else {
            groups.set(key, [token]);
        }
    }

    return Array.from(groups.entries())
        .map(([title, list]) => ({ title, tokens: list }))
        .sort((a, b) => a.title.localeCompare(b.title));
}
