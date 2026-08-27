import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { DateTimeFormatService, ModalComponent } from '@coolms/ui-angular';
import { CockpitVersionOptionDto } from './cockpit.types';

/** Data handed to the migrate dialog: the instance's version timeline. */
export interface MigrateDialogData {
    versions: CockpitVersionOptionDto[];
    currentVersion: number | null;
}

/** Resolved value when the operator picks a migration target. */
export interface MigrateResult {
    targetVersionId: string;
    targetVersion: number;
}

/**
 * M4.i — "Migrate version" dialog for the Process Cockpit detail page.
 *
 * A single dropdown of the instance definition's OTHER deployed versions
 * (the current one is excluded). Re-pinning a suspended instance to the
 * chosen version is the host page's job (it owns the POST + toast + detail
 * re-fetch); this dialog is a pure picker that resolves with a
 * {@link MigrateResult} on submit, or `null` on cancel.
 *
 * The host only opens this when the instance is Suspended AND has at least
 * one non-current version, so the dropdown is never empty.
 */
@Component({
    selector: 'app-migrate-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule],
    template: `
        <app-modal title="Migrate version" [width]="480">
            <div class="fields">
                <p class="lead">
                    Move this suspended instance to a different deployed version of its
                    definition. Token positions must exist in the target version.
                </p>

                <div>
                    <label class="cms-label" for="mig-target">Target version</label>
                    <select id="mig-target" class="cms-input"
                            [(ngModel)]="targetVersionId" (ngModelChange)="error.set(null)">
                        <option value="">— select a version —</option>
                        @for (v of targets; track v.versionId) {
                            <option [value]="v.versionId">Version {{ v.version }} · {{ formatDate(v.deployedAt) }}</option>
                        }
                    </select>
                    <div class="cms-field-hint">
                        Currently running {{ currentLabel() }}.
                    </div>
                </div>

                @if (error()) { <p class="error">{{ error() }}</p> }
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary" (click)="submit()">
                    Migrate
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .fields { display: flex; flex-direction: column; gap: 14px; }
        .lead { margin: 0; font-size: 0.85rem; color: var(--cms-text-muted, #6b7280); }
        .error { color: var(--cms-danger, #b91c1c); margin: 0; font-size: 0.8125rem; }
    `],
})
export class MigrateDialogComponent {
    readonly dialogRef = inject<DialogRef<MigrateResult | null>>(DialogRef);
    private readonly data = inject<MigrateDialogData>(DIALOG_DATA);
    private readonly dtf = inject(DateTimeFormatService);

    /** All deployed versions except the one the instance currently pins. */
    readonly targets: CockpitVersionOptionDto[] = (this.data.versions ?? []).filter(v => !v.isCurrent);

    targetVersionId = '';
    readonly error = signal<string | null>(null);

    currentLabel(): string {
        return this.data.currentVersion != null ? `version ${this.data.currentVersion}` : 'an unknown version';
    }

    formatDate(iso: string): string {
        try {
            return this.dtf.dateTime(iso);
        } catch {
            return iso;
        }
    }

    cancel(): void {
        this.dialogRef.close(null);
    }

    submit(): void {
        const picked = this.targets.find(v => v.versionId === this.targetVersionId);
        if (!picked) {
            this.error.set('Select a target version.');
            return;
        }
        this.dialogRef.close({ targetVersionId: picked.versionId, targetVersion: picked.version });
    }
}
