import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output } from '@angular/core';
import { CmsPaneToolbarComponent, type PaneToolbarAction } from '@coolms/ui-angular';

/**
 * The bar above the checked rows: the actions on them as the pane toolbar draws them, with how many are checked in
 * its status slot, then Select all and Clear as two icon buttons. The toolbar takes every pixel the two buttons leave,
 * so its actions give way only when the row itself is narrow.
 */
@Component({
    selector: 'app-mail-bulk-bar',
    standalone: true,
    imports: [CmsPaneToolbarComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="mbx__bulkbar">
            <cms-pane-toolbar class="mbx__bulkbar-row" [actions]="actions()"
                              label="Actions on the selected messages"
                              [status]="count() + ' selected'"
                              (action)="action.emit($event)" />
            <button type="button" class="mbx__bulkbar-icon" data-test="bulk-select-all" (click)="selectAll.emit()"
                    aria-label="Select all loaded messages" title="Select all loaded messages">
                <i class="bi bi-check-all" aria-hidden="true"></i>
            </button>
            <button type="button" class="mbx__bulkbar-icon" data-test="bulk-clear" (click)="clear.emit()"
                    aria-label="Clear selection" title="Clear selection">
                <i class="bi bi-x-lg" aria-hidden="true"></i>
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
        .mbx__bulkbar-icon {
            flex: 0 0 auto;
            display: inline-flex; align-items: center; justify-content: center;
            width: var(--cms-row-height, 36px); height: var(--cms-row-height, 36px); padding: 0;
            border: 1px solid transparent; border-radius: var(--cms-radius-control, 10px);
            background: transparent; color: var(--cms-text); cursor: pointer;
        }
        .mbx__bulkbar-icon:hover { background: var(--cms-btn-hover-bg); }
        .mbx__bulkbar-icon:focus-visible { outline: 2px solid var(--cms-focus-ring); outline-offset: 1px; }
        .mbx__bulkbar-icon .bi { font-size: 1rem; line-height: 1; }
        @media (max-width: 1199.98px) {
            .mbx__bulkbar-icon { width: var(--cms-touch-target-min, 44px); height: var(--cms-touch-target-min, 44px); }
        }
    `],
})
export class MailBulkBarComponent {
    /** How many rows are checked. */
    readonly count = input.required<number>();
    /** The actions on the checked rows, the server's nodes this page can run. */
    readonly actions = input.required<readonly PaneToolbarAction[]>();
    readonly action = output<string>();
    readonly selectAll = output<void>();
    readonly clear = output<void>();
    /** The bar's element: where a second step of an action (Move's folders) opens. */
    readonly element: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
}
