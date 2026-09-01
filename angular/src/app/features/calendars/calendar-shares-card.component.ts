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

import {
    ApiService,
    CalendarShareDto,
    CalendarShareRoleCode,
    CreateCalendarShareDto,
} from '../../api/api.service';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService, UserSearchSelectComponent } from '@coolms/ui-angular';

type ShareeKind = 'user' | 'group';

/**
 * Calendar Shares card -- adapts the Site Membership UX
 * to the Calendar shares API at /api/v1/calendar/{slug}/shares.
 *
 * Two share targets:
 *  - user shares (`shareeUserId`)
 *  - group shares (`shareeGroupId`)
 *
 * Per-row chip indicates target type; same picker swaps endpoint
 * based on the selected radio.
 *
 * Role: VIEWER | EDITOR. Backend enforces voter gating on every
 * mutation -- only the calendar owner (or ROLE_ADMIN) reaches this
 * card; for read-only visitors the parent gates rendering.
 */
@Component({
    selector: 'app-calendar-shares-card',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UserSearchSelectComponent],
    template: `
        <section class="card">
            <header class="card__head">
                <h2 class="card__title">
                    <i class="bi bi-share"></i> Shares
                </h2>
                <span class="card__count">{{ shares().length }}</span>
            </header>
            <div class="card__body">
                @if (loading()) {
                    <p class="empty">Loading shares…</p>
                } @else if (loadError()) {
                    <p class="error">{{ loadError() }}</p>
                } @else {

                    @if (shares().length === 0) {
                        <p class="empty">
                            This calendar isn't shared with anyone yet.
                            Add a user or group below to grant view or edit access.
                        </p>
                    } @else {
                        <ul class="list">
                            @for (s of shares(); track s.id) {
                                <li class="row">
                                    <div class="row__main">
                                        <span class="chip"
                                              [class.chip--user]="!!s.shareeUserId"
                                              [class.chip--group]="!!s.shareeGroupId">
                                            <i class="bi"
                                               [class.bi-person]="!!s.shareeUserId"
                                               [class.bi-people]="!!s.shareeGroupId"></i>
                                            {{ s.shareeUserId ? 'User' : 'Group' }}
                                        </span>
                                        <span class="mono mono--muted" [title]="shareeId(s)">
                                            {{ shortenId(shareeId(s)) }}
                                        </span>
                                    </div>
                                    <div class="row__actions">
                                        <select class="role-select"
                                                [value]="s.role"
                                                [disabled]="!canManage() || busy()"
                                                (change)="onRoleChange(s, $any($event.target).value)">
                                            <option value="viewer">Viewer</option>
                                            <option value="editor">Editor</option>
                                        </select>
                                        @if (canManage()) {
                                            <button type="button"
                                                    class="cms-btn cms-btn-danger cms-btn-sm"
                                                    [disabled]="busy()"
                                                    (click)="confirmRevoke(s)">
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
                            <div class="add-form__kind">
                                <label class="field-inline">
                                    <input type="radio" name="sk"
                                           [checked]="shareeKind() === 'user'"
                                           (change)="shareeKind.set('user'); pickedId.set('')" />
                                    User
                                </label>
                                <label class="field-inline">
                                    <input type="radio" name="sk"
                                           [checked]="shareeKind() === 'group'"
                                           (change)="shareeKind.set('group'); pickedId.set('')" />
                                    Group
                                </label>
                            </div>
                            <div class="add-form__picker">
                                <app-user-search-select
                                        [apiUrl]="pickerUrl()"
                                        [value]="pickedId()"
                                        [entityLabel]="shareeKind()"
                                        [placeholder]="'Pick a ' + shareeKind() + ' to share with…'"
                                        (valueChange)="pickedId.set($event)" />
                            </div>
                            <select class="role-select" [value]="newRole()"
                                    (change)="newRole.set($any($event.target).value)">
                                <option value="viewer">Viewer</option>
                                <option value="editor">Editor</option>
                            </select>
                            <button type="button"
                                    class="cms-btn cms-btn-primary cms-btn-sm"
                                    [disabled]="busy() || !pickedId() || alreadyShared(pickedId())"
                                    (click)="addShare()">
                                <i class="bi bi-plus-lg"></i> Add share
                            </button>
                        </div>
                        @if (pickedId() && alreadyShared(pickedId())) {
                            <p class="hint hint--warn">
                                This {{ shareeKind() }} is already on the share list.
                            </p>
                        }
                    } @else {
                        <p class="hint">
                            Only the calendar owner can change shares.
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
            background: var(--cms-surface-muted);
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
            background: var(--cms-surface-muted);
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
        .row__actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }

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
        }
        .chip--user  { background: var(--cms-info-subtle); color: var(--cms-info-text); }
        .chip--group { background: var(--cms-meta-subtle); color: var(--cms-meta-text); }

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
            grid-template-columns: max-content 1fr max-content max-content;
            gap: 8px;
            align-items: center;
            border-top: 1px solid var(--cms-border, #e5e7eb);
            padding-top: 12px;
            margin-top: 4px;
        }
        .add-form__kind {
            display: flex;
            gap: 12px;
            flex-shrink: 0;
        }
        .add-form__picker { min-width: 200px; }

        .field-inline { display: inline-flex; align-items: center; gap: 4px; font-size: .85rem; }

        .role-select {
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-sm, 4px);
            padding: 4px 8px;
            font-size: .85rem;
            background: var(--cms-surface);
        }
        .role-select[disabled] { background: var(--cms-surface-muted); opacity: .7; cursor: not-allowed; }


        @media (max-width: 640px) {
            .add-form { grid-template-columns: 1fr; }
        }
    `],
})
export class CalendarSharesCardComponent implements OnInit {
    /** Calendar slug — used as the share endpoint path segment. */
    calendarSlug = input.required<string>();

