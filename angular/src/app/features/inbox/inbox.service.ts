import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, map } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';
import {
    CompleteRequest,
    DelegateRequest,
    InboxTab,
    InboxTaskDto,
    InboxTasksPage,
    ListInboxTasksOptions,
} from './inbox.types';

/**
 * FE — thin API client for the Inbox backend.
 *
 * Standalone service (not bolted onto the project-wide `ApiService`)
 * because the surface is small + tab-routed and the platform
 * `ApiService` is already large. Mirrors the precedent set by
 * `CalendarLiveEventsService` and other per-feature clients that live
 * alongside their consumer page.
 *
 * The collection endpoint returns a Hydra envelope; we unwrap to a
 * `{ items, totalItems, page, pageSize }` shape so the consumer page
 * doesn't depend on Hydra naming.
 */
@Injectable({ providedIn: 'root' })
export class InboxService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    /** Hydra header set the platform's ApiService uses for collection reads. */
    private get hydraHeaders(): { headers: HttpHeaders } {
        return {
            headers: new HttpHeaders({ Accept: 'application/ld+json' }),
        };
    }

    private get apiBase(): string {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        return manifest?.apiBase ?? '/api/v1';
    }

    /**
     * GET /inbox/tasks?tab=...&page=...&limit=...
     *
     * The backend `ListInboxTasksProvider` reads `?tab=` (assigned by
     * default), `?page=` (1-based), `?limit=` (RQL convention -- NOT
     * `?perPage=`, see the Schedules ship for the same gotcha).
     * Filters flow through the standard RQL `?filter=` repeat.
     */
    listTasks(opts: ListInboxTasksOptions = {}): Observable<InboxTasksPage> {
        const url = `${this.apiBase}/inbox/tasks`;
        const pageSize = opts.pageSize ?? 50;
        const page     = opts.page ?? 1;

        let params = new HttpParams()
            .set('tab',   opts.tab ?? 'assigned')
            .set('page',  String(page))
            .set('limit', String(pageSize));

        if (opts.sort) {
            params = params.set('sort', opts.sort);
        }
        for (const f of opts.filters ?? []) {
            if (f && f.trim() !== '') {
                params = params.append('filter', f);
            }
        }

        return this.http
            .get<HydraCollection<InboxTaskDto>>(url, {
                headers: this.hydraHeaders.headers,
                params,
            })
            .pipe(map(r => ({
                items:      r['member'],
                totalItems: r['totalItems'],
                page,
                pageSize,
            })));
    }

    getTask(id: string): Observable<InboxTaskDto> {
        return this.http.get<InboxTaskDto>(`${this.apiBase}/inbox/tasks/${encodeURIComponent(id)}`);
    }

    claim(id: string): Observable<InboxTaskDto> {
        return this.http.post<InboxTaskDto>(`${this.apiBase}/inbox/tasks/${encodeURIComponent(id)}/claim`, {});
    }

    unclaim(id: string): Observable<InboxTaskDto> {
        return this.http.post<InboxTaskDto>(`${this.apiBase}/inbox/tasks/${encodeURIComponent(id)}/unclaim`, {});
    }

    delegate(id: string, body: DelegateRequest): Observable<InboxTaskDto> {
        return this.http.post<InboxTaskDto>(
            `${this.apiBase}/inbox/tasks/${encodeURIComponent(id)}/delegate`,
            body,
        );
    }

    complete(id: string, body: CompleteRequest): Observable<InboxTaskDto> {
        return this.http.post<InboxTaskDto>(
            `${this.apiBase}/inbox/tasks/${encodeURIComponent(id)}/complete`,
            body,
        );
    }

    /** Convenience for the tab-strip query param. */
    static readonly DEFAULT_TAB: InboxTab = 'assigned';
}
