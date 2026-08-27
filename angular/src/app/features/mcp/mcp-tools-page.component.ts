import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';

import { ApiService } from '../../api/api.service';
import type { McpToolCatalogDto, McpToolGovernanceDto } from '../../api/api.service';
import { AppConfigState } from '@coolms/core-angular';
import { CmsListPageComponent, DataGridComponent, type DataGridData } from '@coolms/ui-angular';

/**
 * MCP tool-governance audit (ADR-147) — the operator-facing view over
 * `GET /api/mcp/tools` (`McpToolCatalogController`, ROLE_ADMIN). It lists
 * every tool an external AI agent can call through the governed JSON-RPC
 * endpoint (`POST /api/mcp/rpc`) and, crucially, the AUTHORIZATION GATE on
 * each one — so an admin can see at a glance which tools are public
 * (authenticated-only), which require an elevated role, and which resolve
 * per-user permissions at call time.
 *
 * Read-only. The gate is defined in code (the tool's `requiredRole()` +
 * runtime governance shape); this screen is the single auditable inventory
 * ADR-147 mandates ("tools stay centralized in src/Mcp … auditable in one
 * place"). Lives under /admin/--system next to the Centrifugo dashboard —
 * both are platform-plumbing operator surfaces.
 *
 * **Platform list shell** (ledger #1657): `<cms-list-page>` +
 * `<coolms-datagrid gridId="mcp:tools">` + the `navi.toolbar.mcp.tools`
 * toolbar tree. It previously hand-rolled a `<table>` inside a bespoke card,
 * which cost it sorting, filtering, the column chooser, selection and the
 * context menu — and produced a **duplicate Refresh button**, because the card
 * header re-added a control the page header already had. Descriptions are a
 * `snippet` column so a multi-sentence governance note renders across several
 * lines instead of being truncated to one.
 */
@Component({
    selector: 'app-mcp-tools-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="MCP Tools"
            icon="robot"
            subtitle="Every tool exposed to external AI agents via POST /api/mcp/rpc, with the authorization gate on each"
            toolbarTreeSlug="navi.toolbar.mcp.tools"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="mcp:tools"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class McpToolsPageComponent implements OnInit {
    private readonly api = inject(ApiService);
    private readonly store = inject(Store);
    private readonly destroyRef = inject(DestroyRef);

    protected readonly catalog = signal<McpToolCatalogDto | null>(null);
    protected readonly loading = signal<boolean>(false);
    protected readonly error = signal<string | null>(null);

    protected readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /**
     * `id` is the tool NAME — datagrid selection is keyed on `row['id']`, and
     * tool names are unique within the registry.
     *
     * `access` is projected to the DISPLAY label rather than the raw
     * `authenticated` / `role:ROLE_X` wire value, so the badge text, the sort
     * order and the filter all operate on what the operator actually sees.
     */
    protected readonly gridData = computed((): DataGridData => {
        const tools = this.catalog()?.tools ?? [];
        const rows = tools.map(t => ({
            id:          t.name,
            name:        t.name,
            title:       t.title,
            description: t.description,
            access:      accessLabel(t),
        }));

        return {
            items:      rows,
            totalItems: rows.length,
            page:       1,
            limit:      rows.length,
            totalPages: 1,
            hasMore:    false,
        };
    });

    protected readonly footerLabel = computed(() => {
        const err = this.error();
        if (err !== null) return err;
        if (this.loading() && this.catalog() === null) return '';
        const n = this.catalog()?.count ?? 0;

        return `${n} tool${n === 1 ? '' : 's'} registered`;
    });

    ngOnInit(): void {
        this.load();
    }

    onToolbarAction(actionId: string): void {
        if (actionId === 'reload') {
            this.load();
        }
    }

    load(): void {
        this.loading.set(true);
        this.error.set(null);
        this.api.getMcpTools()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: cat => {
                    this.catalog.set(cat);
                    this.loading.set(false);
                },
                error: (err: Error) => {
                    this.error.set(err.message ?? 'Failed to load MCP tools.');
                    this.loading.set(false);
                },
            });
    }
}

/**
 * The gate as a human label: an explicit role name when one is demanded,
 * otherwise `Authenticated`. Mirrors the badge the hand-rolled table rendered.
 */
function accessLabel(tool: McpToolGovernanceDto): string {
    if (tool.requiredRole !== null) {
        return tool.requiredRole;
    }
    if (tool.access.startsWith('role:')) {
        return tool.access.slice('role:'.length);
    }

    return 'Authenticated';
}
