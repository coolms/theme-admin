import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    input,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs/operators';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService, UserSearchSelectComponent } from '@coolms/ui-angular';
import { EmailService } from './email.service';
import { MailboxDelegationDto } from './email.types';

/**
 * #1426 — the Gmail/Workspace "delegate access" card on the mailbox editor
 * (Slice 3 of the delegation feature). Lists a mailbox's delegates and lets the
 * owner/admin grant + revoke; the backend MANAGE-gates every op and notifies the
 * owner on grant. A delegate gains read + send-as (no role tiers), so this is a
 * simplification of {@link CalendarSharesCardComponent}: no role select, no group
 * target — just a user picker + Add + Revoke.
 */
@Component({
    selector: 'app-email-delegations-card',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UserSearchSelectComponent],
    template: `
        <section class="card">
            <header class="card__head">
                <h2 class="card__title">
                    <i class="bi bi-people"></i> Delegates
                </h2>
                <span class="card__count">{{ delegations().length }}</span>
            </header>
            <div class="card__body">
                @if (loading()) {
                    <p class="empty">Loading delegates…</p>
                } @else if (loadError()) {
                    <p class="error">{{ loadError() }}</p>
                } @else {

                    @if (delegations().length === 0) {
                        <p class="empty">
                            No one has delegate access to this mailbox yet.
                            Add a user below to let them read and send mail on its behalf.
                        </p>
                    } @else {
                        <ul class="list">
                            @for (d of delegations(); track d.id) {
                                <li class="row">
                                    <div class="row__main">
                                        <span class="chip">
                                            <i class="bi bi-person"></i> Delegate
                                        </span>
                                        <span class="mono mono--muted" [title]="d.delegateUserId">
                                            {{ shortenId(d.delegateUserId) }}
                                        </span>
                                    </div>
                                    <div class="row__actions">
                                        @if (canManage()) {
                                            <button type="button"
                                                    class="cms-btn cms-btn-danger cms-btn-sm"
                                                    [disabled]="busy()"
                                                    (click)="confirmRevoke(d)">
                                                <i class="bi bi-x-lg"></i> Revoke
                                            </button>
                                        }
                                    </div>
                                </li>
                            }
                        </ul>
                    }

                    @if (canManage()) {
                        <div class="add-form">
                            <div class="add-form__picker">
                                <app-user-search-select
                                        [apiUrl]="usersUrl()"
                                        [value]="pickedId()"
                                        [entityLabel]="'user'"
                                        [placeholder]="'Pick a user to delegate to…'"
                                        (valueChange)="pickedId.set($event)" />
                            </div>
                            <button type="button"
                                    class="cms-btn cms-btn-primary cms-btn-sm"
                                    [disabled]="busy() || !pickedId() || alreadyDelegated(pickedId())"
                                    (click)="addDelegation()">
                                <i class="bi bi-plus-lg"></i> Add delegate
                            </button>
                        </div>
                        @if (pickedId() && alreadyDelegated(pickedId())) {
                            <p class="hint hint--warn">
                                This user is already a delegate.
                            </p>
                        }
                        <p class="hint">
                            A delegate can read and send mail from this mailbox. You'll be
                            notified whenever access is granted.
                        </p>
                    } @else {
                        <p class="hint">
                            Only the mailbox owner or an admin can change delegates.
                        </p>
                    }

                }
            </div>
        </section>
    `,
    styles: [`
        :host { display: block; }

        .card {
            background: var(--cms-surface, #fff);
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .card__head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 10px 16px;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
            background: var(--cms-surface-hover, #f3f4f6);
        }
        .card__title {
            margin: 0;
            font-size: .9rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .card__count {
            font-size: .8rem;
            color: var(--cms-text-muted, #848b96);
            background: var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-lg, 10px);
            padding: 1px 8px;
        }
        .card__body { padding: 12px 16px; }

        .list { list-style: none; margin: 0 0 8px; padding: 0; }
        .row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 0;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
        }
        .row:last-child { border-bottom: 0; }
        .row__main {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
            flex-wrap: wrap;
        }
        .row__actions { display: flex; align-items: center; gap: 6px; }

        .chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: var(--cms-radius-lg, 10px);
            font-size: .7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .03em;
            background: var(--cms-info-subtle);
            color: var(--cms-info-text);
        }

        .mono { font-family: var(--cms-font-mono, monospace); font-size: .8rem; }
        .mono--muted { color: var(--cms-text-muted, #848b96); }

        .empty { color: var(--cms-text-muted, #848b96); margin: 0 0 8px; }
        .error { color: var(--cms-danger, #dc2626); margin: 0 0 8px; }
        .hint {
            margin: 8px 0 0;
            font-size: .75rem;
            color: var(--cms-text-muted, #848b96);
        }
        .hint--warn { color: var(--cms-warning-text); }

        .add-form {
            display: grid;
            grid-template-columns: 1fr max-content;
            gap: 8px;
            align-items: center;
            border-top: 1px solid var(--cms-border, #e5e7eb);
            padding-top: 12px;
            margin-top: 4px;
        }
        .add-form__picker { min-width: 200px; }


        @media (max-width: 640px) {
            .add-form { grid-template-columns: 1fr; }
        }
    `],
})
export class EmailDelegationsCardComponent implements OnInit {
    /** The mailbox whose delegates are managed — the endpoint path segment. */
    mailboxId = input.required<string>();

