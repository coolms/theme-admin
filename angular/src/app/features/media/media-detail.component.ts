import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { firstValueFrom } from 'rxjs';
import { MediaService } from './media.service';
import { MediaAssetDto } from './media.types';
import { CoolmsEditorComponent } from '@coolms/editor-angular';
import { LocaleSwitcherComponent, TagInputComponent, ToastService } from '@coolms/ui-angular';
import { AppConfigState } from '@coolms/core-angular';
import { MediaPageStateService } from './media-page-state.service';
import {
    CoolmsImageEditorHostComponent,
    type CoolmsImageEditorHostData,
    type CoolmsImageEditorHostResult,
} from '@coolms/image-editor-angular';

@Component({
    selector: 'app-media-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ReactiveFormsModule, TagInputComponent, LocaleSwitcherComponent, CoolmsEditorComponent],
    template: `
        @if (asset()) {
            <div class="media-detail">

                <!-- Preview + focal point editor -->
                <div class="media-preview-wrap" #previewWrap>
                    @if (isImage()) {
                        <img [src]="asset()!.thumbnailUrl ?? ''"
                             [alt]="assetAlt()"
                             class="media-preview-img"
                             (load)="onImageLoad()"
                             #previewImg />
                        <!-- Focal point dot -->
                        <div class="focal-dot"
                             [style.left.%]="focalX() * 100"
                             [style.top.%]="focalY() * 100"
                             (mousedown)="startFocalDrag($event, previewWrap)"
                             title="Drag to set focal point"></div>
                    } @else {
                        <div class="media-preview-placeholder">
                            <span style="font-size:3rem">{{ svc.mimeIcon(asset()!.mimeType) }}</span>
                            <div class="small text-muted mt-2">{{ asset()!.originalFilename }}</div>
                        </div>
                    }
                </div>

                <!-- Metadata form — scrolls independently when detail panel is short -->
                <div class="media-detail-form p-3">

                    <!-- Panel-level locale switcher: ONE strip drives title (alt) +
                         description (caption). Switching reloads the asset for that
                         locale (lazy locale query), so we never ship the whole
                         translations bag to the client. Locale-independent fields
                         (tags / focal point) are unaffected. -->
                    <app-locale-switcher
                        [activeLocale]="activeLocale()"
                        [dirty]="dirty()"
                        [loading]="localeLoading()"
                        (localeChange)="switchLocale($event)" />

                    <!-- Merged media model: Title IS the alt text, Description IS
                         the caption — one localized field each (resolved for the
                         active locale), shown with dual labels. -->
                    <label class="form-label small fw-semibold mb-1">Title <span class="text-muted fw-normal">/ Alt text</span></label>
                    <input type="text"
                           class="form-control form-control-sm"
                           [formControl]="titleControl"
                           [placeholder]="titlePlaceholder()" />

                    <div class="mt-2">
                        <label class="form-label small fw-semibold mb-1">Description <span class="text-muted fw-normal">/ Caption</span></label>
                        <!-- Rich (comment profile: bold/italic/link). mountKey remounts
                             the editor when the asset or locale changes so it re-seeds
                             from the resolved value; (contentChange) feeds the control. -->
                        <coolms-editor
                            class="cms-inline-editor"
                            profile="comment"
                            [content]="descriptionHtml()"
                            [mountKey]="descMountKey()"
                            (contentChange)="onDescriptionChange($event)" />
                    </div>

                    <!-- Tags (locale-independent): badges + search across tags already
                         in use across the library. Freeform — no Tag module yet. -->
                    <div class="mt-2">
                        <label class="form-label small fw-semibold">Tags</label>
                        <app-tag-input
                            [formControl]="tagsControl"
                            [suggestions]="tagSuggestions()"
                            placeholder="Add tag…" />
                    </div>

                    <!-- File info -->
                    <div class="border-top pt-3 mt-3">
                        <div class="small text-muted">
                            <div>Size: {{ formatSize(asset()!.fileSize) }}</div>
                            @if (asset()!.dimensions) {
                                <div>Dimensions: {{ asset()!.dimensions!.width }} × {{ asset()!.dimensions!.height }}px</div>
                            }
                            <div>Type: {{ asset()!.mimeType }}</div>
                            <div>Colorspace: {{ asset()!.colorspace }}</div>
                            <div>Status: <span [class]="statusClass()">{{ asset()!.status }}</span></div>
                        </div>
                    </div>

                    <!-- Actions -->
                    <div class="d-flex gap-2 mt-3 justify-content-end">
                        @if (isImage()) {
                            <button type="button" class="cms-btn"
                                    (click)="openImageEditor()"
                                    [disabled]="editorOpening() || asset()!.status !== 'ready'"
                                    [title]="asset()!.status === 'ready' ? 'Edit image' : 'Image is still ' + asset()!.status + ' — editing disabled'">
                                <i class="bi bi-pencil-square"></i>
                                {{ editorOpening() ? 'Opening…' : 'Edit image' }}
                            </button>
                        }
                        <button type="button" class="cms-btn cms-btn-primary"
                                (click)="save()" [disabled]="saving() || localeLoading()">
                            <i class="bi bi-check-lg"></i>
                            {{ saving() ? 'Saving…' : 'Save' }}
                        </button>
                        @if (asset()!.status === 'failed') {
                            <button type="button" class="cms-btn"
                                    (click)="regenerate()" title="Regenerate thumbnails">
                                <i class="bi bi-arrow-repeat"></i>
                            </button>
                        }
                    </div>
                </div>
            </div>
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .media-detail { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
        .media-preview-wrap {
            position: relative;
            height: 200px;
            background: #212529;
            overflow: hidden;
            flex-shrink: 0;
        }
        .media-detail-form { flex: 1; overflow-y: auto; min-height: 0; }
        .media-preview-img { width: 100%; height: 100%; object-fit: contain; }
        .media-preview-placeholder {
            width: 100%; height: 100%;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            color: #adb5bd;
        }
        .focal-dot {
            position: absolute;
            width: 16px; height: 16px;
            margin: -8px 0 0 -8px;
            border-radius: 50%;
            border: 2px solid white;
            background: #0d6efd;
            cursor: crosshair;
            box-shadow: 0 0 4px rgba(0,0,0,.5);
        }
        .media-locale-tabs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
        .media-locale-tab { font-size: .7rem; padding: 1px 6px; }
        .media-dirty-dot {
            display: inline-block;
            width: 6px; height: 6px;
            margin-left: 4px;
            border-radius: 50%;
            background: currentColor;
            vertical-align: middle;
        }
    `],
})
export class MediaDetailComponent {
    asset = input<MediaAssetDto | null>(null);
    saved = output<MediaAssetDto>();

