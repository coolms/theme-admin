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

/**
 * On a phone, two or more panel toggles go behind one "More panels" menu -- never a menu of one -- each named as on
 * the bar, the elevation note kept, a choice opening the panel as its toggle would.
 */
describe('AdminTopbarComponent, the More panels menu', () => {
    const nav = signal<NaviGraphNode[]>([]);
    const panels = signal([
        { id: 'terminal', dock: 'bottom', toggle: { label: 'Toggle Terminal', text: '>_', key: '`' } },
        { id: 'logs', dock: 'bottom', toggle: { label: 'Toggle Logs', icon: 'journal-text', key: 'l' } },
    ]);

    function item(target: string, access: 'allowed' | 'elevate'): NaviGraphNode {
        return {
            id: target, path: '/' + target, title: target, parentId: null, sortOrder: 0, isActive: true, isVisible: true,
            meta: { target: 'action.panel:' + target }, children: [], access,
        } as NaviGraphNode;
    }

    function render(): { el: HTMLElement; emitted: string[]; host: HTMLElement; detect: () => void } {
        const fixture = TestBed.createComponent(AdminTopbarComponent);
        const emitted: string[] = [];
        fixture.componentInstance.panelToggle.subscribe(id => emitted.push(id));
        fixture.detectChanges();
        return { el: fixture.nativeElement as HTMLElement, emitted, host: fixture.nativeElement, detect: () => fixture.detectChanges() };
    }

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [AdminTopbarComponent],
            providers: [
                provideRouter([]),
                { provide: ConsoleActivation, useValue: { panels, topbar: signal([]) } },
                { provide: NaviGraphService, useValue: { adminNav: nav } },
                { provide: PageTitleService, useValue: { current: signal(null), clear: () => undefined } },
            ],
        });
        TestBed.overrideComponent(AdminTopbarComponent, {
            set: { imports: [NgComponentOutlet, RouterLink], schemas: [NO_ERRORS_SCHEMA] },
        });
    });

    it('holds two offered toggles in order, names kept, the elevation said, and a choice opens that panel', () => {
        nav.set([item('terminal', 'allowed'), item('logs', 'elevate')]);
        const { el, emitted, host, detect } = render();

        expect(host.classList).toContain('cms-topbar--panels-menu');
        (el.querySelector('[data-test="topbar-more"]') as HTMLButtonElement).click();
        detect();
        const items = [...el.querySelectorAll('[role="menu"] [role="menuitem"]')] as HTMLButtonElement[];
        expect(items.map(b => b.getAttribute('data-panel'))).toEqual(['terminal', 'logs']);
        expect(items[0].textContent).toContain('Toggle Terminal');
        expect(items[1].textContent).toContain('needs an elevated session');

        items[1].click();
        detect();
        expect(emitted).toEqual(['logs']);
        expect(el.querySelector('[role="menu"]')).toBeNull();
    });

    it('is never a menu of one: a single offered toggle stays on the bar', () => {
        nav.set([item('terminal', 'allowed')]);
        const { el, host } = render();

        expect(host.classList).not.toContain('cms-topbar--panels-menu');
        expect(el.querySelector('[data-test="topbar-more"]')).toBeNull();
    });

    it('closes on Escape', () => {
        nav.set([item('terminal', 'allowed'), item('logs', 'allowed')]);
        const { el, detect } = render();
        (el.querySelector('[data-test="topbar-more"]') as HTMLButtonElement).click();
        detect();
        expect(el.querySelector('[role="menu"]')).not.toBeNull();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        detect();
        expect(el.querySelector('[role="menu"]')).toBeNull();
    });
});
