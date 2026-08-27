import { discoverTokenNames, groupTokens, looksLikeColour, type UiKitToken } from './ui-kit.tokens';

/**
 * Token discovery for the UI-kit page.
 *
 * The point of discovering rather than listing is that the page cannot drift
 * from `styles.scss`. These pin the parts that would silently break that
 * promise: a third-party sheet that throws on access, a sheet with no kit
 * tokens, and the prefix filter itself.
 */
describe('ui kit tokens', () => {
    /** A stylesheet whose rules expose the given custom properties. */
    function sheetWith(...propertyGroups: string[][]): CSSStyleSheet {
        return {
            get cssRules(): CSSRuleList {
                return propertyGroups.map(properties => ({
                    selectorText: ':root',
                    style: properties,
                })) as unknown as CSSRuleList;
            },
        } as unknown as CSSStyleSheet;
    }

    /** A cross-origin sheet: touching `cssRules` throws, as the browser does. */
    function crossOriginSheet(): CSSStyleSheet {
        return {
            get cssRules(): CSSRuleList {
                throw new DOMException('cross-origin', 'SecurityError');
            },
        } as unknown as CSSStyleSheet;
    }

    it('collects only --cms-* properties, sorted and deduplicated', () => {
        const names = discoverTokenNames([
            sheetWith(['--cms-accent', '--bs-primary', 'color']),
            sheetWith(['--cms-bg', '--cms-accent']),
        ]);

        expect(names).toEqual(['--cms-accent', '--cms-bg']);
    });

    /**
     * The admin loads Bootstrap, xterm and KaTeX alongside its own sheet. If one
     * unreadable sheet aborted the scan, the page would show an empty palette
     * and look like the kit had vanished — so each sheet is guarded on its own.
     */
    it('skips a stylesheet it may not read without losing the others', () => {
        const names = discoverTokenNames([
            crossOriginSheet(),
            sheetWith(['--cms-accent']),
            crossOriginSheet(),
        ]);

        expect(names).toEqual(['--cms-accent']);
    });

    it('returns nothing when no sheet declares kit tokens', () => {
        expect(discoverTokenNames([sheetWith(['--bs-primary'])])).toEqual([]);
        expect(discoverTokenNames([])).toEqual([]);
    });

    describe('colour detection', () => {
        it('recognises the forms the kit actually uses', () => {
            for (const value of ['#F5A623', '#fff', 'rgb(0,0,0)', 'rgba(0,0,0,.55)', 'hsl(0 0% 0%)', 'transparent']) {
                expect(looksLikeColour(value)).withContext(value).toBeTrue();
            }
        });

        /**
         * An UNRESOLVED `var()` must not render as a swatch — an empty coloured
         * box would disguise a broken reference as a legitimate colour.
         */
        it('rejects sizes, shadows and unresolved references', () => {
            for (const value of ['8px', '.8125rem', '0 1px 2px rgba(0,0,0,.1)', 'var(--missing)']) {
                expect(looksLikeColour(value)).withContext(value).toBeFalse();
            }
        });
    });

    describe('grouping', () => {
        const token = (name: string): UiKitToken => ({ name, value: '#000', isColour: true });

        it('groups by the segment after the prefix', () => {
            const groups = groupTokens([
                token('--cms-sidebar-bg'),
                token('--cms-accent'),
                token('--cms-sidebar-text'),
            ]);

            expect(groups.map(g => g.title)).toEqual(['accent', 'sidebar']);
            expect(groups[1].tokens.map(t => t.name)).toEqual(['--cms-sidebar-bg', '--cms-sidebar-text']);
        });

        /**
         * THE case that caught a real flaw. `--cms-accent` is the HEAD of the
         * accent family; an earlier rule sent single-segment names to a
         * catch-all "base" group, so the head sat apart from `-hover`, `-light`
         * and `-text` — the one token a reader looks for was the one not beside
         * its variants. A group of one costs far less than a split family.
         */
        it('keeps a family head with its variants rather than in a catch-all', () => {
            const groups = groupTokens([
                token('--cms-accent'),
                token('--cms-accent-hover'),
                token('--cms-bg'),
            ]);

            expect(groups.map(g => g.title)).toEqual(['accent', 'bg']);
            expect(groups[0].tokens.map(t => t.name))
                .toEqual(['--cms-accent', '--cms-accent-hover']);
        });
    });
});
