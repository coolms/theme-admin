/**
 * Track E Phase 4 (CDP personalization, P4.admin.c) — admin FE wire shapes for
 * the content-personalization rule store.
 *
 * Mirrors the backend Web resource `PersonalizationRuleResource`
 * (`/api/v1/web/personalization-rules`, ROLE_ADMIN). A rule maps a CDP audience
 * (`segment`) to a content treatment (`variant`) in a theme placeholder (`slot`);
 * `sortOrder` orders the rules for the client's first-match-per-slot pick.
 * Presented in the CDP admin area (a sibling of Segments) though the endpoint is
 * Web-owned — the rule that maps an audience to a treatment is a rendering-policy
 * concern.
 */

/** One personalization rule. `id` is the entity's v7 uuid (the API identifier). */
export interface PersonalizationRuleDto {
    readonly id:        string;
    /** CDP segment key the rule targets (the membership token on subjects). */
    readonly segment:   string;
    /** Theme placeholder id — a `data-perso-slot` on the rendered page. */
    readonly slot:      string;
    /** Treatment token applied to the slot as `data-perso-variant`. */
    readonly variant:   string;
    readonly enabled:   boolean;
    readonly sortOrder: number;
}

/** Create (POST) / partial-update (PATCH) payload — the id is server-assigned + immutable. */
export interface PersonalizationRuleWriteDto {
    readonly segment:   string;
    readonly slot:      string;
    readonly variant:   string;
    readonly enabled:   boolean;
    readonly sortOrder: number;
}
