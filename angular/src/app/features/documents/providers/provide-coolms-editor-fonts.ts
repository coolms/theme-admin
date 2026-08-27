import { APP_INITIALIZER, type Provider } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { useDocumentFontTransport, type DocumentFontTransport } from '@coolms/editor-angular';

/**
 * Lets the editor read the MERGED font registry — the families the platform
 * ships plus the ones an operator installed.
 *
 * ## Why the application has to supply this
 *
 * `document-fonts.ts` fetches with the bare `fetch` a package can rely on, and
 * the merged registry lives behind `/api/v1`. The admin's authentication is an
 * HTTP interceptor: it stamps the bearer token and the section header on every
 * request that goes through `HttpClient`, and on nothing that does not. A
 * `fetch` from inside the package would get a 401 for the registry and for
 * every installed face.
 *
 * So the package states an interface and the application implements it with the
 * client it already has. The editor stays usable with no transport at all — it
 * falls back to the shipped manifest asset, which is every family the renderer
 * holds anyway.
 *
 * Spread into `ApplicationConfig.providers` alongside `provideCoolmsEditor()`.
 */
export function provideCoolmsEditorFonts(): Provider[] {
    return [
        {
            provide: APP_INITIALIZER,
            multi:   true,
            deps:    [HttpClient],
            useFactory: (http: HttpClient) => (): void => {
                const transport: DocumentFontTransport = {
                    json: <T>(url: string): Promise<T> =>
                        firstValueFrom(http.get<T>(url)),
                    // `arraybuffer`, not `blob`: the engine measures a
                    // `Uint8Array` and the FontFace API takes one, so a Blob
                    // would only be a second copy and an extra await.
                    bytes: async (url: string): Promise<Uint8Array<ArrayBuffer>> =>
                        new Uint8Array(
                            await firstValueFrom(http.get(url, { responseType: 'arraybuffer' })),
                        ),
                };

                useDocumentFontTransport(transport);
            },
        },
    ];
}
