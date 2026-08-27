import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ModalComponent, ToastService } from '@coolms/ui-angular';
import { MediaPickerComponent } from '../media/media-picker.component';
import type { MediaPickerEmit, MediaPickerOptions } from '../media/media-picker.types';
import { MediaService } from '../media/media.service';
import { ImageMapService } from './image-map.service';
import type { ImageMapDto } from './image-map.types';

export interface ImageMapFormDialogData {
    /** Present → edit mode (slug immutable); absent → create. */
    map?: ImageMapDto;
}

/**
 * Create/edit dialog for an ImageMap (`app-modal` + footer slot, the #520
 * dialog shape; one dialog for both modes via optional DIALOG_DATA — the
 * sync edge-register pattern).
 *
 * The intrinsic size is the coordinate frame regions are normalized against:
 * raster = pixel dimensions, SVG = viewBox extent. On edit the backend
 * re-bases imageRef + BOTH dimensions together (all-or-nothing), so the PATCH
 * always carries the full trio — same values when untouched, which is a no-op.
 */
@Component({
    selector: 'coolms-admin-image-map-form-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule, MediaPickerComponent],
    template: `
        <app-modal [title]="isEdit ? 'Edit image map' : 'New image map'" [width]="520">
            <div class="field">
                <label class="cms-label" for="im-slug">Slug</label>
                <input id="im-slug" class="cms-input" [(ngModel)]="slug" [disabled]="isEdit"
                       placeholder="floor-plan-1" autocomplete="off">
                <div class="cms-field-hint">Lowercase kebab-case; the stable handle consumers reference. Immutable after creation.</div>
            </div>
            <div class="field">
                <label class="cms-label" for="im-title">Title</label>
                <input id="im-title" class="cms-input" [(ngModel)]="title"
                       placeholder="Ground floor" autocomplete="off">
            </div>
            <div class="field">
                <label class="cms-label">Image</label>
                <app-media-picker
                    [options]="pickerOptions"
                    [value]="imageRef || null"
                    cardinality="one"
                    (valueChange)="onImagePicked($event)" />
                <div class="cms-field-hint">
                    @if (imageRef) {
                        Picking a different image re-reads its intrinsic size below.
                    } @else {
                        The raster or SVG the regions are drawn on.
                    }
                </div>
            </div>
            <div class="field size-row">
                <div>
                    <label class="cms-label" for="im-width">Intrinsic width</label>
                    <input id="im-width" class="cms-input" type="number" min="1" [(ngModel)]="intrinsicWidth">
                </div>
                <div>
                    <label class="cms-label" for="im-height">Intrinsic height</label>
                    <input id="im-height" class="cms-input" type="number" min="1" [(ngModel)]="intrinsicHeight">
                </div>
            </div>
            <div class="cms-field-hint size-hint">
                The coordinate frame regions are normalized against (raster: pixels; SVG: viewBox units).
            </div>
            <div class="field">
                <label class="cms-checkbox">
                    <input type="checkbox" [(ngModel)]="enabled"> Enabled
                </label>
            </div>
            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="saving() || !valid()"
                        (click)="save()">
                    {{ saving() ? 'Saving…' : (isEdit ? 'Save image map' : 'Create image map') }}
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .field { margin-bottom: 12px; }
        .size-row { display: flex; gap: 12px; }
        .size-row > div { flex: 1; }
        .size-hint { margin: -6px 0 12px; }
    `],
})
export class ImageMapFormDialogComponent {
    private readonly data      = inject<ImageMapFormDialogData | null>(DIALOG_DATA, { optional: true });
    private readonly dialogRef = inject<DialogRef<ImageMapDto>>(DialogRef);
    private readonly api       = inject(ImageMapService);
    private readonly media     = inject(MediaService);
    // OnPush + a subscription that writes plain fields: without this the
    // pre-filled sizes land in the model and never reach the inputs.
    private readonly cdr       = inject(ChangeDetectorRef);
    private readonly toast     = inject(ToastService);
    private readonly errors    = inject(ErrorHandlerService);

    readonly isEdit = !!this.data?.map;

    slug            = this.data?.map?.slug ?? '';
    title           = this.data?.map?.title ?? '';
    imageRef        = this.data?.map?.imageRef ?? '';
    intrinsicWidth  = this.data?.map?.intrinsicWidth ?? 1000;
    intrinsicHeight = this.data?.map?.intrinsicHeight ?? 1000;
    enabled         = this.data?.map?.enabled ?? true;

    readonly saving = signal(false);

    /**
     * Assets only, emitting the node UUID — the exact scalar `imageRef` stores,
     * so the picker is a drop-in for the text box it replaces rather than a new
     * wire shape. `accept` keeps the grid to images: a region map drawn over a
     * PDF or an audio file is not a thing.
     */
    readonly pickerOptions: MediaPickerOptions = {
        bindTarget:   'asset',
        bindValue:    'uuid',
        accept:       'image/*',
        display:      'thumb',
        recentlyUsed: true,
    };

    /**
     * Picking an image re-reads its intrinsic size, because on this form the two
     * are not independent: the dimensions ARE the coordinate frame the regions
     * are normalized against, so a new image with the old frame silently
     * mis-places every existing region. The backend already treats the trio as
     * all-or-nothing on edit; this makes the form agree with it.
     *
     * Overwrites whatever was typed, deliberately — after changing the image the
     * previous numbers describe a different picture. A failed lookup or an asset
     * with no extracted dimensions (an SVG with no intrinsic size) leaves the
     * inputs alone rather than zeroing them, so the operator can still enter the
     * viewBox extent by hand.
     */
    onImagePicked(emit: MediaPickerEmit): void {
        const uuid = typeof emit === 'string' ? emit : '';
        this.imageRef = uuid;
        if (!uuid) return;

        this.media.get(uuid).subscribe({
            next: asset => {
                // `dimensions` is the only size on MediaAssetDto and it is
                // nullable — the backend has not extracted one for every asset.
                const w = asset.dimensions?.width;
                const h = asset.dimensions?.height;
                if (w && h) {
                    this.intrinsicWidth = w;
                    this.intrinsicHeight = h;
                }
                this.cdr.markForCheck();
            },
            error: () => { /* keep whatever is in the inputs; the operator can type it */ },
        });
    }

    valid(): boolean {
        return /^[a-z0-9][a-z0-9-]{0,127}$/.test(this.slug)
            && this.title.trim() !== ''
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.imageRef)
            && this.intrinsicWidth > 0
            && this.intrinsicHeight > 0;
    }

    save(): void {
        if (!this.valid() || this.saving()) return;
        this.saving.set(true);

        const request$ = this.isEdit
            ? this.api.updateImageMap(this.slug, {
                title:           this.title.trim(),
                imageRef:        this.imageRef,
                intrinsicWidth:  Number(this.intrinsicWidth),
                intrinsicHeight: Number(this.intrinsicHeight),
                enabled:         this.enabled,
            })
            : this.api.createImageMap({
                slug:            this.slug,
                title:           this.title.trim(),
                imageRef:        this.imageRef,
                intrinsicWidth:  Number(this.intrinsicWidth),
                intrinsicHeight: Number(this.intrinsicHeight),
                enabled:         this.enabled,
            });

        request$.subscribe({
            next:  saved => this.dialogRef.close(saved),
            error: (e: unknown) => {
                this.saving.set(false);
                this.toast.error(this.errors.humanize(e));
            },
        });
    }

    cancel(): void {
        this.dialogRef.close();
    }
}
