import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    ViewChild,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    PageTitleService,
    ToastService,
    type DataGridData,
} from '@coolms/ui-angular';
import { type ContactDto, ContactsService } from './contacts.service';
import {
    ContactFormDialogComponent,
    type ContactFormDialogData,
} from './contact-form-dialog.component';
import {
    ContactLinkUserDialogComponent,
    type LinkUserDialogData,
    type LinkUserDialogResult,
} from './contact-link-user.dialog';

/** Rows per server page. */
const PAGE_SIZE = 50;

/**
 * C.3 — the Contacts admin list page (/admin/contacts).
 *
 * `<cms-list-page>` shell + `<coolms-datagrid gridId="contact:contacts">` in
 * `loadingMode: lazy`: the grid emits `(loadMore)` on mount and on every
 * filter/sort/page change, and this page turns that into one server request.
 * Filtering, sorting and paging are ALL server-side.
 *
 * It used to be client-mode — one `list()` call fed the grid as `externalData`
 * and the grid filtered in memory. That read was the CAPPED typeahead port
 * (`listVisible(q, 100)`, clamped at 100 by the repository), so past the 100th
 * contact the directory silently omitted people and the filter row searched
 * only the loaded slice..
 *
 * The `visibility` column is the "My / Shared" filter. Create/Edit open the
 * `ContactFormDialogComponent` modal; on a non-null close we re-load via the
 * grid so the active filter and sort survive. Mirrors the Call-records +
 * Schedules (modal + confirm-delete) list pages.
 */
