import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { ElevationService, ErrorHandlerService } from '@coolms/core-angular';
import {
    type CapabilityState,
    CmsSettingsPaneComponent,
    CmsSettingsShellComponent,
    type CmsSettingsSection,
    ConfirmDialogService,
    type HasUnsavedChanges,
    ToastService,
    UnsavedChangesService,
} from '@coolms/ui-angular';

import { EmailDelegationsCardComponent } from './email-delegations-card.component';
import { EmailService, type MailboxAction } from './email.service';
import { EmailMailboxDto } from './email.types';
import { MailboxConnectionSectionComponent } from './mailbox-connection-section.component';
import { MailboxDetailsSectionComponent } from './mailbox-details-section.component';
import { MailboxFiltersSectionComponent } from './mailbox-filters-section.component';
import { MailboxInboundSectionComponent } from './mailbox-inbound-section.component';
import { afterAccess } from './mailbox-section-save';

/** A pane of a mailbox's settings: its id in the URL, its title and help. */
export interface MailboxPane {
    readonly id: 'general' | 'connection' | 'sync' | 'filters' | 'rules' | 'access' | 'delete';
    readonly title: string;
    readonly help: string;
}

const PANES: readonly MailboxPane[] = [
    { id: 'general', title: 'General', help: 'The mailbox\'s name and address.' },
    { id: 'connection', title: 'Connection', help: 'The incoming and outgoing servers, and how the mailbox signs in.' },
    { id: 'sync', title: 'Sync', help: 'Whether new mail is fetched, and how much past mail.' },
    { id: 'filters', title: 'Filters', help: 'Sort arriving mail: where it goes, and how it is marked.' },
    { id: 'rules', title: 'Rules', help: 'What arriving mail starts.' },
    { id: 'access', title: 'Access', help: 'Who else may read this shared mailbox, and send from it.' },
    { id: 'delete', title: 'Delete this mailbox', help: '' },
];

/** A section the page can drive from its pane's footer. */
interface PaneBody {
    dirty(): boolean;
    saving(): boolean;
    editable(): boolean;
    save(): void;
    discard(): void;
}

/**
 * One mailbox's settings, in the settings shell's object scope: the panes on the left, one at a time on the right,
 * each saved on its own. The wizard stays for adding a mailbox.
 *
 * It does not read the URL: its host does (decided 2026-10-24: an object's settings open in a modal over the
 * object's own page, `/email;mailbox={id}?settings={pane}`). The host gives the mailbox and the pane, and is told
 * when another pane is picked (`replace` when an unknown one fell back to the first), and when the mailbox was
 * deleted.
 *
 * Each pane saves only its own fields, naming the version of the settings it was read at (If-Match); a save's answer
 * is the page's new read, laid under what another pane holds unsaved. What the caller may change is the server's
 * capability answer for the mailbox: a delegate who may only read them sees every pane read-only, with no Save, and
 * no Delete. Access is a shared mailbox's; Delete is last, and asks.
 */
