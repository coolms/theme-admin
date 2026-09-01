import {
    ChangeDetectionStrategy, Component, computed, inject, OnInit, output, signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { filter, startWith } from 'rxjs';
import { AdminTopbarProfileComponent } from './admin-topbar-profile.component';
import { CalendarQuickAccessComponent } from '../features/calendars/calendar-quick-access.component';
import { EmailQuickAccessComponent } from '../features/email/email-quick-access.component';
import { MessagesQuickAccessComponent } from '../features/messages/messages-quick-access.component';
import { DynamicChatQuickAccessComponent } from '../features/dynamic-chat/dynamic-chat-quick-access.component';
import { CallDialQuickAccessComponent } from '../features/call/call-dial-quick-access.component';
import { NotificationBellComponent } from '../features/notification/notification-bell.component';
import { PageTitleService } from '@coolms/ui-angular';
import { SiteSelectorComponent } from '../features/sections/site-selector/site-selector.component';

interface Breadcrumb {
    path: string;
    label: string;
}

/**
 * Full topbar: brand logo left, route breadcrumbs center, drawer toggle + profile right.
 * Breadcrumbs rebuild on every NavigationEnd.
 */
@Component({
    selector: 'app-admin-topbar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, AdminTopbarProfileComponent, CalendarQuickAccessComponent, EmailQuickAccessComponent, MessagesQuickAccessComponent, DynamicChatQuickAccessComponent, CallDialQuickAccessComponent, NotificationBellComponent, SiteSelectorComponent],
    template: `
        <div class="d-flex align-items-center h-100 px-3 gap-3">

            <!-- Logo / brand -->
            <a routerLink="/" class="text-white text-decoration-none fw-bold me-2"
               style="font-size: 1rem; letter-spacing: .02em; flex-shrink: 0">
                CoolMS
            </a>

            <div class="vr opacity-25 mx-1"></div>

            <!-- Breadcrumbs. The last crumb is whatever the page resolved: a
                 title, or a raw UUID when it did not. flex-nowrap stops the
                 LIST wrapping but not the text inside an item, and a browser
                 happily breaks a UUID after its hyphens - which put the topbar
                 on two lines and pushed the row out of shape. So the last crumb
                 is the only one allowed to shrink, and it ellipsises; the
                 ancestors are short and stay whole. Hover shows the full value.
                 (NO BACKTICKS in this comment - one would end the template.) -->
            <nav class="flex-grow-1 overflow-hidden" style="min-width: 0" aria-label="breadcrumb">
                <ol class="breadcrumb mb-0 flex-nowrap" style="font-size: .8rem">
                    @for (crumb of breadcrumbs(); track crumb.path; let last = $last) {
                        <li class="breadcrumb-item"
                            [class.active]="last"
                            [class.text-nowrap]="!last"
                            [class.text-truncate]="last"
                            [style.flex-shrink]="last ? '1' : '0'"
                            [style.min-width]="last ? '0' : null">
                            @if (!last) {
                                <a [routerLink]="crumb.path"
                                   class="text-white-50 text-decoration-none">
                                    {{ crumb.label }}
                                </a>
                            } @else {
                                <span class="text-white" [title]="crumb.label">{{ crumb.label }}</span>
                            }
                        </li>
                    }
                </ol>
            </nav>

            <!-- Right actions: site selector + terminal toggle + drawer toggle + profile -->
            <div class="d-flex align-items-center gap-2 ms-auto flex-shrink-0">

                <!-- Site selector (H7) -- hidden when only a single section exists -->
                <app-site-selector />

                <!-- Terminal toggle -->
                <button type="button"
                        class="cms-btn cms-btn-sm"
                        style="font-family: var(--cms-font-mono, monospace); font-size: .8rem; padding: 4px 10px"
                        title="Toggle Terminal (Ctrl+\`)"
                        (click)="terminalToggle.emit()">
                    &gt;_
                </button>

                <!-- Personal calendar quick-access (M1.2.f) -->
                <app-calendar-quick-access />

                <!-- Email mailbox quick-access -->
                <app-email-quick-access />

                <!-- Internal messages quick-access (#1012) -->
                <app-messages-quick-access />

                <!-- DynamicChat agent-queue quick-access (#1029) -->
                <app-dynamic-chat-quick-access />

                <!-- Click-to-dial pad (M9.g Slice B) -->
                <app-call-dial-quick-access />

                <!-- Notification bell -->
                <app-notification-bell />

                <!-- Profile dropdown -->
                <app-admin-topbar-profile />
            </div>
        </div>
    `,
})
export class AdminTopbarComponent implements OnInit {
    private readonly router           = inject(Router);
    private readonly route            = inject(ActivatedRoute);
    private readonly pageTitleSvc     = inject(PageTitleService);

    /** Raw URL-segment crumbs; rebuilt on every NavigationEnd. */
    private readonly rawCrumbs = signal<Breadcrumb[]>([]);
    terminalToggle = output<void>();

    /**
     * Final breadcrumb list. When PageTitleService carries a resolved label
     * (set by content components after async data loads), the last crumb's
     * display text is replaced with that label so it shows e.g. "Product Test"
     * instead of the raw slug "product_test".
     */
    readonly breadcrumbs = computed(() => {
        const crumbs = this.rawCrumbs();
        const title  = this.pageTitleSvc.current();
        if (!title || crumbs.length === 0) return crumbs;
        // Replace only the label of the last crumb — path stays the same.
        return [
            ...crumbs.slice(0, -1),
            { ...crumbs[crumbs.length - 1], label: title },
        ];
    });

    ngOnInit(): void {
        this.router.events.pipe(
            filter(e => e instanceof NavigationEnd),
            startWith(null),
        ).subscribe(() => {
            // Clear stale title from the previous route before rebuilding crumbs,
            // so the raw slug shows during any async load on the new page.
            this.pageTitleSvc.clear();
            this.rawCrumbs.set(this.buildBreadcrumbs());
        });
    }

    private buildBreadcrumbs(): Breadcrumb[] {
        // Walk to the deepest activated route child to read its data.
        let r: ActivatedRoute = this.route;
        while (r.firstChild) r = r.firstChild;
        const routeBreadcrumb = r.snapshot.data['breadcrumb'] as
            { label: string; routerLink: string } | undefined;

        const currentPath = this.router.url.split('?')[0];

        if (routeBreadcrumb) {
            // Variant B: the active route declares an explicit intermediate crumb.
            // Build: Home → [breadcrumb.label] → [current page title]
            // The last crumb label is replaced by PageTitleService once async
            // data (schema.label etc.) has loaded.
            const lastSeg = currentPath.split('/').filter(Boolean).at(-1) ?? '';
            return [
                { path: '/', label: 'Home' },
                { path: routeBreadcrumb.routerLink, label: routeBreadcrumb.label },
                {
                    path: currentPath,
                    label: lastSeg.charAt(0).toUpperCase() + lastSeg.slice(1).replace(/-/g, ' '),
                },
            ];
        }

        // Default: derive crumbs from URL path segments.
        const segments = currentPath.split('/').filter(Boolean);
        const crumbs: Breadcrumb[] = [{ path: '/', label: 'Home' }];
        let path = '';
        for (const seg of segments) {
            path += '/' + seg;
            crumbs.push({
                path,
                label: seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' '),
            });
        }
        return crumbs;
    }
}
