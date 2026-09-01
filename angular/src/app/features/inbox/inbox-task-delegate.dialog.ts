import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import { ModalComponent, UserSearchSelectComponent } from '@coolms/ui-angular';

/** Data passed into the dialog from the consumer page. */
export interface DelegateDialogData {
    readonly taskId: string;
    /** Activity id (BPMN element id) for display in the dialog title. */
    readonly activityId: string;
}

/** Returned via DialogRef.close() on confirm; null on cancel. */
export interface DelegateDialogResult {
    readonly delegateeUserId: string;
}

/**
 * FE — Delegate dialog.
 *
 * Tiny wrapper around `<app-user-search-select>` + a Confirm/Cancel
 * footer. The consumer (`inbox-list.page`) opens it via the CDK
 * `Dialog` service, awaits `DialogRef.closed`, then posts to
 * `POST /inbox/tasks/{id}/delegate` with the picked UUID.
 *
 * **Why a thin dialog over a full form**: delegation is single-field
 * (`delegateeUserId`). No EL output mapping, no metadata, just "pick
 * a person." The backend `TaskDelegateService` rejects self-delegate
 * via the Domain mutator -- no client-side guard needed.
 */
@Component({
    selector: 'coolms-inbox-task-delegate-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, UserSearchSelectComponent],
    template: `
        <app-modal [title]="'Delegate task — ' + data.activityId" [width]="440">
            <p style="margin: 0 0 12px 0; color: var(--cms-text-muted, #848b96);">
                Pick the user this task should be handed off to.
            </p>

            <label style="display: block; margin-bottom: 4px; font-weight: 500;">
                Delegate to
            </label>
            <app-user-search-select
                [apiUrl]="usersApiUrl"
                [value]="picked()"
                entityLabel="user"
                placeholder="— Search by username or email —"
                (valueChange)="picked.set($event)" />

            <ng-container footer>
                <button type="button"
                        class="cms-btn"
                        (click)="cancel()">
                    Cancel
                </button>
                <button type="button"
                        class="cms-btn cms-btn-primary"
                        [disabled]="picked() === ''"
                        (click)="confirm()">
                    Delegate
                </button>
            </ng-container>
        </app-modal>
    `,
})
export class InboxTaskDelegateDialogComponent {
    readonly data = inject<DelegateDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<DelegateDialogResult | null>>(DialogRef);
    private readonly store     = inject(Store);

    /** Picked user UUID. Empty string disables the Delegate button. */
    readonly picked = signal<string>('');

    /**
     * The users list/search URL — resolved from the boot manifest
     * (`identity.usersUrl` = `GET /api/v1/auth/users`), the same source the
     * working pickers use (site-members, vfs-chown, messages). RQL-searchable
     * per LazySelect's `'rql'` searchStyle. (A hardcoded `/identity/users` 404s —
     * there is no such route; only `/auth/users` exists.)
     */
    readonly usersApiUrl: string = (() => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        return m?.identity?.usersUrl ?? `${m?.apiBase ?? '/api/v1'}/auth/users`;
    })();

    confirm(): void {
        const v = this.picked();
        if (v === '') return;
        this.dialogRef.close({ delegateeUserId: v });
    }

    cancel(): void {
        this.dialogRef.close(null);
    }
}
