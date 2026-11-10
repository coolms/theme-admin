import { afterRenderEffect, ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { CmsPaneToolbarComponent, type PaneToolbarAction } from '@coolms/ui-angular';

/**
 * The bar above the checked rows. It leads with Clear, which carries the count ("x 2 selected"), then the actions on
 * the checked rows as the pane toolbar draws them, then Select all as an icon button. The toolbar takes every pixel
 * the two buttons leave, so its actions give way only when the row itself is narrow.
 *
 * Clear gives way with the actions: once the toolbar has hidden every label, Clear drops its word and reads "x 2";
 * it takes its word back only once the toolbar shows every label again. The two thresholds keep the row from
 * flickering between the two, as Clear's own width changes the toolbar's.
 */
@Component({
    selector: 'app-mail-bulk-bar',
    standalone: true,
    imports: [CmsPaneToolbarComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="mbx__bulkbar">
            <button type="button" class="mbx__bulkbar-clear" data-test="bulk-clear" (click)="clear.emit()"
                    [attr.aria-label]="'Clear selection (' + count() + ' selected)'"
                    [attr.title]="'Clear selection (' + count() + ' selected)'">
                <i class="bi bi-x-lg" aria-hidden="true"></i>
                <span class="mbx__bulkbar-count" aria-hidden="true">{{ count() }}@if (!clearBare()) {<span class="mbx__bulkbar-word"> selected</span>}</span>
            </button>
            <cms-pane-toolbar class="mbx__bulkbar-row" [actions]="actions()"
                              label="Actions on the selected messages"
                              (action)="action.emit($event)" />
            <button type="button" class="mbx__bulkbar-icon" data-test="bulk-select-all" (click)="selectAll.emit()"
                    aria-label="Select all loaded messages" title="Select all loaded messages">
                <i class="bi bi-check-all" aria-hidden="true"></i>
            </button>
        </div>
    `,
    styles: [`
        :host { display: block; }
        .mbx__bulkbar {
            display: flex; align-items: center; gap: 6px;
            padding: 0 10px; border-bottom: 1px solid var(--cms-border);
            background: var(--cms-surface-alt, var(--cms-surface-hover));
        }
        .mbx__bulkbar-row { flex: 1 1 auto; min-width: 0; }
        .mbx__bulkbar-clear, .mbx__bulkbar-icon {
            flex: 0 0 auto;
            display: inline-flex; align-items: center; justify-content: center; gap: 6px;
            min-width: var(--cms-row-height, 36px); height: var(--cms-row-height, 36px); padding: 0 var(--cms-space-2, 8px);
            border: 1px solid transparent; border-radius: var(--cms-radius-control, 10px);
            background: transparent; color: var(--cms-text); cursor: pointer;
            font: inherit; font-size: var(--cms-font-size-body, 14px); font-weight: var(--cms-font-weight-medium, 500);
            white-space: nowrap;
        }
        .mbx__bulkbar-icon { width: var(--cms-row-height, 36px); padding: 0; }
        .mbx__bulkbar-clear:hover, .mbx__bulkbar-icon:hover { background: var(--cms-btn-hover-bg); }
        .mbx__bulkbar-clear:focus-visible, .mbx__bulkbar-icon:focus-visible { outline: 2px solid var(--cms-focus-ring); outline-offset: 1px; }
        .mbx__bulkbar-clear .bi, .mbx__bulkbar-icon .bi { font-size: 1rem; line-height: 1; }
        @media (max-width: 1199.98px) {
            .mbx__bulkbar-clear, .mbx__bulkbar-icon { min-width: var(--cms-touch-target-min, 44px); height: var(--cms-touch-target-min, 44px); }
            .mbx__bulkbar-icon { width: var(--cms-touch-target-min, 44px); }
        }
    `],
})
export class MailBulkBarComponent {
    /** How many rows are checked. */
    readonly count = input.required<number>();
    /** The actions on the checked rows, the server's nodes this page can run. */
    readonly action = output<string>();
    readonly actions = input.required<readonly PaneToolbarAction[]>();
    readonly selectAll = output<void>();
    readonly clear = output<void>();
    /** The bar's element: where a second step of an action (Move's folders) opens. */
    readonly element: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    /** Clear reads "x 2" without its word. */
    readonly clearBare = signal(false);

    private readonly toolbar = viewChild.required(CmsPaneToolbarComponent);

    constructor() {
        // After render: the toolbar's inputs are bound and its layout measured by then.
        afterRenderEffect(() => {
            const layout = this.toolbar().layout();
            if (layout.labelsHidden) {
                this.clearBare.set(true);
            } else if (layout.bare.length === 0) {
                this.clearBare.set(false);
            }
        });
    }
}
