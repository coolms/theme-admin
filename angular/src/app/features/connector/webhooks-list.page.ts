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
import { WebhookService } from './webhook.service';
import { WebhookTriggerDto } from './webhook.types';
import {
    WebhookFormDialogComponent,
    type WebhookFormDialogData,
} from './webhook-form-dialog.component';
import {
    WebhookSecretDialogComponent,
    type WebhookSecretDialogData,
} from './webhook-secret-dialog.component';

/**
 * FE — inbound webhook triggers admin list (`/admin/webhooks`).
 *
 * Client-mode datagrid over GET /connector/webhooks (small admin set; mirrors
 * the Definitions catalog). Toolbar (navi.toolbar.connector.webhooks): New
 * Webhook (header) + reload + row-level Edit / Rotate secret / Delete. Create +
 * rotate reveal the one-time secret via {@link WebhookSecretDialogComponent}.
 */
@Component({
    selector: 'coolms-admin-webhooks-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Webhooks"
            icon="broadcast"
            toolbarTreeSlug="navi.toolbar.connector.webhooks"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="connector:webhooks"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowActionTriggered)="onRowAction($event)"
                (rowSelected)="onRowSelected($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class WebhooksListPageComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly service    = inject(WebhookService);
    private readonly store      = inject(Store);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    readonly rows        = signal<WebhookTriggerDto[]>([]);
    readonly totalItems  = signal(0);
    readonly selectedRow = signal<Record<string, unknown> | null>(null);
    private readonly loaded = signal(false);

    readonly footerLabel = computed(() =>
        this.loaded()
            ? `${this.totalItems()} webhook${this.totalItems() === 1 ? '' : 's'}`
            : '',
    );

    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    readonly gridData = computed((): DataGridData => ({
        items:      this.rows() as unknown as Array<Record<string, unknown>>,
        totalItems: this.totalItems(),
        page:       1,
        limit:      this.totalItems(),
        totalPages: 1,
        hasMore:    false,
    }));

    ngOnInit(): void {
        this.titleSvc.set('Webhooks');
        this.load();
    }

    private load(): void {
        this.service.list().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => {
                this.rows.set(rows);
                this.totalItems.set(rows.length);
                this.loaded.set(true);
            },
            error: (e: unknown) => {
                this.loaded.set(true);
                this.toast.error(this.errors.humanize(e));
            },
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action !== 'open') {
            return;
        }
        const t = this.find(event.row);
        if (t) {
            this.openForm(t);
        }
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openForm(null); return; }
        if (id === 'reload') { this.load(); return; }

        const row = this.selectedRow();
        if (!row) {
            return;
        }
        const t = this.find(row);
        if (!t) {
            return;
        }
        if (id === 'edit')   { this.openForm(t); }
        if (id === 'rotate') { this.confirmRotate(t); }
        if (id === 'delete') { this.confirmDelete(t); }
    }

    private openForm(trigger: WebhookTriggerDto | null): void {
        const data: WebhookFormDialogData = { trigger: trigger ?? undefined };
        this.dialog.open<WebhookTriggerDto | null>(WebhookFormDialogComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((t): t is WebhookTriggerDto => t != null),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(saved => {
            const created = trigger === null;
            this.toast.success(created ? `Webhook "${saved.slug}" created` : 'Webhook saved');
            if (created && saved.secret) {
                this.revealSecret(saved.slug ?? '', saved.secret, saved.webhookUrl ?? null);
            }
            this.load();
        });
    }

    private confirmRotate(t: WebhookTriggerDto): void {
        if (!t.slug) {
            return;
        }
        this.confirmSvc.open({
            title:        'Rotate secret',
            message:      `Rotate the secret for "${t.label ?? t.slug}"? The current secret stops working immediately.`,
            confirmLabel: 'Rotate',
        }).pipe(
            filter(Boolean),
            switchMap(() => this.service.rotateSecret(t.slug!)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: res => this.revealSecret(res.slug, res.secret, t.webhookUrl ?? null),
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    private confirmDelete(t: WebhookTriggerDto): void {
        if (!t.slug) {
            return;
        }
        this.confirmSvc.confirmDelete(t.label ?? t.slug).pipe(
            filter(Boolean),
            switchMap(() => this.service.delete(t.slug!)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Webhook deleted'); this.load(); },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    private revealSecret(slug: string, secret: string, webhookUrl: string | null): void {
        const data: WebhookSecretDialogData = { slug, secret, webhookUrl };
        this.dialog.open(WebhookSecretDialogComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        });
    }

    private find(row: Record<string, unknown>): WebhookTriggerDto | undefined {
        const id = row['id'] as string | undefined;
        return this.rows().find(x => x.id === id);
    }
}
