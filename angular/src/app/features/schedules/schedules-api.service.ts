// Cut from the shell's api/api.service.ts on 2026-09-21: the Scheduler (/schedules, /scheduler/handlers) endpoints,
// verbatim, so a feature stops depending on the shell for its own module's calls.
// Keeps HttpClient for now; the framework-free transport comes with extraction.
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState, ApiManifest, type HydraCollection } from '@coolms/core-angular';
import {
    type ScheduleDto,
    type ScheduledHandlerDto,
    type ScheduleTriggerNowDto,
} from './schedules.types';

@Injectable({ providedIn: 'root' })
export class SchedulesApiService {
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    // -- Scheduled handler catalog ------------------------------------------

    /**
     * Returns every #[ScheduledHandler]-decorated class registered with
     * the container. Feeds the admin "Handler" dropdown in the Schedule
     * create / edit dialog so admins pick a stable label instead of
     * typing an FQCN.
     */
    listScheduledHandlers(q?: string): Observable<ScheduledHandlerDto[]> {
        const url = `${this.manifest.apiBase}/scheduler/handlers`;
        let params = new HttpParams();
        if (q && q.trim() !== '') {
            params = params.set('q', q.trim());
        }
        return this.http
            .get<HydraCollection<ScheduledHandlerDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => r['member']));
    }

    // -- Schedules () ---------------------------------------------------

    listSchedules(): Observable<ScheduleDto[]> {
        const url = `${this.manifest.apiBase}/schedules`;
        return this.http
            .get<HydraCollection<ScheduleDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    /**
     * Sibling -- paged variant for the admin Schedules list.
     * Round-trips RQL filters + sort to the server so we never load
     * 100k+ rows. Mirror of {@see ApiService.listCalendarsPage}.
     */
    listSchedulesPage(opts: {
        page?:     number;
        pageSize?: number;
        sort?:     string | null;
        filters?:  ReadonlyArray<string>;
    } = {}): Observable<{ items: ScheduleDto[]; totalItems: number; page: number; pageSize: number }> {
        const url = `${this.manifest.apiBase}/schedules`;
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
            .get<HydraCollection<ScheduleDto>>(url, {
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

    getSchedule(slug: string): Observable<ScheduleDto> {
        const url = `${this.manifest.apiBase}/schedules/${encodeURIComponent(slug)}`;
        return this.http.get<ScheduleDto>(url);
    }

    createSchedule(dto: Partial<ScheduleDto>): Observable<ScheduleDto> {
        const url = `${this.manifest.apiBase}/schedules`;
        return this.http.post<ScheduleDto>(url, dto);
    }

    updateSchedule(slug: string, patch: Partial<ScheduleDto>): Observable<ScheduleDto> {
        const url = `${this.manifest.apiBase}/schedules/${encodeURIComponent(slug)}`;
        return this.http.patch<ScheduleDto>(url, patch, this.patchHeaders);
    }

    deleteSchedule(slug: string): Observable<void> {
        const url = `${this.manifest.apiBase}/schedules/${encodeURIComponent(slug)}`;
        return this.http.delete<void>(url);
    }

    triggerScheduleNow(slug: string): Observable<ScheduleTriggerNowDto> {
        const url = `${this.manifest.apiBase}/schedules/${encodeURIComponent(slug)}/trigger-now`;
        return this.http.post<ScheduleTriggerNowDto>(url, {});
    }
}
