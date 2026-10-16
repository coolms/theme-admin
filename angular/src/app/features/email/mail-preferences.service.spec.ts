import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';

import { MAIL_PREFERENCE_DEFAULTS, MailPreferencesChangedError, MailPreferencesService } from './mail-preferences.service';

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
            { defaultMailboxId: 'mb-1', remoteImages: 'allow', notifyNewMail: false },
            { headers: { ETag: '"s1"' } },
        );

        expect(read).toEqual({ prefs: { defaultMailboxId: 'mb-1', remoteImages: 'allow', notifyNewMail: false }, version: 's1' });
        expect(prefs.current().remoteImages).toBe('allow');
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
    });
});