@Component({
    selector: 'app-mailbox-settings',
    standalone: true,
    imports: [
        CmsSettingsShellComponent, CmsSettingsPaneComponent,
        MailboxDetailsSectionComponent, MailboxConnectionSectionComponent, MailboxInboundSectionComponent,
        EmailDelegationsCardComponent, MailboxFiltersSectionComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <cms-settings-shell
            [title]="title()"
            icon="envelope"
            scopeLine="Mailbox settings"
            [sections]="sections()"
            [selectedId]="pane()"
            listLabel="Mailbox settings"
            splitterKey="cms.settings.mailbox.listW"
            (picked)="open($event)">

            @if (error(); as message) {
                <p class="text-danger p-3" role="alert">{{ message }}</p>
            } @else if (mailbox(); as mb) {
                @switch (pane()) {
                    @case ('general') {
                        <cms-settings-pane [title]="current().title" icon="envelope" owner="Email" [help]="current().help"
                                           settingKey="email.mailbox.general" [dirty]="body()?.dirty() ?? false"
                                           [saving]="body()?.saving() ?? false" [editable]="body()?.editable() ?? false"
                                           (save)="save()" (discard)="body()?.discard()">
                            <p class="cms-field-hint mb-3">{{ readOnlyNote() }}</p>
                            <app-mailbox-details-section #paneBody
                                [mailbox]="mb" [access]="access()['email.mailbox.update']"
                                [reset]="resetToken()" (saved)="mailbox.set($event)" (reload)="load()" />
                        </cms-settings-pane>
                    }
                    @case ('connection') {
                        <cms-settings-pane [title]="current().title" icon="plug" owner="Email" [help]="current().help"
                                           settingKey="email.mailbox.connection" [dirty]="body()?.dirty() ?? false"
                                           [saving]="body()?.saving() ?? false" [editable]="body()?.editable() ?? false"
                                           (save)="save()" (discard)="body()?.discard()">
                            <p class="cms-field-hint mb-3">{{ readOnlyNote() }}</p>
                            <app-mailbox-connection-section #paneBody part="connection"
                                [mailbox]="mb" [access]="access()['email.mailbox.update']"
                                [authorizeAccess]="access()['email.mailbox.authorize']"
                                [reset]="resetToken()" (saved)="mailbox.set($event)" (reload)="load()" />
                            @if (access()['email.mailbox.update'] !== 'denied') {
                                <button paneActions type="button" class="cms-btn cms-btn-sm"
                                        [disabled]="connection()?.testing() || connection()?.saving()"
                                        (click)="connection()?.test()">
                                    @if (access()['email.mailbox.update'] === 'elevate') { <i class="bi bi-lock"></i> }
                                    {{ connection()?.testing() ? 'Testing…' : 'Test connection' }}
                                </button>
                            }
                        </cms-settings-pane>
                    }
                    @case ('sync') {
                        <cms-settings-pane [title]="current().title" icon="arrow-repeat" owner="Email" [help]="current().help"
                                           settingKey="email.mailbox.sync" [dirty]="body()?.dirty() ?? false"
                                           [saving]="body()?.saving() ?? false" [editable]="body()?.editable() ?? false"
                                           (save)="save()" (discard)="body()?.discard()">
                            <p class="cms-field-hint mb-3">{{ readOnlyNote() }}</p>
                            <app-mailbox-connection-section #paneBody part="sync"
                                [mailbox]="mb" [access]="access()['email.mailbox.update']"
                                [reset]="resetToken()" (saved)="mailbox.set($event)" (reload)="load()" />
                        </cms-settings-pane>
                    }
                    @case ('filters') {
                        <!-- Turning a filter on or off, reordering and deleting are writes of their own; the pane's Save
                             and Discard are the open filter's, shown only while one is open. -->
                        <cms-settings-pane [title]="current().title" icon="funnel" owner="Email" [help]="current().help"
                                           settingKey="email.mailbox.filters" [dirty]="body()?.dirty() ?? false"
                                           [saving]="body()?.saving() ?? false" [editable]="body()?.editable() ?? false"
                                           saveLabel="Save filter" (save)="save()" (discard)="body()?.discard()">
                            <p class="cms-field-hint mb-3">{{ readOnlyNote() }}</p>
                            <app-mailbox-filters-section #paneBody [mailboxId]="mb.id"
                                [canManage]="access()['email.mailbox.update'] !== 'denied'" />
                        </cms-settings-pane>
                    }
                    @case ('rules') {
                        <cms-settings-pane [title]="current().title" icon="diagram-3" owner="Email" [help]="current().help"
                                           settingKey="email.mailbox.rules" [dirty]="body()?.dirty() ?? false"
                                           [saving]="body()?.saving() ?? false" [editable]="body()?.editable() ?? false"
                                           (save)="save()" (discard)="body()?.discard()">
                            <p class="cms-field-hint mb-3">{{ readOnlyNote() }}</p>
                            <app-mailbox-inbound-section #paneBody
                                [mailbox]="mb" [access]="access()['email.mailbox.update']"
                                [reset]="resetToken()" (saved)="mailbox.set($event)" (reload)="load()" />
                        </cms-settings-pane>
                    }
                    @case ('access') {
                        <!-- Delegations are granted and revoked one by one, each its own write: nothing to Save. -->
                        <cms-settings-pane [title]="current().title" icon="people" owner="Email" [help]="current().help"
                                           settingKey="email.mailbox.access" [editable]="false">
                            <app-email-delegations-card [mailboxId]="mb.id" />
                        </cms-settings-pane>
                    }
                    @case ('delete') {
                        <cms-settings-pane [title]="current().title" icon="trash" owner="Email" [danger]="true"
                                           settingKey="email.mailbox.delete">
                            <p>
                                CoolMS's copies of its mail, its rules and its settings are deleted. The account at the
                                mail provider is not touched: its mail stays there.
                            </p>
                            <button paneActions type="button" class="cms-btn cms-btn-sm cms-btn-danger" (click)="remove(mb)">
                                @if (access()['email.mailbox.update'] === 'elevate') { <i class="bi bi-lock"></i> }
                                <i class="bi bi-trash"></i> Delete this mailbox
                            </button>
                        </cms-settings-pane>
                    }
                }
            } @else {
                <p class="cms-field-hint p-3">Reading the mailbox...</p>
            }
        </cms-settings-shell>
    `,
    styles: [`:host { display: flex; flex-direction: column; flex: 1; min-height: 0; }`],
})
export class MailboxSettingsComponent implements HasUnsavedChanges {
    private readonly email = inject(EmailService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly toast = inject(ToastService);
    private readonly elevation = inject(ElevationService);

    readonly mailbox = signal<EmailMailboxDto | null>(null);
    readonly error = signal<string | null>(null);
    /** Moves on every read the page makes: each pane starts over from it (a pane's own save does not). */
    readonly resetToken = signal(0);
    readonly access = signal<Record<MailboxAction, CapabilityState>>({
        'email.mailbox.update': 'denied',
        'email.mailbox.authorize': 'denied',
    });
    /** The mailbox, as the host's URL names it. */
    readonly mailboxId = input.required<string>();
    /** The pane the host's URL names; null or unknown is the first. */
    readonly paneId = input<string | null>(null);
    /** Another pane was picked; `replace` when an unknown pane fell back to the first (the URL is corrected, not added to). */
    readonly paneChange = output<{ readonly pane: MailboxPane['id']; readonly replace: boolean }>();
    /** The mailbox was deleted: the host closes its settings. */
    readonly deleted = output<void>();

    readonly id = computed((): string => this.mailboxId());
    /** The pane open: the host's, when it is one of the panes. */
    readonly pane = computed((): MailboxPane['id'] => PANES.find(p => p.id === this.paneId())?.id ?? 'general');

    /** The open pane's section, whatever kind it is. */
    readonly body = viewChild<PaneBody>('paneBody');
    /** The Connection pane's section, for its Test connection button in the pane's footer. */
    readonly connection = viewChild(MailboxConnectionSectionComponent);

    /** The panes this caller is shown: Access only for a shared mailbox, Access and Delete only to who may change it. */
    readonly panes = computed((): MailboxPane[] => {
        const mb = this.mailbox();
        const mayChange = this.access()['email.mailbox.update'] !== 'denied';

        return PANES.filter(p => ('access' !== p.id || (mayChange && 'shared' === mb?.kind)) && ('delete' !== p.id || mayChange));
    });

    readonly sections = computed((): CmsSettingsSection[] =>
        this.panes().map(p => ({ id: p.id, label: p.title, danger: 'delete' === p.id })));

    readonly current = computed((): MailboxPane => this.panes().find(p => p.id === this.pane()) ?? PANES[0]);

    readonly title = computed((): string => {
        const mb = this.mailbox();

        return mb ? (mb.label || mb.emailAddress || 'Mailbox') : 'Mailbox settings';
    });

    /** Said at the top of every pane when the caller may only read it; empty otherwise. */
    readonly readOnlyNote = computed((): string => {
        const mb = this.mailbox();
        if (this.access()['email.mailbox.update'] !== 'denied' || null === mb) {
            return '';
        }

        return mb.access === 'read_only' || mb.access === 'read_and_send'
            ? `You read this mailbox as a delegate (${mb.access === 'read_only' ? 'read only' : 'read and send'}): its settings are shown, and only its owners can change them.`
            : 'You can read these settings; only the mailbox\'s owners can change them.';
    });

    constructor() {
        // Closing the tab or reloading with a dirty pane asks the browser's own question.
        const stop = inject(UnsavedChangesService).watch(this, () => this.dirty());
        inject(DestroyRef).onDestroy(stop);
        // A new mailbox is read when the host names one; a pane change reads nothing.
        effect(() => {
            const id = this.mailboxId();
            untracked(() => this.load(id));
        });
        // A pane the host named that is not one of the panes: the URL is corrected to the first.
        effect(() => {
            const asked = this.paneId();
            if (null !== asked && undefined === PANES.find(p => p.id === asked)) {
                untracked(() => this.paneChange.emit({ pane: 'general', replace: true }));
            }
        });
    }

    /** The open pane has edits not yet saved (the host asks before it closes or changes pane). */
    dirty(): boolean {
        return this.body()?.dirty() ?? false;
    }

    /** Pick a pane: the host changes the URL, and the pane follows it. */
    open(pane: string): void {
        const known = PANES.find(p => p.id === pane)?.id;
        if (undefined !== known) {
            this.paneChange.emit({ pane: known, replace: false });
        }
    }

    save(): void {
        this.body()?.save();
    }

    /**
     * Deletes the mailbox after the person confirms it -- CoolMS's copies of its mail, its rules and its settings go
     * with it; the account at the mail provider is not touched -- and tells the host, which closes the settings.
     * Asks for an elevated session first where the server answers "elevate".
     */
    remove(mailbox: EmailMailboxDto): void {
        const name = mailbox.label || mailbox.emailAddress || 'this mailbox';
        this.confirm.open({
            title: `Delete "${name}"?`,
            message: "CoolMS's copies of its mail, its rules and its settings are deleted. The account at the mail provider is not touched: its mail stays there.",
            confirmLabel: 'Delete',
            danger: true,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
            if (!confirmed) {
                return;
            }
            afterAccess(this.access()['email.mailbox.update'], this.elevation, () => {
                this.email.deleteMailbox(mailbox.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
                    next: () => {
                        this.toast.success('Mailbox deleted');
                        this.deleted.emit();
                    },
                    error: (err: unknown) => this.toast.error(this.errors.humanize(err)),
                });
            });
        });
    }

    /** The mailbox and what the caller may do to it, read together; a reload starts every pane over. */
    load(id: string = this.id()): void {
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
