import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { type CapabilityState, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto, InboundWorkflowOption } from './email.types';
import { NO_MAILBOX, afterAccess, rebaseDraft, saveFailed } from './mailbox-section-save';

/**
 * Rules: what a mailbox does with mail as it arrives. Starting a workflow is a rule's action -- today the one rule, on
 * a first-contact email: one deployed workflow, or none. Saved on its own at the version it was read; "None" clears
 * it.
 */
@Component({
    selector: 'app-mailbox-inbound-section',
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
            <label class="d-block">
                <span class="cms-label">When a first-contact email arrives: start workflow</span>
                <select class="cms-select w-100" name="inboundWorkflowKey" [ngModel]="key()" (ngModelChange)="key.set($event)">
                    <option value="">None</option>
                    @for (o of options(); track o.key) { <option [value]="o.key">{{ o.label }}</option> }
                    @if (unlisted()) { <option [value]="key()">{{ key() }} (not deployed)</option> }
                </select>
            </label>
            <p class="cms-field-hint">Replies to a conversation the workflow started feed that conversation.</p>
        </fieldset>
    `,
})
export class MailboxInboundSectionComponent implements OnInit {
    readonly mailbox = input<EmailMailboxDto>(NO_MAILBOX);
    readonly access = input<CapabilityState>('denied');
    /** Changes on every Reload of the page: the choice starts over from the read. */
    readonly reset = input(0);
    readonly saved = output<EmailMailboxDto>();
    readonly reload = output<void>();

    private readonly email = inject(EmailService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly elevation = inject(ElevationService);
    private readonly destroyRef = inject(DestroyRef);

    readonly options = signal<InboundWorkflowOption[]>([]);
    readonly key = signal('');
    readonly saving = signal(false);
    readonly stored = computed(() => this.mailbox().inboundWorkflowKey ?? '');
    /** Whether this pane can be saved at all: the caller may change it, and it was read with a version. */
    readonly editable = computed(() => this.access() !== 'denied' && this.versioned());
    readonly dirty = computed(() => this.key() !== this.stored());
    /** A stored key no deployed workflow answers to is still shown, so a save never drops it unseen. */
    readonly unlisted = computed(() => this.key() !== '' && !this.options().some(o => o.key === this.key()));
    readonly versioned = computed(() => {
        const version = this.mailbox().version;
        return version !== null && version !== undefined && version !== '';
    });

    /** The read the choice was last laid over, and the reload it was taken at. */
    private read: string | null = null;
    private readAtReset = -1;

    constructor() {
        // The first read and every Reload start the choice over; any other new read keeps a choice made here and
        // not saved (rebaseDraft), so another section's save never discards it.
        effect(() => {
            const next = this.stored();
            const reset = this.reset();
            untracked(() => {
                const kept = this.read === null || reset !== this.readAtReset
                    ? next
                    : rebaseDraft({ key: this.read }, { key: this.key() }, { key: next }).key;
                this.key.set(kept);
                this.read = next;
                this.readAtReset = reset;
            });
        });
    }

    ngOnInit(): void {
        this.email.listInboundWorkflowOptions().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: options => this.options.set(options),
            error: () => this.options.set([]),
        });
    }

    discard(): void {
        this.key.set(this.stored());
    }

    save(): void {
        afterAccess(this.access(), this.elevation, () => {
            const mailbox = this.mailbox();
            this.saving.set(true);
            // An empty key clears the trigger on the server.
            this.email.saveMailboxSection(mailbox.id, { inboundWorkflowKey: this.key() }, mailbox.version)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: answer => {
                        this.saving.set(false);
                        this.toast.success('Saved');
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
