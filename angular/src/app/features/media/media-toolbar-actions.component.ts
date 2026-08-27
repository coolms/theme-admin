import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';

import { MediaAssetDto } from './media.types';

export type ToolbarContext =
    | { type: 'none' }
    | { type: 'collection'; path: string; name: string }
    | { type: 'files'; assets: MediaAssetDto[] };

@Component({
    selector: 'app-media-toolbar-actions',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    template: `
        @if (context().type !== 'none') {
            <div class="vr" style="height:24px; align-self:center"></div>

            @if (context().type === 'collection') {
                <button type="button" class="cms-btn cms-btn-sm"
                        title="New subcollection"
                        (click)="emit('new-subcollection')">
                    📁 New
                </button>
                <button type="button" class="cms-btn cms-btn-sm"
                        title="Permissions"
                        (click)="emit('collection-permissions')">
                    🔐
                </button>
                <button type="button" class="cms-btn cms-btn-sm"
                        title="Rename"
                        (click)="emit('rename')">
                    ✏️
                </button>
                <button type="button" class="cms-btn cms-btn-danger cms-btn-sm"
                        title="Delete collection"
                        (click)="emit('delete-collection')">
                    🗑️
                </button>
            }

            @if (context().type === 'files') {
                @let files = asFiles();

                @if (files.length === 1) {
                    <button type="button" class="cms-btn cms-btn-sm"
                            title="Edit details"
                            (click)="emit('edit')">
                        ✏️
                    </button>
                }
                <button type="button" class="cms-btn cms-btn-sm"
                        title="Permissions"
                        (click)="emit('permissions')">
                    🔐
                </button>
                <button type="button" class="cms-btn cms-btn-sm"
                        title="Move to…"
                        (click)="emit('move')">
                    📁 Move
                </button>
                @if (files.length === 1) {
                    <button type="button" class="cms-btn cms-btn-sm"
                            title="Download"
                            (click)="emit('download')">
                        ⬇️
                    </button>
                }
                <button type="button" class="cms-btn cms-btn-danger cms-btn-sm"
                        (click)="emit('delete')">
                    🗑️ @if (files.length > 1) { ({{ files.length }}) }
                </button>
            }

            <div class="vr" style="height:24px; align-self:center"></div>
        }
    `,
})
export class MediaToolbarActionsComponent {
    context = input.required<ToolbarContext>();
    action  = output<string>();

    emit(act: string): void { this.action.emit(act); }

    asFiles(): MediaAssetDto[] {
        const ctx = this.context();
        return ctx.type === 'files' ? ctx.assets : [];
    }
}
