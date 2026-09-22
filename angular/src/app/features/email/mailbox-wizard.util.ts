import { type MailboxAuthMethod, type MailboxDraftRequest, type MailboxSecurity } from './email.types';

/**
 * The mailbox wizard's two rules, as pure functions, so the component decides
 * nothing about credentials on its own.
 *
 * **Authorize first.** An OAuth mailbox is not created by the wizard. The wizard
 * sends the INTENDED mailbox to `POST /email/mailboxes/connect`, which stashes it
 * as a server-side draft and answers with the provider's consent URL; the row is
 * built only after the callback has proven the grant over IMAP. An abandoned or
 * refused consent therefore leaves nothing behind -- where the previous flow
 * committed a "pending" row first, which the scheduler then tried to fetch.
 *
 * **One address.** An OAuth mailbox authenticates (XOAUTH2) as its address, so the
 * draft carries no username at all. On the password path the username is derived
 * from the address by the server for everyone; only an administrator may send an
 * alias that differs. The server applies that rule whatever the client sends --
 * what these functions decide is what the wizard SHOWS and what it does not
 * bother sending.
 */

/** The wizard's form, as much of it as these rules read. */
export interface MailboxWizardForm {
    label: string;
    emailAddress: string;
    imapHost: string;
    imapPort: number;
    imapSecurity: MailboxSecurity;
    imapUsername: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecurity: MailboxSecurity;
    smtpUsername: string;
    authMethod: MailboxAuthMethod;
    oauthProvider: string;
}

export type MailboxEditorMode = 'create' | 'edit';

/**
 * Whether the wizard shows editable username fields at all.
 *
 * Never on an OAuth create (the address IS the login); on a password create only
 * for an administrator, who may point the login at an alias; in edit mode as
 * before, where the stored value is being looked at rather than derived.
 */
export function usernameFieldsEditable(mode: MailboxEditorMode, authMethod: MailboxAuthMethod, callerIsAdmin: boolean): boolean {
    if (mode === 'edit') {
        return true;
    }
    if (authMethod === 'oauth') {
        return false;
    }

    return callerIsAdmin;
}

/**
 * The username keys a password CREATE sends, mirroring the server's rule so the
 * request says only what the server would keep: nothing for a non-administrator
 * (the server derives both from the address), and for an administrator only an
 * alias that is actually typed -- a blank field is not "an empty username", it is
 * "the address", and the server says so better than a copied string would.
 */
export function usernamesForCreate(
    callerIsAdmin: boolean,
    imapUsername: string,
    smtpUsername: string,
): { imapUsername?: string; smtpUsername?: string } {
    if (!callerIsAdmin) {
        return {};
    }
    const out: { imapUsername?: string; smtpUsername?: string } = {};
    if (imapUsername.trim() !== '') {
        out.imapUsername = imapUsername.trim();
    }
    if (smtpUsername.trim() !== '') {
        out.smtpUsername = smtpUsername.trim();
    }

    return out;
}

/**
 * The body of `POST /email/mailboxes/connect`: the intended mailbox and nothing
 * about how it logs in. Built from the form rather than spread from it so a
 * future form field cannot leak into the draft by accident -- the server's DTO
 * has exactly these keys, and a username here would be a defect on both sides.
 */
export function draftRequestFromForm(f: MailboxWizardForm): MailboxDraftRequest {
    return {
        label: f.label.trim(),
        emailAddress: f.emailAddress.trim(),
        oauthProvider: f.oauthProvider || 'google',
        imapHost: f.imapHost.trim(),
        imapPort: f.imapPort,
        imapSecurity: f.imapSecurity,
        smtpHost: f.smtpHost.trim(),
        smtpPort: f.smtpPort,
        smtpSecurity: f.smtpSecurity,
    };
}

/**
 * The fields a wizard step owns that must not be blank, by step, for a CREATE.
 * Usernames are on no step: they are derived (password) or absent (OAuth).
 * Returned as [label, value] so the caller can name the first blank.
 */
export function requiredOnStep(step: number, f: MailboxWizardForm): [string, string][] {
    switch (step) {
        case 1: return [['Label', f.label], ['Email address', f.emailAddress]];
        case 2: return [['IMAP host', f.imapHost]];
        case 3: return [['SMTP host', f.smtpHost]];
        default: return [];
    }
}
