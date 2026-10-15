import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { type CapabilityState, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto, MailboxSecurity, MailboxWriteRequest } from './email.types';
import { afterAccess, rebaseDraft, saveFailed } from './mailbox-section-save';

/** The connection fields this section edits, as they are read and as they are saved. */
interface ConnectionDraft {
    imapHost: string;
    imapPort: number | null;
    imapSecurity: MailboxSecurity;
    imapUsername: string;
    smtpHost: string;
    smtpPort: number | null;
    smtpSecurity: MailboxSecurity;
    smtpUsername: string;
    enabled: boolean;
    backfillDepthMonths: number | null;
}

const SECURITY: ReadonlyArray<{ value: MailboxSecurity; label: string }> = [
    { value: 'ssl', label: 'SSL/TLS' },
    { value: 'starttls', label: 'STARTTLS' },
    { value: 'none', label: 'None' },
];

function security(value: string | undefined): MailboxSecurity {
    return value === 'none' || value === 'starttls' ? value : 'ssl';
}

/** The draft a read gives: every field as stored, so an untouched field is never sent. */
export function connectionDraftOf(mailbox: EmailMailboxDto): ConnectionDraft {
    return {
        imapHost: mailbox.imapHost ?? '',
        imapPort: mailbox.imapPort ?? null,
        imapSecurity: security(mailbox.imapSecurity),
        imapUsername: mailbox.imapUsername ?? '',
        smtpHost: mailbox.smtpHost ?? '',
        smtpPort: mailbox.smtpPort ?? null,
        smtpSecurity: security(mailbox.smtpSecurity),
        smtpUsername: mailbox.smtpUsername ?? '',
        enabled: mailbox.enabled ?? true,
        backfillDepthMonths: (mailbox as { backfillDepthMonths?: number | null }).backfillDepthMonths ?? null,
    };
}

/**
 * The fields of `draft` that differ from what `mailbox` holds, plus a new password when one was typed: a section save
 * sends only what the person changed, so a field someone else changed meanwhile is not written back from this read.
 */
export function connectionPatch(mailbox: EmailMailboxDto, draft: ConnectionDraft, password: string): MailboxWriteRequest {
    const read = connectionDraftOf(mailbox);
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(draft) as (keyof ConnectionDraft)[]) {
        if (draft[key] !== read[key] && draft[key] !== null) {
            patch[key] = draft[key];
        }
    }
    if (password.trim() !== '') {
        patch['password'] = password;
    }
    return patch as MailboxWriteRequest;
}

/** What a mailbox's connection state reads as, for the person: the last fetch's outcome in words. */
export function connectionStatusOf(mailbox: EmailMailboxDto): { tone: 'ok' | 'warn' | 'stop' | 'none'; text: string } {
    const why: Record<string, string> = {
        auth_refused: 'the server refused the sign-in',
        reauth_required: 'the account must be connected again',
        unreachable: 'the server could not be reached',
        unknown: 'an unknown error',
    };
    switch (mailbox.connectionKind) {
        case 'ok':
            return { tone: 'ok', text: 'Connected' };
        case 'transient':
            return { tone: 'warn', text: 'Retrying: the last fetch failed' };
        case 'permanent':
            return { tone: 'stop', text: `Stopped: ${why[mailbox.connectionErrorKind ?? 'unknown'] ?? why['unknown']}` };
        case 'pending_recheck':
            return { tone: 'warn', text: 'Waiting for the next fetch to check the connection' };
        default:
            return { tone: 'none', text: 'Not fetched yet' };
    }
}

/**
 * A mailbox's Connection settings: the incoming and outgoing servers, how it signs in, and whether and how far back it
 * syncs. Saved on its own, naming the version of the settings it was read at (If-Match): settings changed since are
 * refused, said, and nothing is saved; Reload reads them again. What the caller may do is the server's answer for
 * `email.mailbox.update` -- `denied` shows the settings read-only, `elevate` asks for an elevated session first.
 */
