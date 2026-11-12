import type { Params } from '@angular/router';

import type { NotificationAction } from './notification-api.service';

/** A notification action the admin can open: its label, how it is drawn, and the route it goes to. */
export interface NotificationActionTarget {
    readonly label: string;
    /** A button under the text, or the whole row as the action. */
    readonly presentation: 'button' | 'row';
    readonly commands: unknown[];
    readonly queryParams: Params;
}

/** The admin's own words for the action label codes it knows; any other code shows the server's labelText. */
const LABELS: Readonly<Record<string, string>> = {
    reconnect: 'Reconnect',
    'manage-access': 'Manage access',
};

/** The mailbox settings pane each section of `email.mailbox.settings` opens; no section opens the first pane. */
const MAILBOX_SECTION_PANES: Readonly<Record<string, string>> = {
    reconnect: 'connection',
    delegations: 'access',
};

/** The query parameter the Email page's settings modal follows (`/email;mailbox={id}?settings={pane}`). */
const SETTINGS_PARAM = 'settings';

/** A param as a non-empty string, or null. */
function param(params: Record<string, unknown>, key: string): string | null {
    const value = params[key];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** How the server says to draw the action: the whole row for `row`, else a button (the default when absent). */
export function notificationActionPresentation(action: NotificationAction): 'button' | 'row' {
    return action.presentation === 'row' ? 'row' : 'button';
}

/** The action's label: the admin's word for the code, else the server's text. */
export function notificationActionLabel(action: NotificationAction): string {
    const own = typeof action.label === 'string' ? LABELS[action.label] : undefined;
    return own ?? action.labelText;
}

/**
 * Where a notification's action goes in the admin, or null when it shows no button and makes no row interactive: no
 * action, a destination the admin does not know (such as chat.conversation), a required param missing, or no label to
 * show. The admin never decides navigation by a notification's type.
 */
export function notificationActionTarget(action: NotificationAction | null | undefined): NotificationActionTarget | null {
    if (!action || typeof action !== 'object' || !action.destination || typeof action.destination !== 'object') {
        return null;
    }
    const label = notificationActionLabel(action);
    if (typeof label !== 'string' || label.trim() === '') {
        return null;
    }
    const params: Record<string, unknown> = action.destination.params ?? {};
    switch (action.destination.name) {
        case 'email.mailbox.settings': {
            const mailboxId = param(params, 'mailboxId');
            if (null === mailboxId) {
                return null;
            }
            const section = param(params, 'section');
            const pane = (null !== section ? MAILBOX_SECTION_PANES[section] : undefined) ?? 'general';
            return {
                label,
                presentation: notificationActionPresentation(action),
                commands: ['/email', { mailbox: mailboxId }],
                queryParams: { [SETTINGS_PARAM]: pane },
            };
        }
        default:
            return null;
    }
}
