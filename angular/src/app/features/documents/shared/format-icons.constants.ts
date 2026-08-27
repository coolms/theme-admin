/**
 * F.14c-1 — fallback icons used while the format-info endpoint is
 * still loading or when a template advertises a format the backend
 * doesn't know. The runtime always prefers `FormatInfoService`'s
 * payload; these constants exist solely so the very first paint of
 * the document grid doesn't render iconless tiles.
 */

export const DEFAULT_FORMAT_ICON = 'bi-file-earmark';
export const DEFAULT_FORMAT_COLOR = 'var(--cms-text-muted)';

/**
 * Hand-rolled label for a format key when the backend payload
 * hasn't arrived yet. Keys here match the backend's
 * `getFormat()` discriminators; unknown keys fall through to an
 * uppercased version of the key itself.
 */
export const FALLBACK_FORMAT_LABELS: Readonly<Record<string, string>> = Object.freeze({
    word: 'Word',
    spreadsheet: 'Spreadsheet',
    presentation: 'Presentation',
    markdown: 'Markdown',
});
