import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterLink } from '@angular/router';
import { ConsoleActivation, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import { PageTitleService } from '@coolms/ui-angular';
import { AdminTopbarComponent } from './admin-topbar.component';

/**
 * The terminal's top-bar toggle follows the navigation rule (2026-10-13, "the header terminal button follows the
 * navigation rule"): hidden for an account the menu offers no terminal item, shown for one it does, and shown with a
 * lock where the item needs elevation. The click goes to the layout, which applies the rule (togglePanelByRule).
 */
describe('AdminTopbarComponent, a console panel\'s toggle', () => {
    const nav = signal<NaviGraphNode[]>([]);

    function terminalItem(access?: 'allowed' | 'elevate'): NaviGraphNode {
        return {
            id: 't', path: '/terminal', title: 'Terminal', parentId: null, sortOrder: 0, isActive: true, isVisible: true,
            meta: { target: 'action.terminal' }, children: [], ...(access === undefined ? {} : { access }),
        } as NaviGraphNode;
    }

    function render(): { el: HTMLElement; emitted: string[] } {
        const fixture = TestBed.createComponent(AdminTopbarComponent);
        const emitted: string[] = [];
        fixture.componentInstance.panelToggle.subscribe(id => emitted.push(id));
        fixture.detectChanges();
        return { el: fixture.nativeElement as HTMLElement, emitted };
    }

    function toggle(el: HTMLElement): HTMLButtonElement | null {
        return [...el.querySelectorAll('button')].find(b => (b.getAttribute('title') ?? '').startsWith('Toggle Terminal')) ?? null;
    }

    beforeEach(() => {
        nav.set([]);
        TestBed.configureTestingModule({
            imports: [AdminTopbarComponent],
            providers: [
                provideRouter([]),
                {
                    provide: ConsoleActivation,
                    useValue: {
                        panels: signal([{ id: 'terminal', dock: 'bottom', toggle: { label: 'Toggle Terminal (Ctrl+`)', text: '>_', key: '`' } }]),
                        topbar: signal([]),
                    },
                },
                { provide: NaviGraphService, useValue: { adminNav: nav } },
                { provide: PageTitleService, useValue: { current: signal(null), clear: () => undefined } },
            ],
        });
        TestBed.overrideComponent(AdminTopbarComponent, {
            set: { imports: [NgComponentOutlet, RouterLink], schemas: [NO_ERRORS_SCHEMA] },
        });
    });

    it('is hidden where the account has no terminal item: outside admin', () => {
        nav.set([]);
        expect(toggle(render().el)).toBeNull();
    });

    it('is shown, without a lock, where the item is allowed, and a click goes to the layout', () => {
        nav.set([terminalItem('allowed')]);
        const { el, emitted } = render();
        const button = toggle(el);

        expect(button).not.toBeNull();
        expect(button?.querySelector('.bi-lock-fill')).toBeNull();
        button?.click();
        expect(emitted).toEqual(['terminal']);
    });

    it('is shown with a lock where the item needs elevation, saying so', () => {
        nav.set([terminalItem('elevate')]);
        const button = toggle(render().el);

        expect(button?.querySelector('.bi-lock-fill')).not.toBeNull();
        expect(button?.getAttribute('aria-label')).toBe('Toggle Terminal (Ctrl+`), needs an elevated session');
    });
});
