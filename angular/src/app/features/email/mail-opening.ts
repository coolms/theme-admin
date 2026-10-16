import { MailPreferences } from './mail-preferences.service';

/**
 * The mailbox the mail page opens on: the one an OAuth sign-in just returned to, then the default mailbox the person
 * chose in their profile, then the last one they viewed, then the first -- each only if it is in the list. Null when
 * the list is empty.
 */
export function openingMailbox(
    list: ReadonlyArray<{ readonly id: string }>,
    oauthTarget: string | null,
    chosen: string | null,
    lastViewed: string | null,
): string | null {
    for (const id of [oauthTarget, chosen, lastViewed]) {
        if (id !== null && list.some(m => m.id === id)) {
            return id;
        }
    }
    return list.at(0)?.id ?? null;
}

/** Whether a message's remote images load as it opens: only when the profile says "always loaded". */
export function loadsRemoteImagesAtOnce(prefs: MailPreferences): boolean {
    return prefs.remoteImages === 'allow';
}