    /** Whether current user can mutate shares (owner / admin). */
    canManage    = input<boolean>(false);

    private readonly api        = inject(ApiService);
    private readonly store      = inject(Store);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);

    readonly shares    = signal<CalendarShareDto[]>([]);
    readonly loading   = signal(true);
    readonly loadError = signal<string | null>(null);
    readonly busy      = signal(false);

    // Add-form state
    readonly shareeKind = signal<ShareeKind>('user');
    readonly pickedId   = signal<string>('');
    readonly newRole    = signal<CalendarShareRoleCode>('viewer');

    /** Picker URL — flips between Identity users + groups list endpoints. */
    readonly pickerUrl = computed<string>(() => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) return '';
        return this.shareeKind() === 'user'
            ? (m.identity?.usersUrl ?? '')
            : (m.identity?.groupsUrl ?? '');
    });

    ngOnInit(): void {
        this.loadShares();
    }

    private loadShares(): void {
        this.loading.set(true);
        this.loadError.set(null);
        this.api.listCalendarShares(this.calendarSlug()).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => {
                this.shares.set(rows);
                this.loading.set(false);
            },
            error: (err: unknown) => {
                this.loading.set(false);
                // Read-only viewers get 403 on GET /shares; surface as
                // a friendly hint rather than an error banner.
                const status = (err as { status?: number })?.status;
                if (status === 403) {
                    this.shares.set([]);
                } else {
                    this.loadError.set(this.errors.humanize(err));
                }
            },
        });
    }

    shareeId(s: CalendarShareDto): string {
        return s.shareeUserId ?? s.shareeGroupId ?? '';
    }

    alreadyShared(id: string): boolean {
        if (!id) return false;
        return this.shares().some(s =>
            s.shareeUserId === id || s.shareeGroupId === id,
        );
    }

    shortenId(id: string | null | undefined): string {
        if (!id) return '—';
        return id.length > 8 ? id.slice(0, 8) + '…' : id;
    }

    addShare(): void {
        if (!this.canManage()) return;
        const target = this.pickedId();
        if (!target || this.alreadyShared(target)) return;

        const dto: CreateCalendarShareDto = {
            role: this.newRole(),
            ...(this.shareeKind() === 'user'
                ? { shareeUserId:  target }
                : { shareeGroupId: target }),
        };

        this.busy.set(true);
        this.api.createCalendarShare(this.calendarSlug(), dto).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.busy.set(false);
                this.pickedId.set('');
                this.toast.success('Share added');
                this.loadShares();
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    onRoleChange(s: CalendarShareDto, newRole: string): void {
        if (!this.canManage()) return;
        if (newRole !== 'viewer' && newRole !== 'editor') return;
        if (newRole === s.role) return;

        this.busy.set(true);
        this.api.updateCalendarShare(this.calendarSlug(), s.id, {
            role: newRole,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.busy.set(false);
                this.toast.success('Share role updated');
                this.loadShares();
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
                // Reload so the dropdown reflects the on-server value.
                this.loadShares();
            },
        });
    }

    confirmRevoke(s: CalendarShareDto): void {
        if (!this.canManage()) return;
        const targetLabel = s.shareeUserId
            ? `user ${this.shortenId(s.shareeUserId)}`
            : `group ${this.shortenId(s.shareeGroupId)}`;
        this.confirmSvc.open({
            title:        `Revoke share?`,
            message:      `${targetLabel} will lose access to this calendar.`,
            confirmLabel: 'Revoke',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => {
                this.busy.set(true);
                return this.api.deleteCalendarShare(this.calendarSlug(), s.id);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.busy.set(false);
                this.toast.success('Share revoked');
                this.loadShares();
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }
}
