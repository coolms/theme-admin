import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, type TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { BACKGROUND_REQUEST } from '@coolms/core-angular';

import {
    LAST_MAILBOX_SAVE_DELAY_MS, MAIL_PREFERENCE_DEFAULTS, MailPreferencesChangedError, MailPreferencesService, type MailPreferences,
    preferencesUnread,
} from './mail-preferences.service';

/**
 * The profile section `mail`, read with its version and saved naming it: a save sends If-Match with the version read
 * (merge-patch), a section saved since is refused (412) and said, a read without a version is never saved over, and
 * the answer -- what stood -- becomes the section as known.
 */
describe('MailPreferencesService -- the mail section, read with its version and saved naming it', () => {
    const URL = '/api/v1/auth/me/settings/mail';
    let http: HttpTestingController;
    let prefs: MailPreferencesService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        prefs = TestBed.inject(MailPreferencesService);
    });

    afterEach(() => http.verify());

    it('reads the section and its version from one answer, and keeps it as the section known', () => {
        let read: unknown;
        prefs.read().subscribe(r => (read = r));
        http.expectOne(URL).flush(
            {
                defaultMailboxId: 'mb-1', remoteImages: 'inherit', notifyNewMail: false,
                remoteImagesEffective: 'allow', remoteImagesInstallation: 'allow',
            },
            { headers: { ETag: '"s1"' } },
        );

        expect(read).toEqual({
            prefs: {
                defaultMailboxId: 'mb-1', remoteImages: 'inherit', notifyNewMail: false,
                remoteImagesEffective: 'allow', remoteImagesInstallation: 'allow',
            },
            version: 's1',
        });
        expect(prefs.current().remoteImagesEffective).toBe('allow');
    });

    it('a save sends only what is given, merge-patch, naming the version read; the answer is what stood', () => {
        let saved: unknown;
        prefs.save({ defaultMailboxId: 'mb-2' }, 's1').subscribe(r => (saved = r));
        const req = http.expectOne(URL);
        expect(req.request.method).toBe('PATCH');
        expect(req.request.headers.get('If-Match')).toBe('"s1"');
        expect(req.request.headers.get('Content-Type')).toBe('application/merge-patch+json');
        expect(req.request.body).toEqual({ defaultMailboxId: 'mb-2' });
        req.flush({ defaultMailboxId: null, remoteImages: 'inherit', notifyNewMail: true }, { headers: { ETag: '"s2"' } });

        expect(saved).toEqual({ prefs: MAIL_PREFERENCE_DEFAULTS, version: 's2' });
    });

    it('reads a missing or unknown resolved rule as blocked, and an unknown installation rule as none', () => {
        let read: { prefs: MailPreferences } | undefined;
        prefs.read().subscribe(r => (read = r));
        http.expectOne(URL).flush(
            { remoteImages: 'inherit', remoteImagesInstallation: 'sometimes' },
            { headers: { ETag: '"s1"' } },
        );

        expect(read?.prefs.remoteImagesEffective).toBe('block');
        expect(read?.prefs.remoteImagesInstallation).toBeNull();
    });

    it('never sends the server\'s read-only rules on a save', () => {
        prefs.save({ remoteImages: 'allow', remoteImagesEffective: 'allow', remoteImagesInstallation: 'allow' }, 's1')
            .subscribe();
        const req = http.expectOne(URL);
        expect(req.request.body).toEqual({ remoteImages: 'allow' });
        req.flush({}, { headers: { ETag: '"s2"' } });
    });

    it('a section saved since is refused (412) as changed elsewhere; nothing is sent again', () => {
        let failed: unknown;
        prefs.save({ remoteImages: 'block' }, 's1').subscribe({ error: e => (failed = e) });
        http.expectOne(URL).flush({ title: 'Precondition Failed' }, { status: 412, statusText: 'Precondition Failed' });

        expect(failed instanceof MailPreferencesChangedError).toBeTrue();
        http.expectNone(URL);
    });

    it('a section read without a version is never saved over', () => {
        let failed: unknown;
        prefs.save({ remoteImages: 'block' }, null).subscribe({ error: e => (failed = e) });

        http.expectNone(URL);
        expect(failed instanceof MailPreferencesChangedError).toBeTrue();
    });

    it('for a reader that only needs it, a section that cannot be read is its defaults', () => {
        let got: unknown;
        prefs.readOrDefaults().subscribe(p => (got = p));
        http.expectOne(URL).flush({ title: 'Server Error' }, { status: 500, statusText: 'Server Error' });

        expect(got).toEqual(MAIL_PREFERENCE_DEFAULTS);
        expect(preferencesUnread(got as MailPreferences)).withContext('said as not read').toBeTrue();
    });

    it('a section read is never taken for one not read, its defaults included', () => {
        let got: MailPreferences | undefined;
        prefs.readOrDefaults().subscribe(p => (got = p));
        http.expectOne(URL).flush({ defaultMailboxId: null, remoteImages: 'inherit', notifyNewMail: true }, { headers: { ETag: '"s1"' } });
        expect(got).toEqual(MAIL_PREFERENCE_DEFAULTS);
        expect(preferencesUnread(got!)).toBeFalse();
    });

    it('reads the last mailbox the section keeps; none, or one read back as null, is absent', () => {
        const lastOf = (body: object): string | undefined => {
            let read: { prefs: MailPreferences } | undefined;
            prefs.read().subscribe(r => (read = r));
            http.expectOne(URL).flush(body, { headers: { ETag: '"s1"' } });
            return read?.prefs.lastMailboxId;
        };
        expect(lastOf({ lastMailboxId: 'mb-3' })).toBe('mb-3');
        expect(lastOf({ lastMailboxId: null })).toBeUndefined();
        expect(lastOf({})).toBeUndefined();
    });

    describe('the last mailbox saved', () => {
        /** The read just before a save, answered at this version. */
        const answerRead = (version: string): void => {
            const req = http.expectOne(r => r.method === 'GET' && r.url === URL);
            expect(req.request.context.get(BACKGROUND_REQUEST)).withContext('a read on the way').toBeTrue();
            req.flush({ defaultMailboxId: 'mb-1', remoteImages: 'allow', notifyNewMail: false, lastMailboxId: 'mb-0' }, { headers: { ETag: `"${version}"` } });
        };
        const nextSave = (): TestRequest => http.expectOne(r => r.method === 'PATCH' && r.url === URL);

        it('a run of choices saves the last of them once, a second after it: that key alone, naming the version read', fakeAsync(() => {
            prefs.rememberLastMailbox('mb-1');
            tick(600);
            prefs.rememberLastMailbox('mb-2');
            tick(LAST_MAILBOX_SAVE_DELAY_MS - 1);
            http.expectNone(URL);
            tick(1);
            answerRead('v7');
            const save = nextSave();
            expect(save.request.body).toEqual({ lastMailboxId: 'mb-2' });
            expect(save.request.headers.get('If-Match')).toBe('"v7"');
            expect(save.request.headers.get('Content-Type')).toBe('application/merge-patch+json');
            expect(save.request.context.get(BACKGROUND_REQUEST)).withContext('saved on the way: no dialog').toBeTrue();
            save.flush({ lastMailboxId: 'mb-2' }, { headers: { ETag: '"v8"' } });
            tick(LAST_MAILBOX_SAVE_DELAY_MS * 2);
            http.expectNone(URL);
        }));

        it('a mailbox the server refuses is dropped, no error, and the next choice is saved as ever', fakeAsync(() => {
            prefs.rememberLastMailbox('mb-gone');
            tick(LAST_MAILBOX_SAVE_DELAY_MS);
            answerRead('v1');
            nextSave().flush({ title: 'Refused' }, { status: 422, statusText: 'Unprocessable Entity' });
            tick(LAST_MAILBOX_SAVE_DELAY_MS);
            http.expectNone(URL);

            prefs.rememberLastMailbox('mb-2');
            tick(LAST_MAILBOX_SAVE_DELAY_MS);
            answerRead('v1');
            const save = nextSave();
            expect(save.request.body).toEqual({ lastMailboxId: 'mb-2' });
            save.flush({ lastMailboxId: 'mb-2' }, { headers: { ETag: '"v2"' } });
        }));

        it('a section saved in between is read again and saved over once', fakeAsync(() => {
            prefs.rememberLastMailbox('mb-2');
            tick(LAST_MAILBOX_SAVE_DELAY_MS);
            answerRead('v1');
            nextSave().flush({ title: 'Precondition Failed' }, { status: 412, statusText: 'Precondition Failed' });
            answerRead('v2');
            const again = nextSave();
            expect(again.request.headers.get('If-Match')).toBe('"v2"');
            expect(again.request.body).toEqual({ lastMailboxId: 'mb-2' });
            again.flush({ lastMailboxId: 'mb-2' }, { headers: { ETag: '"v3"' } });
            tick(LAST_MAILBOX_SAVE_DELAY_MS);
        }));
    });
});