@Component({
    selector: 'app-mailbox-connection-section',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="mbs-section" aria-labelledby="mbs-connection-title">
            <header class="mbs-section__head">
                <h2 id="mbs-connection-title" class="mbs-section__title">Connection</h2>
                <span class="mbs-status" [class]="'mbs-status mbs-status--' + status().tone">{{ status().text }}</span>
            </header>

            <fieldset class="mbs-fields" [disabled]="readOnly() || saving()">
                <div class="mbs-group">
                    <h3 class="mbs-group__title">Incoming (IMAP)</h3>
                    <label class="mbs-field mbs-field--wide">
                        <span>Server</span>
                        <input type="text" name="imapHost" autocomplete="off"
                               [ngModel]="draft().imapHost" (ngModelChange)="set('imapHost', $event)" />
                    </label>
                    <label class="mbs-field">
                        <span>Port</span>
                        <input type="number" name="imapPort" min="1" max="65535"
                               [ngModel]="draft().imapPort" (ngModelChange)="set('imapPort', $event)" />
                    </label>
                    <label class="mbs-field">
                        <span>Security</span>
                        <select name="imapSecurity" [ngModel]="draft().imapSecurity" (ngModelChange)="set('imapSecurity', $event)">
                            @for (s of securities; track s.value) { <option [value]="s.value">{{ s.label }}</option> }
                        </select>
                    </label>
                    <label class="mbs-field mbs-field--wide">
                        <span>Username</span>
                        <input type="text" name="imapUsername" autocomplete="off"
                               [ngModel]="draft().imapUsername" (ngModelChange)="set('imapUsername', $event)" />
                    </label>
                </div>

                <div class="mbs-group">
                    <h3 class="mbs-group__title">Outgoing (SMTP)</h3>
                    <label class="mbs-field mbs-field--wide">
                        <span>Server</span>
                        <input type="text" name="smtpHost" autocomplete="off"
                               [ngModel]="draft().smtpHost" (ngModelChange)="set('smtpHost', $event)" />
                    </label>
                    <label class="mbs-field">
                        <span>Port</span>
                        <input type="number" name="smtpPort" min="1" max="65535"
                               [ngModel]="draft().smtpPort" (ngModelChange)="set('smtpPort', $event)" />
                    </label>
                    <label class="mbs-field">
                        <span>Security</span>
                        <select name="smtpSecurity" [ngModel]="draft().smtpSecurity" (ngModelChange)="set('smtpSecurity', $event)">
                            @for (s of securities; track s.value) { <option [value]="s.value">{{ s.label }}</option> }
                        </select>
                    </label>
                    <label class="mbs-field mbs-field--wide">
                        <span>Username</span>
                        <input type="text" name="smtpUsername" autocomplete="off"
                               [ngModel]="draft().smtpUsername" (ngModelChange)="set('smtpUsername', $event)" />
                    </label>
                </div>

                <div class="mbs-group">
                    <h3 class="mbs-group__title">Sign-in</h3>
                    @if (mailbox().authMethod === 'oauth') {
                        <p class="mbs-note">
                            Signs in through {{ mailbox().oauthProvider || 'its provider' }}:
                            {{ mailbox().oauthConnected ? 'connected' : 'not connected' }}.
                        </p>
                        @if (authorizeAccess() !== 'denied') {
                            <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm" (click)="reconnect()">
                                @if (authorizeAccess() === 'elevate') { <i class="bi bi-lock"></i> }
                                {{ mailbox().oauthConnected ? 'Reconnect' : 'Connect' }}
                            </button>
                        }
                    } @else {
                        <label class="mbs-field mbs-field--wide">
                            <span>Password</span>
                            <input type="password" name="password" autocomplete="new-password"
                                   [placeholder]="mailbox().hasCredential ? 'Stored -- leave empty to keep it' : 'None stored'"
                                   [ngModel]="password()" (ngModelChange)="password.set($event)" />
                        </label>
                    }
                </div>

                <div class="mbs-group">
                    <h3 class="mbs-group__title">Sync</h3>
                    <label class="mbs-check">
                        <input type="checkbox" name="enabled" [ngModel]="draft().enabled" (ngModelChange)="set('enabled', $event)" />
                        Fetch new mail
                    </label>
                    @if (hasBackfillDepth()) {
                        <label class="mbs-field">
                            <span>Months of past mail</span>
                            <input type="number" name="backfillDepthMonths" min="0"
                                   [ngModel]="draft().backfillDepthMonths" (ngModelChange)="set('backfillDepthMonths', $event)" />
                        </label>
                    }
                </div>
            </fieldset>

            <footer class="mbs-section__foot">
                @if (readOnly()) {
                    <p class="mbs-note">Only the mailbox's owners can change these settings.</p>
                } @else if (!versioned()) {
                    <p class="mbs-note">These settings were read without a version, so they cannot be saved here.</p>
                } @else {
                    <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm" [disabled]="!dirty() || saving()" (click)="discard()">
                        Discard
                    </button>
                    <button type="button" class="cms-btn cms-btn-primary cms-btn-sm" [disabled]="!dirty() || saving()" (click)="save()">
                        @if (access() === 'elevate') { <i class="bi bi-lock"></i> }
                        Save connection
                    </button>
                }
            </footer>
        </section>
    `,
    styleUrl: './mailbox-section.css',
})
export class MailboxConnectionSectionComponent {
    /** The mailbox as read, with the version this section saves against. */
    readonly mailbox = input.required<EmailMailboxDto>();
    /** The server's answer for `email.mailbox.update`. */
    readonly access = input<CapabilityState>('denied');
    /** The server's answer for `email.mailbox.authorize`. */
    readonly authorizeAccess = input<CapabilityState>('denied');
    /** Changes on every Reload of the page: the draft starts over from the read. */
    readonly reset = input(0);

    /** The settings as saved: the page takes the answer as its new read (and its new version). */
    readonly saved = output<EmailMailboxDto>();
    /** Read the mailbox again, after a refusal. */
    readonly reload = output<void>();

    private readonly email = inject(EmailService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly elevation = inject(ElevationService);
    private readonly destroyRef = inject(DestroyRef);

    readonly securities = SECURITY;
    readonly draft = signal<ConnectionDraft>(connectionDraftOf({ id: '' }));
    readonly password = signal('');
    readonly saving = signal(false);

    readonly readOnly = computed(() => this.access() === 'denied');
    readonly versioned = computed(() => {
        const version = this.mailbox().version;
        return version !== null && version !== undefined && version !== '';
    });
    readonly hasBackfillDepth = computed(() => 'backfillDepthMonths' in this.mailbox());
    readonly status = computed(() => connectionStatusOf(this.mailbox()));
    readonly dirty = computed(() => Object.keys(connectionPatch(this.mailbox(), this.draft(), this.password())).length > 0);

    /** The read the draft was last laid over, and the reload it was taken at. */
    private read: EmailMailboxDto | null = null;
    private readAtReset = -1;

    constructor() {
        // The first read and every Reload start the draft over. Any other new read -- a save's answer, this
        // section's or another's -- is laid under it: what was typed here and not saved stays (rebaseDraft).
        effect(() => {
            const next = this.mailbox();
            const reset = this.reset();
            untracked(() => {
                const fresh = connectionDraftOf(next);
                if (this.read === null || reset !== this.readAtReset) {
                    this.draft.set(fresh);
                    this.password.set('');
                } else {
                    this.draft.set(rebaseDraft(connectionDraftOf(this.read), this.draft(), fresh));
                }
                this.read = next;
                this.readAtReset = reset;
            });
        });
    }

    set<K extends keyof ConnectionDraft>(key: K, value: ConnectionDraft[K]): void {
        this.draft.update(d => ({ ...d, [key]: value }));
    }

    discard(): void {
        this.draft.set(connectionDraftOf(this.mailbox()));
        this.password.set('');
    }

    save(): void {
        afterAccess(this.access(), this.elevation, () => this.send());
    }

    reconnect(): void {
        afterAccess(this.authorizeAccess(), this.elevation, () => {
            this.email.authorizeMailbox(this.mailbox().id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
                next: result => {
                    if (result.authorizationUrl) {
                        window.location.assign(result.authorizationUrl);
                    }
                },
                error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
            });
        });
    }

    private send(): void {
        const mailbox = this.mailbox();
        const patch = connectionPatch(mailbox, this.draft(), this.password());
        this.saving.set(true);
        this.email.saveMailboxSection(mailbox.id, patch, mailbox.version).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: answer => {
                this.saving.set(false);
                this.password.set('');
                this.toast.success('Connection saved');
                this.saved.emit(answer);
            },
            error: (err: unknown) => {
                this.saving.set(false);
                saveFailed(err, this.toast, this.errors, () => this.reload.emit());
            },
        });
    }
}
