import { type Routes, type UrlMatchResult, type UrlSegment } from '@angular/router';
import { unsavedChangesGuard } from '@coolms/ui-angular';

/**
 * One mailbox's settings, in the settings shell's object scope, as ONE route:
 *
 *   /admin/email/mailboxes/{id}/settings           the first pane
 *   /admin/email/mailboxes/{id}/settings/{pane}    that pane
 *
 * One config, so picking another pane changes only a param and the page stays put (separate entries would re-create
 * it, and re-read the mailbox, on every pick).
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
        path: '',
        loadComponent: () =>
            import('./email-mailbox.page').then(m => m.EmailMailboxPageComponent),
    },
    {
        // One mailbox's settings, a pane at a time; the wizard stays for adding a mailbox. Leaving a pane with
        // unsaved changes -- for another pane, or away -- asks first.
        matcher: mailboxSettingsUrlMatcher,
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
            import('./mailbox-settings.page').then(m => m.MailboxSettingsPageComponent),
    },
];
