import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import { type CapabilityState, ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto, MailboxSecurity, MailboxTestOutcome, MailboxTestRequest, MailboxTestResult, MailboxWriteRequest, SendVia } from './email.types';
import { HttpErrorResponse } from '@angular/common/http';
import { NO_MAILBOX, afterAccess, rebaseDraft, saveFailed } from './mailbox-section-save';
import { sendViaChoices, sendViaHint } from './send-via';

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
    sendVia: SendVia;
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
        sendVia: mailbox.sendVia ?? 'auto',
        enabled: mailbox.enabled ?? true,
        backfillDepthMonths: mailbox.backfillDepthMonths ?? null,
    };
}

/** How much past mail a sync fetches, as the person chooses it: the stored number read as a choice. */
export type BackfillChoice = 'default' | 'none' | 'months' | 'all';

export function backfillChoiceOf(months: number | null): BackfillChoice {
    if (months === null) return 'default';
    if (months === 0) return 'none';
    if (months < 0) return 'all';
    return 'months';
}

/** The two panes the connection settings are shown in: how it connects, and how it syncs. */
export type ConnectionPart = 'connection' | 'sync';

/** The fields the Sync pane edits; every other field (and the password) is the Connection pane's. */
const SYNC_KEYS: ReadonlyArray<string> = ['enabled', 'backfillDepthMonths'];

/** The part of a section patch that a pane saves: its own fields only, so two panes never write each other's. */
export function partPatch(patch: MailboxWriteRequest, part: ConnectionPart): MailboxWriteRequest {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
        if (SYNC_KEYS.includes(key) === ('sync' === part)) {
            out[key] = value;
        }
    }
    return out as MailboxWriteRequest;
}

/** A connection test's outcome for one protocol, in words. */
export function testOutcomeText(outcome: MailboxTestOutcome | undefined): string {
    if (!outcome) return 'not tested';
    if (outcome.ok) return 'connected';
    return outcome.message || 'failed';
}

/**
 * The fields of `draft` that differ from what `mailbox` holds, plus a new password when one was typed: a section save
 * sends only what the person changed, so a field someone else changed meanwhile is not written back from this read.
 */
