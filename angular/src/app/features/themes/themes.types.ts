// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Theme (/themes/{slug}/templates) endpoints, verbatim.

// --- Theme template DTOs (Navi-node picker, Deliverable 1) ---------

export interface ThemeTemplateDto {
    /** Relative path under the theme's `templates/`, e.g. `pages/home.html.dtmpl`. */
    path:      string;
    /** Theme slug this template belongs to (mirrors the path param). */
    themeSlug: string;
    /** Display label -- the file basename, e.g. `home.html.dtmpl`. */
    label:     string;
}
