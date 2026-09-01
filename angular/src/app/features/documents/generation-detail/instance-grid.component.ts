import { CommonModule, DatePipe } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';

import type { DocumentInstanceDto } from '../../../api/api.service';

/** Instance-status filter tab the grid currently surfaces. */
export type InstanceFilterTab = 'all' | 'failed' | 'pending' | 'done';

/**
 * Virtual-scroll grid of `DocumentInstanceDto` rows for the generation
 * detail page. Owns the status-filter tabs and the row-expansion state
 * for failed-row error messages. Data fetching, polling, and download-
 * URL plumbing stay on the parent so this component is a pure view.
 */
@Component({
    selector: 'cms-instance-grid',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, DatePipe, ScrollingModule],
    template: `
        <div class="cms-instance-grid">
            <div class="cms-instance-grid__tabs" role="tablist" aria-label="Filter instances by status">
                @for (tab of tabs(); track tab.id) {
                    <button
                        type="button"
                        role="tab"
                        class="cms-instance-grid__tab"
                        [class.cms-instance-grid__tab--active]="activeTab() === tab.id"
                        [attr.aria-selected]="activeTab() === tab.id"
                        (click)="tabChanged.emit(tab.id)"
                    >
                        {{ tab.label }}
                        <span class="cms-instance-grid__count">({{ tab.count }})</span>
                    </button>
                }
            </div>

            <div class="cms-instance-grid__header" role="row">
                <div class="cms-instance-grid__col cms-instance-grid__col--idx" role="columnheader">#</div>
                <div class="cms-instance-grid__col cms-instance-grid__col--name" role="columnheader">Name</div>
                <div class="cms-instance-grid__col cms-instance-grid__col--status" role="columnheader">Status</div>
                <div class="cms-instance-grid__col cms-instance-grid__col--time" role="columnheader">Generated</div>
                <div class="cms-instance-grid__col cms-instance-grid__col--file" role="columnheader">File</div>
            </div>

            @if (loading() && items().length === 0) {
                <div class="cms-instance-grid__empty">Loading instances…</div>
            } @else if (items().length === 0) {
                <div class="cms-instance-grid__empty">No instances match this filter.</div>
            } @else {
                <cdk-virtual-scroll-viewport
                    [itemSize]="ROW_HEIGHT"
                    class="cms-instance-grid__viewport"
                    (scrolledIndexChange)="onScrolledIndexChange($event)"
                >
                    <ng-container *cdkVirtualFor="let row of items(); let i = index; trackBy: trackById">
                        <div
                            class="cms-instance-grid__row"
                            [class.cms-instance-grid__row--failed]="row.status === 'failed'"
                            role="row"
                        >
                            <div class="cms-instance-grid__col cms-instance-grid__col--idx">{{ i + 1 }}</div>
                            <div class="cms-instance-grid__col cms-instance-grid__col--name" [title]="row.name ?? row.id">
                                {{ row.name ?? row.id }}
                            </div>
                            <div class="cms-instance-grid__col cms-instance-grid__col--status">
                                <span class="cms-instance-grid__badge"
                                      [class.cms-instance-grid__badge--rendered]="row.status === 'rendered'"
                                      [class.cms-instance-grid__badge--pending]="row.status === 'pending'"
                                      [class.cms-instance-grid__badge--failed]="row.status === 'failed'">
                                    {{ statusLabel(row.status) }}
                                </span>
                            </div>
                            <div class="cms-instance-grid__col cms-instance-grid__col--time">
                                {{ row.generatedAt ? (row.generatedAt | date: 'short') : '—' }}
                            </div>
                            <div class="cms-instance-grid__col cms-instance-grid__col--file">
                                @if (row.status === 'rendered' && row.generatedFileId) {
                                    <button type="button"
                                            class="cms-instance-grid__view"
                                            (click)="viewRequested.emit(row)">View</button>
                                } @else if (row.status === 'failed') {
                                    <button type="button"
                                            class="cms-instance-grid__expand"
                                            [attr.aria-expanded]="expanded() === row.id"
                                            (click)="toggleExpand(row.id)">
                                        {{ expanded() === row.id ? 'Hide error' : 'Show error' }}
                                    </button>
                                } @else {
                                    <span class="cms-instance-grid__muted">—</span>
                                }
                            </div>
                        </div>
                        @if (row.status === 'failed' && expanded() === row.id) {
                            <div class="cms-instance-grid__error" role="row">
                                {{ row.errorMessage ?? 'No error message recorded.' }}
                            </div>
                        }
                    </ng-container>
                </cdk-virtual-scroll-viewport>
            }
        </div>
    `,
    styles: [`
        .cms-instance-grid__view {
            background: none;
            border: 0;
            padding: 0;
            font: inherit;
            color: var(--cms-accent);
            cursor: pointer;
            text-decoration: underline;
        }

        :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }

        .cms-instance-grid {
            display: flex;
            flex-direction: column;
            min-height: 0;
            flex: 1;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            background: var(--cms-surface);
        }
        .cms-instance-grid__tabs {
            display: flex;
            gap: .25rem;
            padding: .5rem;
            border-bottom: 1px solid var(--cms-border);
            background: var(--cms-bg);
        }
        .cms-instance-grid__tab {
            background: none;
            border: 1px solid transparent;
            color: var(--cms-text-secondary);
            cursor: pointer;
            padding: .25rem .75rem;
            font-size: .85rem;
            border-radius: var(--cms-radius-sm);
            transition: background .1s, color .1s, border-color .1s;
        }
        .cms-instance-grid__tab:hover {
            color: var(--cms-text);
            background: var(--cms-border-light);
        }
        .cms-instance-grid__tab--active {
            color: var(--cms-text);
            background: var(--cms-surface);
            border-color: var(--cms-border);
            font-weight: 600;
        }
        .cms-instance-grid__count {
            color: var(--cms-text-muted);
            margin-left: .25rem;
        }

        .cms-instance-grid__header,
        .cms-instance-grid__row {
            display: grid;
            grid-template-columns: 48px minmax(160px, 1fr) 120px 160px 120px;
            align-items: center;
            gap: .5rem;
            padding: 0 .75rem;
            font-size: .85rem;
        }
        .cms-instance-grid__header {
            height: 32px;
            background: var(--cms-bg);
            border-bottom: 1px solid var(--cms-border);
            color: var(--cms-text-secondary);
            font-weight: 600;
        }
        .cms-instance-grid__row {
            height: 40px;
            border-bottom: 1px solid var(--cms-border-light);
            color: var(--cms-text);
        }
        .cms-instance-grid__row--failed { background: var(--cms-danger-light, #fef2f2); }

        .cms-instance-grid__col--idx { color: var(--cms-text-muted); }
        .cms-instance-grid__col--name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .cms-instance-grid__viewport {
            flex: 1;
            min-height: 320px;
            height: 600px;
        }

        .cms-instance-grid__badge {
            display: inline-block;
            padding: 1px 8px;
            border-radius: 999px;
            font-size: .75rem;
            font-weight: 600;
            text-transform: capitalize;
        }
        .cms-instance-grid__badge--rendered {
            background: var(--cms-success-light, #f0fdf4);
            color: var(--cms-success, #16a34a);
        }
        .cms-instance-grid__badge--pending {
            background: var(--cms-info-light, #eff6ff);
            color: var(--cms-info, #2563eb);
        }
        .cms-instance-grid__badge--failed {
            background: var(--cms-danger-light, #fef2f2);
            color: var(--cms-danger, #dc2626);
        }

        .cms-instance-grid__expand {
            background: none;
            border: none;
            color: var(--cms-primary, #2563eb);
            cursor: pointer;
            font-size: .8rem;
            padding: 0;
            text-decoration: underline;
        }
        .cms-instance-grid__muted { color: var(--cms-text-muted); }

        .cms-instance-grid__error {
            padding: .5rem 1rem .75rem 60px;
            font-size: .8rem;
            color: var(--cms-danger-text);
            background: var(--cms-danger-light, #fef2f2);
            white-space: pre-wrap;
            word-break: break-word;
        }

        .cms-instance-grid__empty {
            padding: 2rem 1rem;
            text-align: center;
            color: var(--cms-text-secondary);
            font-size: .9rem;
        }
    `],
})
export class InstanceGridComponent {
    readonly ROW_HEIGHT = 40;

