import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import { Location } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { combineLatest, filter } from 'rxjs';
import { ConfirmDialogService } from '@coolms/ui-angular';

import { MailboxSettingsDialogComponent, type MailboxSettingsDialogData } from './mailbox-settings-dialog.component';

/** The query parameter that holds the open settings pane. */
export const SETTINGS_PARAM = 'settings';

/**
 * A mailbox's settings as a modal over the Email page, kept in step with the URL (decided 2026-10-24):
 *
 *   /email;mailbox={id}?settings={pane}   the modal open on that pane, over that mailbox's page
 *
 * - The URL is the truth. A link opens the modal on its pane; the modal is open exactly while the URL names one.
 * - Picking a pane REPLACES the URL, so browser Back closes the modal rather than stepping through panes.
 * - Esc, the close button and the scrim ask to close: with unsaved changes, "Discard changes" or "Keep editing".
 *   Closing goes back in history when the entry before is this page without the modal (Back and the close button
 *   then do the same thing); otherwise it replaces the URL with the page's own.
 * - Back while a pane holds unsaved changes cannot be refused by a browser: the modal URL is put back and the
 *   question is asked; "Discard changes" then closes it.
 *
 * Provided by the Email page, and alive exactly as long as it.
 */
@Injectable()
export class MailboxSettingsModal {
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly dialog = inject(Dialog);
    private readonly location = inject(Location);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly mailboxId = signal('');
    private readonly pane = signal<string | null>(null);
    private ref: DialogRef<unknown, MailboxSettingsDialogComponent> | null = null;
    /** The URL before the current one, and the current one (each after redirects). */
    private previousUrl: string | null = null;
    private currentUrl: string | null = null;
    /** Set while the modal is being closed on purpose: the URL losing its pane then needs no question. */
    private leaving = false;

    constructor() {
        this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
            .subscribe(e => {
                this.previousUrl = this.currentUrl;
                this.currentUrl = e.urlAfterRedirects;
            });
        this.destroyRef.onDestroy(() => this.ref?.close());
    }

    /** Follows the page's URL from now on. */
    attach(): void {
        combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(([params, query]) => this.follow(params.get('mailbox'), query.get(SETTINGS_PARAM)));
    }

    /** Opens a mailbox's settings from the page: one history entry, so Back closes them. */
    open(mailboxId: string, pane = 'general'): void {
        void this.router.navigate(['/email', { mailbox: mailboxId }], { queryParams: { [SETTINGS_PARAM]: pane } });
    }

    /** Whether the open modal's pane holds unsaved changes. */
    private dirty(): boolean {
        return this.ref?.componentInstance?.settings().dirty() ?? false;
    }

    private follow(mailboxId: string | null, pane: string | null): void {
        if (null !== mailboxId && null !== pane) {
            this.mailboxId.set(mailboxId);
            this.pane.set(pane);
            if (null === this.ref) {
                this.show();
            }
            return;
        }
        if (null === this.ref) {
            return;
        }
        if (this.leaving || !this.dirty()) {
            this.hide();
            return;
        }
        // Back with unsaved changes: the modal stays, its URL is put back, and the question is asked.
        void this.router.navigate(['/email', { mailbox: this.mailboxId() }], { queryParams: { [SETTINGS_PARAM]: this.pane() } });
        this.askThenLeave();
    }

    private show(): void {
        const data: MailboxSettingsDialogData = {
            mailboxId: this.mailboxId.asReadonly(),
            pane: this.pane.asReadonly(),
            onPane: change => this.changePane(change.pane, change.replace),
            onCloseRequested: () => this.askThenLeave(),
            onDeleted: () => {
                this.leaving = true;
                void this.router.navigate(['/email'], { replaceUrl: true });
            },
        };
        this.ref = this.dialog.open(MailboxSettingsDialogComponent, {
            data,
            panelClass: 'cms-settings-dialog-panel',
            ariaLabel: 'Mailbox settings',
            // Esc and the scrim are requests the host answers (it asks first when a pane is dirty).
            disableClose: true,
        });
        this.ref.backdropClick.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.askThenLeave());
    }

    private hide(): void {
        this.leaving = false;
        const ref = this.ref;
        this.ref = null;
        ref?.close();
    }

    private changePane(pane: string, replace: boolean): void {
        const go = () => void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { [SETTINGS_PARAM]: pane },
            queryParamsHandling: 'merge',
            // Every pane change replaces: Back closes the modal, it does not walk the panes.
            replaceUrl: true,
        });
        if (replace || !this.dirty()) {
            go();
            return;
        }
        this.confirm.confirmDiscard().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(discard => {
            if (discard) {
                go();
            }
        });
    }

    private askThenLeave(): void {
        if (!this.dirty()) {
            this.leave();
            return;
        }
        this.confirm.confirmDiscard().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(discard => {
            if (discard) {
                this.leave();
            }
        });
    }

    /** Closes by the URL: back when the entry before is this page without the modal, else the page's own URL. */
    private leave(): void {
        this.leaving = true;
        const base = this.router.serializeUrl(this.router.createUrlTree(['/email', { mailbox: this.mailboxId() }]));
        if (null !== this.previousUrl && this.previousUrl === base) {
            this.location.back();
            return;
        }
        void this.router.navigate(['/email', { mailbox: this.mailboxId() }], { replaceUrl: true });
    }
}
