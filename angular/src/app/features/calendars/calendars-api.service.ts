// Cut from the shell's api/api.service.ts on 2026-09-21: the Calendar (/calendar/*) -- and Recurrence's /recurrence/preview, hosted here until a recurrence feature exists endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, type HydraCollection } from '@coolms/core-angular';
import {
    type CalendarImportResultDto,
    type CalendarDto,
    type HolidayRuleDto,
    type CalendarHolidayPreviewDto,
    type CalendarItemDto,
    type CreateCalendarItemDto,
    type UpdateCalendarItemDto,
    type CalendarItemExceptionRequest,
    type CalendarItemExceptionResponse,
    type CalendarItemSkipResponse,
    type CalendarItemSplitRequest,
    type CalendarItemSplitResponse,
    type CalendarItemDeleteFollowingResponse,
    type RecurrencePreviewRequest,
    type RecurrencePreviewResponse,
    type EventAttendeeStatusCode,
    type EventAttendeeRoleCode,
    type EventAttendeeDto,
    type CalendarItemRsvpDto,
    type CalendarShareDto,
    type CreateCalendarShareDto,
    type UpdateCalendarShareDto,
    type ListCalendarItemsOptions,
} from './calendars.types';

/**
 * A write of an event or a series read with no version is not sent: without the version it was read at, it could
 * only go over whatever is stored now, unseen.
 */
export class CalendarItemNotReadError extends Error {
    constructor(readonly itemId: string) {
        super(`The event "${itemId}" was read with no version, so it is not changed.`);
        this.name = 'CalendarItemNotReadError';
    }
}

/**
 * A write refused because the event or its series changed since it was read (412), or because it was read with no
 * version: nothing was changed. What the person can do is reload; the write is never sent again on its own.
 */
export function calendarItemChangedSinceRead(err: unknown): boolean {
    return err instanceof CalendarItemNotReadError || (err instanceof HttpErrorResponse && err.status === 412);
}

