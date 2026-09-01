import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideStore } from '@ngxs/store';
import { NaviGraphNode } from '@coolms/core-angular';

import { SidebarNavItemComponent } from './sidebar-nav-item.component';

/**
 * A third-party module gets an admin screen by DECLARING one: it contributes a
 * navigraph node whose `meta.route` names a generic screen the platform already
 * renders, and ships no Angular code at all.
 *
 * The whole mechanism rests on `meta.route` reaching `[routerLink]` intact.
 * Nothing asserted that, and a well-meant "normalise the route" change would
 * break every declared screen at once while every existing single-segment entry
 * kept working -- so the multi-segment case is the one pinned here.
 */
describe('SidebarNavItemComponent route resolution', () => {
    function node(partial: Partial<NaviGraphNode>): NaviGraphNode {
        return {
            id:        'n1',
            path:      '/admin/example',
            title:     'Example',
            parentId:  null,
            sortOrder: 0,
            isActive:  true,
            isVisible: true,
            meta:      {},
            children:  [],
            ...partial,
        } as NaviGraphNode;
    }

    function linkFor(n: NaviGraphNode): string {
        const fixture = TestBed.createComponent(SidebarNavItemComponent);
        fixture.componentRef.setInput('node', n);
        fixture.detectChanges();
        return fixture.componentInstance.routerLinkFor();
    }

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports:   [SidebarNavItemComponent],
            providers: [
                provideRouter([]),
                provideHttpClient(),
                provideHttpClientTesting(),
 // NaviGraphService reaches the NGXS store, so the component
 // cannot be constructed without it even though route
 // resolution never touches it.
                provideStore([]),
            ],
        });
    });

 it('carries a multi-segment generic route through untouched', () => {
 // The shape a declared third-party screen uses: the generic
 // `dynamic-records/:typeAlias` screen, named by a module that ships no
 // component of its own.
        expect(linkFor(node({ meta: { route: 'dynamic-records/acme_crm' } })))
            .toBe('/dynamic-records/acme_crm');
    });

 it('does not double a leading slash', () => {
        expect(linkFor(node({ meta: { route: '/dynamic-records/acme_crm' } })))
            .toBe('/dynamic-records/acme_crm');
    });

 it('accepts routerLink as the older spelling', () => {
        expect(linkFor(node({ meta: { routerLink: 'media' } }))).toBe('/media');
    });

 it('falls back to the node path with the /admin prefix removed', () => {
        expect(linkFor(node({ path: '/admin/example', meta: {} }))).toBe('/example');
    });
});
