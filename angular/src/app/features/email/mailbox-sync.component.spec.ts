import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ErrorHandlerService } from '@coolms/core-angular';
import { DateTimeFormatService, ToastService } from '@coolms/ui-angular';
import { Subject, of, throwError } from 'rxjs';

import { EmailSyncFinishedEvent } from './email-live-events.service';
import { EmailService, MailboxSyncStarted } from './email.service';
import { EmailMailboxDto } from './email.types';
import { MailboxSyncComponent, SYNC_ANSWER_WAIT_MS } from './mailbox-sync.component';

const BOX: EmailMailboxDto = { id: 'mb-1', label: 'Work', lastSuccessAt: '2026-11-05T09:12:00+00:00' };
const STARTED: MailboxSyncStarted = { id: 'mb-1', syncId: 's-1', startedAt: '2026-11-05T10:00:00+00:00', repeated: false };

function frame(over: Partial<EmailSyncFinishedEvent> = {}): EmailSyncFinishedEvent {
    return { type: 'mail.sync.finished', mailboxId: 'mb-1', syncId: 's-1', outcome: 'ok', newCount: 2, finishedAt: '2026-11-05T10:00:05+00:00', ...over };
}

describe('MailboxSyncComponent', () => {
    let email: jasmine.SpyObj<EmailService>;
    let toast: jasmine.SpyObj<ToastService>;

    function make(mailbox: EmailMailboxDto | null = BOX) {
        const fixture = TestBed.createComponent(MailboxSyncComponent);
        fixture.componentRef.setInput('mailbox', mailbox);
        fixture.detectChanges();
        const finished: string[] = [];
        fixture.componentInstance.finished.subscribe(id => finished.push(id));
        const el = fixture.nativeElement as HTMLElement;
        const press = () => {
            el.querySelector<HTMLButtonElement>('[data-action=refresh]')?.click();
            fixture.detectChanges();
        };
        return { fixture, el, finished, press, sync: fixture.componentInstance };
    }

    beforeEach(() => {
        email = jasmine.createSpyObj<EmailService>('EmailService', ['syncMailbox']);
        email.syncMailbox.and.returnValue(of(STARTED));
        toast = jasmine.createSpyObj<ToastService>('ToastService', ['error']);
        TestBed.configureTestingModule({
            imports: [MailboxSyncComponent],
            providers: [
                { provide: EmailService, useValue: email },
                { provide: ToastService, useValue: toast },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'refused' } },
                { provide: DateTimeFormatService, useValue: { auto: () => '09:12' } },
            ],
        });
        jasmine.clock().install();
    });

    afterEach(() => jasmine.clock().uninstall());

    it('is a pane row: Refresh, its icon and label, and at the end when the mailbox last synced, nothing when it never has', () => {
        const { el } = make();
        const refresh = el.querySelector<HTMLButtonElement>('.cms-pane-toolbar [data-action=refresh]');
        expect(refresh?.getAttribute('aria-label')).toBe('Refresh');
        expect(refresh?.querySelector('.bi-arrow-clockwise')).not.toBeNull();
        expect(el.querySelector('.cms-pane-toolbar__status')?.textContent).toContain('Synced at 09:12');
        expect(make({ id: 'mb-1' }).el.querySelector('.cms-pane-toolbar__status')).toBeNull();
    });

    it("takes Refresh as the server's tree gives it once served, and still asks for the sync", () => {
        const { el, fixture, press } = make();
        fixture.componentRef.setInput('served', [{ id: 'refresh', label: 'Sync now', icon: 'arrow-repeat', group: 'list', overflow: 5 }]);
        fixture.detectChanges();
        const refresh = el.querySelector('[data-action=refresh]');
        expect(refresh?.getAttribute('aria-label')).toBe('Sync now');
        expect(refresh?.hasAttribute('data-pinned')).toBeFalse();
        press();
        expect(email.syncMailbox).toHaveBeenCalledOnceWith('mb-1');
    });

    it('with no mailbox open, Refresh is disabled and asks nothing', () => {
        const { el, press } = make(null);
        expect(el.querySelector('[data-action=refresh]')?.getAttribute('aria-disabled')).toBe('true');
        press();
        expect(email.syncMailbox).not.toHaveBeenCalled();
    });

    it('a press asks once, shows the state, and its frame ends it', () => {
        const { el, finished, press, sync, fixture } = make();
        press();
        expect(email.syncMailbox).toHaveBeenCalledOnceWith('mb-1');
        expect(el.querySelector('[data-test=mail-syncing]')?.textContent).toContain('Syncing this mailbox');
        expect(el.querySelector('[data-action=refresh]')?.getAttribute('aria-busy')).toBe('true');
        expect(el.querySelector('.cms-pane-toolbar__status')?.textContent).toContain('Synced at 09:12');
        press();
        expect(email.syncMailbox).toHaveBeenCalledTimes(1);

        sync.frame(frame());
        fixture.detectChanges();

        expect(el.querySelector('[data-test=mail-syncing]')?.textContent?.trim()).toBe('');
        expect(el.querySelector('[data-action=refresh]')?.hasAttribute('aria-busy')).toBeFalse();
        expect(finished).toEqual(['mb-1']);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('a frame for another sync ends nothing; one for another mailbox only has its time read', () => {
        const { finished, press, sync } = make();
        press();
        sync.frame(frame({ syncId: 'other' }));
        expect(finished).toEqual([]);
        sync.frame(frame({ mailboxId: 'other', syncId: 'elsewhere' }));
        expect(sync.syncing()).toBeTrue();
        expect(finished).toEqual(['other']);
    });

    it('back on a mailbox whose sync ended meanwhile, a press answered with that sync ends at once', () => {
        const { fixture, finished, press, sync } = make();
        press();
        fixture.componentRef.setInput('mailbox', { id: 'mb-2' });
        fixture.detectChanges();
        sync.frame(frame());
        fixture.componentRef.setInput('mailbox', BOX);
        fixture.detectChanges();
        email.syncMailbox.and.returnValue(of({ ...STARTED, repeated: true }));
        press();
        expect(sync.syncing()).toBeFalse();
        expect(finished).toEqual(['mb-1', 'mb-1']);
    });

    it('a failed sync is said; a skipped one is not an error', () => {
        const failed = make();
        failed.press();
        failed.sync.frame(frame({ outcome: 'failed' }));
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(failed.finished).toEqual(['mb-1']);

        toast.error.calls.reset();
        const skipped = make();
        skipped.press();
        skipped.sync.frame(frame({ outcome: 'skipped' }));
        expect(toast.error).not.toHaveBeenCalled();
        expect(skipped.finished).toEqual(['mb-1']);
    });

    it('a frame that arrives before the answer still ends the sync', () => {
        const answer = new Subject<MailboxSyncStarted>();
        email.syncMailbox.and.returnValue(answer);
        const { finished, press, sync } = make();
        press();
        sync.frame(frame());
        expect(sync.syncing()).toBeTrue();
        answer.next(STARTED);
        expect(sync.syncing()).toBeFalse();
        expect(finished).toEqual(['mb-1']);
    });

    it('a press answered with a sync already finished ends at once', () => {
        const { finished, fixture, press, sync } = make();
        press();
        sync.frame(frame());
        fixture.detectChanges();
        email.syncMailbox.and.returnValue(of({ ...STARTED, repeated: true }));
        press();
        expect(sync.syncing()).toBeFalse();
        expect(finished).toEqual(['mb-1', 'mb-1']);
    });

    it('with no frame the list is read after the wait, once', () => {
        const { finished, press, sync } = make();
        press();
        jasmine.clock().tick(SYNC_ANSWER_WAIT_MS - 1);
        expect(sync.syncing()).toBeTrue();
        jasmine.clock().tick(1);
        expect(sync.syncing()).toBeFalse();
        expect(finished).toEqual(['mb-1']);
        jasmine.clock().tick(SYNC_ANSWER_WAIT_MS);
        expect(finished).toEqual(['mb-1']);
    });

    it('a frame later than the wait still ends its sync, and says a failure', () => {
        const { finished, press, sync } = make();
        press();
        jasmine.clock().tick(SYNC_ANSWER_WAIT_MS);
        expect(finished).toEqual(['mb-1']);

        sync.frame(frame({ outcome: 'failed' }));

        expect(finished).toEqual(['mb-1', 'mb-1']);
        expect(toast.error).toHaveBeenCalledTimes(1);
        sync.frame(frame({ outcome: 'failed' }));
        expect(finished).toEqual(['mb-1', 'mb-1']);
    });

    it('a late frame of the sync before does not end a new press whose answer is on the way', () => {
        const answer = new Subject<MailboxSyncStarted>();
        const { fixture, finished, press, sync } = make();
        press();
        jasmine.clock().tick(SYNC_ANSWER_WAIT_MS);
        fixture.detectChanges();
        email.syncMailbox.and.returnValue(answer);
        press();

        sync.frame(frame());
        expect(sync.syncing()).toBeTrue();

        answer.next({ ...STARTED, syncId: 's-2' });
        sync.frame(frame({ syncId: 's-2' }));
        expect(sync.syncing()).toBeFalse();
        expect(finished).toEqual(['mb-1', 'mb-1']);
    });

    it('an answer to a press left behind changes nothing for the mailbox open now', () => {
        const first = new Subject<MailboxSyncStarted>();
        const second = new Subject<MailboxSyncStarted>();
        email.syncMailbox.and.returnValues(first, second);
        const { fixture, finished, press, sync } = make();
        press();
        fixture.componentRef.setInput('mailbox', { id: 'mb-2' });
        fixture.detectChanges();
        press();
        expect(sync.syncing()).toBeTrue();

        first.error(new HttpErrorResponse({ status: 409 }));
        expect(sync.syncing()).toBeTrue();
        expect(toast.error).not.toHaveBeenCalled();

        second.next({ ...STARTED, id: 'mb-2', syncId: 's-2' });
        sync.frame(frame({ mailboxId: 'mb-2', syncId: 's-2' }));
        expect(sync.syncing()).toBeFalse();
        expect(finished).toEqual(['mb-2']);
    });

    it('an answer arriving after the sync was left behind sets no wait', () => {
        const answer = new Subject<MailboxSyncStarted>();
        email.syncMailbox.and.returnValue(answer);
        const { fixture, finished, press } = make();
        press();
        fixture.componentRef.setInput('mailbox', { id: 'mb-2' });
        fixture.detectChanges();
        answer.next(STARTED);
        jasmine.clock().tick(SYNC_ANSWER_WAIT_MS);
        expect(finished).toEqual([]);
    });

    it('a refusal is said in the server\'s words, and the button comes back', () => {
        email.syncMailbox.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
        const { press, sync, finished } = make();
        press();
        expect(toast.error).toHaveBeenCalledOnceWith('refused');
        expect(sync.syncing()).toBeFalse();
        expect(finished).toEqual([]);
    });

    it('another mailbox opening leaves the sync behind', () => {
        const { fixture, finished, press, sync } = make();
        press();
        fixture.componentRef.setInput('mailbox', { id: 'mb-2' });
        fixture.detectChanges();
        expect(sync.syncing()).toBeFalse();
        jasmine.clock().tick(SYNC_ANSWER_WAIT_MS);
        expect(finished).toEqual([]);
        sync.frame(frame());
        expect(finished).toEqual(['mb-1']);
        expect(sync.syncing()).toBeFalse();
    });
});
