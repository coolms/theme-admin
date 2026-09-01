import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    inject,
    signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalComponent } from '@coolms/ui-angular';
import { ErrorHandlerService } from '@coolms/core-angular';
import { BackupService, RestorePreviewResult } from './backup.service';

/**
 * "Restore preview" dialog (ADR-149, #1478).
 *
 * A read-only dry run: on open it POSTs to `/core/backups/{name}/restore-preview`
 * (which writes NOTHING) and renders the plan — the per-module list of what
 * `coolms:backup:restore` WOULD replay. There is deliberately no "apply" button:
 * applying a restore overwrites the live DB and stays on the CLI behind its
 * interactive confirmation. `{ name }` arrives via `DIALOG_DATA`.
 */
@Component({
    selector: 'app-restore-preview-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent],
    template: `
        <app-modal [title]="'Restore preview — ' + name" [width]="580">
            @if (preview(); as p) {
                <p class="hint">
                    <strong>Dry run — nothing is written.</strong> This is what
                    <code>coolms:backup:restore</code> would replay from bundle
                    <code>{{ p.name }}</code> (format v{{ p.formatVersion }}; tiers:
                    {{ p.tiers.join(', ') }}). Applying a real restore overwrites the live
                    database and stays on the CLI.
                </p>
                <table class="ptable">
                    <thead><tr><th>Module</th><th>Plan</th></tr></thead>
                    <tbody>
                        @for (row of p.plan; track row.key) {
                            <tr>
                                <td>{{ row.label }} <code>{{ row.key }}</code></td>
                                <td>{{ row.status }}</td>
                            </tr>
                        }
                    </tbody>
                </table>
            } @else if (loading()) {
                <p class="hint">Computing the restore plan…</p>
            } @else {
                <p class="err"><i class="bi bi-exclamation-triangle"></i> {{ error() }}</p>
            }

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="close()">Close</button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .hint { margin: 0 0 0.85rem; font-size: 0.82rem; color: var(--cms-text-muted, #848b96); }
        .hint code { font-family: var(--cms-font-mono, ui-monospace, monospace); font-size: 0.78rem; }
        .err { color: var(--cms-danger-text); font-size: 0.85rem; display: flex; align-items: center; gap: 0.4rem; }
        .ptable { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .ptable th, .ptable td {
            text-align: left;
            padding: 0.35rem 0.5rem;
            border-bottom: 1px solid var(--cms-border, #e5e7eb);
        }
        .ptable th {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            color: var(--cms-text-muted, #848b96);
        }
        .ptable code {
            font-family: var(--cms-font-mono, ui-monospace, monospace);
            font-size: 0.76rem;
            color: var(--cms-text-muted, #848b96);
        }
    `],
})
export class RestorePreviewDialogComponent implements OnInit {
    private readonly api = inject(BackupService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);
    readonly dialogRef = inject(DialogRef);

    readonly name = inject<{ name: string }>(DIALOG_DATA).name;

    readonly loading = signal(true);
    readonly preview = signal<RestorePreviewResult | null>(null);
    readonly error = signal<string | null>(null);

    ngOnInit(): void {
        this.api.restorePreview(this.name).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: p => { this.preview.set(p); this.loading.set(false); },
            error: e => { this.error.set(this.errors.humanize(e)); this.loading.set(false); },
        });
    }

    close(): void {
        this.dialogRef.close();
    }
}
