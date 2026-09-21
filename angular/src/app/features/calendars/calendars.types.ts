// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Calendar (/calendar/*) -- and Recurrence's /recurrence/preview, hosted here until a recurrence feature exists endpoints, verbatim.

// --- Calendar DTOs () --------------------------------------------------
//
// Mirror the backend `Calendar` / `HolidayRule` / `CalendarHolidayPreview`
// Resources at `src/Calendar/Infrastructure/ApiPlatform/Resource/`. The
// admin Calendar pages are the only consumers today.

/** One weekday entry inside `workingHours`. ISO weekday code MO..SU. */
export interface WeekdayHoursDto {
    readonly day:  'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
    readonly from: string;  // HH:MM 24-hour
    readonly till: string;  // HH:MM 24-hour
}

/** Snapshot of a Calendar entity for the list / detail / form. */
/** -- summary returned by `POST /api/v1/calendar/{slug}/import`. */
export interface CalendarImportResultDto {
    readonly imported: number;
    readonly skipped:  number;
    readonly skips:    ReadonlyArray<string>;
}

export interface CalendarDto {
    readonly id?:            string;
    readonly slug?:          string;
    readonly label?:         string;
    readonly tz?:            string;
    readonly workingHours?:  ReadonlyArray<WeekdayHoursDto>;
    readonly parentId?:      string | null;
    readonly ownerId?:       string | null;
    /** Human-friendly owner label resolved by
     *  the backend list provider (firstName + lastName, falls back to
     *  username, then shortened UUID). Null on Get endpoints. */
    readonly ownerLabel?:    string | null;
    /** Owner role: `owned | shared | admin | null`. */
    readonly currentUserAccess?: 'owned' | 'shared' | 'admin' | null;
    /** True when the calendar is the user's seeded
     *  default personal calendar (`personal-{ownerId}`); the FE
     *  disables the delete button when this is true. */
    readonly isDefaultPersonal?: boolean;
    readonly createdAt?:     string;
    readonly updatedAt?:     string;
}

/** Holiday rule type, mirrors backend `HolidayRuleType` enum values. */
export type HolidayRuleTypeCode =
    | 'fixed'
    | 'other'
    | 'moveable'
    | 'transferred'
    | 'related'
    | 'gregorian_easter'
    | 'julian_easter';

/** Snapshot of a HolidayRule for list / detail / form. */
export interface HolidayRuleDto {
    readonly id?:                string;
    readonly calendarId?:        string;
    readonly label?:             string;
    readonly type?:              HolidayRuleTypeCode;
    readonly params?:            Record<string, unknown>;
    readonly isWorking?:         boolean;
    readonly weekendAdjustment?: number | null;
    readonly createdAt?:         string;
    readonly updatedAt?:         string;
}

/** Single row from `GET /api/v1/calendar/{slug}/preview?year=...`. */
export interface HolidayPreviewItemDto {
    readonly date:       string;  // YYYY-MM-DD
    readonly dayOfWeek:  number;  // 1..7 (Mon..Sun)
    readonly ruleId:     string;
    readonly ruleLabel:  string;
    readonly ruleType:   HolidayRuleTypeCode;
    readonly isWorking:  boolean;
}

/** Wrapper returned by the preview endpoint. */
export interface CalendarHolidayPreviewDto {
    readonly slug:  string;
    readonly year:  number;
    readonly tz:    string;
    readonly items: ReadonlyArray<HolidayPreviewItemDto>;
}

// --- CalendarItem / Share DTOs ( / / /) ----------
//
// Mirror the backend `CalendarItemResource`, `EventAttendeeResource`,
// `CalendarItemRsvpResource`, and `CalendarShareResource` at
// `src/Calendar/Infrastructure/ApiPlatform/Resource/`.
//
// `CalendarItemDto` carries the canonical row OR a materialised
// occurrence (recurring items are expanded server-side when the
// list endpoint is called with `from`/`to`). FE keys events by
// `id`; the canonical row is `originalItemId`. For owned single
// occurrences this is the same UUID; for occurrences of a
// recurring rule the id is `{uuid}@{YmdHis}` while
// `originalItemId` is the bare canonical UUID -- this lets the
// editor target the right row on edit/delete.

export type CalendarItemTypeCode =
    | 'event'
    | 'task'
    | 'scheduler_ref'
    | 'blog_post'
    | 'holiday'
    | 'external';

