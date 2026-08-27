import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CmsRightPanelComponent } from '@coolms/ui-angular';
import { MediaPageStateService } from './media-page-state.service';
import { MediaDetailComponent } from './media-detail.component';
import { CollectionDetailComponent } from './collection-detail.component';
import { MediaAssetDto } from './media.types';

/**
 * Slot adapter that mounts the right-panel Properties content inside the shared
 * `<cms-right-panel>` chrome. Hosts EITHER the asset Properties panel (when an
 * asset is active) OR the collection Properties panel (when a collection is
 * active) — both drive the same panel region; `state.panelNode()` picks the
 * matching header (icon + title) for each.
 *
 * Registered as 'MediaDetail' in ComponentRegistry. ExplorerLayout shows the
 * region when `context.activeItem` is truthy (the page sets it to
 * `activeAsset ?? activeCollection`).
 */
@Component({
    selector: 'app-media-detail-slot',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsRightPanelComponent, MediaDetailComponent, CollectionDetailComponent],
    template: `
        @if (state.activeAsset(); as asset) {
            <cms-right-panel
                [node]="state.panelNode()"
                (closed)="state.activeAsset.set(null)">
                <button extra-actions
                        class="cms-btn cms-btn-ghost cms-btn-sm"
                        title="Permissions"
                        (click)="state.permissionsRequested$.next(asset)">
                    <i class="bi bi-lock-fill"></i>
                </button>
                <app-media-detail
                    [asset]="asset"
                    (saved)="onSaved($event)" />
            </cms-right-panel>
        }
        @if (state.activeCollection(); as col) {
            <cms-right-panel
                [node]="state.panelNode()"
                (closed)="state.activeCollection.set(null)">
                <button extra-actions
                        class="cms-btn cms-btn-ghost cms-btn-sm"
                        title="Permissions"
                        (click)="state.collectionPermsRequested$.next(col.path)">
                    <i class="bi bi-lock-fill"></i>
                </button>
                <app-collection-detail
                    [path]="col.path"
                    [name]="col.name"
                    (saved)="onCollectionSaved()" />
            </cms-right-panel>
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
    `],
})
export class MediaDetailSlotComponent {
    readonly state = inject(MediaPageStateService);

    onSaved(updated: MediaAssetDto): void {
        this.state.activeAsset.set(updated);
        this.state.assetSaved$.next(updated);
    }

    onCollectionSaved(): void {
        // Title is display-only metadata; the collections tree keys on the
        // directory name, so no tree reload is needed here.
    }
}
