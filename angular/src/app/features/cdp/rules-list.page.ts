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
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { filter } from 'rxjs';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    PageTitleService,
    ToastService,
    type DataGridData,
} from '@coolms/ui-angular';
import { PersonalizationRulesService } from './personalization-rules.service';
import { PersonalizationRuleDto } from './personalization-rules.types';
import {
    RuleEditorDialogComponent,
    type RuleEditorDialogData,
} from './rule-editor-dialog.component';

/** Projected grid row (id = the rule's v7 uuid). */
interface RuleRow {
    id:        string;
    segment:   string;
    slot:      string;
    variant:   string;
    enabled:   boolean;
    sortOrder: number;
}

/**
 * Track E Phase 4 (CDP personalization, P4.admin.c) — personalization-rule list
 * (`/admin/cdp/rules`).
 *
 * Platform list-page shell (`<cms-list-page>` + `<coolms-datagrid>` driven by the
 * `analytics:personalization-rules` config YAML) — a sibling of the Segments list.
 * Create / Edit open the {@link RuleEditorDialogComponent} modal; Delete removes
 * after a confirm. `loadingMode: client`: the rule set is small (hand-authored),
 * so the FE loads it once and the grid filters / sorts / paginates in memory.
 */
@Component({
    selector: 'coolms-cdp-rules',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="Personalization"
            icon="sliders"
            subtitle="Rules mapping a CDP segment to a content variant per slot"
            toolbarTreeSlug="navi.toolbar.analytics.personalization-rules"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="analytics:personalization-rules"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowSelected)="selectedRow.set($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class RulesListPageComponent implements OnInit {
    private readonly api        = inject(PersonalizationRulesService);
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

    private readonly rows = signal<RuleRow[]>([]);
    private readonly loaded = signal(false);
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** The raw DTOs kept alongside the projected rows, so a selection (id = uuid) resolves back. */
    private originals: PersonalizationRuleDto[] = [];

    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    readonly gridData = computed((): DataGridData => {
        const rows = this.rows();
        return {
            items: rows as unknown as Array<Record<string, unknown>>,
            totalItems: rows.length,
            page: 1,
            limit: rows.length,
            totalPages: 1,
            hasMore: false,
        };
    });

    /** Footer row-count strip (bottom-left) — mirrors the other cms-list-page consumers. */
    readonly footerLabel = computed(() => {
        if (!this.loaded()) {
            return '';
        }
        const n = this.rows().length;
        return `${n} rule${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Customer Data — Personalization');
        this.load();
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openEditor(null); return; }
        if (id === 'reload') { this.load(); return; }

        const rule = this.selected();
        if (!rule) {
            return;
        }
        if (id === 'edit')   { this.openEditor(rule); }
        if (id === 'delete') { this.confirmDelete(rule); }
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action !== 'open') {
            return;
        }
        const rule = this.find(event.row);
        if (rule) {
            this.openEditor(rule);
        }
    }

    private openEditor(rule: PersonalizationRuleDto | null): void {
        const data: RuleEditorDialogData = { rule: rule ?? undefined };
        this.dialog.open<PersonalizationRuleDto | null>(RuleEditorDialogComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((r): r is PersonalizationRuleDto => r != null),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(saved => {
            this.toast.success(`Rule "${saved.segment} → ${saved.slot}" ${rule ? 'updated' : 'created'}`);
            this.load();
        });
    }

    private confirmDelete(rule: PersonalizationRuleDto): void {
        this.confirmSvc.open({
            title:        `Delete this rule?`,
            message:      `Removes the "${rule.segment} → ${rule.slot}" mapping. The page falls back to its default content.`,
            confirmLabel: 'Delete',
            danger:       true,
        }).pipe(
            filter(Boolean),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            this.api.deleteRule(rule.id).pipe(
                takeUntilDestroyed(this.destroyRef),
            ).subscribe({
                next: () => { this.toast.success('Rule deleted'); this.load(); },
                error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
            });
        });
    }

    private load(): void {
        this.api.listRules().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: rows => {
                this.originals = rows;
                this.rows.set(rows.map(r => this.toRow(r)));
                this.selectedRow.set(null);
                this.loaded.set(true);
            },
            error: (e: unknown) => {
                this.loaded.set(true);
                this.toast.error(this.errors.humanize(e));
            },
        });
    }

    private toRow(r: PersonalizationRuleDto): RuleRow {
        return {
            id: r.id,
            segment: r.segment,
            slot: r.slot,
            variant: r.variant,
            enabled: r.enabled,
            sortOrder: r.sortOrder,
        };
    }

    /** Resolve the selected grid row (id = uuid) back to its DTO. */
    private selected(): PersonalizationRuleDto | undefined {
        const row = this.selectedRow();
        return row ? this.find(row) : undefined;
    }

    private find(row: Record<string, unknown>): PersonalizationRuleDto | undefined {
        const id = row['id'] as string | undefined;
        return this.originals.find(x => x.id === id);
    }
}
