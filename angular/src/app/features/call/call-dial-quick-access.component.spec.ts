import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ElevationService, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import { DrawerService } from '@coolms/ui-angular';
import { CallDialQuickAccessComponent } from './call-dial-quick-access.component';

/**
 * The top bar's dial pad follows its module's item in the navigation the server answered (2026-10-12, "the
 * header controls follow the same rule"): allowed -- shown, opens; elevate -- shown with a lock, asks for elevation
 * first and opens once granted; absent -- not shown.
 */
describe('CallDialQuickAccessComponent and the navigation\'s answer', () => {
    let asks: number;
    let opened: number;
    const nav = signal<NaviGraphNode[]>([]);

    function item(access?: 'allowed' | 'elevate'): NaviGraphNode {
        return {
            id: 'call', path: '/call', title: 'Call', parentId: null, sortOrder: 0, isActive: true,
            isVisible: true, meta: { resource: '/api/v1/call/records' }, children: [],
            ...(access === undefined ? {} : { access }),
        } as NaviGraphNode;
    }

    function render(): HTMLElement {
        const fixture = TestBed.createComponent(CallDialQuickAccessComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    beforeEach(() => {
        asks = 0;
        opened = 0;
        TestBed.configureTestingModule({
            imports: [CallDialQuickAccessComponent],
            providers: [
                { provide: Store, useValue: { selectSnapshot: () => ({ id: 'u1' }) } },
                { provide: NaviGraphService, useValue: { adminNav: nav } },
                { provide: DrawerService, useValue: { open: () => { opened++; } } },
                {
                    provide: ElevationService,
                    useValue: { offerFor: () => { asks++; return of(true); }, elevated: () => true },
                },
            ],
        });
    });

    it('shows a locked item with a lock, and asks for elevation before it opens the pad', () => {
        nav.set([item('elevate')]);
        const el = render();

        const button = el.querySelector('button') as HTMLButtonElement;
        expect(button).withContext('shown, not hidden').not.toBeNull();
        expect(el.querySelector('.bi-lock-fill')).withContext('the lock').not.toBeNull();
        expect(button.getAttribute('aria-label')).toContain('needs an elevated session');

        button.click();
        expect(asks).toBe(1);
        expect(opened).toBe(1);
    });

    it('opens an allowed item directly, with no lock and no question', () => {
        nav.set([item('allowed')]);
        const el = render();

        expect(el.querySelector('.bi-lock-fill')).toBeNull();
        (el.querySelector('button') as HTMLButtonElement).click();
        expect(asks).toBe(0);
        expect(opened).toBe(1);
    });

    it('shows nothing when the navigation has no item for it', () => {
        nav.set([]);
        expect(render().querySelector('button')).toBeNull();
    });
});