export function connectionPatch(mailbox: EmailMailboxDto, draft: ConnectionDraft, password: string): MailboxWriteRequest {
    const read = connectionDraftOf(mailbox);
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(draft) as (keyof ConnectionDraft)[]) {
        if (draft[key] !== read[key] && (draft[key] !== null || key === 'backfillDepthMonths')) {
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
        @if (readOnly()) {
            <p class="cms-field-hint mb-3">Only the mailbox's owners can change these settings.</p>
        } @else if (!versioned()) {
            <p class="cms-field-hint mb-3">These settings were read without a version, so they cannot be saved here.</p>
        }

        @if (part() === 'connection') {
            <p class="mb-3">
                <span class="cms-badge"
                      [class.text-success]="'ok' === status().tone"
                      [class.text-warning]="'warn' === status().tone"
                      [class.text-danger]="'stop' === status().tone">{{ status().text }}</span>
            </p>
        }

        <fieldset class="border-0 p-0 m-0" [disabled]="readOnly() || saving()">
            @if (part() === 'connection') {
                <h3 class="cms-section-title px-0">Incoming (IMAP)</h3>
                <div class="row g-3 mb-4">
                    <label class="col-12 col-md-6">
                        <span class="cms-label">Server</span>
                        <input type="text" class="cms-input w-100" name="imapHost" autocomplete="off"
                               [ngModel]="draft().imapHost" (ngModelChange)="set('imapHost', $event)" />
                    </label>
                    <label class="col-6 col-md-2">
                        <span class="cms-label">Port</span>
                        <input type="number" class="cms-input w-100" name="imapPort" min="1" max="65535"
                               [ngModel]="draft().imapPort" (ngModelChange)="set('imapPort', $event)" />
                    </label>
                    <label class="col-6 col-md-4">
                        <span class="cms-label">Security</span>
                        <select class="cms-select w-100" name="imapSecurity" [ngModel]="draft().imapSecurity" (ngModelChange)="set('imapSecurity', $event)">
                            @for (s of securities; track s.value) { <option [value]="s.value">{{ s.label }}</option> }
                        </select>
                    </label>
                    <label class="col-12 col-md-6">
                        <span class="cms-label">Username</span>
                        <input type="text" class="cms-input w-100" name="imapUsername" autocomplete="off" [readonly]="usernameIsAddress()"
                               [ngModel]="draft().imapUsername" (ngModelChange)="set('imapUsername', $event)" />
                    </label>
                </div>

                <h3 class="cms-section-title px-0">Outgoing (SMTP)</h3>
                <div class="row g-3 mb-4">
                    <label class="col-12 col-md-6">
                        <span class="cms-label">Server</span>
                        <input type="text" class="cms-input w-100" name="smtpHost" autocomplete="off"
                               [ngModel]="draft().smtpHost" (ngModelChange)="set('smtpHost', $event)" />
                    </label>
                    <label class="col-6 col-md-2">
                        <span class="cms-label">Port</span>
                        <input type="number" class="cms-input w-100" name="smtpPort" min="1" max="65535"
                               [ngModel]="draft().smtpPort" (ngModelChange)="set('smtpPort', $event)" />
                    </label>
                    <label class="col-6 col-md-4">
                        <span class="cms-label">Security</span>
                        <select class="cms-select w-100" name="smtpSecurity" [ngModel]="draft().smtpSecurity" (ngModelChange)="set('smtpSecurity', $event)">
                            @for (s of securities; track s.value) { <option [value]="s.value">{{ s.label }}</option> }
                        </select>
                    </label>
                    <label class="col-12 col-md-6">
                        <span class="cms-label">Username</span>
                        <input type="text" class="cms-input w-100" name="smtpUsername" autocomplete="off" [readonly]="usernameIsAddress()"
                               [ngModel]="draft().smtpUsername" (ngModelChange)="set('smtpUsername', $event)" />
                    </label>
                </div>
                @if (hasSendVia()) {
                    <div class="row g-3 mb-4">
                        <label class="col-12 col-md-6">
                            <span class="cms-label">Send through</span>
                            <select class="cms-select w-100" name="sendVia" [ngModel]="draft().sendVia" (ngModelChange)="set('sendVia', $event)">
                                @for (c of sendChoices(); track c.value) { <option [value]="c.value" [disabled]="c.disabled">{{ c.label }}</option> }
                            </select>
                        </label>
                        <p class="cms-field-hint col-12 mb-0">{{ sendHint() }}</p>
                    </div>
                }
                @if (usernameIsAddress() && !readOnly()) {
                    <p class="cms-field-hint mb-3">Your mailbox signs in as its address. An administrator can set another sign-in name.</p>
                }

                <h3 class="cms-section-title px-0">Sign-in</h3>
                @if (mailbox().authMethod === 'oauth') {
                    <div class="d-flex align-items-center gap-3 mb-3">
                        <span>
                            Signs in through {{ mailbox().oauthProvider || 'its provider' }}:
                            {{ mailbox().oauthConnected ? 'connected' : 'not connected' }}.
                        </span>
                        @if (authorizeAccess() !== 'denied') {
                            <button type="button" class="cms-btn cms-btn-sm" (click)="reconnect()">
                                @if (authorizeAccess() === 'elevate') { <i class="bi bi-lock"></i> }
                                {{ mailbox().oauthConnected ? 'Reconnect' : 'Connect' }}
                            </button>
                        }
                    </div>
                } @else {
                    <div class="row g-3 mb-3">
                        <label class="col-12 col-md-6">
                            <span class="cms-label">Password</span>
                            <input type="password" class="cms-input w-100" name="password" autocomplete="new-password"
                                   [placeholder]="mailbox().hasCredential ? 'Stored -- leave empty to keep it' : 'None stored'"
                                   [ngModel]="password()" (ngModelChange)="password.set($event)" />
                        </label>
                    </div>
                }
            } @else {
                <div class="form-check mb-3">
                    <input type="checkbox" class="form-check-input" id="mbs-enabled" name="enabled"
                           [ngModel]="draft().enabled" (ngModelChange)="set('enabled', $event)" />
                    <label class="form-check-label" for="mbs-enabled">Fetch new mail</label>
                </div>
                @if (hasBackfillDepth()) {
                    <div class="row g-3">
                        <label class="col-12 col-md-6">
                            <span class="cms-label">Past mail to fetch</span>
                            <select class="cms-select w-100" name="backfillChoice" [ngModel]="backfillChoice()" (ngModelChange)="chooseBackfill($event)">
                                <option value="default">The installation's default</option>
                                <option value="none">None</option>
                                <option value="months">The last months, as set</option>
                                <option value="all">All of it</option>
                            </select>
                        </label>
                        @if (backfillChoice() === 'months') {
                            <label class="col-6 col-md-3">
                                <span class="cms-label">Months (1-600)</span>
                                <input type="number" class="cms-input w-100" name="backfillDepthMonths" min="1" max="600"
                                       [ngModel]="draft().backfillDepthMonths" (ngModelChange)="set('backfillDepthMonths', $event)" />
                            </label>
                        }
                    </div>
                }
            }
        </fieldset>

        @if (part() === 'connection' && !readOnly()) {
            <!-- The test's button is the pane's (its footer); what it found is said here. -->
            <p class="cms-field-hint mt-3">Test connection signs in with what is typed here; nothing is saved.</p>
            @if (testResult(); as r) {
                <ul class="list-unstyled mb-0">
                    <li [class.text-success]="r.imap?.ok" [class.text-danger]="r.imap && !r.imap.ok">Incoming (IMAP): {{ outcomeText(r.imap) }}</li>
                    <li [class.text-success]="r.smtp?.ok" [class.text-danger]="r.smtp && !r.smtp.ok">Outgoing (SMTP): {{ outcomeText(r.smtp) }}</li>
                </ul>
            }
            @if (testRefused(); as why) { <p class="text-danger mb-0" role="alert">{{ why }}</p> }
        }
    `,
})
export class MailboxConnectionSectionComponent {
    /** The mailbox as read, with the version this section saves against. */
    readonly mailbox = input<EmailMailboxDto>(NO_MAILBOX);
    /** The server's answer for `email.mailbox.update`. */
    readonly access = input<CapabilityState>('denied');
    /** The server's answer for `email.mailbox.authorize`. */
    readonly authorizeAccess = input<CapabilityState>('denied');
    /** Changes on every Reload of the page: the draft starts over from the read. */
    readonly reset = input(0);
    /** Which pane this instance is: the servers and the sign-in, or the sync. Each saves only its own fields. */
    readonly part = input<ConnectionPart>('connection');

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
    /** The sending choice, where the server offers it (a server before it reads no `sendVia`). */
    readonly hasSendVia = computed(() => 'sendVia' in this.mailbox());
    readonly sendChoices = computed(() => sendViaChoices(this.mailbox().sendApi, this.mailbox().sendVia ?? 'auto'));
    readonly sendHint = computed(() => sendViaHint(this.draft().sendVia, this.mailbox().sendApi));
    readonly backfillChoice = computed(() => backfillChoiceOf(this.draft().backfillDepthMonths));
    /**
     * An owner who is not an administrator signs in as the mailbox's address (the server holds a username they send to
     * it): the names are shown, not edited, and sent back as read.
     */
    readonly usernameIsAddress = computed(() => this.mailbox().access === 'owner');

    readonly testing = signal(false);
    readonly testResult = signal<MailboxTestResult | null>(null);
    /** Why the last test was not run (too many tests, a refused field), in words. */
    readonly testRefused = signal<string | null>(null);
    readonly outcomeText = testOutcomeText;
    readonly status = computed(() => connectionStatusOf(this.mailbox()));
    /** What a save of this pane would send: its own changed fields. */
    readonly patch = computed(() => partPatch(connectionPatch(this.mailbox(), this.draft(), this.password()), this.part()));
    readonly dirty = computed(() => Object.keys(this.patch()).length > 0);
    /** Whether this pane can be saved at all: the caller may change it, and it was read with a version. */
    readonly editable = computed(() => !this.readOnly() && this.versioned());

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

    /** Throws away this pane's own edits; the other pane's stay. */
    discard(): void {
        const read = connectionDraftOf(this.mailbox()) as unknown as Record<string, unknown>;
        const draft = { ...this.draft() } as unknown as Record<string, unknown>;
        for (const key of Object.keys(read)) {
            if (SYNC_KEYS.includes(key) === ('sync' === this.part())) {
                draft[key] = read[key];
            }
        }
        this.draft.set(draft as unknown as ConnectionDraft);
        if ('connection' === this.part()) {
            this.password.set('');
        }
    }

    /** The choice of past mail, as the stored number: the default (null), none (0), all (-1), or a number of months. */
    chooseBackfill(choice: BackfillChoice): void {
        const current = this.draft().backfillDepthMonths;
        const months = { default: null, none: 0, all: -1, months: current !== null && current > 0 ? current : 12 }[choice];
        this.set('backfillDepthMonths', months);
    }

    /** Tests the connection with what is typed here -- nothing saved -- as the server's answer for the section allows. */
    test(): void {
        afterAccess(this.access(), this.elevation, () => this.sendTest());
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

    private sendTest(): void {
        const d = this.draft();
        const request: MailboxTestRequest = {
            imapHost: d.imapHost, imapSecurity: d.imapSecurity, smtpHost: d.smtpHost, smtpSecurity: d.smtpSecurity,
        };
        if (d.imapPort !== null) request.imapPort = d.imapPort;
        if (d.smtpPort !== null) request.smtpPort = d.smtpPort;
        if (!this.usernameIsAddress()) {
            request.imapUsername = d.imapUsername;
            request.smtpUsername = d.smtpUsername;
        }
        if (this.password().trim() !== '') request.password = this.password();
        this.testing.set(true);
        this.testResult.set(null);
        this.testRefused.set(null);
        this.email.testMailbox(this.mailbox().id, request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: result => {
                this.testing.set(false);
                this.testResult.set(result);
            },
            error: (err: unknown) => {
                this.testing.set(false);
                if (err instanceof HttpErrorResponse && err.status === 429) {
                    const after = Number(err.headers?.get('Retry-After'));
                    this.testRefused.set(Number.isFinite(after) && after > 0
                        ? `Too many tests: try again in ${Math.ceil(after)} seconds.`
                        : 'Too many tests: try again in a few minutes.');
                    return;
                }
                this.testRefused.set(this.errors.humanize(err));
            },
        });
    }

    private send(): void {
        const mailbox = this.mailbox();
        const patch = this.patch();
        this.saving.set(true);
        this.email.saveMailboxSection(mailbox.id, patch, mailbox.version).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: answer => {
                this.saving.set(false);
                if ('connection' === this.part()) {
                    this.password.set('');
                }
                this.toast.success('connection' === this.part() ? 'Connection saved' : 'Sync saved');
                this.saved.emit(answer);
            },
            error: (err: unknown) => {
                this.saving.set(false);
                saveFailed(err, this.toast, this.errors, () => this.reload.emit());
            },
        });
    }
}
