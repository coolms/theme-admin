import { Subject, of } from 'rxjs';
import { type ElevationChange, type NaviGraphNode } from '@coolms/core-angular';
import { navFollowsElevation } from './nav-follows-elevation';

/**
 * The locks follow elevation without a reload (2026-10-12): every change of elevation asks the navigation
 * again, past the cache. Asked from the cache, a lock would outlive the grant -- or come back only after a reload.
 */
describe('navFollowsElevation', () => {
    const URL = '/api/v1/navi/trees/navi.admin/graph';

    it('asks the navigation again, fresh, on every change of elevation -- and not before one', () => {
        const changes$ = new Subject<ElevationChange>();
        const asked: { url: string; fresh: boolean | undefined }[] = [];
        const naviGraph = {
            loadAdminNav: (url: string, options: { fresh?: boolean } = {}) => {
                asked.push({ url, fresh: options.fresh });
                return of<NaviGraphNode[]>([]);
            },
        };

        const sub = navFollowsElevation(naviGraph, { changes$ }, URL).subscribe();
        expect(asked).toEqual([]);

        changes$.next({ kind: 'granted' } as ElevationChange);
        changes$.next({ kind: 'dropped' } as ElevationChange);

        expect(asked).toEqual([{ url: URL, fresh: true }, { url: URL, fresh: true }]);
        sub.unsubscribe();
    });
});