@Injectable({ providedIn: 'root' })
export class CalendarsApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    // -- Calendars () --------------------------------------------------

    listCalendars(): Observable<CalendarDto[]> {
        const url = `${this.manifest.apiBase}/calendar`;
        return this.http
            .get<HydraCollection<CalendarDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    /**
     * -- paged variant for the admin Calendars list. Round-trips
     * RQL filters + sort to the server so we never load 100k+ rows
     * into the browser. The lazy-mode DataGrid emits page/sort/filter
     * on every `loadMore`; the page calls into this method and feeds
     * the returned envelope to the grid via `[externalData]`.
     *
     * `filters` is a list of RQL clauses (e.g. `slug cn "foo"`,
     * `currentUserAccess eq "owned"`) -- each becomes its own
     * `?filter=` query param.
     */
    listCalendarsPage(opts: {
        page?:     number;
        pageSize?: number;
        sort?:     string | null;
        filters?:  ReadonlyArray<string>;
    } = {}): Observable<{ items: CalendarDto[]; totalItems: number; page: number; pageSize: number }> {
        const url = `${this.manifest.apiBase}/calendar`;
        let params = new HttpParams();
        const pageSize = opts.pageSize ?? 50;
        const page     = opts.page ?? 1;
        params = params.set('page',     String(page));
        // RQL parser reads `?limit=N` (see RqlParser).
        // Sending `pageSize` was a no-op -- backend silently fell back to
        // RqlQuery::DEFAULT_LIMIT (20), and the FE's offset math (built on
        // PAGE_SIZE=50) requested page 1 over and over, duplicating rows.
        params = params.set('limit', String(pageSize));
        if (opts.sort) {
            params = params.set('sort', opts.sort);
        }
        for (const f of opts.filters ?? []) {
            if (f && f.trim() !== '') {
                params = params.append('filter', f);
            }
        }
        return this.http
            .get<HydraCollection<CalendarDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => ({
                items:      r['member'],
                totalItems: r['totalItems'],
                page,
                pageSize,
            })));
    }

    getCalendar(slug: string): Observable<CalendarDto> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}`;
        return this.http.get<CalendarDto>(url);
    }

    createCalendar(dto: Partial<CalendarDto>): Observable<CalendarDto> {
        const url = `${this.manifest.apiBase}/calendar`;
        return this.http.post<CalendarDto>(url, dto);
    }

    updateCalendar(slug: string, patch: Partial<CalendarDto>): Observable<CalendarDto> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}`;
        return this.http.patch<CalendarDto>(url, patch, this.patchHeaders);
    }

    deleteCalendar(slug: string): Observable<void> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}`;
        return this.http.delete<void>(url);
    }

    /**
     * -- download a calendar as an RFC 5545 `.ics`. Goes through
     * HttpClient (not a bare `<a href>`) so the Bearer interceptor attaches
     * the token; the caller turns the Blob into a download.
     */
    exportCalendarIcs(slug: string): Observable<Blob> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}/export.ics`;
        return this.http.get(url, { responseType: 'blob' as const });
    }

    /** -- upload an `.ics` document (raw body) into a calendar. */
    importCalendarIcs(slug: string, ics: string): Observable<CalendarImportResultDto> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}/import`;
        return this.http.post<CalendarImportResultDto>(url, ics, {
            headers: { 'Content-Type': 'text/calendar' },
        });
    }

    listHolidayRules(calendarSlug: string): Observable<HolidayRuleDto[]> {
        const url    = `${this.manifest.apiBase}/calendar/holiday-rules`;
        const params = new HttpParams().set('calendar', calendarSlug);
        return this.http
            .get<HydraCollection<HolidayRuleDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => r['member']));
    }

    getHolidayRule(id: string): Observable<HolidayRuleDto> {
        const url = `${this.manifest.apiBase}/calendar/holiday-rules/${encodeURIComponent(id)}`;
        return this.http.get<HolidayRuleDto>(url);
    }

    createHolidayRule(dto: Partial<HolidayRuleDto>): Observable<HolidayRuleDto> {
        const url = `${this.manifest.apiBase}/calendar/holiday-rules`;
        return this.http.post<HolidayRuleDto>(url, dto);
    }

    updateHolidayRule(id: string, patch: Partial<HolidayRuleDto>): Observable<HolidayRuleDto> {
        const url = `${this.manifest.apiBase}/calendar/holiday-rules/${encodeURIComponent(id)}`;
        return this.http.patch<HolidayRuleDto>(url, patch, this.patchHeaders);
    }

    deleteHolidayRule(id: string): Observable<void> {
        const url = `${this.manifest.apiBase}/calendar/holiday-rules/${encodeURIComponent(id)}`;
        return this.http.delete<void>(url);
    }

    previewCalendarYear(slug: string, year: number): Observable<CalendarHolidayPreviewDto> {
        const url    = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}/preview`;
        const params = new HttpParams().set('year', year.toString());
        return this.http.get<CalendarHolidayPreviewDto>(url, { params });
    }

    // -- Calendar Items ( /) ------------------------------------
    //
    // The range query (`from`/`to`) is the FullCalendar event source. Backend
    // expands recurring items within the requested window via
    // CalendarItemRangeExpander + tagged CalendarItemProvider's. Without a
    // range the endpoint returns canonical rows only (no expansion). Callers
    // should always pass `from`+`to` for calendar grids.

    listCalendarItems(opts: ListCalendarItemsOptions = {}): Observable<CalendarItemDto[]> {
        const url = `${this.manifest.apiBase}/calendar/items`;
        let params = new HttpParams();
        if (opts.calendarSlug) params = params.set('calendar', opts.calendarSlug);
        if (opts.from)         params = params.set('from',     opts.from);
        if (opts.to)           params = params.set('to',       opts.to);
        if (opts.type)         params = params.set('type',     opts.type);
        return this.http
            .get<HydraCollection<CalendarItemDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => r['member']));
    }

    getCalendarItem(id: string): Observable<CalendarItemDto> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(id)}`;
        return this.http.get<CalendarItemDto>(url);
    }

    createCalendarItem(dto: CreateCalendarItemDto): Observable<CalendarItemDto> {
        const url = `${this.manifest.apiBase}/calendar/items`;
        return this.http.post<CalendarItemDto>(url, dto);
    }

    /**
     * `version`: the version of the row `id` names, as read -- `version` of an event or of an edited occurrence,
     * `seriesVersion` for the series' base. Sent as If-Match; a row changed since answers 412, nothing changed.
     */
    updateCalendarItem(id: string, patch: UpdateCalendarItemDto, version: number | null | undefined): Observable<CalendarItemDto> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(id)}`;
        return this.withVersion(id, version, ifMatch => this.http.patch<CalendarItemDto>(url, patch, {
            headers: { ...this.patchHeaders.headers, 'If-Match': ifMatch },
        }));
    }

    /** `version`: as for {@link updateCalendarItem}. */
    deleteCalendarItem(id: string, version: number | null | undefined): Observable<void> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(id)}`;
        return this.withVersion(id, version, ifMatch => this.http.delete<void>(url, { headers: { 'If-Match': ifMatch } }));
    }

    // -- Per-occurrence overrides ----------------------------------
    //
    // When the user edits / deletes / drags one occurrence of a recurring
    // event AND picks the "only this event" scope, we route to these two
    // endpoints instead of touching the canonical row. Both are idempotent
    // on `(parentItemId, recurrenceInstant)` server-side, so a re-edit on
    // the same instant updates rather than duplicates.
    //
    // These four change the SERIES: each names the series' version as read
    // (`seriesVersion`); a series changed since answers 412, nothing changed.

    createCalendarItemException(
        parentItemId: string,
        body: CalendarItemExceptionRequest,
        seriesVersion: number | null | undefined,
    ): Observable<CalendarItemExceptionResponse> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(parentItemId)}/exception`;
        return this.withVersion(parentItemId, seriesVersion, ifMatch =>
            this.http.post<CalendarItemExceptionResponse>(url, body, { headers: { 'If-Match': ifMatch } }));
    }

    skipCalendarItemOccurrence(
        parentItemId: string,
        recurrenceInstant: string,
        seriesVersion: number | null | undefined,
    ): Observable<CalendarItemSkipResponse> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(parentItemId)}/skip`;
        return this.withVersion(parentItemId, seriesVersion, ifMatch =>
            this.http.post<CalendarItemSkipResponse>(url, { recurrenceInstant }, { headers: { 'If-Match': ifMatch } }));
    }

    /**
     * "This and following events" save / drag-resize. Trims
     * the base's RRULE at `recurrenceInstant` and creates a new base
     * with the patched properties starting at `newStart`. Both halves
     * share `seriesId` so the "all events" walk traverses the split.
     */
    splitCalendarItem(
        parentItemId: string,
        body: CalendarItemSplitRequest,
        seriesVersion: number | null | undefined,
    ): Observable<CalendarItemSplitResponse> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(parentItemId)}/split`;
        return this.withVersion(parentItemId, seriesVersion, ifMatch =>
            this.http.post<CalendarItemSplitResponse>(url, body, { headers: { 'If-Match': ifMatch } }));
    }

    /**
     * "Delete this and following events". Truncates the
     * base's RRULE; later overrides are removed. No new item is
     * created.
     */
    deleteFollowingCalendarItem(
        parentItemId: string,
        recurrenceInstant: string,
        seriesVersion: number | null | undefined,
    ): Observable<CalendarItemDeleteFollowingResponse> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(parentItemId)}/delete-following`;
        return this.withVersion(parentItemId, seriesVersion, ifMatch =>
            this.http.post<CalendarItemDeleteFollowingResponse>(url, { recurrenceInstant }, {
                headers: { 'If-Match': ifMatch },
            }));
    }

    /** The write, sent with `version` as a strong If-Match -- or, read without one, not sent at all. */
    private withVersion<T>(
        id: string,
        version: number | null | undefined,
        send: (ifMatch: string) => Observable<T>,
    ): Observable<T> {
        if (version === null || version === undefined) {
            return throwError(() => new CalendarItemNotReadError(id));
        }
        return send(`"${version}"`);
    }

    // -- Recurrence preview ( / shared) ----------------------------------
    //
    // Pure computation endpoint over the canonical RecurrenceIterator. The
    // calendar event editor's structured recurrence form calls this on
    // debounced form changes to render the "next 5 occurrences" preview list.
    // Any other module that exposes a recurrence configurator (Scheduler,
    // Workflow deadlines) can call the same endpoint without extra wiring.

    recurrencePreview(req: RecurrencePreviewRequest): Observable<RecurrencePreviewResponse> {
        const url = `${this.manifest.apiBase}/recurrence/preview`;
        return this.http.post<RecurrencePreviewResponse>(url, req);
    }

    // -- Event Attendees / RSVP () -------------------------------------

    listEventAttendees(itemId: string): Observable<EventAttendeeDto[]> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(itemId)}/attendees`;
        return this.http
            .get<HydraCollection<EventAttendeeDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    addEventAttendee(
        itemId: string,
        dto: { userId: string; role?: EventAttendeeRoleCode; status?: EventAttendeeStatusCode },
    ): Observable<EventAttendeeDto> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(itemId)}/attendees`;
        return this.http.post<EventAttendeeDto>(url, dto);
    }

    updateEventAttendee(
        itemId: string,
        attendeeId: string,
        patch: { status?: EventAttendeeStatusCode; role?: EventAttendeeRoleCode },
    ): Observable<EventAttendeeDto> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(itemId)}/attendees/${encodeURIComponent(attendeeId)}`;
        return this.http.patch<EventAttendeeDto>(url, patch, this.patchHeaders);
    }

    removeEventAttendee(itemId: string, attendeeId: string): Observable<void> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(itemId)}/attendees/${encodeURIComponent(attendeeId)}`;
        return this.http.delete<void>(url);
    }

    rsvpCalendarItem(
        itemId: string,
        status: EventAttendeeStatusCode,
    ): Observable<CalendarItemRsvpDto> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(itemId)}/rsvp`;
        return this.http.post<CalendarItemRsvpDto>(url, { status });
    }

    // -- Calendar Shares () ------------------------------------------

    listCalendarShares(calendarSlug: string): Observable<CalendarShareDto[]> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(calendarSlug)}/shares`;
        return this.http
            .get<HydraCollection<CalendarShareDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    createCalendarShare(
        calendarSlug: string,
        dto: CreateCalendarShareDto,
    ): Observable<CalendarShareDto> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(calendarSlug)}/shares`;
        return this.http.post<CalendarShareDto>(url, dto);
    }

    updateCalendarShare(
        calendarSlug: string,
        shareId: string,
        patch: UpdateCalendarShareDto,
    ): Observable<CalendarShareDto> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(calendarSlug)}/shares/${encodeURIComponent(shareId)}`;
        return this.http.patch<CalendarShareDto>(url, patch, this.patchHeaders);
    }

    deleteCalendarShare(calendarSlug: string, shareId: string): Observable<void> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(calendarSlug)}/shares/${encodeURIComponent(shareId)}`;
        return this.http.delete<void>(url);
    }
}