    focalX         = signal(0.5);
    focalY         = signal(0.5);
    saving         = signal(false);
    editorOpening  = signal(false);
    localeLoading  = signal(false);
    /** True when the active locale's fields differ from what was last loaded/saved. */
    readonly dirty = signal(false);

    /** Single-value controls — each holds the value RESOLVED for {@link activeLocale}.
     *  title doubles as the image's alt text, description as its caption. */
    readonly titleControl       = new FormControl<string>('', { nonNullable: true });
    readonly descriptionControl = new FormControl<string>('', { nonNullable: true });
    readonly tagsControl        = new FormControl<string[]>([]);

    /** The locale currently shown in the panel; one locale is loaded at a time. */
    readonly activeLocale = signal<string>('en');

    /** Seed HTML for the rich Description editor (set on populate; the editor owns
     *  its doc thereafter and writes back via (contentChange)). */
    readonly descriptionHtml = signal<string>('');
    /** Remount key — bumps on asset/locale change so the editor re-seeds. */
    readonly descMountKey = computed<string>(() => `${this.asset()?.id ?? 'none'}:${this.activeLocale()}`);

    readonly svc        = inject(MediaService);
    readonly destroyRef = inject(DestroyRef);
    private readonly store     = inject(Store);
    private readonly dialog    = inject(Dialog);
    private readonly toast     = inject(ToastService);
    private readonly pageState = inject(MediaPageStateService);

    /** Distinct tags already used across the loaded library — the tag-input's
     *  search vocabulary (there's no Tag module / central tag store yet). */
    readonly tagSuggestions = computed<string[]>(() => {
        const set = new Set<string>();
        for (const a of this.pageState.assets()) {
            for (const t of a.tags ?? []) set.add(t);
        }
        return [...set].sort();
    });

