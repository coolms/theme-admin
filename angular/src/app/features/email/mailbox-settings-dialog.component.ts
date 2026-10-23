import { ChangeDetectionStrategy, Component, type Signal, inject, viewChild } from '@angular/core';
import { DIALOG_DATA } from '@angular/cdk/dialog';

import { type MailboxPane, MailboxSettingsComponent } from './mailbox-settings.component';

/** What the modal's host hands it: the URL's mailbox and pane, and where its requests go. */
export interface MailboxSettingsDialogData {
    readonly mailboxId: Signal<string>;
    readonly pane: Signal<string | null>;
    readonly onPane: (change: { readonly pane: MailboxPane['id']; readonly replace: boolean }) => void;
    /** Esc, the close button or the scrim: the host asks first when a pane holds unsaved changes. */
    readonly onCloseRequested: () => void;
    readonly onDeleted: () => void;
}

/**
 * A mailbox's settings in a modal over the Email page: the same settings shell, list and panes as before, framed
 * with a close button. It does nothing with the URL itself -- the host keeps the URL and the modal in step -- so
 * Esc and the close button are only requests to close.
 */
@Component({
    selector: 'app-mailbox-settings-dialog',
    standalone: true,
    imports: [MailboxSettingsComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="cms-settings-dialog" (keydown.escape)="$event.stopPropagation(); data.onCloseRequested()">
            <button type="button" class="cms-dialog-close cms-settings-dialog__close" aria-label="Close"
                    (click)="data.onCloseRequested()">
                <i class="bi bi-x-lg"></i>
            </button>
            <app-mailbox-settings
                [mailboxId]="data.mailboxId()"
                [paneId]="data.pane()"
                (paneChange)="data.onPane($event)"
                (deleted)="data.onDeleted()" />
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }
        .cms-settings-dialog { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .cms-settings-dialog__close { position: absolute; top: 12px; right: 12px; z-index: 1; }
    `],
})
export class MailboxSettingsDialogComponent {
    readonly data = inject<MailboxSettingsDialogData>(DIALOG_DATA);
    /** The settings inside: whether a pane holds unsaved changes. */
    readonly settings = viewChild.required(MailboxSettingsComponent);
}
