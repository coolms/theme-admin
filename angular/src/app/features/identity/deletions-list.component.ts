import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
    signal,
    ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    DrawerService,
    PageTitleService,
    TabStripComponent,
    type TabStripItem,
    ToastService,
} from '@coolms/ui-angular';
import { IdentityApiService } from './identity-api.service';
import { AccountDeletionDto } from './identity.types';
import { DeletionDetailPanelComponent } from './deletion-detail-panel.component';
import { HoldsRegisterComponent } from './holds-register.component';
import { LegalHoldDialogComponent, LegalHoldDialogData } from './legal-hold-dialog.component';

const LIMIT = 50;

type DeletionsTab = 'deletions' | 'holds';

/**
 * Account deletions: every deletion ever requested, one row
 * per record, with the run's four lists in the drawer; and, as a second tab,
 * the holds register. The grid, its columns and filters come from
 * `identity:deletions`; the toolbar from `navi.toolbar.identity.deletions`,
 * whose conditions read `_selected`, `_state` and `_holdActive` published
 * here for the selected row. Cancel, hold and release are elevated acts: the
 * 403 prompts elevation through the interceptor and the same request is
 * re-sent; the list reloads on success and derives nothing from a
 * remembered flag. There is no "delete now": zero days is the operator's
 * setting, not a button.
 */
@Component({
    selector: 'app-deletions-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent, TabStripComponent, HoldsRegisterComponent],
    template: `
        <cms-list-page
            title="Account deletions"
            icon="person-x"
            toolbarTreeSlug="navi.toolbar.identity.deletions"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">

            <app-tab-strip
                [tabs]="TABS"
                [activeId]="tab()"
                (selected)="switchTab($any($event))" />

            @if (tab() === 'deletions') {
                <coolms-datagrid
                    gridId="identity:deletions"
                    entityAlias="accountDeletion"
                    [configBaseUrl]="configBaseUrl()"
                    [externalData]="gridData()"
                    (rowActionTriggered)="onRowAction($event)"
                    (rowSelected)="onRowSelected($event)"
                    (loadMore)="onLoadMore($event)">
                </coolms-datagrid>
            } @else {
                <app-holds-register />
            }
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class DeletionsListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;
    private readonly identityApi = inject(IdentityApiService);
    private readonly store      = inject(Store);
    private readonly dialog     = inject(Dialog);
    private readonly drawer     = inject(DrawerService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    readonly TABS: ReadonlyArray<TabStripItem> = [
        { id: 'deletions', label: 'Deletions', icon: 'person-x' },
        { id: 'holds',     label: 'Holds register', icon: 'shield-lock' },
    ];
    readonly tab = signal<DeletionsTab>('deletions');

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    readonly rows    = signal<AccountDeletionDto[]>([]);
    readonly total   = signal<number | null>(null);
    readonly hasMore = signal(true);
    readonly loaded  = signal(false);

    readonly footerLabel = computed(() => {
        if (!this.loaded() || this.tab() !== 'deletions') return '';
        const n = this.rows().length;
        const total = this.total();
        return total !== null && total > n ? `${n} of ${total} deletions` : `${n} deletion${n === 1 ? '' : 's'}`;
    });

    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** What the toolbar's conditions read: the selected row's state, and whether its hold still stands. */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const d = this.selected();
        return {
            _selected:   d !== null,
            _state:      d?.state ?? null,
            _holdActive: d?.hold?.active === true,
        };
    });

    readonly gridData = computed((): DataGridData => ({
        items: this.rows().map(d => ({
            ...d,
            // The grid's sortable column is the entity's own `createdAt`; the row says `requestedAt`.
            createdAt:  d.requestedAt,
            holdReason: d.hold ? d.hold.reason + (d.hold.active ? '' : ' (released)') : '',
        })),
        totalItems: this.total() ?? this.rows().length,
        page:       1,
        limit:      LIMIT,
        totalPages: 1,
        hasMore:    this.hasMore(),
    }));

    ngOnInit(): void {
        this.titleSvc.set('Account deletions');
    }

    switchTab(t: DeletionsTab): void {
        if (this.tab() === t) return;
        this.tab.set(t);
        this.selectedRow.set(null);
    }

    onLoadMore(event: { offset: number; sort: string | null; reset: boolean; columnFilters: ReadonlyArray<string> }): void {
        if (event.reset) {
            this.rows.set([]);
            this.hasMore.set(true);
        }
        const epoch = ++this._loadEpoch;
        const page = Math.floor(event.offset / LIMIT) + 1;

        this.identityApi.listDeletions({
            limit:   LIMIT,
            page,
            filters: [...event.columnFilters],
            sort:    event.sort ?? '-createdAt',
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: ({ members, total }) => {
                if (epoch !== this._loadEpoch && event.reset) return;
                this.total.set(total);
                this.rows.set(event.reset ? members : [...this.rows(), ...members]);
                this.hasMore.set(this.rows().length < total);
                this.loaded.set(true);
            },
            error: err => this.toast.error(this.errors.humanize(err)),
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const d = this.rows().find(r => r.id === (event.row['id'] as string));
        if (d) this.act(event.action, d);
    }

    onToolbarAction(id: string): void {
        if (id === 'reload') { this.reload(); return; }
        const d = this.selected();
        if (d) this.act(id, d);
    }

    private selected(): AccountDeletionDto | null {
        const row = this.selectedRow();
        if (!row) return null;
        return this.rows().find(r => r.id === (row['id'] as string)) ?? null;
    }

    private act(action: string, d: AccountDeletionDto): void {
        if (action === 'detail')  this.openDetail(d);
        if (action === 'cancel')  this.cancel(d);
        if (action === 'hold')    this.placeHold(d);
        if (action === 'release') this.release(d);
    }

    private openDetail(d: AccountDeletionDto): void {
        this.drawer.open(DeletionDetailPanelComponent, { deletion: d }, `Deletion of ${d.accountLabel}`);
    }

    private cancel(d: AccountDeletionDto): void {
        this.confirmSvc.open({
            title:        `Cancel the deletion of ${d.accountLabel}?`,
            message:      'Access is restored at once and the person is told who cancelled.',
            confirmLabel: 'Cancel the deletion',
            cancelLabel:  'Keep it',
        }).pipe(
            filter(Boolean),
            switchMap(() => this.identityApi.cancelDeletion(d.userId)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Deletion cancelled; access restored'); this.reload(); },
            error: err => this.toast.error(this.errors.humanize(err)),
        });
    }

    private placeHold(d: AccountDeletionDto): void {
        const data: LegalHoldDialogData = { userId: d.userId, accountLabel: d.accountLabel };
        this.dialog.open(LegalHoldDialogComponent, { data })
            .closed.pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.reload());
    }

    private release(d: AccountDeletionDto): void {
        const hold = d.hold;
        if (!hold || !hold.active) return;
        this.confirmSvc.open({
            title:        `Release the hold on ${d.accountLabel}?`,
            message:      'The deletion is re-armed: due now, or at its own date if that is later.',
            confirmLabel: 'Release',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => this.identityApi.releaseLegalHold(d.userId, hold.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Hold released; the deletion is re-armed'); this.reload(); },
            error: err => this.toast.error(this.errors.humanize(err)),
        });
    }

    private reload(): void {
        this.selectedRow.set(null);
        this.grid?.reload();
    }

    private _loadEpoch = 0;
}