    /** Default (canonical) locale — used to hint the fallback on non-default tabs. */
    readonly defaultLocale = computed((): string => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        return m?.platformDefaults?.locale ?? m?.supportedLocales?.[0]?.code ?? 'en';
    });

    /** On a non-default locale, hint the canonical fallback the public will see. */
    readonly titlePlaceholder = computed((): string => {
        if (this.activeLocale() === this.defaultLocale()) return 'Title / alt text…';
        const def = this.asset()?.title;
        return def ? `Falls back to ${this.defaultLocale().toUpperCase()}: “${def}”` : 'No default-locale value';
    });


    constructor() {
        // New asset selected → reset to the default locale and populate from the
        // (default-locale) payload the parent already loaded.
        effect(() => {
            const a = this.asset();
            if (!a) return;
            untracked(() => {
                this.activeLocale.set(this.defaultLocale());
                this.populate(a);
            });
        });

        // Any edit to a locale-scoped or shared field marks the active locale dirty.
        const tracked: AbstractControl[] = [
            this.titleControl, this.descriptionControl, this.tagsControl,
        ];
        for (const ctrl of tracked) {
            ctrl.valueChanges
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(() => this.dirty.set(true));
        }
    }

    /** Load the form controls from an asset payload (no dirty flag, no value events). */
    private populate(a: MediaAssetDto): void {
        this.titleControl.setValue(a.title ?? '', { emitEvent: false });
        this.descriptionControl.setValue(a.description ?? '', { emitEvent: false });
        this.descriptionHtml.set(a.description ?? '');
        this.tagsControl.setValue(a.tags ?? [], { emitEvent: false });
        this.focalX.set(a.focalPoint?.[0] ?? 0.5);
        this.focalY.set(a.focalPoint?.[1] ?? 0.5);
        this.dirty.set(false);
    }

    /**
     * Switch the panel to another locale. Guards unsaved edits, then lazily
     * reloads the asset for the target locale (`?locale=`) so alt/caption show
     * that locale's resolved value.
     */
    switchLocale(locale: string): void {
        if (locale === this.activeLocale()) return;
        if (this.dirty()
            && !confirm(`Discard unsaved changes for ${this.activeLocale().toUpperCase()}?`)) {
            return;
        }
        const a = this.asset();
        if (!a) return;

        this.activeLocale.set(locale);
        this.localeLoading.set(true);
        this.svc.get(a.id, locale)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: reloaded => { this.localeLoading.set(false); this.populate(reloaded); },
                error: ()       => { this.localeLoading.set(false); },
            });
    }

    isImage(): boolean {
        return !!this.asset()?.mimeType?.startsWith('image/');
    }

    /** The preview <img alt> — the title IS the alt text in the merged model. */
    assetAlt(): string {
        return this.titleControl.value;
    }

    /** Rich-editor (comment profile) wrote HTML → mirror into the save control. */
    onDescriptionChange(html: string): void {
        if (this.descriptionControl.value === html) return;
        this.descriptionControl.setValue(html); // emits → marks the active locale dirty
    }

    statusClass(): string {
        const map: Record<string, string> = {
            pending: 'text-warning',
            ready:   'text-success',
            failed:  'text-danger',
        };
        return map[this.asset()!.status] ?? '';
    }

    formatSize(bytes: number): string {
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
    }

    startFocalDrag(event: MouseEvent, wrap: HTMLElement): void {
        event.preventDefault();
        const move = (e: MouseEvent) => {
            const rect = wrap.getBoundingClientRect();
            this.focalX.set(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
            this.focalY.set(Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)));
            this.dirty.set(true);
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }

    save(): void {
        const a = this.asset();
        if (!a) return;
        this.saving.set(true);

        this.svc.update(a.id, {
            title:       this.titleControl.value,
            description: this.descriptionControl.value,
            tags:        this.tagsControl.value ?? [],
            focalPoint:  [this.focalX(), this.focalY()],
        }, this.activeLocale()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: updated => {
                this.saving.set(false);
                // Re-seed from the resolved response so the form reflects what was
                // persisted (and clears dirty).
                this.populate(updated);
                this.saved.emit(updated);
            },
            error: () => this.saving.set(false),
        });
    }

    regenerate(): void {
        const a = this.asset();
        if (!a) return;
        this.svc.regenerate(a.id).pipe(
            takeUntilDestroyed(this.destroyRef)
        ).subscribe();
    }

    /**
     * Opens the image editor dialog for the current asset. Handles both
     * Save (overwrite) and Save as... (new asset) flows by re-fetching
     * the result asset after a successful save and emitting it through
     * the existing `saved` output, which the parent slot uses to swap
     * the active asset and notify the asset list.
     *
     * Visibility is gated by `isImage()` in the template; backend voter
     * (ImageEditPermissionVoter) enforces VFS_WRITE before the save
     * lands. Authors without write permission see a 403 → toast error
     * inside the dialog rather than a hidden button — keeps the UI
     * affordance discoverable.
     */
    async openImageEditor(): Promise<void> {
        const asset = this.asset();
        if (!asset || !this.isImage() || !asset.originalUrl) return;

        this.editorOpening.set(true);
        try {
            const data: CoolmsImageEditorHostData = {
                context: 'media',
                asset: {
                    uuid:        asset.id,
                    originalUrl: asset.originalUrl ?? '',
                    filename:    asset.originalFilename,
                    mimeType:    asset.mimeType,
                    path:        asset.path ?? null,
                    dimensions:  asset.dimensions
                        ? { width: asset.dimensions.width, height: asset.dimensions.height }
                        : null,
                },
            };

            const dialogRef = this.dialog.open<CoolmsImageEditorHostResult, CoolmsImageEditorHostData>(
                CoolmsImageEditorHostComponent,
                {
                    data,
                    backdropClass: 'cdk-overlay-dark-backdrop',
                    disableClose:  true,
                },
            );

            const result = await firstValueFrom(dialogRef.closed);
            if (!result || result.kind === 'cancelled') return;

            // Both modes (overwrite, save_as_new) return a UUID for
            // Media-context saves. Refetch so we have the freshest
            // variants/dimensions/preset URLs, and emit through the
            // same `saved` channel the parent already consumes. The
            // parent's MediaPageStateService routes the event to
            // both the active-asset slot and the asset list. Falls
            // back to the source asset id when the host couldn't
            // resolve a fresh id from the response.
            const resolvedUuid = result.assetUuid ?? asset.id;
            const refreshed = await firstValueFrom(this.svc.get(resolvedUuid));
            this.saved.emit(refreshed);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            this.toast.error('Could not open editor: ' + message);
        } finally {
            this.editorOpening.set(false);
        }
    }

    onImageLoad(): void { /* fit/zoom logic if needed */ }
}
