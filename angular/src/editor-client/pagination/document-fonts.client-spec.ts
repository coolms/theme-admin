// Copied from @coolms/editor-client's own specs (src/pagination/document-fonts.spec.ts, source commit 99d1aec), imports
// pointed at the installed package: they run in the admin's suite against what npm serves, through
// src/editor-client-specs.spec.ts. Refresh the copy when the client's spec changes.
import { offeredFontFamilies, type FontManifest } from '@coolms/document-engine';

import {
    familyOf, loadFontManifest, paintedAs, useDocumentFontTransport,
    type DocumentFontTransport,
} from '@coolms/editor-client';

/**
 * The names a document's fonts answer to.
 *
 *  Stated here rather than read from the shipped manifest. The mapping is
 * the thing under test; reading the real file would make this pass for a
 * manifest that had lost every substitute it has.
 */
const MANIFEST = {
    version: 1,
    defaults: { family: 'Carlito', sizePt: 11 },
    families: {
        Carlito: {
            substitutes: ['Calibri', 'Carlito'],
            fallback: 'sans-serif',
            files: { regular: { file: 'Carlito-Regular.ttf', sha256: '', bytes: 1 } },
        },
        Caladea: {
            substitutes: ['Cambria', 'Caladea'],
            fallback: 'serif',
            files: { regular: { file: 'Caladea-Regular.ttf', sha256: '', bytes: 1 } },
        },
        'Liberation Mono': {
            substitutes: ['Courier New', 'Courier', 'Liberation Mono'],
            fallback: 'monospace',
            files: { regular: { file: 'LiberationMono-Regular.ttf', sha256: '', bytes: 1 } },
        },
    },
} as unknown as FontManifest;

