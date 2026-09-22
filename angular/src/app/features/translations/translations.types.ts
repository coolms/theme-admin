// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the I18n (/i18n/catalogues) endpoints, verbatim.

// --- Translation catalogues (admin editor) ------------------
// Mirror backend `TranslationCatalogueResource`.
// `id` is the composite `{domain}:{locale}` slug used in URI paths.

/** One row on /admin/i18n/translations (collection summary). */
export interface TranslationCatalogueDto {
    readonly id:            string;
    readonly domain:        string;
    readonly locale:        string;
    readonly hasOverride:   boolean;
    readonly entryCount:    number;
    readonly overrideCount: number;
    /** Populated only on item GET (drill-down); null on the list. */
    readonly entries?:      ReadonlyArray<TranslationCatalogueEntryDto> | null;
}

/** One translation row inside a catalogue's editor. */
export interface TranslationCatalogueEntryDto {
    readonly key:      string;
    readonly baseline: string;
    /** null = no override (renders baseline); string = override text. */
    readonly override: string | null;
}
