import { type Observable, switchMap } from 'rxjs';
import { type ElevationService, type NaviGraphNode, type NaviGraphService } from '@coolms/core-angular';

/**
 * The admin navigation asked again, past the cache, on every change of elevation -- a grant, a drop, an expiry,
 * another tab's. The server answers it per elevation state (a section is locked before a grant and open after it,
 * locked again when the elevation ends), so this is what makes the locks follow without a reload (
 * 2026-10-12). A change while an earlier answer is still on its way supersedes it.
 */
export function navFollowsElevation(
    naviGraph: Pick<NaviGraphService, 'loadAdminNav'>,
    elevation: Pick<ElevationService, 'changes$'>,
    url: string,
): Observable<NaviGraphNode[]> {
    return elevation.changes$.pipe(switchMap(() => naviGraph.loadAdminNav(url, { fresh: true })));
}
