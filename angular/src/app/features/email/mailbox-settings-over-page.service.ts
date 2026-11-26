import { DestroyRef, Injectable, type Type, inject, signal } from '@angular/core';
import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfirmDialogService } from '@coolms/ui-angular';

import type { MailboxSettingsDialogComponent, MailboxSettingsDialogData } from './mailbox-settings-dialog.component';

/** The dialog, loaded the first time it is opened. */
const loadDialog = (): Promise<Type<MailboxSettingsDialogComponent>> =>
    import('./mailbox-settings-dialog.component').then(m => m.MailboxSettingsDialogComponent);

/**
 * A mailbox's settings as a modal over a page other than Email's: the same dialog and panes, the address untouched.
 * The open pane is held here; Esc, the close button, the scrim and another pane ask first while a pane holds unsaved
 * changes. It names the mailbox by its id alone, so the mailbox need not be in any list.
 *
 * Provided by the component that opens it, and closed with it.
 */
@Injectable()
export class MailboxSettingsOverPage {
    private readonly dialog = inject(Dialog);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly mailboxId = signal('');
    private readonly pane = signal<string | null>(null);
    private ref: DialogRef<unknown, MailboxSettingsDialogComponent> | null = null;
    private loading = false;

    constructor() {
        this.destroyRef.onDestroy(() => this.ref?.close());
    }

    /**
     * Opens a mailbox's settings on a pane (the first, for one that is none of them); `closed` runs once they close,
     * however they closed. Open already, they go to that mailbox and pane.
     */
    async open(mailboxId: string, pane: string, closed: () => void = () => undefined): Promise<void> {
        if (this.ref !== null) {
            this.ifClean(() => this.point(mailboxId, pane));
            return;
        }
        this.point(mailboxId, pane);
        if (this.loading) {
            return;
        }
        this.loading = true;
        try {
            const component = await loadDialog();
            if (!this.destroyRef.destroyed) {
                this.show(component, closed);
            }
        } finally {
            this.loading = false;
        }
    }

    private point(mailboxId: string, pane: string): void {
        this.mailboxId.set(mailboxId);
        this.pane.set(pane);
    }

    private show(component: Type<MailboxSettingsDialogComponent>, closed: () => void): void {
        const close = (): void => this.ref?.close();
        const data: MailboxSettingsDialogData = {
            mailboxId: this.mailboxId.asReadonly(),
            pane: this.pane.asReadonly(),
            onPane: change => {
                if (change.replace) {
                    this.pane.set(change.pane);
                } else {
                    this.ifClean(() => this.pane.set(change.pane));
                }
            },
            onCloseRequested: () => this.ifClean(close),
            onDeleted: close,
        };
        const ref = this.dialog.open<unknown, MailboxSettingsDialogData, MailboxSettingsDialogComponent>(component, {
            data,
            panelClass: 'cms-settings-dialog-panel',
            ariaLabel: 'Mailbox settings',
            // Esc and the scrim are requests answered here (a dirty pane asks first).
            disableClose: true,
        });
        this.ref = ref;
        ref.backdropClick.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.ifClean(close));
        ref.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.ref = null;
            closed();
        });
    }

    /** Runs `go` at once, or after the person agreed to discard what the open pane holds unsaved. */
    private ifClean(go: () => void): void {
        if (!(this.ref?.componentInstance?.settings().dirty() ?? false)) {
            go();
            return;
        }
        this.confirm.confirmDiscard().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(discard => {
            if (discard) {
                go();
            }
        });
    }
}
