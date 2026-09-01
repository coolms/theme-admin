import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    signal,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalComponent, ToastService } from '@coolms/ui-angular';
import { ErrorHandlerService } from '@coolms/core-angular';
import { BackupService, CreateBackupResult } from './backup.service';

/**
 * "Create backup" dialog.
 *
 * Picks which data tiers to export into a new bundle, then POSTs to the backup
 * admin API. The create runs synchronously server-side, so the primary is
 * disabled while in flight; `config` is the default (the quick, deploy-config
 * payload) since `config,content` serialises the whole VFS blob store. Resolves
 * the dialog with the create report so the list page can toast + refresh.
 */
@Component({
    selector: 'app-backup-create-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule],
    template: `
        <app-modal title="Create backup" [width]="520">
            <p class="hint">
                Exports the selected data tiers into a new on-disk bundle under
                <code>var/backups/</code>. It runs <strong>synchronously</strong> — a
                <code>config,content</code> backup serialises the whole file store and can
                take a while, so start with <code>config</code> for a quick bundle.
            </p>
            <div class="field">
                <label class="cms-label" for="bk-tier">Tiers</label>
                <select id="bk-tier" class="cms-input" [(ngModel)]="tier">
                    <option value="config">config — platform / setup data</option>
                    <option value="config,content">config + content — the deploy payload</option>
                    <option value="content">content — pages, media, documents</option>
                    <option value="all">all — adds runtime (full DR clone)</option>
                </select>
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="creating()" (click)="create()">
                    <i class="bi bi-hdd-stack"></i>
                    <span>{{ creating() ? 'Creating…' : 'Create backup' }}</span>
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .hint { margin: 0 0 0.85rem; font-size: 0.82rem; color: var(--cms-text-muted, #848b96); }
        .hint code { font-family: var(--cms-font-mono, ui-monospace, monospace); font-size: 0.78rem; }
        .field { display: flex; flex-direction: column; margin-bottom: 0.5rem; }
    `],
})
export class BackupCreateDialogComponent {
    private readonly api = inject(BackupService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);
    readonly dialogRef = inject<DialogRef<CreateBackupResult>>(DialogRef);

    tier = 'config';
    readonly creating = signal(false);

    cancel(): void {
        this.dialogRef.close();
    }

    create(): void {
        if (this.creating()) return;
        this.creating.set(true);
        this.api.createBackup(this.tier).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: res => { this.creating.set(false); this.dialogRef.close(res); },
            error: e => { this.creating.set(false); this.toast.error(this.errors.humanize(e)); },
        });
    }
}
