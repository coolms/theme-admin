import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ErrorHandlerService, isElevationRefusal } from '@coolms/core-angular';
import { ElevationRequiredComponent, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { SystemMailDto } from './email.types';
import { MailboxSettingsOverPage } from './mailbox-settings-over-page.service';
import { sayOAuthReturn } from './oauth-return';

/** The state line, in words: whether system mail is going out, and why it stopped when it did. */
export function systemMailStateText(view: SystemMailDto): string {
    switch (view.state) {
        case 'sending': return 'Sending through the chosen mailbox.';
        case 'stopped': return `Stopped: ${stopReasonText(view.stopReason)}`;
        default: return 'No mailbox chosen: system mail goes out through the server\'s configured mail transport.';
    }
}

function stopReasonText(reason: string | null): string {
    switch (reason) {
        case 'mailbox-gone': return 'the mailbox no longer exists.';
        case 'mailbox-disabled': return 'the mailbox is disabled.';
        case 'mailbox-needs-reconnect': return 'the mailbox needs to be connected again.';
        default: return reason ?? 'no reason was given.';
    }
}

/** What the address asks for: the mailbox's settings, on which pane, and a sign-in's outcome to say. */
interface AskedSettings {
    readonly mailboxId: string;
    readonly pane: string | null;
    readonly oauth: string | null;
}

/** The query parameters the address asks with. */
const ASKED_PARAMS = ['mailbox', 'settings', 'oauth'] as const;

/**
 * System mail's state and Send test, under the System mail setting -- Email's guest in the settings pane
 * (`settings.pane:email.system_mail`). The state is what the form cannot show: whether system mail is going out, why it
 * stopped (the mailbox gone, disabled, or needing to be connected again), and how much is held waiting; it is read when
 * the pane opens, after the setting above is saved or reset, and after a test, from `GET /email/system-mail`.
 *
 * The setting itself is the common form's; this sends a test through the chosen mailbox, to any address given, or to
 * the signed-in administrator's own when the field is left empty: an address outside the organisation is how the
 * receiving side's SPF, DKIM and DMARC verdicts are read. The server allows a few an hour; its refusal (a malformed
 * address, or too many with when to try again) is shown in its own words, here, not only in a toast.
 *
 * The state is a read the server refuses for want of elevation: then the pane shows the Elevate button
 * (`cms-elevation-required`) instead of the refusal's words, and reads the state again once the session is elevated.
 *
 * With the state read and a mailbox chosen, Mailbox settings opens that mailbox's settings over this page, by its id
 * alone. An address that names it (`?mailbox=<id>`, with `settings=<pane>` and `oauth=<outcome>` when there are any)
 * does the same once the state is read, says the outcome of a sign-in at the provider, and is cleared of them; one
 * that names any other mailbox does nothing.
 */
@Component({
    selector: 'app-system-mail-test-pane',
    standalone: true,
    imports: [FormsModule, ElevationRequiredComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [MailboxSettingsOverPage],
    template: `
        <section class="mb-3" aria-label="Current state">
            @if (state(); as view) {
                <p class="mb-1"><strong>{{ stateText(view) }}</strong></p>
                @if (view.held > 0) {
                    <p class="mb-1">Held, waiting for the mailbox: {{ view.held }}</p>
                }
                @if (view.mailboxId; as mailboxId) {
                    <button type="button" class="cms-btn cms-btn-sm mt-1" data-test="system-mail-mailbox-settings"
                            (click)="openSettings(mailboxId)">
                        <i class="bi bi-gear"></i> Mailbox settings
                    </button>
                }
            } @else if (stateNeedsElevation()) {
                <cms-elevation-required data-test="system-mail-elevation-required"
                                        title="System mail's state needs an elevated session"
                                        (elevated)="readState()" />
            } @else if (stateUnread(); as why) {
                <p class="cms-field-hint mb-1">The state could not be read: {{ why }}</p>
            }
        </section>
        <div class="cms-card p-3 mt-3">
            <h6 class="mb-2">Send test</h6>
            <p class="cms-field-hint mb-2">
                Sends a test through the chosen mailbox, as saved. Leave the address empty to send it to your own.
            </p>
            <form class="d-flex gap-2 align-items-start" (ngSubmit)="send()">
                <input type="email" class="form-control" name="to" autocomplete="email"
                       placeholder="Your own address" aria-label="Send the test to"
                       [ngModel]="to()" (ngModelChange)="to.set($event)" [disabled]="busy()" />
                <button type="submit" class="cms-btn" [disabled]="busy()">Send test</button>
            </form>
            @if (sentTo(); as where) {
                <div class="alert alert-success mt-3 mb-0" role="status">
                    The test was sent to {{ where }}. Check that it arrived.
                </div>
            }
            @if (refusal(); as words) {
                <div class="alert alert-warning mt-3 mb-0" role="alert">{{ words }}</div>
            }
        </div>
    `,
})
export class SystemMailTestPaneComponent {
    /** The setting this pane sits under, as the settings hub passes it. */
    readonly settingKey = input<string>('');
    /** Goes up when the setting above is saved or reset (the settings hub): the state is read again then. */
    readonly revision = input<number>(0);

    readonly to = signal('');
    readonly busy = signal(false);
    readonly sentTo = signal<string | null>(null);
    readonly refusal = signal<string | null>(null);
    readonly state = signal<SystemMailDto | null>(null);
    readonly stateUnread = signal<string | null>(null);
    /** The last read was refused for want of elevation (a stamped 403), not for any other reason. */
    readonly stateNeedsElevation = signal(false);
    readonly stateText = systemMailStateText;

    private readonly email = inject(EmailService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly settings = inject(MailboxSettingsOverPage);
    private readonly toast = inject(ToastService);
    private readonly router = inject(Router);
    /** What the address asked for, until a state is read to answer it by. */
    private asked: AskedSettings | null = null;

    constructor() {
        // The address as it stands, and each one gone to while the pane is open (a notification's link).
        this.readAddress();
        this.router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
            this.readAddress();
            const view = this.state();
            if (view !== null) {
                this.answerAddress(view);
            }
        });
        // On open, and each time the setting above is saved or reset -- the moment the state changes most.
        effect(() => {
            this.revision();
            untracked(() => this.readState());
        });
    }

    /** What system mail is doing now, from the server: on open, and after a test, which can change it. */
    readState(): void {
        this.email.getSystemMail().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: view => {
                this.state.set(view);
                this.stateUnread.set(null);
                this.stateNeedsElevation.set(false);
                this.answerAddress(view);
            },
            error: (err: unknown) => {
                this.state.set(null);
                this.stateNeedsElevation.set(isElevationRefusal(err));
                this.stateUnread.set(this.errors.humanize(err));
            },
        });
    }

    /** The mailbox's settings over this page; what they changed shows in the state, read again as they close. */
    openSettings(mailboxId: string, pane: string | null = null): void {
        void this.settings.open(mailboxId, pane ?? 'general', () => this.readState());
    }

    private readAddress(): void {
        const query = this.router.parseUrl(this.router.url).queryParamMap;
        const mailboxId = query.get('mailbox');
        if (mailboxId !== null && mailboxId !== '') {
            this.asked = { mailboxId, pane: query.get('settings'), oauth: query.get('oauth') };
        }
    }

    /** Does what the address asked for, once, when it names the system mailbox; else nothing. */
    private answerAddress(view: SystemMailDto): void {
        const asked = this.asked;
        this.asked = null;
        if (asked === null || asked.mailboxId !== view.mailboxId) {
            return;
        }
        this.clearAddress();
        if (asked.oauth !== null) {
            sayOAuthReturn(asked.oauth, this.toast);
        }
        this.openSettings(asked.mailboxId, asked.pane);
    }

    /** Takes what was asked for out of the address, in place: a reload does not ask again. */
    private clearAddress(): void {
        const url = this.router.parseUrl(this.router.url);
        for (const name of ASKED_PARAMS) {
            delete url.queryParams[name];
        }
        void this.router.navigateByUrl(url, { replaceUrl: true });
    }

    send(): void {
        const to = this.to().trim();
        this.refusal.set(null);
        this.sentTo.set(null);
        this.busy.set(true);
        this.email.testSystemMail(to).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.busy.set(false);
                this.sentTo.set('' === to ? 'your own address' : to);
                this.readState();
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.refusal.set(this.errors.humanize(err));
                this.readState();
            },
        });
    }
}
