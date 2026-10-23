import { type Observable, startWith, switchMap } from 'rxjs';
import { type ElevationService, type NaviGraphNode, type NaviGraphService } from '@coolms/core-angular';

/**
 * The admin navigation: loaded once, then asked again, past the cache, on every change of elevation -- a grant, a
 * drop, an expiry, another tab's. The server answers it per elevation state (a section is locked before a grant and
 * open after it, locked again when the elevation ends), so this is what makes the locks follow without a reload
 * (2026-10-12).
 *
 * ONE stream for the first load and every re-ask, so a later answer always supersedes an earlier one: a change
 * that comes while the first load is still on its way cancels it, and an older answer never lands after a newer one.
 */
export function navFollowsElevation(
    naviGraph: Pick<NaviGraphService, 'loadAdminNav'>,
    elevation: Pick<ElevationService, 'changes$'>,
    url: string,
): Observable<NaviGraphNode[]> {
    return elevation.changes$.pipe(
        startWith(null),
        switchMap((change) => naviGraph.loadAdminNav(url, { fresh: change !== null })),
    );
}
