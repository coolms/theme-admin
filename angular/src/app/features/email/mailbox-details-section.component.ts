import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { type CapabilityState, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto, MailboxKind, MailboxWriteRequest } from './email.types';
import { NO_MAILBOX, afterAccess, rebaseDraft, saveFailed } from './mailbox-section-save';

/** A mailbox's kind as read: `personal` when the read has none, as the server defaults it. */
export function kindOf(mailbox: EmailMailboxDto): MailboxKind {
    return mailbox.kind === 'shared' ? 'shared' : 'personal';
}

/**
 * General: a mailbox's own name, address and whose it is, saved on their own at the version they were read, sending
 * only what changed -- the section the wizard's first step was for an existing mailbox. Making a mailbox shared is how
 * one connected as a person's own is handed to the organisation, before that person's account is deleted.
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
                <label class="col-12 col-md-6">
                    <span class="cms-label">Whose mailbox</span>
                    <select class="cms-input w-100" name="kind" [ngModel]="kind()" (ngModelChange)="kind.set($event)">
                        <option value="personal">Personal (its owner's)</option>
                        <option value="shared">Shared (the organisation's)</option>
                    </select>
                    <small class="cms-field-hint">
                        When the account that connected it is deleted, a personal mailbox stops with it; a shared one
                        is kept, to be connected again. Only a shared mailbox can send the system's mail.
                    </small>
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
    readonly kind = signal<MailboxKind>('personal');
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
        if (this.kind() !== kindOf(this.mailbox())) {
            patch.kind = this.kind();
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
                const fresh = { label: next.label ?? '', address: next.emailAddress ?? '', kind: kindOf(next) };
                const kept = this.read === null || reset !== this.readAtReset
                    ? fresh
                    : rebaseDraft(
                        { label: this.read.label ?? '', address: this.read.emailAddress ?? '', kind: kindOf(this.read) },
                        { label: this.label(), address: this.address(), kind: this.kind() },
                        fresh,
                    );
                this.label.set(kept.label);
                this.address.set(kept.address);
                this.kind.set(kept.kind);
                this.read = next;
                this.readAtReset = reset;
            });
        });
    }

    discard(): void {
        this.label.set(this.mailbox().label ?? '');
        this.address.set(this.mailbox().emailAddress ?? '');
        this.kind.set(kindOf(this.mailbox()));
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
