import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { type Observable, forkJoin } from 'rxjs';
import { ElevationService, ErrorHandlerService, isElevationRefusal } from '@coolms/core-angular';
import { CmsPageHeaderComponent, ConfirmDialogService, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import type { EmailMailboxDto, SystemMailDto } from './email.types';
import { systemMailCandidates, systemMailChoice, systemMailStateText } from './system-mail.util';

/**
 * System mail: the mailbox the platform's own mail (sign-in codes, resets, invitations, notices) goes out through,
 * and its From. Over `/api/v1/email/system-mail`, every route of it an elevated administrator's.
 *
 * A read refused for want of elevation shows "needs an elevated session" here with an Elevate button: the
 * interceptor asks only for a person's writes. Save, Clear and Send test are writes, so the prompt opens on them
 * where it is needed. Every refusal is shown in the server's words, on the page and not only in a toast, because
 * what to do next is in them.
 */
@Component({
    selector: 'app-system-mail-page',
    standalone: true,
    imports: [FormsModule, CmsPageHeaderComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <cms-page-header title="System mail" icon="send" subtitle="The mailbox the platform's own mail goes out through" />
        <div class="p-3" style="max-width: 48rem">
            <p class="cms-field-hint mb-3">
                Only marked platform mail uses this mailbox, and only once system mail is switched on for this entry.
            </p>

            @if (loadError(); as failure) {
                <div class="alert alert-warning d-flex align-items-center gap-3" role="alert">
                    <span class="flex-grow-1">{{ failure.message }}</span>
                    @if (failure.elevation) {
                        <button type="button" class="cms-btn cms-btn-primary cms-btn-sm" (click)="elevateAndLoad()">Elevate</button>
                    } @else {
                        <button type="button" class="cms-btn cms-btn-sm" (click)="load()">Reload</button>
                    }
                </div>
            } @else if (view(); as current) {
                <section class="mb-4" aria-label="Current state">
                    <p class="mb-1"><strong>{{ stateText() }}</strong></p>
                    @if (current.mailboxId) {
                        <p class="mb-1">Mailbox: {{ mailboxName(current.mailboxId) }}</p>
                        <p class="mb-1">From: {{ fromLine() }}</p>
                    }
                    @if (current.held > 0) {
                        <p class="mb-1">Held, waiting for the mailbox: {{ current.held }}</p>
                    }
                </section>

                <fieldset class="border-0 p-0 m-0" [disabled]="busy()">
                    <div class="row g-3">
                        <label class="col-12 col-md-6">
                            <span class="cms-label">Mailbox</span>
                            <select class="cms-input w-100" name="mailbox" [ngModel]="mailboxId()" (ngModelChange)="pickMailbox($event)">
                                <option value="">Choose a shared mailbox</option>
                                @for (m of candidates(); track m.id) {
                                    <option [value]="m.id">{{ m.label || m.emailAddress }}{{ m.label && m.emailAddress ? ' (' + m.emailAddress + ')' : '' }}</option>
                                }
                            </select>
                            @if (candidates().length === 0) {
                                <small class="cms-field-hint">No mailbox is shared and enabled. Connect one as Shared (the organisation's) first.</small>
                            }
                        </label>
                        <label class="col-12 col-md-6">
                            <span class="cms-label">From</span>
                            <select class="cms-input w-100" name="fromAddress" [ngModel]="fromAddress()" (ngModelChange)="fromAddress.set($event)"
                                    [disabled]="addresses().length === 0">
                                @for (a of addresses(); track a) {
                                    <option [value]="a">{{ a }}</option>
                                }
                            </select>
                            @if (unreadable(); as why) {
                                <small class="cms-field-hint">Only the mailbox's own address is offered: {{ why }}</small>
                            }
                        </label>
                        <label class="col-12 col-md-6">
                            <span class="cms-label">Display name (optional)</span>
                            <input type="text" class="cms-input w-100" name="fromName" [ngModel]="fromName()" (ngModelChange)="fromName.set($event)"
                                   placeholder="Blank keeps the configured name" />
                        </label>
                    </div>
                </fieldset>

                @if (refusal(); as words) {
                    <div class="alert alert-danger mt-3" role="alert">{{ words }}</div>
                }
                @if (testSent()) {
                    <div class="alert alert-success mt-3" role="status">The test was sent to your own address. Check that it arrived.</div>
                }

                <div class="d-flex gap-2 mt-3">
                    <button type="button" class="cms-btn cms-btn-primary" [disabled]="!canSave() || busy()" (click)="save()">Save</button>
                    <button type="button" class="cms-btn" [disabled]="!current.mailboxId || busy()" (click)="sendTest()">Send test</button>
                    <button type="button" class="cms-btn cms-btn-danger ms-auto" [disabled]="!current.mailboxId || busy()" (click)="clear()">Clear</button>
                </div>
            } @else {
                <p class="cms-field-hint">Reading...</p>
            }
        </div>
    `,
})
export class SystemMailPageComponent implements OnInit {
    private readonly email = inject(EmailService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly elevation = inject(ElevationService);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);

    readonly view = signal<SystemMailDto | null>(null);
    readonly mailboxes = signal<EmailMailboxDto[]>([]);
    readonly candidates = computed(() => systemMailCandidates(this.mailboxes()));
    readonly loadError = signal<{ message: string; elevation: boolean } | null>(null);

    readonly mailboxId = signal('');
    readonly addresses = signal<string[]>([]);
    readonly unreadable = signal<string | null>(null);
    readonly fromAddress = signal('');
    readonly fromName = signal('');

    readonly busy = signal(false);
    /** The last refusal, in the server's words; cleared by the next action. */
    readonly refusal = signal<string | null>(null);
    readonly testSent = signal(false);

    readonly stateText = computed(() => {
        const current = this.view();
        return null === current ? '' : systemMailStateText(current);
    });
    readonly fromLine = computed(() => {
        const current = this.view();
        if (null === current || null === current.fromAddress) {
            return '';
        }
        return null === current.fromName ? current.fromAddress : `${current.fromName} (${current.fromAddress})`;
    });
    readonly canSave = computed(() => '' !== this.mailboxId() && '' !== this.fromAddress());

    ngOnInit(): void {
        this.load();
    }

    /** Reads the choice and the mailboxes together; the form starts from what is chosen. */
    load(): void {
        this.loadError.set(null);
        forkJoin({ view: this.email.getSystemMail(), mailboxes: this.email.listMailboxes() })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: ({ view, mailboxes }) => {
                    this.mailboxes.set(mailboxes);
                    this.show(view);
                },
                error: (err: unknown) => this.loadError.set({
                    message: this.errors.humanize(err),
                    elevation: isElevationRefusal(err),
                }),
            });
    }

    elevateAndLoad(): void {
        this.elevation.offerFor().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(granted => {
            if (granted || this.elevation.elevated()) {
                this.load();
            }
        });
    }

    mailboxName(id: string): string {
        const m = this.mailboxes().find(x => x.id === id);
        return m === undefined ? id : (m.label || m.emailAddress || id);
    }

    /** A mailbox picked: its Froms are read, and the From starts at its own address (the list's first). */
    pickMailbox(id: string, keepFrom: string | null = null): void {
        this.mailboxId.set(id);
        this.addresses.set([]);
        this.unreadable.set(null);
        this.fromAddress.set('');
        if ('' === id) {
            return;
        }
        this.email.getSystemMailSendAs(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: sendAs => {
                this.addresses.set(sendAs.addresses);
                this.unreadable.set(sendAs.unreadable);
                this.fromAddress.set(sendAs.addresses.find(a => a === keepFrom) ?? sendAs.addresses[0] ?? '');
            },
            error: (err: unknown) => this.refusal.set(this.errors.humanize(err)),
        });
    }

    save(): void {
        const choice = systemMailChoice(this.mailboxId(), this.fromAddress(), this.fromName());
        this.act(() => this.email.chooseSystemMail(choice), 'System mail saved');
    }

    clear(): void {
        this.confirm.open({
            title: 'Clear system mail?',
            message: 'The configured transport carries the platform\'s mail again. The mailbox itself is not changed.',
            confirmLabel: 'Clear',
            danger: true,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
            if (confirmed) {
                this.act(() => this.email.clearSystemMail(), 'System mail cleared');
            }
        });
    }

    sendTest(): void {
        this.refusal.set(null);
        this.testSent.set(false);
        this.busy.set(true);
        this.email.testSystemMail().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.busy.set(false);
                this.testSent.set(true);
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.refusal.set(this.errors.humanize(err));
            },
        });
    }

    /**
     * A write: its answer is the new state, or, when it answers none (Clear), the state is read again. A refusal is
     * kept on the page.
     */
    private act(send: () => Observable<unknown>, done: string): void {
        this.refusal.set(null);
        this.testSent.set(false);
        this.busy.set(true);
        send().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: answer => {
                this.busy.set(false);
                this.toast.success(done);
                if (!isSystemMail(answer)) {
                    this.load();
                } else {
                    this.show(answer);
                }
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.refusal.set(this.errors.humanize(err));
            },
        });
    }

    private show(view: SystemMailDto): void {
        this.view.set(view);
        this.fromName.set(view.fromName ?? '');
        this.pickMailbox(view.mailboxId ?? '', view.fromAddress);
    }
}

function isSystemMail(answer: unknown): answer is SystemMailDto {
    return null !== answer && typeof answer === 'object' && 'state' in answer;
}