export type CalendarItemVisibilityCode =
    | 'default'
    | 'public'
    | 'private'
    | 'busy_only';

export type CalendarItemStatusCode =
    | 'confirmed'
    | 'tentative'
    | 'cancelled';

export interface CalendarItemDto {
    readonly id:              string;
    readonly calendarId:      string;
    readonly type:            CalendarItemTypeCode;
    readonly title:           string;
    readonly description:     string | null;
    readonly location:        string | null;
    readonly start:           string;        // ISO 8601 with TZ
    readonly end:             string | null; // ISO 8601 with TZ; null for tasks
    readonly allDay:          boolean;
    readonly recurrence:      string | null; // canonical RFC 5545 spec (multi-line)
    readonly color:           string | null; // hex (#rrggbb) or null = use calendar default
    readonly visibility:      CalendarItemVisibilityCode;
    readonly status:          CalendarItemStatusCode;
    readonly organizerId:     string | null;
    /** Canonical row UUID. Equals `id` for non-recurring rows. */
    readonly originalItemId:  string | null;
    readonly createdAt?:      string;
    readonly updatedAt?:      string;
    /**
     * Soft-grouping id of the recurring series. Non-null
     * for base recurring items + their overrides; null for one-shot
     * items. The FE keys "is this part of a series?" off this, NOT
     * off `recurrence` -- flat occurrence projections strip the rule
     * to prevent client-side re-expansion.
     */
    readonly seriesId?:       string | null;
    /**
     * Parent base id on override rows; null otherwise.
     * Lets the FE distinguish editing an override row vs editing a
     * base occurrence.
     */
    readonly parentItemId?:   string | null;
    /**
     * -- non-working-day policy. Controls what the expander
     * does when a recurring occurrence lands on a holiday or other
     * non-working day of the host calendar:
     *   - `off` (default) -- yield every iterator candidate.
     *   - `skip` -- drop non-working candidates.
     *   - `shift_forward` -- bump to next working day, same time-of-day.
     * Only meaningful for recurring items; ignored on one-shot rows.
     */
    readonly nwdPolicy?:      NonWorkingDayPolicy | null;
}

/** {@see NonWorkingDayPolicy} on the backend.. */
export type NonWorkingDayPolicy = 'off' | 'skip' | 'shift_forward';

export interface CreateCalendarItemDto {
    readonly calendarId:   string;
    readonly type?:        CalendarItemTypeCode;
    readonly title:        string;
    readonly description?: string | null;
    readonly location?:    string | null;
    readonly start:        string;
    readonly end?:         string | null;
    readonly allDay?:      boolean;
    readonly recurrence?:  string | null;
    readonly color?:       string | null;
    readonly visibility?:  CalendarItemVisibilityCode;
    readonly status?:      CalendarItemStatusCode;
    readonly organizerId?: string | null;
    readonly nwdPolicy?:   NonWorkingDayPolicy | null;
}

export type UpdateCalendarItemDto = Partial<CreateCalendarItemDto>;

/**
 * Wire shape for `POST /api/v1/calendar/items/{itemId}/exception`.
 *
 * Reschedules / patches one occurrence of a recurring base item. The
 * server is idempotent on (parentItemId, recurrenceInstant), so a re-edit
 * on the same instant updates rather than creates a duplicate.
 */
export interface CalendarItemExceptionRequest {
    /** ISO 8601 -- the ORIGINAL occurrence start, before any drag. */
    readonly recurrenceInstant: string;
    /** ISO 8601 -- the new occurrence start (often == recurrenceInstant when only title/desc/status changed). */
    readonly newStart:          string;
    /** ISO 8601 -- the new occurrence end. NULL for point-in-time items. */
    readonly newEnd?:           string | null;
    readonly title?:            string | null;
    readonly description?:      string | null;
    readonly status?:           CalendarItemStatusCode | null;
}

export interface CalendarItemExceptionResponse {
    readonly itemId:            string; // parent base item id
    readonly overrideId:        string;
    readonly parentItemId:      string;
    readonly seriesId:          string | null;
    readonly recurrenceInstant: string;
    readonly newStart:          string;
    readonly newEnd:            string | null;
    readonly title:             string | null;
    readonly description:       string | null;
    readonly status:            string | null;
}

