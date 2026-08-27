import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
    ApiService,
    RoutingStepKind,
    RoutingTraceDto,
} from '../../api/api.service';
import { ErrorHandlerService } from '@coolms/core-angular';
/**
 * Coordinates state between the three Routing Inspector slot components.
 *
 * Provided at the route level (see `routing-inspector.routes.ts` --
 * actually `app.routes.ts` where the route is declared) so every
 * activation of `/admin/routing-inspector` gets a fresh instance and
 * the three sibling slots (`RoutingInspectorForm`, `RoutingInspectorOutcome`,
 * `RoutingInspectorSteps`) share one source of truth.
 *
 * Owns:
 *  - The (host, path) input values
 *  - The current trace / loading / error signals
 *  - The expanded-detail set (which steps have payload rows toggled
 *    open)
 *  - URL-sync on inspect (so admins can paste the URL into a PR)
 *
 * Slot components inject this service and read/write directly. The
 * layout shell itself is generic and knows nothing about it.
 */
@Injectable()
export class RoutingInspectorStateService {
    private static readonly DEFAULT_HOST = 'localhost';
    private static readonly DEFAULT_PATH = '/';

    private readonly api        = inject(ApiService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly route      = inject(ActivatedRoute);
    private readonly router     = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    /** Free text inputs bound to ngModel in the form slot. */
    readonly hostInput = signal<string>(RoutingInspectorStateService.DEFAULT_HOST);
    readonly pathInput = signal<string>(RoutingInspectorStateService.DEFAULT_PATH);

    readonly trace    = signal<RoutingTraceDto | null>(null);
    readonly loading  = signal(false);
    readonly error    = signal<string | null>(null);
    /** Set of step kinds whose details payload is currently expanded. */
    readonly expanded = signal<Set<RoutingStepKind>>(new Set());

    /**
     * Hydrate from `?host=&path=` query params (Site Detail page deep-
     * links here) then kick off the first inspection. Called once by
     * the Form slot in its ngOnInit so the state lifecycle is tied to
     * the first slot to mount.
     *
     * Uses a one-shot snapshot read instead of subscribing to
     * `queryParamMap`. The subscription form was originally tempting
     * (it kept the form in sync with external URL changes), but it
     * feedback-looped against `runInspect`'s own `router.navigate({
     * queryParamsHandling: 'merge', replaceUrl: true })` -- every
     * navigate triggered another emit which re-ran runInspect, which
     * in flight raced against routerLink navigations away from this
     * page (the queued router.navigate would clobber the routerLink's
     * target URL with query params from this page). The one-shot read
     * means: hydrate from URL once on mount, the form's submit path
     * is the ONLY source of subsequent URL updates after that.
     */
    hydrateAndRun(): void {
        const params = this.route.snapshot.queryParamMap;
        const qHost = params.get('host');
        const qPath = params.get('path');
        if (qHost !== null) this.hostInput.set(qHost);
        if (qPath !== null) this.pathInput.set(qPath);
        this.runInspect();
    }

    runInspect(): void {
        const host = this.hostInput().trim();
        const path = this.pathInput().trim() || RoutingInspectorStateService.DEFAULT_PATH;

        this.loading.set(true);
        this.error.set(null);

        // Reflect current inputs in the URL so the trace is shareable.
        void this.router.navigate([], {
            relativeTo:          this.route,
            queryParams:         { host, path },
            queryParamsHandling: 'merge',
            replaceUrl:          true,
        });

        this.api.inspectRouting(host, path).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: trace => {
                this.trace.set(trace);
                // Reset expansion when a new trace lands -- prevents
                // stale rows showing an unrelated previous trace's
                // payload.
                this.expanded.set(new Set());
                this.loading.set(false);
            },
            error: (err: unknown) => {
                this.error.set(this.errors.humanize(err));
                this.loading.set(false);
            },
        });
    }

    toggleStep(step: RoutingStepKind): void {
        const next = new Set(this.expanded());
        if (next.has(step)) {
            next.delete(step);
        } else {
            next.add(step);
        }
        this.expanded.set(next);
    }
}
