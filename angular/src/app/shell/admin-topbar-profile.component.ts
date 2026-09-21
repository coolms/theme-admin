import {
    ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef,
    HostListener, inject, OnInit, signal, ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { AuthState, AppConfigState, NaviGraphService, NaviGraphNode, Logout } from '@coolms/core-angular';
import { UserAvatarComponent } from '@coolms/ui-angular';
import { ElevationDisplay } from './elevation-display.service';
import { EndElevationAction } from './end-elevation.action';

/**
 * Topbar profile dropdown driven by the navi.admin.topbar NaviGraph tree.
 *
 * Shows the current user's avatar + email. On click opens a dropdown
 * panel listing all action nodes (sign out, profile link, etc.).
 * Nodes are sorted by sortOrder ASC. Click handling is data-driven:
 *   - meta.target === 'action.logout' -> dispatch Logout
 *   - otherwise -> router.navigate to meta.routerLink ?? '/admin' + node.path
 * Closes on outside click via HostListener.
 */
@Component({
    selector: 'app-admin-topbar-profile',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UserAvatarComponent],
    template: `
        <div class="position-relative" #container>

            <!-- Avatar trigger -->
            <button class="btn btn-sm d-flex align-items-center gap-2 text-white"
                    style="background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
                           border-radius: 20px; padding: 4px 10px 4px 6px"
                    (click)="toggle()">
                <app-user-avatar [user]="topbarUser()" size="sm" />
                <span style="font-size:.8rem; max-width:120px"
                      class="text-truncate d-none d-md-inline">
                    {{ userEmail() }}
                </span>
                <svg width="12" height="12" fill="none" stroke="currentColor"
                     stroke-width="2.5" viewBox="0 0 24 24">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
            </button>

            <!-- Dropdown panel. It hangs below the bar but it is a page
                 surface, so it paints the page's surface and the page's ink:
                 as a child of the topbar it would otherwise inherit the bar's
                 light ink (--cms-sidebar-text) onto a white panel in the light
                 theme -- the menu was there and could not be read. -->
            @if (isOpen()) {
                <div class="position-absolute end-0 mt-1 py-1 rounded shadow"
                     style="min-width: 180px; z-index: 1050; top: 100%;
                            background: var(--cms-surface); color: var(--cms-text)">
                    <div class="px-3 py-2 border-bottom">
                        <div class="small fw-semibold text-truncate">{{ userEmail() }}</div>

                        <!-- The session's STATE, beside who it belongs to. The
                             badge says the same thing in the topbar; this is
                             the menu no longer being silent about it. Present
                             only while elevated, so it stays something that
                             appeared rather than a permanent row reading
                             "not elevated". -->
                        @if (elevatedUntil(); as until) {
                            <div class="d-flex align-items-center justify-content-between gap-2 mt-2">
                                <span class="small text-secondary text-truncate">
                                    <i class="bi bi-shield-lock-fill" style="font-size:.8rem"></i>
                                    Elevated until {{ until }}
                                </span>
                                <button type="button"
                                        class="btn btn-link btn-sm p-0 text-decoration-none small"
                                        (click)="endElevation()">End</button>
                            </div>
                        }
                    </div>
                    @for (node of sortedProfileActions(); track node.id) {
                        <button class="dropdown-item d-flex align-items-center gap-2 py-2 px-3"
                                (click)="onNodeClick(node, $event)">
                            @if (node.meta['icon']) {
                                <i class="bi bi-{{ node.meta['icon'] }}"
                                   style="font-size:.9rem; width:16px; text-align:center"></i>
                            }
                            {{ node.meta['label'] ?? node.title }}
                        </button>
                    }
                </div>
            }
        </div>
    `,
})
export class AdminTopbarProfileComponent implements OnInit {
    private readonly naviGraph  = inject(NaviGraphService);
    private readonly store      = inject(Store);
    private readonly router     = inject(Router);
    private readonly destroyRef = inject(DestroyRef);
    private readonly display    = inject(ElevationDisplay);
    private readonly end        = inject(EndElevationAction);

    @ViewChild('container') container?: ElementRef;

    isOpen         = signal(false);
    userEmail      = signal('');
    profileActions = signal<NaviGraphNode[]>([]);
    topbarUser     = signal<{ avatarUrl?: string | null; firstName?: string | null; identifier?: string } | null>(null);

    /** Nodes sorted by sortOrder ASC -- ready to render. */
    readonly sortedProfileActions = computed(() =>
        [...this.profileActions()].sort((a, b) => a.sortOrder - b.sortOrder),
    );

    /**
     * The same sentence the badge shows, from the same place -- so the two
     * cannot disagree by construction rather than by anyone remembering to
     * keep them in step.
     */
    readonly elevatedUntil = (): string | null => this.display.until();

    endElevation(): void {
        this.isOpen.set(false);
        this.end.run();
    }

    @HostListener('document:click', ['$event.target'])
    onOutsideClick(target: EventTarget | null): void {
        // `$event.target` is an EventTarget; narrow it once so the DOM
        // containment check below stays a real check.
        const node = target instanceof Node ? target : null;
        if (this.isOpen() && !this.container?.nativeElement.contains(node)) {
            this.isOpen.set(false);
        }
    }

    ngOnInit(): void {
        // Reactive -- updates whenever PatchCurrentUser (or any other auth action) mutates the store
        this.store.select(AuthState.currentUser)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(user => {
                const id = user?.identifier ?? user?.email ?? '';
                this.userEmail.set(id);
                this.topbarUser.set(user ? { avatarUrl: user.avatarUrl, firstName: user.firstName, identifier: id } : null);
            });

        const url = this.store.selectSnapshot(AppConfigState.manifest)?.navi?.topbarNavGraph;
        if (!url) return;

        this.naviGraph.loadTopbarNav(url).subscribe(nodes => {
            // Look for a designated dropdown root node; fall back to all root nodes
            const dropdown = nodes.find(n => n.meta['target'] === 'dropdown');
            this.profileActions.set(dropdown?.children ?? nodes);
        });
    }

    toggle(): void {
        this.isOpen.update(v => !v);
    }

    /**
     * Data-driven click handler for topbar dropdown nodes.
     *
     * Routing logic based on meta.target:
     *   'action.logout' -> dispatch Logout + navigate to /login
     *   (default)       -> router.navigate to meta.routerLink ?? '/admin' + node.path
     */
    onNodeClick(node: NaviGraphNode, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.isOpen.set(false);

        if (node.meta?.['target'] === 'action.logout') {
            this.store.dispatch(new Logout()).subscribe(() => {
                void this.router.navigate(['/login']);
            });
            return;
        }

        const routerLink = node.meta?.['routerLink'];
        const route = routerLink ?? (node.path ?? '/');
        void this.router.navigate([route]);
    }
}
