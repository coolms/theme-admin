import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { ComposeAttachmentsComponent } from './compose-attachments.component';

/**
 * Attach as an icon: a button labelled "Attach files" opening From device and From files, for a composer whose files
 * (the chips and the size meter) are drawn elsewhere by its `app-compose-attachments`, which does the attaching.
 */
@Component({
    selector: 'app-compose-attach-button',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="cab" (focusout)="onFocusOut($event)" (keydown.escape)="close($event)">
            <button type="button" class="cms-btn cms-btn-ghost cab__btn" data-test="attach-button"
                    aria-label="Attach files" title="Attach files" aria-haspopup="menu"
                    [attr.aria-expanded]="open()" (click)="open.set(!open())">
                <i class="bi bi-paperclip" aria-hidden="true"></i>
            </button>
            @if (open()) {
                <div class="cab__menu" role="menu" aria-label="Attach files" data-test="attach-button-menu"
                     [class.cab__menu--up]="up()">
                    <button type="button" role="menuitem" class="cab__item" data-test="attach-button-device"
                            (click)="fromDevice()">
                        <i class="bi bi-upload" aria-hidden="true"></i> From device
                    </button>
                    <button type="button" role="menuitem" class="cab__item" data-test="attach-button-files"
                            (click)="fromFiles()">
                        <i class="bi bi-folder2-open" aria-hidden="true"></i> From files
                    </button>
                </div>
            }
        </div>
    `,
    styles: [`
        :host { display: inline-flex; flex: 0 0 auto; }
        .cab { position: relative; display: inline-flex; }
        .cab__btn {
            justify-content: center; width: 36px; height: 36px; padding: 0;
        }
        .cab__btn .bi { font-size: 1.05rem; }
        .cab__menu {
            position: absolute; left: 0; top: calc(100% + 4px); z-index: 5;
            display: flex; flex-direction: column; min-width: 12rem; padding: 4px;
            background: var(--cms-surface); border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius); box-shadow: var(--cms-shadow-md);
        }
        .cab__menu--up { top: auto; bottom: calc(100% + 4px); }
        .cab__item {
            display: flex; align-items: center; gap: 8px; min-height: 2.25rem; padding: 4px 10px;
            border: 0; border-radius: var(--cms-radius-sm); background: none; color: var(--cms-text);
            font: inherit; text-align: start; cursor: pointer;
        }
        .cab__item:hover, .cab__item:focus-visible { background: var(--cms-bg-hover); }
        @media (max-width: 599.98px) {
            .cab__btn, .cab__item { min-width: var(--cms-touch-target-min); min-height: var(--cms-touch-target-min); }
        }
    `],
})
export class ComposeAttachButtonComponent {
    /** The composer's attachments, which attach what is chosen. */
    readonly target = input.required<ComposeAttachmentsComponent>();
    /** The menu opens above the button (a footer at the bottom of the screen). */
    readonly up = input(true);
    readonly open = signal(false);

    protected onFocusOut(event: FocusEvent): void {
        const next = event.relatedTarget as Node | null;
        if (next === null || !(event.currentTarget as HTMLElement).contains(next)) {
            this.open.set(false);
        }
    }

    protected close(event: Event): void {
        if (!this.open()) {
            return;
        }
        event.stopPropagation();
        this.open.set(false);
    }

    protected fromDevice(): void {
        this.open.set(false);
        this.target().chooseFromDevice();
    }

    protected fromFiles(): void {
        this.open.set(false);
        void this.target().chooseFromFiles();
    }
}