describe('document fonts', () => {
    describe('the family a document name resolves to', () => {
        it('reads the substitute Word would have written', () => {
            expect(familyOf(MANIFEST, 'Calibri')).toBe('Carlito');
            expect(familyOf(MANIFEST, 'Courier New')).toBe('Liberation Mono');
            expect(familyOf(MANIFEST, 'Cambria')).toBe('Caladea');
        });

        it('reads the vendored name a document may state directly', () => {
            expect(familyOf(MANIFEST, 'Carlito')).toBe('Carlito');
            expect(familyOf(MANIFEST, 'Liberation Mono')).toBe('Liberation Mono');
        });

        it('ignores case and the space either side, which a document may carry', () => {
            expect(familyOf(MANIFEST, '  courier NEW ')).toBe('Liberation Mono');
        });

        it('resolves nothing for a family that is not vendored', () => {
            // Not the default family: a name nobody ships is DROPPED, and the
            // catalogue substitutes it the way it already documents. Answering
            // Carlito here would fetch the wrong bytes and claim they were right.
            expect(familyOf(MANIFEST, 'Wingdings')).toBeNull();
        });
    });


    describe('the families the toolbar offers', () => {
        it('offers only names that resolve to something we vendor', () => {
            //  The join between the select and the measurement. `familyOf`
            // returning null is exactly the state that made Georgia, Verdana
            // and Tahoma unmeasurable: the flow mapper never names the family,
            // so the ENGINE measures the base face while CSS paints the
            // author's own copy. An offered name must never be in that state.
            for (const name of offeredFontFamilies(MANIFEST)) {
                expect(familyOf(MANIFEST, name)).withContext(name).not.toBeNull();
            }
        });

        it('offers a name whose face is painted under that same name', () => {
 // The other half of: resolving is not enough, the FontFace
            // has to answer to the offered name or the browser paints a system
            // font over correctly measured boxes.
            for (const name of offeredFontFamilies(MANIFEST)) {
                const family = familyOf(MANIFEST, name)!;
                const entry = MANIFEST.families[family]!;

                expect(paintedAs(family, entry)).withContext(name).toContain(name);
            }
        });
    });

    describe('where the registry comes from', () => {
        const INSTALLED = {
            version: 1,
            defaults: { family: 'Carlito', sizePt: 11 },
            families: {
                'Brandish Display': {
                    substitutes: ['Brandish Display'],
                    fallback: 'sans-serif',
                    files: {
                        regular: {
                            file: '019c-0000-7000-8000-000000000001.ttf',
                            sha256: '', bytes: 1,
                            url: '/api/v1/document/fonts/face/019c-0000-7000-8000-000000000001',
                        },
                    },
                },
            },
        } as unknown as FontManifest;

        let fetched: string[];
        let originalFetch: typeof fetch;

        beforeEach(() => {
            fetched = [];
            originalFetch = window.fetch;
            // The shipped ASSET, standing in for the file beside the bundle.
            window.fetch = ((url: string): Promise<Response> => {
                fetched.push(url);

                return Promise.resolve(new Response(JSON.stringify(MANIFEST), {
                    headers: { 'Content-Type': 'application/json' },
                }));
            }) as unknown as typeof fetch;
        });

        afterEach(() => {
            window.fetch = originalFetch;
            useDocumentFontTransport(null);
        });

        function transportReturning(manifest: unknown): DocumentFontTransport {
            return {
                json: <T>(): Promise<T> => Promise.resolve(manifest as T),
                bytes: (): Promise<Uint8Array<ArrayBuffer>> =>
                    Promise.resolve(new Uint8Array(new ArrayBuffer(0))),
            };
        }

        it('reads the MERGED registry through the transport the application supplied', async () => {
            //  The whole point: an installed family is a row in a table that
            // did not exist when the bundle was built, so the shipped asset
            // cannot mention it and the toolbar would never offer it.
            useDocumentFontTransport(transportReturning(INSTALLED));

            const manifest = await loadFontManifest();

            expect(Object.keys(manifest.families)).toContain('Brandish Display');
            expect(fetched).withContext('the asset was not touched').toEqual([]);
        });

        it('falls back to the shipped asset when the registry cannot be reached', async () => {
            //  Not belt and braces. This package is used outside the admin,
            // and inside it before the transport is wired; a font list that
            // threw would take the paper down with it. The vendored families
            // are the ones the renderer holds anyway.
            useDocumentFontTransport({
                json: <T>(): Promise<T> => Promise.reject(new Error('401')),
                bytes: (): Promise<Uint8Array<ArrayBuffer>> => Promise.reject(new Error('401')),
            });

            const manifest = await loadFontManifest();

            expect(Object.keys(manifest.families)).toEqual(Object.keys(MANIFEST.families));
            expect(fetched.length).withContext('the asset answered instead').toBe(1);
        });

        it('forgets a registry it read before the transport arrived', async () => {
            // The ordering this exists for: an editor can mount before the
            // application's initializer runs. Memoising the asset then would
            // hold it for the life of the page.
            const first = await loadFontManifest();
            expect(Object.keys(first.families)).not.toContain('Brandish Display');

            useDocumentFontTransport(transportReturning(INSTALLED));

            expect(Object.keys((await loadFontManifest()).families)).toContain('Brandish Display');
        });
    });

    describe('the names a face is painted under', () => {
        it('answers to every name the manifest substitutes, not just its own', () => {
            //  The point of the whole file. A document writes `Calibri`; if
            // only `Carlito` is registered, the browser paints whatever the
            // machine has under that name while the engine measures Carlito.
            // MEASURED on Windows: a `Cambria` run drew a line box 17.90px
            // tall against Caladea's 18.70, and the same sentence set 7.4%
            // wider -- two fonts in one document.
            const entry = MANIFEST.families['Caladea'];
            expect(entry).withContext('the manifest under test').toBeDefined();

            expect(paintedAs('Caladea', entry!)).toContain('Cambria');
        });

        it('carries the real family name even where the substitutes omit it', () => {
            expect(paintedAs('Caladea', { substitutes: ['Cambria'] })).toEqual(['Caladea', 'Cambria']);
        });

        it('names each face once, so the same bytes are not registered twice', () => {
            // Every shipped family lists ITSELF among its substitutes, so the
            // naive concatenation would register two `FontFace` objects over
            // the same megabyte or so of font.
            expect(paintedAs('Carlito', { substitutes: ['Calibri', 'Carlito'] }))
                .toEqual(['Carlito', 'Calibri']);
        });
    });
});
