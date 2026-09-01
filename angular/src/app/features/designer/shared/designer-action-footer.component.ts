import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { DateTimePipe } from '@coolms/ui-angular';

/**
 * UI-polish — the shared bottom bar for all four designer surfaces
 * (BPMN-Lite / DMN-table / DMN-DRD / state-machine).
 *
 * Mirrors the Image Editor's chrome: ONE bottom bar carries both the
 * primary actions (right-aligned) AND the surface status (left-aligned),
 * so there is no separate status strip wasting a band between the header
 * and the canvas. The editing toolbar keeps only canvas tools
 * (undo/redo/zoom/connect/palette).
 *
 *  - **Left (status):** an optional connect-mode hint, the "Saved {ts}"
 *    indicator, a projected `<ng-content>` slot for surface extras (e.g.
 *    BPMN's "Forked from module" chip + Revert), and the deploy badge
 *    (`deployedVersion > 0` -> green "Deployed vN"; else the muted
 *    `draftLabel`). This is the content that used to live in the now-retired
 *    standalone `designer-status-bar` strip.
 *  - **Right (actions):** Cancel (modal-only), Save (secondary), Deploy
 *    (primary). Each button is independently toggleable so a read-only
 *    viewer can show status with no write affordances.
 *
 * Stateless: the host page owns the Save/Deploy/Cancel lifecycle + binds
 * the outputs. Token-styled (`--cms-*`) so it tracks the platform palette.
 */
@Component({
    selector: 'app-designer-action-footer',
    standalone: true,
    imports: [DateTimePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="designer-action-footer">
            <div class="designer-action-footer__status">
                @if (connectHint()) {
                    <span class="designer-action-footer__hint">
                        <i class="bi bi-diagram-2 me-1" aria-hidden="true"></i>{{ connectHint() }}
                    </span>
                }
                @if (savedAt(); as ts) {
                    <span class="designer-action-footer__saved">Saved {{ ts | appDateTime }}</span>
                }
                <ng-content />
                @if (deployedVersion() && deployedVersion()! > 0) {
                    <span class="badge bg-success">Deployed v{{ deployedVersion() }}</span>
                } @else if (showDraftBadge()) {
                    <span class="badge bg-light text-dark border">{{ draftLabel() }}</span>
                }
            </div>
            <div class="designer-action-footer__actions">
                @if (showCancel()) {
                    <button
                        type="button"
                        class="cms-btn cms-btn-sm"
                        [disabled]="busy()"
                        (click)="cancel.emit()"
                    >
                        {{ cancelLabel() }}
                    </button>
                }
                @if (showSave()) {
                    <button
                        type="button"
                        class="cms-btn cms-btn-sm"
                        [disabled]="busy()"
                        (click)="save.emit()"
                    >
                        {{ saveLabel() }}
                    </button>
                }
                @if (showDeploy()) {
                    <button
                        type="button"
                        class="cms-btn cms-btn-primary cms-btn-sm"
                        [disabled]="busy()"
                        (click)="deploy.emit()"
                    >
                        {{ deployLabel() }}
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        .designer-action-footer {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 16px;
            border-top: 1px solid var(--cms-border);
            background: var(--cms-surface, #fff);
            flex-shrink: 0;
        }
        .designer-action-footer__status {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
            font: 12px/1.4 system-ui, -apple-system, sans-serif;
            color: var(--cms-text-secondary);
        }
        .designer-action-footer__saved { color: var(--cms-text-secondary); }
        .designer-action-footer__hint { color: var(--cms-accent-text); }
        .designer-action-footer__actions {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: 8px;
        }
    `],
})
export class DesignerActionFooterComponent {
    // --- actions ----------------------------------------------------------
    readonly saveLabel = input<string>('Save');
    readonly deployLabel = input<string>('Deploy');
    readonly cancelLabel = input<string>('Cancel');
    /** Disables every button (e.g. while a save/deploy is in flight). */
    readonly busy = input<boolean>(false);
    readonly showSave = input<boolean>(true);
    readonly showDeploy = input<boolean>(true);
    /** Cancel is modal-only (closes the dialog); routed pages leave it off. */
    readonly showCancel = input<boolean>(false);

    // --- status (folded in from the retired designer-status-bar) ----------
    /**
     * Raw ISO "saved at" instant; null hides the indicator. Rendered via the
     * pref-aware `appDateTime` pipe so it honours the user's tz +
     * 12h/24h + date-format pref (today -> time, older -> date + time) — the
     * same seam every other surface uses. (Was a pre-formatted locale string.)
     */
    readonly savedAt = input<string | null>(null);
    /** Latest deployed version; > 0 -> "Deployed vN", else the draft badge. */
    readonly deployedVersion = input<number | null>(null);
    /** Muted badge text shown when not deployed. */
    readonly draftLabel = input<string>('Draft · not deployed');
    /** Whether to show the draft badge at all when not deployed. */
    readonly showDraftBadge = input<boolean>(true);
    /** Optional connect-mode hint shown on the left while connecting. */
    readonly connectHint = input<string | null>(null);

    readonly save = output<void>();
    readonly deploy = output<void>();
    readonly cancel = output<void>();
}
