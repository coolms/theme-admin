import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, of } from 'rxjs';
import { CmsLoaderComponent, ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';

import { EmailService } from './email.service';
import { EmailMailboxDto } from './email.types';
import {
    MAIL_PREFERENCE_DEFAULTS,
    MAIL_PREFERENCES_READ_ONLY,
    MailPreferences,
    MailPreferencesChangedError,
    MailPreferencesService,
    RemoteImages,
} from './mail-preferences.service';

/** The fields of `draft` that differ from `read`: a save sends only what the person changed. */
export function mailPreferencesPatch(read: MailPreferences, draft: MailPreferences): Partial<MailPreferences> {
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(draft) as (keyof MailPreferences)[]) {
        if (!MAIL_PREFERENCES_READ_ONLY.includes(key) && draft[key] !== read[key]) {
            patch[key] = draft[key];
        }
    }
    return patch as Partial<MailPreferences>;
}

/**
 * The "Mail" pane of My Profile -- Email's guest in Identity's `profile.tab` slot (`profile.tab:mail`).
 *
 * The person's own mail settings, the profile section `mail`: the mailbox the mail page opens on and new mail is sent
 * from, and how remote images in a message are treated. Read with the section's version and saved naming it: saved
 * somewhere else since, the save is refused, said, and Reload offered -- never retried, never merged. The server keeps
 * only what it may (a mailbox the person may no longer send from is not stored), so the answer is shown as what
 * stood, and a change that did not stand is said. A section that could not be read shows no form to save over it.
 */
