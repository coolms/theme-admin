import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CollectionService } from './collection.service';
import { MultiOptionSelectComponent, ToastService } from '@coolms/ui-angular';

interface DistributionDialogData {
    /** Absolute VFS path of the collection directory. */
    readonly path: string;
    /** Human label for the header (falls back to the path). */
    readonly label?: string;
}

/**
 * Per-section outbound-distribution config (backend). Opened from
 * the Pages list right-click menu on a content-collection directory row; sets
 * which outbound channels a published post in the collection fans out to.
 *
 *  - Channels come from the `core.outbound_channels` OptionSource, so the list
 *    grows automatically as channels are installed — no hard-coded ids.
 *  - Reads the current config from the generic node-meta endpoint (`extras`).
 *  - Writes via the validated `PATCH …/collections/distribution` (unknown
 *    channels are rejected server-side).
 *  - `webhook` gets a URL field (its per-channel config); other channels need
 *    no extra config today. Empty selection = no distribution.
 *
 * Degrades gracefully when the target dir is not a content collection.
 */
@Component({
    selector: 'app-collection-distribution-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, MultiOptionSelectComponent],
    template: `
        <div class="cms-dialog" style="width: 460px;">
            <div class="cms-dialog-header">
                <span>Distribution — {{ label }}</span>
                <button class="cms-dialog-close" (click)="close()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            <div class="cms-dialog-body" style="display: flex; flex-direction: column; gap: 12px;">
                @if (loading()) {
                    <div class="text-muted">Loading…</div>
                } @else if (!isCollection()) {
                    <div class="cms-field-hint">
                        This directory is not a content collection. Distribution settings
                        apply to blog/docs collections.
                    </div>
                } @else {
                    <div>
                        <label class="cms-label">Channels</label>
                        <app-multi-option-select
                            [values]="enabledChannels()"
                            [apiUrl]="channelsApiUrl"
                            placeholder="— No distribution —"
                            entityLabel="channel"
                            (valuesChange)="onChannelsChange($event)" />
                        <div class="cms-field-hint">
                            Publishing a post in this collection fans out to the selected
                            channels. Empty = distribution off.
                        </div>
                    </div>
                    @if (webhookEnabled()) {
                        <div>
                            <label class="cms-label">Webhook URL</label>
                            <input class="cms-input" type="url" [(ngModel)]="webhookUrl"
                                   placeholder="https://hooks.example.com/…" />
                            <div class="cms-field-hint">
                                The published item is POSTed here as JSON. Leave blank to skip the webhook.
                            </div>
                        </div>
                    }
                }
            </div>
            <div class="cms-dialog-footer">
                <button class="cms-btn cms-btn-sm" (click)="close()">Cancel</button>
                @if (!loading() && isCollection()) {
                    <button class="cms-btn cms-btn-primary cms-btn-sm"
                            [disabled]="saving()"
                            (click)="save()">
                        {{ saving() ? 'Saving…' : 'Save' }}
                    </button>
                }
            </div>
        </div>
    `,
})
export class CollectionDistributionDialogComponent implements OnInit {
    private readonly dialogRef     = inject<DialogRef<boolean | null>>(DialogRef);
    private readonly data          = inject<DistributionDialogData>(DIALOG_DATA);
    private readonly collectionSvc = inject(CollectionService);
    private readonly toast         = inject(ToastService);

    readonly channelsApiUrl = '/api/v1/options/core.outbound_channels';

    readonly loading         = signal(true);
    readonly saving          = signal(false);
    readonly isCollection    = signal(true);
    readonly enabledChannels = signal<readonly string[]>([]);
    readonly webhookEnabled  = computed(() => this.enabledChannels().includes('webhook'));
    webhookUrl = '';

    get label(): string {
        return this.data.label ?? this.data.path;
    }

    ngOnInit(): void {
        this.collectionSvc.getDistribution(this.data.path).subscribe({
            next: cfg => {
                this.isCollection.set(cfg.isCollection);
                this.enabledChannels.set(cfg.enabledChannels);
                const webhook = cfg.channelConfig['webhook'];
                this.webhookUrl = webhook && typeof webhook['url'] === 'string' ? String(webhook['url']) : '';
                this.loading.set(false);
            },
            error: () => {
                this.toast.error('Failed to load distribution settings');
                this.isCollection.set(false);
                this.loading.set(false);
            },
        });
    }

    onChannelsChange(values: readonly string[]): void {
        this.enabledChannels.set(values);
    }

    save(): void {
        this.saving.set(true);

        const channelConfig: Record<string, unknown> = {};
        if (this.webhookEnabled() && this.webhookUrl.trim()) {
            channelConfig['webhook'] = { url: this.webhookUrl.trim() };
        }

        this.collectionSvc.setDistribution({
            path:            this.data.path,
            enabledChannels: [...this.enabledChannels()],
            channelConfig,
        }).subscribe({
            next: () => {
                this.toast.success('Distribution settings saved', this.label);
                this.dialogRef.close(true);
            },
            error: () => {
                this.saving.set(false);
                this.toast.error('Failed to save distribution settings');
            },
        });
    }

    close(): void {
        this.dialogRef.close(null);
    }
}