@Component({
    selector: 'coolms-admin-contacts-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="Contacts"
            icon="person-lines-fill"
            subtitle="Your personal address book + the shared company directory"
            toolbarTreeSlug="navi.toolbar.contact.contacts"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="contact:contacts"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (loadMore)="onLoadMore($event)"
                (rowSelected)="selectedRow.set($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class ContactsListComponent implements OnInit {
    /** Optional: toolbar Reload can fire before the view settles. */
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;

    private readonly api        = inject(ContactsService);
    private readonly router     = inject(Router);
    private readonly store      = inject(Store);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    readonly contacts    = signal<ContactDto[]>([]);
    readonly loading     = signal(true);
    readonly selectedRow = signal<Record<string, unknown> | null>(null);
    /** Server's count for the CURRENT filter — drives the footer and `hasMore`. */
    readonly totalItems  = signal(0);
    /** Flips true after the first response (success OR error) so the footer stops hiding. */
    readonly loaded      = signal(false);

    /** Guards against out-of-order responses; see {@link onLoadMore}. */
    private loadEpoch = 0;

    /**
     * `_selected` gates Edit / Delete; `_canLink` / `_linked` gate the C.6
     * Link-user / Unlink-user actions (a contact is linked iff `userId` is set);
     * `_canConvert` gates the C.6.b Convert-to-user action (an unlinked contact
     * that has an email — the invite needs an address).
     */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const c = this.selectedContact();
        const linked = c !== null && c.userId !== null && c.userId !== undefined && c.userId !== '';
        const hasEmail = c !== null && c.primaryEmail !== null && c.primaryEmail !== undefined && c.primaryEmail !== '';
        return {
            _selected:   c !== null,
            _canLink:    c !== null && !linked,
            _linked:     linked,
            _canConvert: c !== null && !linked && hasEmail,
        };
    });

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /**
     * Lazy payload. `hasMore` drives the sentinel fetch loop: true until the
     * loaded window covers the server's total, and true before the first load
     * resolves so the grid emits its initial `(loadMore)`.
     */
    readonly gridData = computed((): DataGridData => {
        const rows = this.contacts();
        return {
            items:      rows as unknown as Array<Record<string, unknown>>,
            totalItems: this.totalItems(),
            page:       1,
            limit:      PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(this.totalItems() / PAGE_SIZE)),
            hasMore:    this.loading() || rows.length < this.totalItems(),
        };
    });

    /**
     * `totalItems` is the SERVER's count for the current filter, so it needs no
     * client-side adjustment — the endpoint filters and pages now.
     */
    readonly footerLabel = computed(() => {
        if (!this.loaded()) return '';
        const n = this.totalItems();
        // Say nothing at zero: the grid's own empty state now distinguishes
        // "No contacts yet" from "No matches", and the footer cannot tell the
        // two apart — so a fixed "No contacts yet" here would contradict the
        // body the moment a filter is what emptied the list.
        if (n === 0) return '';

        return `${n} contact${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Contacts');
        // No fetch here — the grid emits `(loadMore)` on mount, which is the
        // single entry point. Fetching here too would race and double-load.
    }

    /**
     * The one place contacts are fetched. Fired on mount, on every filter/sort
     * change (`reset`, offset 0) and when the lazy sentinel scrolls in.
     *
     * `columnFilters` is passed VERBATIM: this endpoint is RQL-native (the ORM-
     * backed), and its allowlist is derived from the same `contact:contacts`
     * YAML that renders the filter row.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        const page  = Math.floor(event.offset / PAGE_SIZE) + 1;
        const epoch = ++this.loadEpoch;

        this.api.listPage({
            page,
            pageSize: PAGE_SIZE,
            sort:     event.sort,
            filters:  event.columnFilters,
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => {
                // Filter changes fire in quick succession and can land out of
                // order; a stale response would show rows for a filter the user
                // has already moved off.
                if (epoch !== this.loadEpoch) return;

                this.contacts.set(event.reset ? result.items : [...this.contacts(), ...result.items]);
                this.totalItems.set(result.totalItems);
                this.loading.set(false);
                this.loaded.set(true);
                if (event.reset) this.selectedRow.set(null);
            },
            error: () => {
                if (epoch !== this.loadEpoch) return;
                // Settle `hasMore` on failure too, or the sentinel retries the
                // failed page forever.
                this.loading.set(false);
                this.loaded.set(true);
                this.toast.error('Failed to load contacts');
            },
        });
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openEditor(); return; }
        if (id === 'reload') { this.load(); return; }
        const c = this.selectedContact();
        if (!c) return;
        if (id === 'edit')         this.openEditor(c);
        if (id === 'delete')       this.confirmDelete(c);
        if (id === 'link-user')    this.openLinkUser(c);
        if (id === 'unlink-user')  this.confirmUnlinkUser(c);
        if (id === 'convert-user') this.confirmConvertUser(c);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const c = this.contacts().find(x => x.id === (event.row['id'] as string));
        if (!c) return;
        if (event.action === 'open')   this.openDetail(c);
        if (event.action === 'edit')   this.openEditor(c);
        if (event.action === 'delete') this.confirmDelete(c);
    }

    /** Open the contact's Person-hub detail page (`/admin/contacts/:id`). */
    private openDetail(c: ContactDto): void {
        if (c.id) void this.router.navigate(['/contacts', c.id]);
    }

    private selectedContact(): ContactDto | null {
        const row = this.selectedRow();
        if (!row) return null;
        return this.contacts().find(x => x.id === (row['id'] as string)) ?? null;
    }

    /**
     * Re-runs the current query from page 1, KEEPING the active filters and
     * sort — the grid owns that state now, so it must drive the refetch. A
     * direct `api.list()` here would quietly discard the user's filter.
     */
    private load(): void {
        this.selectedRow.set(null);
        this.grid?.reload();
    }

    /** Open the create (no arg) or edit (contact) modal; re-load on a saved close. */
    private openEditor(contact?: ContactDto): void {
        const data: ContactFormDialogData = { contact };
        this.dialog.open<ContactDto | null, ContactFormDialogData>(ContactFormDialogComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((c): c is ContactDto => c !== null && c !== undefined),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(c => {
            this.toast.success(contact
                ? `Contact "${c.displayName}" updated`
                : `Contact "${c.displayName}" created`);
            this.load();
        });
    }

    private confirmDelete(c: ContactDto): void {
        const id = c.id;
        if (id === undefined || id === '') return;
        this.confirmSvc.confirmDelete(c.displayName ?? 'this contact').pipe(
            filter(Boolean),
            switchMap(() => this.api.delete(id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Contact deleted'); this.load(); },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    /** C.6.a — open the user-picker dialog; on confirm associate + re-load. */
    private openLinkUser(c: ContactDto): void {
        const id = c.id;
        if (id === undefined || id === '') return;
        const data: LinkUserDialogData = { contactName: c.displayName ?? 'this contact' };
        this.dialog.open<LinkUserDialogResult | null, LinkUserDialogData>(ContactLinkUserDialogComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((r): r is LinkUserDialogResult => r !== null && r !== undefined),
            switchMap(r => this.api.associateUser(id, r.userId)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  updated => {
                this.toast.success(updated.userDisplayName != null && updated.userDisplayName !== ''
                    ? `Linked to "${updated.userDisplayName}"`
                    : 'User linked');
                this.load();
            },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    /**
     * C.6.b — confirm, then mint a NEW platform user from the contact (email +
     * phone become identifiers), link it, and send an activation invite.
     */
    private confirmConvertUser(c: ContactDto): void {
        const id = c.id;
        if (id === undefined || id === '') return;
        const email = c.primaryEmail ?? '';
        this.confirmSvc.open({
            title:        'Convert to platform user',
            message:      `Create a platform user account for "${c.displayName ?? 'this contact'}"`
                + (email !== '' ? ` and send an activation invite to ${email}` : '')
                + `? They can sign in and set a password later.`,
            confirmLabel: 'Convert & invite',
        }).pipe(
            filter(Boolean),
            switchMap(() => this.api.convertToUser(id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  updated => {
                this.toast.success(updated.userDisplayName != null && updated.userDisplayName !== ''
                    ? `User created & invited: "${updated.userDisplayName}"`
                    : 'User created & invited');
                this.load();
            },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    /** C.6.a — confirm, then clear the platform-user link + re-load. */
    private confirmUnlinkUser(c: ContactDto): void {
        const id = c.id;
        if (id === undefined || id === '') return;
        this.confirmSvc.open({
            title:        'Unlink platform user',
            message:      `Remove the platform-user link from "${c.displayName ?? 'this contact'}"?`,
            confirmLabel: 'Unlink',
        }).pipe(
            filter(Boolean),
            switchMap(() => this.api.dissociateUser(id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('User unlinked'); this.load(); },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }
}
