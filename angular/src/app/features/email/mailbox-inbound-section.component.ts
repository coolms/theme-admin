import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { type CapabilityState, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto, InboundWorkflowOption } from './email.types';
import { afterAccess, saveFailed } from './mailbox-section-save';

/**
 * What starts when a first-contact email reaches the mailbox: one deployed workflow, or none. Saved on its own at
 * the version it was read; "None" clears the trigger. Until a mailbox's rules exist this is their one rule.
 */
@Component({
    selector: 'app-mailbox-inbound-section',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="mbs-section" aria-labelledby="mbs-inbound-title">
            <header class="mbs-section__head">
                <h2 id="mbs-inbound-title" class="mbs-section__title">When mail arrives</h2>
            </header>
            <fieldset class="mbs-fields" [disabled]="access() === 'denied' || saving()">
                <div class="mbs-group">
                    <label class="mbs-field mbs-field--wide">
                        <span>Start a workflow for a first-contact email</span>
                        <select name="inboundWorkflowKey" [ngModel]="key()" (ngModelChange)="key.set($event)">
                            <option value="">None</option>
                            @for (o of options(); track o.key) { <option [value]="o.key">{{ o.label }}</option> }
                            @if (unlisted()) { <option [value]="key()">{{ key() }} (not deployed)</option> }
                        </select>
                    </label>
                    <p class="mbs-note">Replies to a conversation the workflow started feed that conversation.</p>
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
export class MailboxInboundSectionComponent implements OnInit {
    readonly mailbox = input.required<EmailMailboxDto>();
    readonly access = input<CapabilityState>('denied');
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
    readonly dirty = computed(() => this.key() !== this.stored());
    /** A stored key no deployed workflow answers to is still shown, so a save never drops it unseen. */
    readonly unlisted = computed(() => this.key() !== '' && !this.options().some(o => o.key === this.key()));
    readonly versioned = computed(() => {
        const version = this.mailbox().version;
        return version !== null && version !== undefined && version !== '';
    });

    constructor() {
        effect(() => this.key.set(this.stored()));
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
