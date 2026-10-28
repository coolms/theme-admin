import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ErrorHandlerService } from '@coolms/core-angular';

import { EmailService } from './email.service';

/**
 * Send test, under the System mail setting -- Email's guest in the settings pane (`settings.pane:email.system_mail`).
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

    readonly to = signal('');
    readonly busy = signal(false);
    readonly sentTo = signal<string | null>(null);
    readonly refusal = signal<string | null>(null);

    private readonly email = inject(EmailService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    send(): void {
        const to = this.to().trim();
        this.refusal.set(null);
        this.sentTo.set(null);
        this.busy.set(true);
        this.email.testSystemMail(to).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.busy.set(false);
                this.sentTo.set('' === to ? 'your own address' : to);
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.refusal.set(this.errors.humanize(err));
            },
        });
    }
}
