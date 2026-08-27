/**
 * F.14c-1 — wire shape for the F.14b `GET /api/v1/document/format-info`
 * endpoint. The response is the authoritative source for per-format
 * UI metadata (icons, colours, labels) AND the file-picker `accept`
 * string; the frontend never hard-codes it.
 */

export interface FormatDisplayInfo {
    /** Discriminator key (e.g. `'word'`). */
    readonly format: string;
    /** Human-readable label (e.g. `'Word Document'`). */
    readonly label: string;
    /** Bootstrap Icons class name (e.g. `'bi-file-earmark-word'`). */
    readonly icon: string;
    /** Brand colour (CSS hex, e.g. `'#2B579A'`). */
    readonly color: string;
    /**
     * Canonical source MIME types this format accepts — both halves of
     * ADR-084's source axis, so `['<docx mime>', 'text/x-dtmpl']` for Word.
     *
     * Positionally paired with {@link extensions}: `extensions[i]` is the
     * extension of `mimeTypes[i]`. The backend states that contract on
     * `DocumentFormatProviderInterface`; the admin resolves a template's
     * download extension from its source mime through it.
     */
    readonly mimeTypes: string[];
    /** File extensions with leading dot, paired with {@link mimeTypes}. */
    readonly extensions: string[];
    /**
     * Whether a template of this format can be authored from scratch —
     * backend-derived from the provider's native source mime, so the "New
     * Template" format list is a projection of the registry rather than a
     * pair spelled out here. Word and Spreadsheet are true today;
     * Presentation is false (upload a `.pptx` instead).
     *
     * Optional on the wire so a frontend running against an older backend
     * degrades to "no format advertises native authoring" rather than
     * offering every format including the ones that would 422.
     */
    readonly supportsNativeAuthoring?: boolean;
}

export interface FormatInfoResponse {
    readonly formats: FormatDisplayInfo[];
    readonly acceptMimeTypes: string[];
    readonly acceptExtensions: string[];
    /**
     * Comma-separated extension list ready for the HTML `accept`
     * attribute (e.g. `'.docx'` today, `'.docx,.xlsx,.pptx'` once
     * Spreadsheet/Presentation modules ship).
     */
    readonly acceptString: string;
}
