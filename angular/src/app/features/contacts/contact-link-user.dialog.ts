import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import { ModalComponent, UserSearchSelectComponent } from '@coolms/ui-angular';

/** Data passed into the dialog from the consumer page. */
export interface LinkUserDialogData {
    /** Display name of the contact being linked — for the dialog title. */
    readonly contactName: string;
}

/** Returned via DialogRef.close() on confirm; null on cancel. */
export interface LinkUserDialogResult {
    readonly userId: string;
}

/**
 * C.6.a FE — "Link platform user" dialog.
 *
 * Thin wrapper around `<app-user-search-select>` + a Confirm/Cancel footer,
 * mirroring {@link InboxTaskDelegateDialogComponent}. The consumer
 * ({@link ContactsListComponent}) opens it via the CDK `Dialog` service, awaits
 * `DialogRef.closed`, then posts to `POST /contacts/{id}/link-user` with the
 * picked UUID. Existence of the user is validated server-side (404 otherwise).
 */
@Component({
    selector: 'coolms-contact-link-user-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, UserSearchSelectComponent],
    template: `
        <app-modal [title]="'Link platform user — ' + data.contactName" [width]="440">
            <p style="margin: 0 0 12px 0; color: var(--cms-text-muted, #6c757d);">
                Associate this contact with an existing platform user account.
            </p>

            <label style="display: block; margin-bottom: 4px; font-weight: 500;">
                Platform user
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
                    Link user
                </button>
            </ng-container>
        </app-modal>
    `,
})
export class ContactLinkUserDialogComponent {
    readonly data = inject<LinkUserDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<LinkUserDialogResult | null>>(DialogRef);
    private readonly store     = inject(Store);

    /** Picked user UUID. Empty string disables the Link button. */
    readonly picked = signal<string>('');

    /**
     * The users list/search URL — resolved from the boot manifest
     * (`identity.usersUrl` = `GET /api/v1/auth/users`), the same source the
     * working pickers use (site-members, vfs-chown). RQL-searchable per
     * LazySelect's `'rql'` searchStyle. (A hardcoded `/identity/users` 404s —
     * there is no such route; only `/auth/users` exists.)
     */
    readonly usersApiUrl: string = (() => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        return m?.identity?.usersUrl ?? `${m?.apiBase ?? '/api/v1'}/auth/users`;
    })();

    confirm(): void {
        const v = this.picked();
        if (v === '') return;
        this.dialogRef.close({ userId: v });
    }

    cancel(): void {
        this.dialogRef.close(null);
    }
}
