/**
 * Pure helpers for naming a template's SOURCE file.
 *
 * A template's source is whatever bytes back its Node, and that is NOT one
 * shape per format — it is one per point on ADR-084's source axis:
 *
 *   word        imported → .docx      native → .dtmpl   (ADR-154)
 *   spreadsheet imported → .xlsx      native → .dsheet  (ADR-155)
 *   presentation imported → .pptx     (no native authoring)
 *
 * Every map here is a FALLBACK, reached only when the backend's
 * `format-info` payload has not arrived (it loads async on page mount and
 * its errors are swallowed) or advertises nothing for the mime in hand. The
 * live answer comes from that endpoint, where each format module spells its
 * own mimes and extensions — see `FormatInfoService.extensionForMime()`.
 * That ordering is what keeps a future format from having to be added here.
 */

import { type DocumentTemplate } from '../shared/document-explorer.types';
import { type FormatDisplayInfo } from '../shared/format-info.types';
import { SHEET_DOCUMENT_EXT, SHEET_DOCUMENT_MIME } from '../shared/sheet-document.constants';

/**
 * The NATIVE Word source (ADR-154). A native Word template is a `.dtmpl`
 * whose body IS the source; the `.docx` exists only as generation output.
 */
export const DTMPL_MIME = 'text/x-dtmpl';

export const DTMPL_EXT = '.dtmpl';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * Extension for a source mime while `format-info` is unavailable. Carries
 * both halves of the axis for every format: the native mimes were the ones
 * missing when this map lived on the page, which is how a `.dtmpl` came to
 * download named `.docx`.
 */
const FALLBACK_SOURCE_EXTENSIONS: Readonly<Record<string, string | undefined>> = Object.freeze({
    [DOCX_MIME]: '.docx',
    [XLSX_MIME]: '.xlsx',
    [PPTX_MIME]: '.pptx',
    [DTMPL_MIME]: DTMPL_EXT,
    [SHEET_DOCUMENT_MIME]: SHEET_DOCUMENT_EXT,
    'application/pdf': '.pdf',
});

/** Imported (Office) source mime per format key. */
const IMPORTED_SOURCE_MIMES: Readonly<Record<string, string | undefined>> = Object.freeze({
    word: DOCX_MIME,
    spreadsheet: XLSX_MIME,
    presentation: PPTX_MIME,
});

/**
 * Native (authored) source mime per format key. `presentation` is absent on
 * purpose — its provider returns no native source mime, so there is nothing
 * to author and nothing to name.
 */
const NATIVE_SOURCE_MIMES: Readonly<Record<string, string | undefined>> = Object.freeze({
    word: DTMPL_MIME,
    spreadsheet: SHEET_DOCUMENT_MIME,
});

/**
 * Defensive fallback when `sourceMimeType` is empty on the row — it is the
 * Node's mime and is only ever null when the Node carries none.
 *
 * `native` is a parameter rather than an assumption: this used to answer
 * with the imported Office mime for every template, so a native one resolved
 * to the wrong half of its own format.
 */
export function inferTemplateSourceMime(format: string, native: boolean): string | null {
    const mimes = native ? NATIVE_SOURCE_MIMES : IMPORTED_SOURCE_MIMES;

    return mimes[format] ?? null;
}

/**
 * Extension (leading dot) for a source mime. `advertised` is the backend's
 * answer and always wins; the local map covers the payload-missing case.
 * Returns `''` when neither knows the mime — a bare name beats a name that
 * claims to be something it isn't.
 */
export function extensionForSourceMime(mime: string, advertised: string | null): string {
    return advertised ?? FALLBACK_SOURCE_EXTENSIONS[mime] ?? '';
}

/**
 * The advertised extension of `mime`, read out of `format-info` entries by the
 * index pairing `DocumentFormatProviderInterface` states: `extensions[i]`
 * names `mimeTypes[i]`.
 *
 * Pure and list-taking so the one implementation serves both callers —
 * `FormatInfoService.extensionForMime()` passes the whole cached registry,
 * while the Replace dialog passes the single entry it fetched for its own
 * format (a filtered load deliberately does not enter the shared cache).
 *
 * `null` when no entry advertises the mime, or when the entry's `extensions`
 * list is too short for the pairing to hold — callers fall back to their own
 * defaults rather than take SOME extension.
 */
export function extensionForMimeIn(formats: readonly FormatDisplayInfo[], mime: string): string | null {
    for (const info of formats) {
        const index = info.mimeTypes.indexOf(mime);
        if (index < 0) {
            continue;
        }
        const extension = info.extensions.at(index);
        if (extension) {
            return extension;
        }
    }

    return null;
}

/** The source-axis fields alone — narrow so specs can fake a row. */
export type TemplateSourceAxis = Pick<DocumentTemplate, 'format' | 'native' | 'sourceMimeType'>;

/**
 * The IMPORTED (Office) source mime for a template — the only source
 * `replaceSource()` will take.
 *
 * Every provider gates a replacement on `validateUpload()`, and every
 * `validateUpload()` opens the bytes as an Office file (`DocxTextExtractor`,
 * `XlsxTemplate::open()`, `PptxTemplate::open()`). So the NATIVE half of
 * ADR-084's source axis — `.dtmpl`, `.dsheet` — is not replaceable source even
 * though `format-info` advertises it beside the imported half. A picker
 * offering a format's whole extension list would hand the operator a file the
 * backend refuses.
 *
 * The row answers first: an imported template's own `sourceMimeType` IS the
 * imported mime, so the common case consults no map at all. Only a NATIVE
 * template — whose source mime is the other half — falls through to the
 * per-format fallback, and `null` (a format nothing here has heard of) leaves
 * the picker unfiltered rather than filtered to a guess.
 */
export function importedSourceMime(template: TemplateSourceAxis): string | null {
    if (!template.native && null !== template.sourceMimeType && '' !== template.sourceMimeType) {
        return template.sourceMimeType;
    }

    return inferTemplateSourceMime(template.format, false);
}

/** The fields a filename is built from — narrow so specs can fake a row. */
export type TemplateSourceIdentity = Pick<
    DocumentTemplate,
    'slug' | 'format' | 'native' | 'sourceMimeType'
>;

/**
 * Filename for a template's source download.
 *
 * `slug` is the backing Node's basename (the backend derives it with
 * `pathinfo(..., PATHINFO_FILENAME)`), so slug + source extension reproduces
 * the file's real name on disk.
 *
 * `advertisedExtension` is passed in rather than imported so this stays a
 * pure function: the page hands it `FormatInfoService.extensionForMime`.
 */
export function templateSourceFilename(
    template: TemplateSourceIdentity,
    advertisedExtension: (mime: string) => string | null,
): string {
    const mime = template.sourceMimeType ?? inferTemplateSourceMime(template.format, template.native);
    if (null === mime) {
        return template.slug;
    }

    return `${template.slug}${extensionForSourceMime(mime, advertisedExtension(mime))}`;
}
