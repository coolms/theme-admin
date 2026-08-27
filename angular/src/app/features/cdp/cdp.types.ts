/**
 * Track E Phase 3 (CDP core, #1150) — admin FE wire shapes.
 *
 * Mirror the backend Analytics resources:
 *  - `AnalyticsSegmentResource`      → {@link SegmentDto}
 *  - `AnalyticsSegmentRuleCheckResource` → {@link SegmentRuleCheckDto}
 *  - `AnalyticsSubjectResource`      → {@link SubjectDto}
 *
 * The whole surface is `ROLE_ADMIN`; the Subject profiles are counts-only
 * (no PII), inheriting the event store's privacy-by-design posture.
 */

/** One audience segment — an EL rule over a subject context. */
export interface SegmentDto {
    /** Durable kebab slug — the API identifier AND the membership token on subjects. */
    readonly key:         string;
    readonly name:        string;
    /** Expression-Language boolean over the `subject` context. */
    readonly rule:        string;
    readonly enabled:     boolean;
    readonly description: string | null;
    /**
     * Optional deployed WorkflowDefinition key started when a subject ENTERS
     * this segment (Track E Phase 5, activation). `null` = passive membership.
     */
    readonly activationWorkflow: string | null;
}

/** Create/update payload for a segment (key is immutable once created). */
export interface SegmentWriteDto {
    readonly key?:                string;
    readonly name:                string;
    readonly rule:                string;
    readonly enabled:             boolean;
    readonly description?:        string | null;
    readonly activationWorkflow?: string | null;
}

/** Live rule-lint verdict from `POST /analytics/segments/validate`. */
export interface SegmentRuleCheckDto {
    readonly rule:    string;
    readonly valid:   boolean;
    readonly message: string | null;
}

/** One CDP subject profile — counts only. */
export interface SubjectDto {
    /** `known:<userId>` (durable) or `anon:<visitorRef>` (ephemeral). */
    readonly key:         string;
    readonly kind:        'anonymous' | 'known';
    /** The stitched user UUID (RFC 4122) for known subjects; null for anonymous. */
    readonly userRef:     string | null;
    readonly eventCount:  number;
    readonly totalEvents: number;
    /** Per-type event counts (busiest first, as stored). */
    readonly eventCounts: Record<string, number>;
    /** The full computed profile blob (counts only). */
    readonly attributes:  Record<string, unknown>;
    /** Segment keys this subject currently matches. */
    readonly segments:    string[];
    readonly firstSeen:   string | null;
    readonly lastSeen:    string | null;
}
