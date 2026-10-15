import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { type CapabilityState, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto, MailboxWriteRequest } from './email.types';
import { afterAccess, rebaseDraft, saveFailed } from './mailbox-section-save';

/**
 * A mailbox's own name and address, saved on their own at the version they were read, sending only what changed --
 * the section the wizard's first step was for an existing mailbox.
 */
@Component({
    selector: 'app-mailbox-details-section',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="mbs-section" aria-labelledby="mbs-details-title">
            <header class="mbs-section__head">
                <h2 id="mbs-details-title" class="mbs-section__title">Mailbox</h2>
            </header>
            <fieldset class="mbs-fields" [disabled]="access() === 'denied' || saving()">
                <div class="mbs-group">
                    <label class="mbs-field mbs-field--wide">
                        <span>Name</span>
                        <input type="text" name="label" [ngModel]="label()" (ngModelChange)="label.set($event)" />
                    </label>
                    <label class="mbs-field mbs-field--wide">
                        <span>Address</span>
                        <input type="email" name="emailAddress" [ngModel]="address()" (ngModelChange)="address.set($event)" />
                    </label>
                </div>
            </fieldset>
            @if (access() !== 'denied' && versioned()) {
                <footer class="mbs-section__foot">
                    <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm" [disabled]="!dirty() || saving()" (click)="discard()">
                        Discard
                    </button>
                    <button type="button" class="cms-btn cms-btn-primary cms-btn-sm" [disabled]="!dirty() || saving()" (click)="save()">
                        @if (access() === 'elevate') { <i class="bi bi-lock"></i> }
                        Save
                    </button>
                </footer>
            }
        </section>
    `,
    styleUrl: './mailbox-section.css',
})
export class MailboxDetailsSectionComponent {
    readonly mailbox = input.required<EmailMailboxDto>();
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
