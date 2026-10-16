import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { DraftConflict } from './draft-conflict';

/**
 * A draft that moved on since the page read it, said above the canvas: saved by someone else, or deleted. The edits
 * stay on the canvas, and nothing of the other save was overwritten. Reload reads the draft as it is now, in place of
 * the edits; until then Save and Deploy refuse -- a save never retries on its own and never merges.
 */
@Component({
    selector: 'app-draft-conflict',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="draft-conflict" role="alert">
            <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
            <span>
                @if (kind() === 'deleted') {
                    This draft was deleted since you opened it. Your edits are still on the canvas; saving cannot make it again.
                } @else {
                    This draft was saved by someone else since you opened it. Your edits are still on the canvas, and nothing of theirs was overwritten.
                }
            </span>
            <button type="button" class="cms-btn cms-btn-sm" (click)="reload.emit()">Reload, discarding my edits</button>
        </div>
    `,
    styles: [`
        .draft-conflict {
            display: flex; align-items: center; gap: 10px; padding: 8px 16px; margin: 0 0 8px;
            background: var(--cms-warning-light); color: var(--cms-warning-text);
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius-sm); font-size: .8125rem;
        }
        .draft-conflict > span { flex: 1; }
    `],
})
export class DraftConflictBannerComponent {
    readonly kind = input<DraftConflict>('changed');
    readonly reload = output<void>();
}
