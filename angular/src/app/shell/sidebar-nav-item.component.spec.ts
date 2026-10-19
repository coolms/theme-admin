import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideStore } from '@ngxs/store';
import { of } from 'rxjs';
import { ElevationService, NaviGraphNode } from '@coolms/core-angular';

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

/**
 * A section the server answered 'elevate' for this member of admin (2026-10-12): shown with a lock, never
 * hidden -- hiding it left no way in -- and a click asks for elevation, then opens it by the router (no reload).
 */
describe('SidebarNavItemComponent, a locked section', () => {
    let asks: number;
    let answer: boolean;
    let elevated: boolean;

    function node(access?: 'allowed' | 'elevate'): NaviGraphNode {
        return {
            id: 'b', path: '/backups', title: 'Backups', parentId: null, sortOrder: 0,
            isActive: true, isVisible: true, meta: { resource: '/api/v1/backup' }, children: [],
            ...(access === undefined ? {} : { access }),
        } as NaviGraphNode;
    }

    function render(n: NaviGraphNode): HTMLElement {
        const fixture = TestBed.createComponent(SidebarNavItemComponent);
        fixture.componentRef.setInput('node', n);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    beforeEach(() => {
        asks = 0;
        answer = true;
        elevated = false;
        TestBed.configureTestingModule({
            imports:   [SidebarNavItemComponent],
            providers: [
                provideRouter([]),
                provideHttpClient(),
                provideHttpClientTesting(),
                provideStore([]),
                {
                    provide: ElevationService,
                    useValue: {
                        offerFor: () => { asks++; if (answer) { elevated = true; } return of(answer); },
                        elevated: () => elevated,
                    },
                },
            ],
        });
    });

    it('shows the section with a lock, and no link that would open it unelevated', () => {
        const el = render(node('elevate'));

        expect(el.querySelector('.cms-nav-item__lock')).withContext('the lock').not.toBeNull();
        const link = el.querySelector('a.cms-nav-item') as HTMLAnchorElement;
        expect(link.classList.contains('cms-nav-item--locked')).toBeTrue();
        expect(link.getAttribute('href')).toBe('#');
        expect(link.getAttribute('aria-label')).toBe('Backups, needs an elevated session');
    });

    it('asks for elevation on a click, and opens the section by the router once it is granted', () => {
        const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
        const el = render(node('elevate'));

        (el.querySelector('a.cms-nav-item') as HTMLAnchorElement).click();

        expect(asks).toBe(1);
        expect(navigate).toHaveBeenCalledOnceWith('/backups');
    });

    it('opens nothing when the person declines', () => {
        answer = false;
        const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
        const el = render(node('elevate'));

        (el.querySelector('a.cms-nav-item') as HTMLAnchorElement).click();

        expect(asks).toBe(1);
        expect(navigate).not.toHaveBeenCalled();
    });

    it('shows an allowed section, and one from a server that says nothing, as before: no lock, its own link', () => {
        for (const n of [node('allowed'), node()]) {
            const el = render(n);
            expect(el.querySelector('.cms-nav-item__lock')).toBeNull();
            const link = el.querySelector('a.cms-nav-item') as HTMLAnchorElement;
            expect(link.classList.contains('cms-nav-item--locked')).toBeFalse();
            expect(link.getAttribute('href')).toBe('/backups');
        }
        expect(asks).toBe(0);
    });

    /**
     * A special target -- the terminal, a panel -- is opened by the host shell, not the router. Locked, it was
     * rendered by the special branch first: the lock showed, and a click opened the terminal without asking for
     * elevation. Locked comes first now, and after the grant the shell opens it as always.
     */
    function terminal(access?: 'allowed' | 'elevate'): NaviGraphNode {
        return {
            id: 't', path: '/terminal', title: 'Terminal', parentId: null, sortOrder: 0,
            isActive: true, isVisible: true, meta: { target: 'action.terminal' }, children: [],
            ...(access === undefined ? {} : { access }),
        } as NaviGraphNode;
    }

    function renderTerminal(n: NaviGraphNode): { el: HTMLElement; opened: NaviGraphNode[] } {
        const fixture = TestBed.createComponent(SidebarNavItemComponent);
        const opened: NaviGraphNode[] = [];
        fixture.componentInstance.specialClick.subscribe((x) => opened.push(x));
        fixture.componentRef.setInput('node', n);
        fixture.detectChanges();
        return { el: fixture.nativeElement as HTMLElement, opened };
    }

    it('shows a locked terminal item locked, and opens it through the shell only once elevated', () => {
        const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
        const { el, opened } = renderTerminal(terminal('elevate'));
        const link = el.querySelector('a.cms-nav-item') as HTMLAnchorElement;
        expect(link.classList.contains('cms-nav-item--locked')).withContext('locked, not the special link').toBeTrue();
        expect(link.getAttribute('aria-label')).toBe('Terminal, needs an elevated session');

        link.click();

        expect(asks).withContext('the click asks for elevation').toBe(1);
        expect(opened.map((x) => x.id)).withContext('the shell opens it, after the grant').toEqual(['t']);
        expect(navigate).not.toHaveBeenCalled();
    });

    it('does not open a locked terminal item when the person declines', () => {
        answer = false;
        const { el, opened } = renderTerminal(terminal('elevate'));

        (el.querySelector('a.cms-nav-item') as HTMLAnchorElement).click();

        expect(asks).toBe(1);
        expect(opened).toEqual([]);
    });

    it('opens an allowed terminal item through the shell at once, as before', () => {
        const { el, opened } = renderTerminal(terminal('allowed'));
        const link = el.querySelector('a.cms-nav-item') as HTMLAnchorElement;
        expect(link.classList.contains('cms-nav-item--locked')).toBeFalse();

        link.click();

        expect(asks).toBe(0);
        expect(opened.map((x) => x.id)).toEqual(['t']);
    });
});
