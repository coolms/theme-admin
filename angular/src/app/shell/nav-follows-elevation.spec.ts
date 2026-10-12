import { Subject, of, type Observable } from 'rxjs';
import { type ElevationChange, type NaviGraphNode } from '@coolms/core-angular';
import { navFollowsElevation } from './nav-follows-elevation';

/**
 * The locks follow elevation without a reload (2026-10-12): the menu is loaded once, then every change of elevation
 * asks it again, past the cache. One stream, so a re-ask that comes while the first load is on its way supersedes
 * it -- the older answer never lands after the newer one.
 */
describe('navFollowsElevation', () => {
    const URL = '/api/v1/navi/trees/navi.admin/graph';

    it('loads the menu once, then asks it again, fresh, on every change of elevation', () => {
        const changes$ = new Subject<ElevationChange>();
        const asked: { url: string; fresh: boolean | undefined }[] = [];
        const naviGraph = {
            loadAdminNav: (url: string, options: { fresh?: boolean } = {}) => {
                asked.push({ url, fresh: options.fresh });
                return of<NaviGraphNode[]>([]);
            },
        };

        const sub = navFollowsElevation(naviGraph, { changes$ }, URL).subscribe();
        expect(asked).toEqual([{ url: URL, fresh: false }]);

        changes$.next({ kind: 'granted' } as ElevationChange);
        changes$.next({ kind: 'dropped' } as ElevationChange);

        expect(asked).toEqual([{ url: URL, fresh: false }, { url: URL, fresh: true }, { url: URL, fresh: true }]);
        sub.unsubscribe();
    });

    it('lets a re-ask supersede a first load still on its way: the older answer never lands', () => {
        const changes$ = new Subject<ElevationChange>();
        const first = new Subject<NaviGraphNode[]>();
        const second = new Subject<NaviGraphNode[]>();
        const pending: Observable<NaviGraphNode[]>[] = [first, second];
        const naviGraph = { loadAdminNav: () => pending.shift()! };
        const landed: string[] = [];

        const sub = navFollowsElevation(naviGraph, { changes$ }, URL)
            .subscribe(tree => landed.push(tree[0]?.title ?? 'empty'));

        changes$.next({ kind: 'granted' } as ElevationChange);
        second.next([{ title: 'after the grant' } as NaviGraphNode]);
        first.next([{ title: 'before the grant' } as NaviGraphNode]);

        expect(landed).toEqual(['after the grant']);
        sub.unsubscribe();
    });
});
