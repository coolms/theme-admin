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
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import { AppConfigState, AuthState, ErrorHandlerService, isElevationRefusal } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    ElevationRequiredComponent,
    PageTitleService,
    RELOAD_PAGE,
    ToastService,
} from '@coolms/ui-angular';
import { IdentityApiService } from './identity-api.service';
import { ActiveSessionDto } from './identity.types';

const LIMIT = 30;

/** Said when ending signs the reader out here: the sign-in is the one this page uses, or among those ended. */
const SIGNS_YOU_OUT = ' This includes your sign-in here: you will be signed out.';

type LoadEvent = { offset: number; sort: string | null; reset: boolean; columnFilters: ReadonlyArray<string> };

/**
 * Signed-in sessions: who is signed in, since when, from where, with which
 * audience. People's data, so the list answers an elevated session only and
 * the server audits every read; refused for want of elevation, the Elevate
 * state stands in place of the list. The grid and its columns come from
 * `identity:sessions`; the toolbar from `navi.toolbar.identity.sessions`.
 * Ending one sign-in revokes its tokens and closes its realtime connections;
 * ending all of a person's also forgets their known devices. Both are
 * elevated acts: the 403 prompts elevation through the interceptor and the
 * same request is re-sent; the list reloads on success. Ending the reader's own sign-in here (the row the server
 * marks `current`), or every sign-in of their own account, says first that it signs them out.
 */
@Component({
    selector: 'app-sessions-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent, ElevationRequiredComponent],
    template: `
        <cms-list-page
            title="Signed-in sessions"
            icon="shield-lock"
            toolbarTreeSlug="navi.toolbar.identity.sessions"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            @if (elevationRequired()) {
                <cms-elevation-required data-test="sessions-elevation-required" (elevated)="loadAgain()" />
            }
            <coolms-datagrid
                [hidden]="elevationRequired()"
                gridId="identity:sessions"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowSelected)="onRowSelected($event)"
                (loadMore)="onLoadMore($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class SessionsListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;
    private readonly identityApi = inject(IdentityApiService);
    private readonly store      = inject(Store);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly reloadPage = inject(RELOAD_PAGE, { optional: true });
    private lastLoad: LoadEvent | null = null;

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    readonly rows    = signal<ActiveSessionDto[]>([]);
    readonly total   = signal<number | null>(null);
    readonly hasMore = signal(true);
    readonly loaded  = signal(false);
    /** The list was refused for want of elevation: the Elevate state stands in place of it. */
    readonly elevationRequired = signal(false);

    readonly footerLabel = computed(() => {
        if (!this.loaded()) return '';
        const n = this.rows().length;
        const total = this.total();
        return total !== null && total > n ? `${n} of ${total} sessions` : `${n} session${n === 1 ? '' : 's'}`;
    });

    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selected() !== null,
    }));

    readonly gridData = computed((): DataGridData => ({
        items: this.rows().map(s => ({
            ...s,
            // The grid keys a row by `id`; the person column shows a name, not the object.
            id:     s.sessionId,
            person: personLabel(s),
        })),
        totalItems: this.total() ?? this.rows().length,
        page:       1,
        limit:      LIMIT,
        totalPages: 1,
        hasMore:    this.hasMore(),
    }));

    ngOnInit(): void {
        this.titleSvc.set('Signed-in sessions');
    }

    onLoadMore(event: LoadEvent): void {
        const epoch = ++this._loadEpoch;
        if (event.reset) {
            this.rows.set([]);
            this.hasMore.set(true);
            this.lastLoad = event;
            this._resetEpoch = epoch;
        }
        const page = Math.floor(event.offset / LIMIT) + 1;

        this.identityApi.listSessions({ page, itemsPerPage: LIMIT })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: ({ members, total }) => {
                    // An answer asked before the latest reset belongs to the list it replaced: a page still in
                    // flight when a sign-in was ended would bring the ended row back.
                    if (epoch < this._resetEpoch) return;
                    this.total.set(total);
                    this.rows.set(event.reset ? members : [...this.rows(), ...members]);
                    this.hasMore.set(this.rows().length < total);
                    this.loaded.set(true);
                    this.elevationRequired.set(false);
                },
                error: (err: unknown) => {
                    if (epoch < this._resetEpoch) return;
                    if (isElevationRefusal(err)) {
                        this.elevationRequired.set(true);
                    } else {
                        this.toast.error(this.errors.humanize(err));
                    }
                },
            });
    }

    /** After the session was elevated from the Elevate state: the page made anew, or else the list read again. */
    loadAgain(): void {
        if (this.reloadPage) {
            this.reloadPage();
        } else if (this.lastLoad) {
            this.elevationRequired.set(false);
            this.onLoadMore({ ...this.lastLoad, reset: true, offset: 0 });
        }
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onToolbarAction(id: string): void {
        const s = this.selected();
        if (!s) return;
        if (id === 'end-session')      this.endSession(s);
        if (id === 'end-all-sessions') this.endAllSessions(s);
    }

    private selected(): ActiveSessionDto | null {
        const row = this.selectedRow();
        if (!row) return null;
        return this.rows().find(r => r.sessionId === (row['id'] as string)) ?? null;
    }

    private endSession(s: ActiveSessionDto): void {
        this.confirmSvc.open({
            title:        `End this sign-in of ${personLabel(s)}?`,
            message:      'Its tokens stop working and its live connections close at once.'
                + (s.current === true ? SIGNS_YOU_OUT : ''),
            confirmLabel: 'End sign-in',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => this.identityApi.endSession(s.sessionId)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Sign-in ended'); this.reload(); },
            error: err => this.toast.error(this.errors.humanize(err)),
        });
    }

    private endAllSessions(s: ActiveSessionDto): void {
        this.confirmSvc.open({
            title:        `End every sign-in of ${personLabel(s)}?`,
            message:      'Every session of this account ends at once, on every device, and its known devices are forgotten.'
                + (this.isOwn(s) ? SIGNS_YOU_OUT : ''),
            confirmLabel: 'End all sign-ins',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => this.identityApi.endAllSessions(s.person.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success(`Every sign-in of ${personLabel(s)} ended`); this.reload(); },
            error: err => this.toast.error(this.errors.humanize(err)),
        });
    }

    private reload(): void {
        this.selectedRow.set(null);
        this.grid?.reload();
    }

    /** The signed-in administrator's own account: ending all its sign-ins ends the one this page uses too. */
    private isOwn(s: ActiveSessionDto): boolean {
        return s.person.id === this.store.selectSnapshot(AuthState.currentUser)?.id;
    }

    private _loadEpoch = 0;
    private _resetEpoch = 0;
}

/** The person as the list names them: their name, else their sign-in identifier, else their id. */
function personLabel(s: ActiveSessionDto): string {
    return s.person.displayName || s.person.primaryIdentifier || s.person.id;
}
