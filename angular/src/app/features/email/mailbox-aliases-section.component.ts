import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngxs/store';
import { catchError, filter, forkJoin, of } from 'rxjs';
import { AuthState, ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';

import { EmailLiveEventsService } from './email-live-events.service';
import { EmailService } from './email.service';
import {
    declinedRecently,
    type MailAlias,
    type MailboxSendAsDto,
    refusalInWords,
    sendFromRows,
    type SendFromRow,
} from './mail-aliases';

/** The line under the list after an ask: the link sent, or why not. */
interface Notice {
    readonly kind: 'sent' | 'refused';
    readonly text: string;
}

/**
 * The "Addresses you send from" pane of a mailbox's settings: the mailbox's own address and the ones its provider
 * verified, which are shown and not changed here, then each address typed for it, confirmed or waiting for its owner
 * to answer the link mailed to it (valid 24 hours).
 *
 * Who may change the mailbox's settings (the list's `canManage`) adds an address, sends its link again, and withdraws
 * one; anyone else reads the list. Confirming, declining and withdrawing, from any tab or from the mailed link, arrive
 * as `mail.aliases.changed` on the person's mail channel, and the list is read again.
 */
@Component({
    selector: 'app-mailbox-aliases-section',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DatePipe, FormsModule],
    template: `
        <p class="cms-field-hint">
            A message sent from this mailbox can come from any address below. An address you add is used only once its
            owner answers the mail sent to it.
        </p>

        @if (loading()) {
            <p class="sfa__empty">Loading addresses…</p>
        } @else if (loadError(); as message) {
            <p class="sfa__error" role="alert">{{ message }}</p>
        } @else {
            <ul class="sfa__list" aria-label="Addresses you send from">
                @for (row of rows(); track row.kind + ' ' + row.address) {
                    <li class="sfa__row" [class.sfa__row--alias]="row.kind === 'alias'">
                        <div class="sfa__main">
                            <span class="sfa__address">{{ row.address }}</span>
                            @switch (row.kind) {
                                @case ('own') {
                                    <span class="sfa__chip sfa__chip--fixed">This mailbox's address</span>
                                }
                                @case ('provider') {
                                    <span class="sfa__chip sfa__chip--fixed">Verified by the provider</span>
                                }
                                @case ('alias') {
                                    @switch (row.alias.status) {
                                        @case ('confirmed') {
                                            <span class="sfa__chip sfa__chip--confirmed">Confirmed</span>
                                        }
                                        @case ('pending') {
                                            <span class="sfa__chip sfa__chip--pending">Waiting for confirmation</span>
                                        }
                                        @case ('expired') {
                                            <span class="sfa__chip sfa__chip--off">Link expired</span>
                                        }
                                        @case ('declined') {
                                            <span class="sfa__chip sfa__chip--off">Declined</span>
                                        }
                                    }
                                }
                            }
                            @if (row.kind === 'alias') {
                                <span class="sfa__meta">
                                    @switch (row.alias.status) {
                                        @case ('confirmed') {
                                            @if (row.alias.confirmedAt) { Confirmed {{ row.alias.confirmedAt | date: 'medium' }} }
                                        }
                                        @case ('pending') {
                                            @if (row.alias.expiresAt) { Expires at {{ row.alias.expiresAt | date: 'medium' }} }
                                        }
                                        @case ('expired') { Its owner did not answer within 24 hours. }
                                    }
                                    @if (isDeclined(row.alias)) {
                                        Declined by the address's owner.
                                        @if (askAgainAt(row.alias); as when) { It can be asked for again after {{ when | date: 'medium' }}. }
                                    }
                                </span>
                            } @else if (row.kind === 'own') {
                                <span class="sfa__meta">Always offered; not changed here.</span>
                            } @else {
                                <span class="sfa__meta">Verified at the mail provider; not changed here.</span>
                            }
                        </div>
                        <!-- A declined address has no action: withdrawing it would drop the decline, and the owner
                             could be mailed again. -->
                        @if (row.kind === 'alias' && canManage() && !isDeclined(row.alias)) {
                            <div class="sfa__actions">
                                @if (row.alias.status === 'pending' || row.alias.status === 'expired') {
                                    <button type="button" class="cms-btn cms-btn-sm" [disabled]="busy()"
                                            (click)="sendAgain(row.alias)">
                                        <i class="bi bi-arrow-repeat"></i> Send again
                                    </button>
                                }
                                <button type="button" class="cms-btn cms-btn-sm cms-btn-danger" [disabled]="busy()"
                                        (click)="withdraw(row.alias)">
                                    <i class="bi bi-x-lg"></i> Withdraw
                                </button>
                            </div>
                        }
                    </li>
                }
            </ul>
            @if (sendAsRefused()) {
                <p class="sfa__hint">The addresses the mail provider verified are shown to those who may send from this mailbox.</p>
            } @else if (unreadable()) {
                <p class="sfa__hint">The provider's own list could not be read just now, so its addresses are not shown.</p>
            }

            @if (canManage()) {
                <form class="sfa__add" (ngSubmit)="add()">
                    <label class="cms-label" for="sfa-address">Add an address</label>
                    <div class="sfa__add-line">
                        <input id="sfa-address" class="cms-input" type="email" name="address" autocomplete="off"
                               placeholder="name@example.com" [ngModel]="address()" (ngModelChange)="address.set($event)" />
                        <button type="submit" class="cms-btn cms-btn-primary cms-btn-sm" [disabled]="busy() || !address().trim()">
                            <i class="bi bi-send"></i> Send confirmation
                        </button>
                    </div>
                </form>
            } @else {
                <p class="sfa__hint">Only who may change this mailbox's settings adds or withdraws addresses.</p>
            }

            @if (notice(); as n) {
                <p class="sfa__notice" [class.sfa__notice--refused]="n.kind === 'refused'"
                   [attr.role]="n.kind === 'refused' ? 'alert' : 'status'">{{ n.text }}</p>
            }
        }
    `,
    styles: [`
        :host { display: block; }
        .sfa__empty, .sfa__hint, .sfa__meta { color: var(--cms-text-muted); }
        .sfa__error { color: var(--cms-danger); }
        .sfa__list { list-style: none; margin: 0 0 12px; padding: 0; border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md); }
        .sfa__row { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--cms-border); }
        .sfa__row:last-child { border-bottom: 0; }
        .sfa__main { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; flex: 1; }
        .sfa__address { font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
        .sfa__meta { flex-basis: 100%; font-size: .8rem; }
        .sfa__chip { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: var(--cms-radius-lg); font-size: .75rem; font-weight: 600; border: 1px solid transparent; }
        .sfa__chip--fixed { background: var(--cms-info-subtle); color: var(--cms-info-text); border-color: var(--cms-info-subtle-border); }
        .sfa__chip--confirmed { background: var(--cms-success-subtle); color: var(--cms-success-text); border-color: var(--cms-success-subtle-border); }
        .sfa__chip--pending { background: var(--cms-warning-subtle); color: var(--cms-warning-text); border-color: var(--cms-warning-subtle-border); }
        .sfa__chip--off { background: var(--cms-surface-muted); color: var(--cms-text-muted); border-color: var(--cms-border); }
        .sfa__actions { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
        .sfa__hint { font-size: .8rem; margin: 0 0 12px; }
        .sfa__add { margin: 0; }
        .sfa__add-line { display: flex; gap: 8px; align-items: center; }
        .sfa__add-line .cms-input { flex: 1; min-width: 0; }
        .sfa__notice { margin: 8px 0 0; font-size: .875rem; overflow-wrap: anywhere; }
        .sfa__notice--refused { color: var(--cms-danger); }
        @media (max-width: 640px) {
            .sfa__row { flex-direction: column; align-items: stretch; }
            .sfa__actions { justify-content: flex-start; }
            .sfa__add-line { flex-direction: column; align-items: stretch; }
        }
    `],
})
export class MailboxAliasesSectionComponent {
    /** The mailbox whose addresses these are. */
    readonly mailboxId = input.required<string>();
    /** The mailbox's own address, always first. */
    readonly ownAddress = input<string | null>(null);

