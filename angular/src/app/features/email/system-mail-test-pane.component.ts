import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ErrorHandlerService } from '@coolms/core-angular';

import { EmailService } from './email.service';
import { SystemMailDto } from './email.types';

/** The state line, in words: whether system mail is going out, and why it stopped when it did. */
export function systemMailStateText(view: SystemMailDto): string {
    switch (view.state) {
        case 'sending': return 'Sending through the chosen mailbox.';
        case 'stopped': return `Stopped: ${stopReasonText(view.stopReason)}`;
        default: return 'No mailbox chosen: system mail is not going out.';
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

/**
 * System mail's state and Send test, under the System mail setting -- Email's guest in the settings pane
 * (`settings.pane:email.system_mail`). The state is what the form cannot show: whether system mail is going out, why it
 * stopped (the mailbox gone, disabled, or needing to be connected again), and how much is held waiting; it is read when
 * the pane opens and again after a test, from `GET /email/system-mail`.
 *
 * The setting itself is the common form's; this sends a test through the chosen mailbox, to any address given, or to
 * the signed-in administrator's own when the field is left empty: an address outside the organisation is how the
 * receiving side's SPF, DKIM and DMARC verdicts are read. The server allows a few an hour; its refusal (a malformed
 * address, or too many with when to try again) is shown in its own words, here, not only in a toast.
 */
@Component({
    selector: 'app-system-mail-test-pane',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="mb-3" aria-label="Current state">
            @if (state(); as view) {
                <p class="mb-1"><strong>{{ stateText(view) }}</strong></p>
                @if (view.held > 0) {
                    <p class="mb-1">Held, waiting for the mailbox: {{ view.held }}</p>
                }
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
export class SystemMailTestPaneComponent implements OnInit {
    /** The setting this pane sits under, as the settings hub passes it. */
    readonly settingKey = input<string>('');

    readonly to = signal('');
    readonly busy = signal(false);
    readonly sentTo = signal<string | null>(null);
    readonly refusal = signal<string | null>(null);
    readonly state = signal<SystemMailDto | null>(null);
    readonly stateUnread = signal<string | null>(null);
    readonly stateText = systemMailStateText;

    private readonly email = inject(EmailService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    ngOnInit(): void {
        this.readState();
    }

    /** What system mail is doing now, from the server: on open, and after a test, which can change it. */
    readState(): void {
        this.email.getSystemMail().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: view => {
                this.state.set(view);
                this.stateUnread.set(null);
            },
            error: (err: unknown) => {
                this.state.set(null);
                this.stateUnread.set(this.errors.humanize(err));
            },
        });
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
