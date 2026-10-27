import { type MailboxDraftRequest } from './email.types';
import {
    draftRequestFromForm,
    type MailboxWizardForm,
    requiredOnStep,
    usernameFieldsEditable,
    usernamesForCreate,
} from './mailbox-wizard.util';

/**
 * The wizard used to create a pending OAuth row and then ask for consent, and it
 * showed a username field to everyone. Now the OAuth path creates nothing until
 * the grant proves, and the username is the address unless an administrator says
 * otherwise. These are the rules, pinned where the component cannot bend them.
 */
describe('mailbox wizard rules', () => {
    const form = (over: Partial<MailboxWizardForm> = {}): MailboxWizardForm => ({
        label: ' Support ',
        emailAddress: ' support@example.com ',
        imapHost: ' imap.gmail.com ',
        imapPort: 993,
        imapSecurity: 'ssl',
        imapUsername: '',
        smtpHost: ' smtp.gmail.com ',
        smtpPort: 465,
        smtpSecurity: 'ssl',
        smtpUsername: '',
        authMethod: 'oauth',
        oauthProvider: 'google',
        kind: 'personal',
        ...over,
    });

    describe('username fields', () => {
        it('are never shown on an OAuth create -- the address is the login', () => {
            expect(usernameFieldsEditable('oauth', true)).toBeFalse();
            expect(usernameFieldsEditable('oauth', false)).toBeFalse();
        });

        it('are shown on a password create only to an administrator', () => {
            expect(usernameFieldsEditable('password', true)).toBeTrue();
            expect(usernameFieldsEditable('password', false)).toBeFalse();
        });
    });

    describe('usernames on a password create', () => {
        it('are not sent by a non-administrator at all, whatever was typed', () => {
            expect(usernamesForCreate(false, 'alias@example.com', 'other@example.com')).toEqual({});
        });

        it('are sent by an administrator only where an alias was typed, trimmed', () => {
            expect(usernamesForCreate(true, ' alias@example.com ', '')).toEqual({ imapUsername: 'alias@example.com' });
            expect(usernamesForCreate(true, '', '  ')).toEqual({});
        });
    });

    describe('the connect draft', () => {
        it('carries the intended mailbox and no username key of any kind', () => {
            const req = draftRequestFromForm(form({ imapUsername: 'leak@example.com', smtpUsername: 'leak@example.com' }));

            const expected: MailboxDraftRequest = {
                label: 'Support',
                emailAddress: 'support@example.com',
                oauthProvider: 'google',
                kind: 'personal',
                imapHost: 'imap.gmail.com',
                imapPort: 993,
                imapSecurity: 'ssl',
                smtpHost: 'smtp.gmail.com',
                smtpPort: 465,
                smtpSecurity: 'ssl',
            };
            expect(req).toEqual(expected);
            expect('imapUsername' in req).toBeFalse();
            expect('smtpUsername' in req).toBeFalse();
            expect('password' in req).toBeFalse();
        });

        it('says whose the mailbox is: the organisation\'s when chosen, which is the one that may send system mail', () => {
            expect(draftRequestFromForm(form({ kind: 'shared' })).kind).toBe('shared');
            expect(draftRequestFromForm(form()).kind).toBe('personal');
        });

        it('defaults the provider to google when the form has none', () => {
            expect(draftRequestFromForm(form({ oauthProvider: '' })).oauthProvider).toBe('google');
        });
    });

    describe('required fields by step', () => {
        it('never asks for a username on any step', () => {
            const f = form({ authMethod: 'password' });
            const labels = [1, 2, 3, 4].flatMap(s => requiredOnStep(s, f).map(([label]) => label));

            expect(labels).toEqual(['Label', 'Email address', 'IMAP host', 'SMTP host']);
        });

        it('names the first blank of the step, by label', () => {
            const blank = requiredOnStep(1, form({ emailAddress: '  ' })).find(([, v]) => v.trim() === '');

            expect(blank?.[0]).toBe('Email address');
        });
    });
});
