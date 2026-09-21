// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Scheduler (/schedules, /scheduler/handlers) endpoints, verbatim.

/** -- Scheduler trigger kind code, lowercase enum. */
export type TriggerKindCode = 'cron' | 'rrule';

/** Snapshot of a Schedule for list / detail / form. */
export interface ScheduleDto {
    readonly id?:           string;
    readonly slug?:         string;
    readonly name?:         string;
    readonly triggerKind?:  TriggerKindCode;
    readonly triggerSpec?:  string;
    readonly tz?:           string;
    readonly handler?:      string;
    readonly payload?:      Record<string, unknown>;
    readonly enabled?:      boolean;
    readonly calendarId?:   string | null;
    /**
     * Sibling -- display slug for the backing calendar, set
     * server-side by ListSchedulesProvider so the FE doesn't need a
     * separate `/calendar` round-trip to resolve calendarId -> slug.
     */
    readonly calendarSlug?: string | null;
    readonly ownerId?:      string | null;
    /** Display label for the owner -- set by ListSchedulesProvider. */
    readonly ownerLabel?:   string | null;
    readonly lastRunAt?:    string | null;
    readonly nextRunAt?:    string | null;
    readonly createdAt?:    string;
    readonly updatedAt?:    string;
}

/**
 * One row from `GET /api/v1/scheduler/handlers` -- a class registered
 * with `#[ScheduledHandler]`. The dropdown stores the `key` in
 * `ScheduleDto.handler`; `label` + `description` are shown to the
 * admin; `fqcn` is informational.
 */
export interface ScheduledHandlerDto {
    readonly key:          string;
    readonly label:        string;
    readonly description?: string | null;
    readonly fqcn?:        string | null;
}

/** Status DTO returned by `POST /api/v1/schedules/{slug}/trigger-now`. */
export interface ScheduleTriggerNowDto {
    readonly slug:       string;
    readonly dispatched: boolean;
    readonly firedAt:    string | null;
    readonly nextRunAt:  string | null;
}