    private readonly email = inject(EmailService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly toast = inject(ToastService);
    private readonly live = inject(EmailLiveEventsService);
    private readonly store = inject(Store);
    private readonly destroyRef = inject(DestroyRef);

    readonly aliases = signal<readonly MailAlias[]>([]);
    /** The server's answer: whether this caller may add, send again and withdraw. */
    readonly canManage = signal(false);
    /** Send-as as served; null when it could not be read (one who may read the mailbox but not send from it). */
    readonly sendAs = signal<MailboxSendAsDto | null>(null);
    readonly loading = signal(true);
    readonly loadError = signal<string | null>(null);
    readonly busy = signal(false);
    readonly address = signal('');
    readonly notice = signal<Notice | null>(null);
    /** Send-as answered 403: one who may read the mailbox but not send from it. */
    readonly sendAsRefused = signal(false);
    /**
     * Aliases a withdraw found declined (a list read before the decline, in this tab), by id: when each may be asked
     * for again, null when the answer did not say. Kept across reads, for a list that does not carry the date.
     */
    readonly declinedSeen = signal<Readonly<Record<string, string | null>>>({});

    readonly rows = computed((): SendFromRow[] =>
        sendFromRows(this.ownAddress(), this.sendAs()?.addresses ?? [], this.aliases()));
    readonly unreadable = computed((): boolean => !!this.sendAs()?.unreadable);

    constructor() {
        effect(() => {
            const id = this.mailboxId();
            untracked(() => {
                this.loading.set(true);
                this.notice.set(null);
                this.load(id);
            });
        });
        const uid = this.store.selectSnapshot(AuthState.currentUser)?.id ?? null;
        if (uid !== null) {
            this.live.watch(uid)
                .pipe(
                    filter(evt => evt.type === 'mail.aliases.changed' && evt.mailboxId === this.mailboxId()),
                    takeUntilDestroyed(this.destroyRef),
                )
                .subscribe({ next: () => this.load(), error: () => undefined });
        }
    }

    /** The list and send-as, read together; send-as that cannot be read leaves the own address and the aliases. */
    load(id: string = this.mailboxId()): void {
        forkJoin({
            list: this.email.listAliases(id),
            sendAs: this.email.getSendAs(id).pipe(catchError((err: unknown) => of(
                err instanceof HttpErrorResponse && err.status === 403 ? 'refused' as const : null,
            ))),
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: ({ list, sendAs }) => {
                this.loadError.set(null);
                this.sendAsRefused.set(sendAs === 'refused');
                this.canManage.set(list.canManage);
                this.aliases.set(list.aliases);
                this.sendAs.set(sendAs === 'refused' ? null : sendAs);
                this.loading.set(false);
            },
            error: (err: unknown) => {
                this.loading.set(false);
                this.loadError.set(this.errors.humanize(err));
            },
        });
    }

    /** Mails the typed address its link; the row waits for its owner's answer. */
    add(): void {
        const address = this.address().trim();
        if (!this.canManage() || address === '') {
            return;
        }
        this.ask(address, () => this.address.set(''));
    }

    /** A fresh link to an address still waiting, or whose link expired: the old one stops working. */
    sendAgain(alias: MailAlias): void {
        if (!this.canManage()) {
            return;
        }
        this.ask(alias.address);
    }

    /** Declined by the address's owner: the list says so, or a withdraw found it so. */
    isDeclined(alias: MailAlias): boolean {
        return alias.status === 'declined' || alias.id in this.declinedSeen();
    }

    /** When a declined address may be asked for again: the list's date, else the one a refused withdraw gave. */
    askAgainAt(alias: MailAlias): string | null {
        return alias.askAgainAt ?? this.declinedSeen()[alias.id] ?? null;
    }

    /** Withdraws an address after the person confirms it; a declined one is kept, never withdrawn. */
    withdraw(alias: MailAlias): void {
        if (!this.canManage() || this.isDeclined(alias)) {
            return;
        }
        this.confirm.open({
            title: `Withdraw ${alias.address}?`,
            message: alias.status === 'confirmed'
                ? 'This mailbox stops sending from this address. Adding it again mails its owner a new link.'
                : 'The address is removed from this mailbox; a link already sent to it stops working.',
            confirmLabel: 'Withdraw',
            danger: true,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
            if (!confirmed) {
                return;
            }
            this.busy.set(true);
            this.email.withdrawAlias(this.mailboxId(), alias.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
                next: () => {
                    this.busy.set(false);
                    this.aliases.update(list => list.filter(a => a.id !== alias.id));
                    this.sendAs.update(s => s === null ? s : { ...s, addresses: s.addresses.filter(a => a.toLowerCase() !== alias.address.toLowerCase()) });
                    this.toast.success(`${alias.address} withdrawn`);
                },
                error: (err: unknown) => {
                    this.busy.set(false);
                    const askAgain = declinedRecently(err);
                    if (askAgain !== undefined) {
                        this.declinedSeen.update(seen => ({ ...seen, [alias.id]: askAgain }));
                        this.load();
                        return;
                    }
                    this.toast.error(this.errors.humanize(err));
                },
            });
        });
    }

    private ask(address: string, done: () => void = () => undefined): void {
        this.busy.set(true);
        this.notice.set(null);
        this.email.askAlias(this.mailboxId(), address).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: asked => {
                this.busy.set(false);
                const row: MailAlias = {
                    id: asked.id, address: asked.address, status: 'pending', requestedAt: new Date().toISOString(),
                    confirmedAt: null, expiresAt: asked.expiresAt,
                };
                this.aliases.update(list => list.some(a => a.id === asked.id)
                    ? list.map(a => a.id === asked.id ? row : a)
                    : [...list.filter(a => a.address.toLowerCase() !== asked.address.toLowerCase()), row]);
                this.notice.set({ kind: 'sent', text: `We sent a link to ${asked.address}. It works for 24 hours.` });
                done();
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.notice.set({ kind: 'refused', text: refusalInWords(err) ?? this.errors.humanize(err) });
            },
        });
    }
}
