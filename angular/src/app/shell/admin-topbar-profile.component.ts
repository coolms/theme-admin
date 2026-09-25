import {
    ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
    HostListener, inject, OnInit, signal, ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { AuthState } from '@coolms/core-angular';
import { UserAvatarComponent } from '@coolms/ui-angular';
import { ElevationDisplay } from './elevation-display.service';
import { EndElevationAction } from './end-elevation.action';
import { SignOutService } from './sign-out.service';

/** One entry of the account menu. */
interface AccountEntry {
    readonly id: 'profile' | 'sign-out' | 'sign-out-everywhere';
    readonly label: string;
    readonly icon: string;
}

/**
 * The account menu in the topbar: the current user's avatar and address, and
 * what every signed-in person may do with their own account -- their profile,
 * "Sign out" (this session) and "Sign out everywhere" (every session and device).
 *
 * The account, not admin navigation (Dmitry, 2026-09-26). The menu used to be
 * the navi.admin.topbar tree, which only an admin may read: a signed-in person
 * without the admin role got a 403 and an empty menu -- no way to sign out at
 * all (measured with the call harness's plain-user account). So the entries are
 * the menu's own, shown to everyone signed in, and no tree is asked for.
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
                    @for (entry of entries; track entry.id) {
                        <button class="dropdown-item d-flex align-items-center gap-2 py-2 px-3"
                                (click)="onEntry(entry, $event)">
                            <i class="bi bi-{{ entry.icon }}"
                               style="font-size:.9rem; width:16px; text-align:center"></i>
                            {{ entry.label }}
                        </button>
                    }
                </div>
            }
        </div>
    `,
})
export class AdminTopbarProfileComponent implements OnInit {
    private readonly store      = inject(Store);
    private readonly router     = inject(Router);
    private readonly destroyRef = inject(DestroyRef);
    private readonly display    = inject(ElevationDisplay);
    private readonly end        = inject(EndElevationAction);
    private readonly signOut    = inject(SignOutService);

    @ViewChild('container') container?: ElementRef;

    isOpen     = signal(false);
    userEmail  = signal('');
    topbarUser = signal<{ avatarUrl?: string | null; firstName?: string | null; identifier?: string } | null>(null);

    readonly entries: readonly AccountEntry[] = [
        { id: 'profile', label: 'My Profile', icon: 'person-fill' },
        { id: 'sign-out', label: 'Sign out', icon: 'box-arrow-right' },
        { id: 'sign-out-everywhere', label: 'Sign out everywhere', icon: 'shield-lock' },
    ];

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
    }

    toggle(): void {
        this.isOpen.update(v => !v);
    }

    /**
     *   profile             -> the profile page
     *   sign-out            -> SignOutService: this session, then /login
     *   sign-out-everywhere -> SignOutService: every session and device, then /login
     *
     * Both sign-outs reach the server (2026-09-25): until then "Sign out" only
     * cleared this browser and the session stayed valid on the server.
     */
    onEntry(entry: AccountEntry, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.isOpen.set(false);

        switch (entry.id) {
            case 'sign-out':
                this.signOut.signOut().subscribe();
                return;
            case 'sign-out-everywhere':
                this.signOut.signOut({ everywhere: true }).subscribe();
                return;
            case 'profile':
                void this.router.navigate(['/profile']);
                return;
        }
    }
}
