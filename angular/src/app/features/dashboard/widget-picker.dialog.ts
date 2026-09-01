import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

import { ModalComponent } from '@coolms/ui-angular';

/** One addable card, as the dashboard page describes it. */
export interface PickableWidget {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    /** Explicit grouping from the catalogue; absent for most widgets. */
    readonly group?: string;
}

export interface WidgetPickerData {
    readonly widgets: PickableWidget[];
}

interface WidgetGroup {
    readonly name: string;
    readonly widgets: PickableWidget[];
}

/**
 * "Which card would you like to add?".
 *
 * ## This IS the prompt for a module that offers several
 *
 * The request was for a picker AND a prompt when one module offers more than
 * one widget. They turned out to be the same screen: a list grouped by module
 * answers both, because choosing from "VFS: Files stored / Storage used" is
 * exactly the choice a prompt would have asked for — without a second dialog
 * appearing after the first.
 *
 * ## Grouping falls back to the id prefix, and that is honest rather than lazy
 *
 * A widget id is module-prefixed by convention (`vfs.file-count`), and `group`
 * is optional and mostly unset. So the heading uses `group` when a module said
 * one and the prefix otherwise. It is a display heading and nothing depends on
 * it: get it wrong and a card is filed under an odd title, which is a very
 * different cost from getting a permission or a width wrong.
 */
@Component({
    selector: 'app-widget-picker-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent],
    template: `
        <app-modal title="Add a widget">
            @if (groups().length === 0) {
                <p class="picker__empty">
                    Every widget the installed modules offer is already on the dashboard.
                </p>
            } @else {
                @for (group of groups(); track group.name) {
                    <div class="picker__group">{{ group.name }}</div>
                    @for (widget of group.widgets; track widget.id) {
                        <button type="button" class="picker__item" (click)="pick(widget.id)">
                            <i class="bi" [class]="widget.icon"></i>
                            <span>{{ widget.label }}</span>
                        </button>
                    }
                }
            }

            <div footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
            </div>
        </app-modal>
    `,
    styles: [`
        .picker__empty { margin: 0; color: var(--cms-text-muted); }

        .picker__group {
            margin: 12px 0 4px;
            color: var(--cms-text-muted);
            font-size: .72rem;
            letter-spacing: .06em;
            text-transform: uppercase;
        }
        .picker__group:first-child { margin-top: 0; }

        .picker__item {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 8px 10px;
            border: 1px solid transparent;
            border-radius: var(--cms-radius, 6px);
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
        }
        .picker__item:hover {
            border-color: var(--cms-border);
            background: var(--cms-hover, rgba(127,127,127,.12));
        }
        .picker__item i { color: var(--cms-accent); font-size: 1.05rem; }
    `],
})
export class WidgetPickerDialogComponent {
    private readonly dialog = inject<DialogRef<string | null>>(DialogRef);
    private readonly data = inject<WidgetPickerData>(DIALOG_DATA);

    protected readonly groups = computed<WidgetGroup[]>(() => {
        const byName = new Map<string, PickableWidget[]>();

        for (const widget of this.data.widgets) {
            const name = this.groupName(widget);
            const bucket = byName.get(name);
            if (bucket) {
                bucket.push(widget);
            } else {
                byName.set(name, [widget]);
            }
        }

        // Insertion order, which is catalogue order — the order modules chose
        // to offer their widgets in, not an alphabetisation of it.
        return [...byName.entries()].map(([name, widgets]) => ({ name, widgets }));
    });

    protected pick(id: string): void {
        this.dialog.close(id);
    }

    protected cancel(): void {
        this.dialog.close(null);
    }

    private groupName(widget: PickableWidget): string {
        if (widget.group) return widget.group;

        const prefix = widget.id.split('.')[0] ?? widget.id;

        return prefix.charAt(0).toUpperCase() + prefix.slice(1);
    }
}
