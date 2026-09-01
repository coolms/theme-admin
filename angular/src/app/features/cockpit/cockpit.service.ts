import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, map } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';
import {
    CockpitExternalTaskDto,
    CockpitInstanceDetailDto,
    CockpitInstanceDto,
    CockpitReportDto,
    CockpitReportExportDto,
    CockpitTaskMetricsDto,
    CockpitTimingReportDto,
    ListCockpitExternalTasksOptions,
    ListCockpitInstancesOptions,
} from './cockpit.types';

/**
 * M4.a FE — thin API client for the Process Cockpit backend
 * (`/api/v1/cockpit/instances`).
 *
 * Standalone per-feature service (mirrors `InboxService`): small + read-only,
 * so it lives beside its consumer page rather than on the platform-wide
 * `ApiService`. The collection endpoint returns a Hydra envelope (API
 * Platform GetCollection); we request `application/ld+json` and unwrap
 * `member` to a plain array so the consumer page stays Hydra-agnostic —
 * the same shape `InboxService` uses for its array-provider collection.
 */
@Injectable({ providedIn: 'root' })
export class CockpitService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        return manifest?.apiBase ?? '/api/v1';
    }

    /** GET /cockpit/instances?state=&definitionId=&page=&perPage= */
    listInstances(opts: ListCockpitInstancesOptions = {}): Observable<CockpitInstanceDto[]> {
        return this.listInstancesPage(opts).pipe(map(r => r.items));
    }

    /**
     * The paginated form — returns `totalItems` alongside the rows.
     *
     * The endpoint now answers the grid's whole filter surface
     * (`definition`, `businessKey`, `startedFrom`/`startedTo`, `sort`) and
     * responds with a paginator, so the list page can page lazily and its
     * footer can describe the FILTERED set rather than the loaded slice.
     */
    listInstancesPage(opts: ListCockpitInstancesOptions = {}): Observable<{ items: CockpitInstanceDto[]; totalItems: number }> {
        let params = new HttpParams()
            .set('page', String(opts.page ?? 1))
            .set('perPage', String(opts.perPage ?? 200));

        if (opts.state && opts.state.trim() !== '') {
            params = params.set('state', opts.state.trim());
        }
        if (opts.definitionId && opts.definitionId.trim() !== '') {
            params = params.set('definitionId', opts.definitionId.trim());
        }
        if (opts.definition && opts.definition.trim() !== '') {
            params = params.set('definition', opts.definition.trim());
        }
        if (opts.businessKey && opts.businessKey.trim() !== '') {
            params = params.set('businessKey', opts.businessKey.trim());
        }
        if (opts.startedFrom) params = params.set('startedFrom', opts.startedFrom);
        if (opts.startedTo)   params = params.set('startedTo', opts.startedTo);
        if (opts.sort)        params = params.set('sort', opts.sort);

        return this.http
            .get<HydraCollection<CockpitInstanceDto>>(`${this.apiBase}/cockpit/instances`, {
                headers: new HttpHeaders({ Accept: 'application/ld+json' }),
                params,
            })
            .pipe(map(r => ({
                items: r['member'] ?? [],
                totalItems: r['totalItems'] ?? 0,
            })));
    }

    /** GET /cockpit/external-tasks?state=&topic=&processInstanceId=&page=&perPage= */
    listExternalTasks(opts: ListCockpitExternalTasksOptions = {}): Observable<CockpitExternalTaskDto[]> {
        return this.listExternalTasksPage(opts).pipe(map(r => r.items));
    }

    /**
     * The paginated form — returns `totalItems` alongside the rows, so the list
     * page can page lazily and its footer can describe the FILTERED set.
     */
    listExternalTasksPage(opts: ListCockpitExternalTasksOptions = {}): Observable<{ items: CockpitExternalTaskDto[]; totalItems: number }> {
        const pageSize = opts.perPage ?? 200;
        const page = opts.page ?? 1;

        let params = new HttpParams()
            .set('page', String(page))
            .set('perPage', String(pageSize));

        if (opts.state && opts.state.trim() !== '') {
            params = params.set('state', opts.state.trim());
        }
        if (opts.topic && opts.topic.trim() !== '') {
            params = params.set('topic', opts.topic.trim());
        }
        if (opts.processInstanceId && opts.processInstanceId.trim() !== '') {
            params = params.set('processInstanceId', opts.processInstanceId.trim());
        }
        if (opts.activityId && opts.activityId.trim() !== '') {
            params = params.set('activityId', opts.activityId.trim());
        }
        if (opts.worker && opts.worker.trim() !== '') {
            params = params.set('worker', opts.worker.trim());
        }
        if (opts.createdFrom) params = params.set('createdFrom', opts.createdFrom);
        if (opts.createdTo)   params = params.set('createdTo', opts.createdTo);
        if (opts.sort)        params = params.set('sort', opts.sort);

        return this.http
            .get<HydraCollection<CockpitExternalTaskDto>>(`${this.apiBase}/cockpit/external-tasks`, {
                headers: new HttpHeaders({ Accept: 'application/ld+json' }),
                params,
            })
            .pipe(map(r => ({
                items: r['member'] ?? [],
                totalItems: r['totalItems'] ?? 0,
            })));
    }

    /**
     * POST /cockpit/external-tasks/{id}/retry — re-open a permanently-Failed
     * external task so a worker can attempt it again (M5 external-worker
     * cockpit steering). Returns the refreshed row (Created). 404 unknown id;
     * 409 when the task is not Failed.
     */
    retryExternalTask(id: string): Observable<CockpitExternalTaskDto> {
        return this.http.post<CockpitExternalTaskDto>(
            `${this.apiBase}/cockpit/external-tasks/${id}/retry`,
            {},
            { headers: new HttpHeaders({ Accept: 'application/ld+json' }) },
        );
    }

    /**
     * GET /cockpit/instances/{id} — the enriched single-instance detail
     * (M4.b). Unlike the collection, the item op returns a single JSON-LD
     * object (not a Hydra envelope), so we just normalize the optional
     * engine-state arrays and return it as the detail DTO.
     */
    getInstance(id: string): Observable<CockpitInstanceDetailDto> {
        return this.http
            .get<CockpitInstanceDetailDto>(`${this.apiBase}/cockpit/instances/${id}`, {
                headers: new HttpHeaders({ Accept: 'application/ld+json' }),
            })
            .pipe(map(r => ({
                ...r,
                tokens: r.tokens ?? [],
                history: r.history ?? [],
                tasks: r.tasks ?? [],
                variables: r.variables ?? {},
                availableVersions: r.availableVersions ?? [],
            })));
    }

    /**
     * GET /cockpit/report — the aggregate operator report (M4.d): platform
     * state counts + rolling throughput + per-definition breakdown. A
     * singleton item GET (no identifier), so it returns a single JSON-LD
     * object; we normalize the optional arrays/maps defensively.
     */
    getReport(): Observable<CockpitReportDto> {
        return this.http
            .get<CockpitReportDto>(`${this.apiBase}/cockpit/report`, {
                headers: new HttpHeaders({ Accept: 'application/ld+json' }),
            })
            .pipe(map(r => ({
                total: r.total ?? 0,
                stateCounts: r.stateCounts ?? {},
                throughput: r.throughput ?? {
                    started24h: 0, started7d: 0, started30d: 0,
                    completed24h: 0, completed7d: 0, completed30d: 0,
                },
                definitions: r.definitions ?? [],
                avgDurationSeconds: r.avgDurationSeconds ?? null,
            })));
    }

    /**
     * GET /cockpit/task-metrics — aggregate user-task metrics (M4.k): the
     * task-level complement to the process report — count by task state, the
     * open subtotal, overdue count, mean queue-/cycle-time, and completion
     * throughput. A singleton item GET (no identifier), so it returns a single
     * JSON-LD object; we normalize defensively (API Platform omits null props,
     * so the avg-* fields arrive as undefined when there is no sample).
     */
    getTaskMetrics(): Observable<CockpitTaskMetricsDto> {
        return this.http
            .get<CockpitTaskMetricsDto>(`${this.apiBase}/cockpit/task-metrics`, {
                headers: new HttpHeaders({ Accept: 'application/ld+json' }),
            })
            .pipe(map(r => ({
                total: r.total ?? 0,
                stateCounts: r.stateCounts ?? {},
                openTotal: r.openTotal ?? 0,
                overdueCount: r.overdueCount ?? 0,
                avgQueueSeconds: r.avgQueueSeconds ?? null,
                avgCycleSeconds: r.avgCycleSeconds ?? null,
                completed24h: r.completed24h ?? 0,
                completed7d: r.completed7d ?? 0,
                completed30d: r.completed30d ?? 0,
            })));
    }

    /**
     * GET /cockpit/definitions/{definitionId}/timing — the per-definition
     * bottleneck report (M4.g): each AST element's mean + max dwell across
     * the definition's instances, slowest-average first. A single JSON-LD
     * object; we normalize the optional `elements` array defensively. 404 if
     * the definition is unknown (surfaced by the caller's error handler).
     */
    getTiming(definitionId: string): Observable<CockpitTimingReportDto> {
        return this.http
            .get<CockpitTimingReportDto>(`${this.apiBase}/cockpit/definitions/${definitionId}/timing`, {
                headers: new HttpHeaders({ Accept: 'application/ld+json' }),
            })
            .pipe(map(r => ({ ...r, elements: r.elements ?? [] })));
    }

    /**
     * GET /cockpit/reports/export?kind=… (M4.c+) — a Cockpit report rendered
     * server-side as CSV, wrapped in a JSON envelope ({kind, filename, csv,
     * generatedAt}). The caller triggers the `.csv` download client-side from
     * the returned `csv`/`filename` (a raw attachment would 401 — a plain
     * `<a download>` can't carry the bearer token). `definitionId` is required
     * for `kind='timing'`, ignored otherwise.
     */
    exportReport(
        kind: 'definitions' | 'task-metrics' | 'timing',
        definitionId?: string,
    ): Observable<CockpitReportExportDto> {
        let params = new HttpParams().set('kind', kind);
        if (definitionId && definitionId.trim() !== '') {
            params = params.set('definitionId', definitionId.trim());
        }

        return this.http.get<CockpitReportExportDto>(`${this.apiBase}/cockpit/reports/export`, {
            headers: new HttpHeaders({ Accept: 'application/ld+json' }),
            params,
        });
    }

    /**
     * M4.c — steering actions. Each POSTs to a verb sub-resource and the
     * backend returns the updated instance read view. The detail page
     * re-fetches `getInstance(id)` after every successful action (so the
     * token positions + history + variables refresh too), so the returned
     * row is informational only — callers may ignore it.
     *
     * State-illegal transitions surface as a 409, an empty set-variable
     * name as a 400, and an unknown id as a 404 — all humanized by the
     * shared ErrorHandlerService on the consumer page.
     */

    /** POST /cockpit/instances/{id}/cancel — kill running tokens, -> cancelled. */
    cancel(id: string): Observable<CockpitInstanceDto> {
        return this.post(id, 'cancel');
    }

    /** POST /cockpit/instances/{id}/suspend — running -> suspended. */
    suspend(id: string): Observable<CockpitInstanceDto> {
        return this.post(id, 'suspend');
    }

    /** POST /cockpit/instances/{id}/resume — suspended -> running. */
    resume(id: string): Observable<CockpitInstanceDto> {
        return this.post(id, 'resume');
    }

    /**
     * POST /cockpit/instances/{id}/retry — failed -> running (M4.f). Un-fails
     * the instance, re-activates the token parked at the failed service task,
     * and re-drives the engine; on a repeat handler failure it lands Failed
     * again. Retrying a non-failed instance surfaces as a 409.
     */
    retry(id: string): Observable<CockpitInstanceDto> {
        return this.post(id, 'retry');
    }

    /** POST /cockpit/instances/{id}/set-variable — upsert one process variable. */
    setVariable(id: string, name: string, value: string): Observable<CockpitInstanceDto> {
        return this.post(id, 'set-variable', { name, value });
    }

    /**
     * POST /cockpit/instances/{id}/migrate — in-flight version migration
     * (M4.i): re-pin a Suspended instance to a different deployed version of
     * its own definition. The backend validates same-definition + that every
     * live token's element id exists in the target AST; a violation (or a
     * non-suspended instance) surfaces as a 409.
     */
    migrate(id: string, targetVersionId: string): Observable<CockpitInstanceDto> {
        return this.post(id, 'migrate', { targetVersionId });
    }

    private post(id: string, verb: string, body: unknown = {}): Observable<CockpitInstanceDto> {
        return this.http.post<CockpitInstanceDto>(
            `${this.apiBase}/cockpit/instances/${id}/${verb}`,
            body,
            { headers: new HttpHeaders({ Accept: 'application/ld+json' }) },
        );
    }
}