/**
 * Wire shape for `POST /api/v1/calendar/items/{itemId}/skip`.
 *
 * Drops one occurrence by appending EXDATE to the base item's RRULE. The
 * server also clears any prior reschedule override for the same instant
 * (EXDATE supersedes). Idempotent -- repeat calls with the same instant
 * are no-ops once the EXDATE is in place.
 */
export interface CalendarItemSkipResponse {
    readonly itemId:            string;
    readonly recurrenceInstant: string;
    readonly exdateCount:       number;
}

/**
 * Wire shape for `POST /api/v1/calendar/items/{itemId}/split`.
 *
 * Trims the base's RRULE at `recurrenceInstant` and creates a NEW
 * base item starting at `newStart` carrying the patched properties.
 * The server returns the new base's id + the shared `seriesId` so
 * the FE can update its local cache.
 */
export interface CalendarItemSplitRequest {
    readonly recurrenceInstant: string;
    readonly newStart:          string;
    readonly newEnd?:           string | null;
    readonly title?:            string | null;
    readonly description?:      string | null;
    readonly status?:           CalendarItemStatusCode | null;
}

export interface CalendarItemSplitResponse {
    readonly itemId:            string; // parent (original, now-truncated) base id
    readonly newBaseId:         string;
    readonly seriesId:          string | null;
    readonly recurrenceInstant: string;
    readonly newStart:          string;
    readonly newEnd:            string | null;
    readonly newStartIso:       string | null;
    readonly newEndIso:         string | null;
    readonly title:             string | null;
    readonly description:       string | null;
    readonly status:            string | null;
}

/**
 * Wire shape for `POST /api/v1/calendar/items/{itemId}/delete-following`
     * Truncates the base's RRULE and deletes later overrides.
 */
export interface CalendarItemDeleteFollowingResponse {
    readonly itemId:            string;
    readonly recurrenceInstant: string;
    readonly truncatedUntil:    string | null;
}

/**
 * Wire shape for `POST /api/v1/recurrence/preview`. The endpoint
 * computes the next N occurrences of an RRULE spec from a given
 * DTSTART without persisting anything; the calendar event editor's
 * recurrence form calls it (debounced) to render a "next 5
 * occurrences" preview as the user toggles freq / interval / BYDAY /
 * EXDATE.
 */
export interface RecurrencePreviewRequest {
    readonly rrule:         string;
    readonly dtstart:       string;
    readonly tz?:           string | null;
    readonly count?:        number;
    readonly horizonYears?: number;
}

export interface RecurrencePreviewResponse {
    readonly rrule:        string;
    readonly dtstart:      string;
    readonly tz:           string | null;
    readonly count:        number;
    readonly horizonYears: number;
    readonly occurrences:  string[]; // ISO 8601 with offset
}

export type EventAttendeeStatusCode =
    | 'pending'
    | 'accepted'
    | 'declined'
    | 'tentative';

export type EventAttendeeRoleCode =
    | 'required'
    | 'optional'
    | 'chair'
    | 'resource';

export interface EventAttendeeDto {
    readonly id:             string;
    readonly calendarItemId: string;
    readonly userId:         string;
    readonly status:         EventAttendeeStatusCode;
    readonly role:           EventAttendeeRoleCode;
    readonly respondedAt:    string | null;
    readonly createdAt?:     string;
    readonly updatedAt?:     string;
}

export interface CalendarItemRsvpDto {
    readonly itemId:     string;
    readonly status:     EventAttendeeStatusCode;
    readonly userId:     string;
    readonly attendeeId: string;
}

export type CalendarShareRoleCode = 'viewer' | 'editor';

export interface CalendarShareDto {
    readonly id:            string;
    readonly calendarId:    string;
    readonly calendarSlug:  string;
    readonly role:          CalendarShareRoleCode;
    readonly shareeUserId:  string | null;
    readonly shareeGroupId: string | null;
    readonly grantedById:   string | null;
    readonly createdAt:     string;
    readonly updatedAt?:    string;
}

export interface CreateCalendarShareDto {
    readonly role:           CalendarShareRoleCode;
    readonly shareeUserId?:  string;
    readonly shareeGroupId?: string;
}

export interface UpdateCalendarShareDto {
    readonly role: CalendarShareRoleCode;
}

/** Options for the calendar-items range query. */
export interface ListCalendarItemsOptions {
    readonly calendarSlug?: string;
    readonly from?:         string; // ISO 8601
    readonly to?:           string; // ISO 8601
    readonly type?:         CalendarItemTypeCode;
}