@Component({
    selector: 'app-profile-mail-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, CmsLoaderComponent],
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; }
        .tab-body { padding: 20px; flex: 1; }
        .tab-footer {
            display: flex; justify-content: flex-end; align-items: center; gap: 12px;
            padding: 12px 20px; border-top: 1px solid var(--cms-border); flex-shrink: 0;
        }
        .group { display: flex; flex-direction: column; gap: 6px; max-width: 480px; }
        .group + .group { margin-top: 18px; }
        .group-label { font-size: .85rem; font-weight: 600; color: var(--cms-text); }
        .group-help { font-size: .75rem; color: var(--cms-text-muted); margin: 0; }
        .choice { display: inline-flex; align-items: center; gap: 8px; font-size: .875rem; cursor: pointer; }
        .notice {
            margin: 0 0 16px; padding: 8px 12px; border-radius: var(--cms-radius-sm);
            background: var(--cms-warning-light); color: var(--cms-warning-text); font-size: .8125rem;
            display: flex; align-items: center; gap: 10px; max-width: 640px;
        }
        .notice > span { flex: 1; }
        .error { color: var(--cms-danger); font-size: .875rem; }
    `],
    template: `
        <div class="tab-body">
            @if (loading()) {
                <cms-loader label="Reading your mail settings" />
            } @else if (unreadable()) {
                <p class="error" role="alert">Your mail settings could not be read, so they are not shown to change.</p>
                <button type="button" class="cms-btn cms-btn-sm" (click)="load()">Read them again</button>
            } @else {
                @if (changedElsewhere()) {
                    <div class="notice" role="alert">
                        <span>Your mail settings were saved somewhere else since you opened them. Nothing was saved here.</span>
                        <button type="button" class="cms-btn cms-btn-sm" (click)="load()">Reload, discarding my changes</button>
                    </div>
                }
                @for (line of notStored(); track line) {
                    <div class="notice" role="status"><span>{{ line }}</span></div>
                }
                <div class="group">
                    <label class="group-label" for="mail-default">Default mailbox</label>
                    <select id="mail-default" class="cms-select" [ngModel]="draft().defaultMailboxId ?? ''"
                            (ngModelChange)="set('defaultMailboxId', $event === '' ? null : $event)">
                        <option value="">None</option>
                        @for (mb of sendable(); track mb.id) {
                            <option [value]="mb.id">{{ mb.label || mb.emailAddress }}</option>
                        }
                        @if (unlistedDefault()) {
                            <option [value]="draft().defaultMailboxId">A mailbox you can no longer send from</option>
                        }
                    </select>
                    <p class="group-help">The mailbox the mail page opens on and new mail is sent from. Only a mailbox you may send from can be chosen.</p>
                </div>
                <div class="group">
                    <span class="group-label">Remote images in a message</span>
                    @for (o of imageChoices(); track o.value) {
                        <label class="choice">
                            <input type="radio" name="remoteImages" [value]="o.value"
                                   [ngModel]="draft().remoteImages" (ngModelChange)="set('remoteImages', $event)" />
                            {{ o.label }}
                        </label>
                    }
                    <p class="group-help">A remote image tells the sender that, and when, the message was opened.</p>
                </div>
            }
        </div>
        @if (!loading() && !unreadable()) {
            <div class="tab-footer">
                <button type="button" class="cms-btn cms-btn-ghost" [disabled]="!dirty() || saving()" (click)="discard()">Discard</button>
                <button type="button" class="cms-btn cms-btn-primary" [disabled]="!dirty() || saving() || changedElsewhere()" (click)="save()">
                    @if (saving()) { <cms-loader [inline]="true" /> }
                    Save changes
                </button>
            </div>
        }
    `,
})
export class ProfileMailTabComponent implements OnInit {
    /** The settings section this pane edits, as the slot hands it. */
    readonly section = input('mail');

    private readonly prefs = inject(MailPreferencesService);
    private readonly email = inject(EmailService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    /** The choices; "as the installation decides" names the installation's rule as the server last answered it. */
    readonly imageChoices = computed<ReadonlyArray<{ value: RemoteImages; label: string }>>(() => {
        const rule = this.read().remoteImagesInstallation;
        const now = rule === 'allow' ? ' (now: loaded)' : rule === 'block' ? ' (now: blocked)' : '';
        return [
            { value: 'inherit', label: 'As the installation decides' + now },
            { value: 'block', label: 'Always blocked; load them per message' },
            { value: 'allow', label: 'Always loaded' },
        ];
    });

    readonly loading = signal(true);
    readonly unreadable = signal(false);
    readonly saving = signal(false);
    readonly changedElsewhere = signal(false);
    /** What a save sent that did not stand, in words. */
    readonly notStored = signal<string[]>([]);
    readonly mailboxes = signal<EmailMailboxDto[]>([]);
    readonly read = signal<MailPreferences>(MAIL_PREFERENCE_DEFAULTS);
    readonly draft = signal<MailPreferences>(MAIL_PREFERENCE_DEFAULTS);
    private readonly version = signal<string | null>(null);

    /** The mailboxes the person may send from: their own, and those delegated to them to read and send. */
    readonly sendable = computed(() => this.mailboxes().filter(m => m.access === 'owner' || m.access === 'read_and_send'));
    readonly unlistedDefault = computed(() => {
        const id = this.draft().defaultMailboxId;
        return id !== null && !this.sendable().some(m => m.id === id);
    });
    readonly dirty = computed(() => Object.keys(mailPreferencesPatch(this.read(), this.draft())).length > 0);

    ngOnInit(): void {
        this.load();
    }

    /** The section and its version, and the mailboxes the person may read, in place of anything typed. */
    load(): void {
        this.loading.set(true);
        this.unreadable.set(false);
        this.changedElsewhere.set(false);
        this.notStored.set([]);
        forkJoin({
            read: this.prefs.read(),
            mailboxes: this.email.listReadableMailboxes().pipe(catchError(() => of<EmailMailboxDto[]>([]))),
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: ({ read, mailboxes }) => {
                this.version.set(read.version);
                this.read.set(read.prefs);
                this.draft.set(read.prefs);
                this.mailboxes.set(mailboxes);
                this.loading.set(false);
            },
            error: () => {
                this.unreadable.set(true);
                this.loading.set(false);
            },
        });
    }

    set<K extends keyof MailPreferences>(key: K, value: MailPreferences[K]): void {
        this.draft.update(d => ({ ...d, [key]: value }));
    }

    discard(): void {
        this.draft.set(this.read());
        this.notStored.set([]);
    }

    save(): void {
        // Refused once, the settings are not sent again until a Reload reads them again.
        if (this.changedElsewhere()) return;
        const sent = mailPreferencesPatch(this.read(), this.draft());
        this.saving.set(true);
        this.notStored.set([]);
        this.prefs.save(sent, this.version()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: saved => {
                this.saving.set(false);
                this.version.set(saved.version);
                this.read.set(saved.prefs);
                this.draft.set(saved.prefs);
                const lost = (Object.keys(sent) as (keyof MailPreferences)[]).filter(k => saved.prefs[k] !== sent[k]);
                this.notStored.set(lost.map(k => k === 'defaultMailboxId'
                    ? 'The default mailbox was not stored: it is not one you may send from.'
                    : 'A setting was not stored: the server did not accept its value.'));
                if (lost.length === 0) {
                    this.toast.success('Mail settings saved');
                }
            },
            error: (err: unknown) => {
                this.saving.set(false);
                if (err instanceof MailPreferencesChangedError) {
                    this.changedElsewhere.set(true);
                    return;
                }
                this.toast.error(this.errors.humanize(err));
            },
        });
    }
}