    readonly items = input.required<readonly DocumentInstanceDto[]>();
    readonly loading = input<boolean>(false);
    readonly activeTab = input.required<InstanceFilterTab>();
    readonly totals = input.required<{ all: number; failed: number; pending: number; done: number }>();

    /** The row the operator wants to open; the page owns HOW it opens. */
    readonly viewRequested = output<DocumentInstanceDto>();
    readonly tabChanged = output<InstanceFilterTab>();
    readonly scrolledNearEnd = output<void>();

    protected readonly expanded = signal<string | null>(null);

    protected readonly tabs = computed(() => {
        const t = this.totals();
        return [
            { id: 'all' as const, label: 'All', count: t.all },
            { id: 'failed' as const, label: 'Failed', count: t.failed },
            { id: 'pending' as const, label: 'Pending', count: t.pending },
            { id: 'done' as const, label: 'Done', count: t.done },
        ];
    });

    protected toggleExpand(id: string): void {
        this.expanded.update(curr => (curr === id ? null : id));
    }

    protected trackById = (_index: number, row: DocumentInstanceDto): string => row.id;

    protected statusLabel(status: string): string {
        if (status === 'rendered') {
            return 'Done';
        }
        return status;
    }

    protected onScrolledIndexChange(_index: number): void {
        // Parent owns the "near end" heuristic; emit and let it decide
        // whether to fetch the next page. Polling impl currently
        // re-fetches the whole filter window every 2 s, so this hook
        // stays optional until lazy pagination is wired.
        this.scrolledNearEnd.emit();
    }
}
