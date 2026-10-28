import { inject } from '@angular/core';
import { Router, type Routes, type UrlMatchResult, type UrlSegment } from '@angular/router';

import { SETTINGS_PARAM } from './mailbox-settings-modal.service';

/**
 * Where one mailbox's settings USED to be a page of their own:
 *
 *   /admin/email/mailboxes/{id}/settings           the first pane
 *   /admin/email/mailboxes/{id}/settings/{pane}    that pane
 *
 * They open in a modal over the Email page now (decided 2026-10-24): `/admin/email;mailbox={id}?settings={pane}`.
 * The old addresses still answer -- a bookmark, a link in a message, the mailbox menu's Settings -- by redirecting
 * there, with the same pane.
 */
export function mailboxSettingsUrlMatcher(segments: UrlSegment[]): UrlMatchResult | null {
    if (segments.length < 3 || segments.length > 4 || 'mailboxes' !== segments[0].path || 'settings' !== segments[2].path) {
        return null;
    }

    const posParams: Record<string, UrlSegment> = { id: segments[1] };
    if (4 === segments.length) {
        posParams['pane'] = segments[3];
    }

    return { consumed: segments, posParams };
}

/**
 * Email mailbox client route. A single full-height three-pane page
 * (mailbox rail / message list / detail + composer) over the APIs.
 */
export const EMAIL_ROUTES: Routes = [
    {
        // The installation's system mail: which mailbox the platform's own mail goes out through.
        // System mail is one of Email's settings, in the settings shell; the old address still lands there.
        path: 'system-mail',
        redirectTo: '/email/settings/email.system_mail',
        pathMatch: 'full',
    },
    {
        path: '',
        loadComponent: () =>
            import('./email-mailbox.page').then(m => m.EmailMailboxPageComponent),
    },
    {
        // The old settings page's address: the Email page with that mailbox's settings open on the same pane.
        matcher: mailboxSettingsUrlMatcher,
        redirectTo: ({ params }) => inject(Router).createUrlTree(
            ['/email', { mailbox: params['id'] }],
            { queryParams: { [SETTINGS_PARAM]: params['pane'] ?? 'general' } },
        ),
    },
];
