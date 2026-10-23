import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { type CapabilityState, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto, MailboxWriteRequest } from './email.types';
import { NO_MAILBOX, afterAccess, rebaseDraft, saveFailed } from './mailbox-section-save';

/**
 * General: a mailbox's own name and address, saved on their own at the version they were read, sending only what
 * changed -- the section the wizard's first step was for an existing mailbox.
 */
@Component({
    selector: 'app-mailbox-details-section',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (access() === 'denied') {
            <p class="cms-field-hint mb-3">Only the mailbox's owners can change these settings.</p>
        } @else if (!versioned()) {
            <p class="cms-field-hint mb-3">These settings were read without a version, so they cannot be saved here.</p>
        }
        <fieldset class="border-0 p-0 m-0" [disabled]="access() === 'denied' || saving()">
            <div class="row g-3">
                <label class="col-12 col-md-6">
                    <span class="cms-label">Name</span>
                    <input type="text" class="cms-input w-100" name="label" [ngModel]="label()" (ngModelChange)="label.set($event)" />
                </label>
                <label class="col-12 col-md-6">
                    <span class="cms-label">Address</span>
                    <input type="email" class="cms-input w-100" name="emailAddress" [ngModel]="address()" (ngModelChange)="address.set($event)" />
                </label>
            </div>
        </fieldset>
    `,
})
export class MailboxDetailsSectionComponent {
    readonly mailbox = input<EmailMailboxDto>(NO_MAILBOX);
    readonly access = input<CapabilityState>('denied');
    /** Changes on every Reload of the page: the fields start over from the read. */
    readonly reset = input(0);
    readonly saved = output<EmailMailboxDto>();
    readonly reload = output<void>();

    private readonly email = inject(EmailService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly elevation = inject(ElevationService);
    private readonly destroyRef = inject(DestroyRef);

    readonly label = signal('');
    readonly address = signal('');
    readonly saving = signal(false);
    readonly versioned = computed(() => {
        const version = this.mailbox().version;
        return version !== null && version !== undefined && version !== '';
    });
    readonly patch = computed<MailboxWriteRequest>(() => {
        const patch: MailboxWriteRequest = {};
        if (this.label() !== (this.mailbox().label ?? '')) {
            patch.label = this.label();
        }
        if (this.address() !== (this.mailbox().emailAddress ?? '')) {
            patch.emailAddress = this.address();
        }
        return patch;
    });
    /** Whether this pane can be saved at all: the caller may change it, and it was read with a version. */
    readonly editable = computed(() => this.access() !== 'denied' && this.versioned());
    readonly dirty = computed(() => Object.keys(this.patch()).length > 0);

    /** The read the fields were last laid over, and the reload it was taken at. */
    private read: EmailMailboxDto | null = null;
    private readAtReset = -1;

    constructor() {
        // The first read and every Reload start the fields over; any other new read keeps what was typed here and
        // not saved (rebaseDraft), so another section's save never discards it.
        effect(() => {
            const next = this.mailbox();
            const reset = this.reset();
            untracked(() => {
                const fresh = { label: next.label ?? '', address: next.emailAddress ?? '' };
                const kept = this.read === null || reset !== this.readAtReset
                    ? fresh
                    : rebaseDraft(
                        { label: this.read.label ?? '', address: this.read.emailAddress ?? '' },
                        { label: this.label(), address: this.address() },
                        fresh,
                    );
                this.label.set(kept.label);
                this.address.set(kept.address);
                this.read = next;
                this.readAtReset = reset;
            });
        });
    }

    discard(): void {
        this.label.set(this.mailbox().label ?? '');
        this.address.set(this.mailbox().emailAddress ?? '');
    }

    save(): void {
        afterAccess(this.access(), this.elevation, () => {
            const mailbox = this.mailbox();
            this.saving.set(true);
            this.email.saveMailboxSection(mailbox.id, this.patch(), mailbox.version)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: answer => {
                        this.saving.set(false);
                        this.toast.success('Mailbox saved');
                        this.saved.emit(answer);
                    },
                    error: (err: unknown) => {
                        this.saving.set(false);
                        saveFailed(err, this.toast, this.errors, () => this.reload.emit());
                    },
                });
        });
    }
}
