import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { type CapabilityState, ConfirmDialogService, ToastService } from '@coolms/ui-angular';

import { EmailDelegationsCardComponent } from './email-delegations-card.component';
import { EmailService, type MailboxAction } from './email.service';
import { EmailMailboxDto } from './email.types';
import { MailboxConnectionSectionComponent } from './mailbox-connection-section.component';
import { MailboxDetailsSectionComponent } from './mailbox-details-section.component';
import { MailboxInboundSectionComponent } from './mailbox-inbound-section.component';
import { afterAccess } from './mailbox-section-save';

/**
 * One mailbox's settings, as a page of sections -- not the wizard, which stays for adding a mailbox (decided
 * 2026-10-15). Each section is saved on its own, naming the version of the settings it was read at; a save's answer
 * is the page's new read. What the caller may change is the server's capability answer for the mailbox: someone who
 * may only read them sees them read-only.
 *
 * Sections appear as the server serves what they edit, never as empty placeholders: Connection, and Access for a
 * shared mailbox (its delegations). Sending addresses, folders, rules, auto-reply and trusted senders follow theirs.
 */
@Component({
    selector: 'app-mailbox-settings-page',
    standalone: true,
    imports: [
        RouterLink, MailboxDetailsSectionComponent, MailboxConnectionSectionComponent, MailboxInboundSectionComponent,
        EmailDelegationsCardComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="mbs-page">
            <header class="mbs-page__head">
                <a routerLink="/email" class="mbs-page__back"><i class="bi bi-arrow-left"></i> Mail</a>
                @if (mailbox(); as mb) {
                    <h1 class="mbs-page__title">{{ mb.label || mb.emailAddress }}</h1>
                    @if (mb.label && mb.emailAddress) { <span class="mbs-page__address">{{ mb.emailAddress }}</span> }
                } @else {
                    <h1 class="mbs-page__title">Mailbox settings</h1>
                }
            </header>

            @if (error(); as message) {
                <p class="mbs-page__error" role="alert">{{ message }}</p>
            } @else if (mailbox(); as mb) {
                @if (access()['email.mailbox.update'] === 'denied') {
                    <p class="mbs-page__readonly">You can read these settings; only the mailbox's owners can change them.</p>
                } @else if (mb.version === null || mb.version === undefined || mb.version === '') {
                    <p class="mbs-page__readonly">
                        These settings were read without a version, so they cannot be saved here: a save could only go
                        over whatever is stored now, unseen.
                    </p>
                }

                <app-mailbox-details-section
                    [mailbox]="mb" [access]="access()['email.mailbox.update']"
                    [reset]="resetToken()" (saved)="mailbox.set($event)" (reload)="load()" />

                <app-mailbox-connection-section
                    [mailbox]="mb"
                    [access]="access()['email.mailbox.update']"
                    [authorizeAccess]="access()['email.mailbox.authorize']"
                    (saved)="mailbox.set($event)"
                    [reset]="resetToken()"
                    (reload)="load()" />

                <app-mailbox-inbound-section
                    [mailbox]="mb" [access]="access()['email.mailbox.update']"
                    [reset]="resetToken()" (saved)="mailbox.set($event)" (reload)="load()" />

                @if (mb.kind === 'shared' && access()['email.mailbox.update'] !== 'denied') {
                    <section class="mbs-page__section" aria-label="Access">
                        <h2 class="mbs-page__section-title">Access</h2>
                        <app-email-delegations-card [mailboxId]="mb.id" />
                    </section>
                }

                @if (access()['email.mailbox.update'] !== 'denied') {
                    <footer class="mbs-page__danger">
                        <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm mbs-page__remove" (click)="remove(mb)">
                            @if (access()['email.mailbox.update'] === 'elevate') { <i class="bi bi-lock"></i> }
                            <i class="bi bi-trash"></i> Remove this mailbox
                        </button>
                    </footer>
                }
            } @else {
                <p class="mbs-page__loading">Reading the mailbox...</p>
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .mbs-page { max-width: 880px; margin: 0 auto; padding: 20px 16px 40px; display: flex; flex-direction: column; gap: 16px; }
        .mbs-page__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
        .mbs-page__back { flex: 0 0 100%; font-size: .8125rem; color: var(--cms-text-muted); text-decoration: none; }
        .mbs-page__title { margin: 0; font-size: 1.25rem; font-weight: 600; }
        .mbs-page__address { color: var(--cms-text-muted); font-size: .875rem; }
        .mbs-page__error { color: var(--cms-danger); }
        .mbs-page__loading { color: var(--cms-text-muted); }
        .mbs-page__section-title { margin: 0 0 8px; font-size: 1rem; font-weight: 600; }
        .mbs-page__readonly { margin: 0; padding: 10px 12px; border-radius: var(--cms-radius-sm, 4px); background: var(--cms-surface-muted); font-size: .8125rem; }
        .mbs-page__danger { display: flex; justify-content: flex-end; }
        .mbs-page__remove { color: var(--cms-danger); }
    `],
})
export class MailboxSettingsPageComponent implements OnInit {
    private readonly route = inject(ActivatedRoute);
    private readonly email = inject(EmailService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly router = inject(Router);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly toast = inject(ToastService);
    private readonly elevation = inject(ElevationService);

    readonly mailbox = signal<EmailMailboxDto | null>(null);
    readonly error = signal<string | null>(null);
    /** Moves on every read the page makes: each section starts over from it (a section's own save does not). */
    readonly resetToken = signal(0);
    readonly access = signal<Record<MailboxAction, CapabilityState>>({
        'email.mailbox.update': 'denied',
        'email.mailbox.authorize': 'denied',
    });
    readonly id = computed(() => this.route.snapshot.paramMap.get('id') ?? '');

    ngOnInit(): void {
        this.load();
    }

    /**
     * Removes the mailbox after the person confirms it -- its fetched mail goes with it -- and returns to Mail.
     * Asks for an elevated session first where the server answers "elevate".
     */
    remove(mailbox: EmailMailboxDto): void {
        const name = mailbox.label || mailbox.emailAddress || 'this mailbox';
        this.confirm.open({
            title: `Remove "${name}"?`,
            message: 'Its connection, who it is shared with and the mail fetched into CoolMS are removed. The mail on the mail server stays.',
            confirmLabel: 'Remove',
            danger: true,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
            if (!confirmed) {
                return;
            }
            afterAccess(this.access()['email.mailbox.update'], this.elevation, () => {
                this.email.deleteMailbox(mailbox.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
                    next: () => {
                        this.toast.success('Mailbox removed');
                        void this.router.navigate(['/email']);
                    },
                    error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
                });
            });
        });
    }

    /** The mailbox and what the caller may do to it, read together; a reload starts every section over. */
    load(): void {
        const id = this.id();
        this.error.set(null);
        forkJoin({ mailbox: this.email.getMailbox(id), access: this.email.mailboxCapabilities(id) })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: ({ mailbox, access }) => {
                    this.access.set(access);
                    this.resetToken.update(n => n + 1);
                    this.mailbox.set(mailbox);
                },
                error: (err: unknown) => this.error.set(this.errors.humanize(err)),
            });
    }
}