    /** Whether the current user can mutate delegates (owner / admin). */
    canManage = input<boolean>(true);

    private readonly email      = inject(EmailService);
    private readonly store      = inject(Store);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);

    readonly delegations = signal<MailboxDelegationDto[]>([]);
    readonly loading     = signal(true);
    readonly loadError   = signal<string | null>(null);
    readonly busy        = signal(false);

    readonly pickedId = signal<string>('');

    /** Identity users list endpoint from the boot manifest. */
    readonly usersUrl = computed<string>(() => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        return m?.identity?.usersUrl ?? '';
    });

    ngOnInit(): void {
        this.loadDelegations();
    }

    private loadDelegations(): void {
        this.loading.set(true);
        this.loadError.set(null);
        this.email.listDelegations(this.mailboxId()).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => {
                this.delegations.set(rows);
                this.loading.set(false);
            },
            error: (err: unknown) => {
                this.loading.set(false);
                // Non-managers get 403 on GET /delegations; degrade to empty
                // rather than an error banner (mirrors the calendar shares card).
                const status = (err as { status?: number })?.status;
                if (status === 403) {
                    this.delegations.set([]);
                } else {
                    this.loadError.set(this.errors.humanize(err));
                }
            },
        });
    }

    alreadyDelegated(id: string): boolean {
        if (!id) return false;
        return this.delegations().some(d => d.delegateUserId === id);
    }

    shortenId(id: string | null | undefined): string {
        if (!id) return '—';
        return id.length > 8 ? id.slice(0, 8) + '…' : id;
    }

    addDelegation(): void {
        if (!this.canManage()) return;
        const target = this.pickedId();
        if (!target || this.alreadyDelegated(target)) return;

        this.busy.set(true);
        this.email.grantDelegation(this.mailboxId(), { delegateUserId: target }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.busy.set(false);
                this.pickedId.set('');
                this.toast.success('Delegate added');
                this.loadDelegations();
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    confirmRevoke(d: MailboxDelegationDto): void {
        if (!this.canManage()) return;
        this.confirmSvc.open({
            title:        'Revoke delegate?',
            message:      `User ${this.shortenId(d.delegateUserId)} will lose access to this mailbox.`,
            confirmLabel: 'Revoke',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => {
                this.busy.set(true);
                return this.email.revokeDelegation(this.mailboxId(), d.id);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.busy.set(false);
                this.toast.success('Delegate revoked');
                this.loadDelegations();
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }
}
