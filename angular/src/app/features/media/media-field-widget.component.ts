import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MediaPickerComponent } from './media-picker.component';
import { MediaPickerEmit, MediaPickerOptions } from './media-picker.types';
import { MediaService } from './media.service';
import { MediaAssetDto } from './media.types';

/**
 * The `image` field widget (registered by the Media module via the field-widget
 * registry, see {@link import('../../../../../src/Media/Infrastructure/Field/MediaFieldWidgetProvider.php')}):
 * a field declared `type: image` renders a thumbnail preview of the current
 * value plus the Media Library picker (inline mode -> a "Choose…" trigger that
 * opens the library browser), instead of a plain URL text box.
 *
 * The stored value is the picked asset's **public URL** (a string), resolved
 * from the selected asset's `originalUrl` — so server-side consumers (the SEO
 * head's `<meta property="og:image">`) use it directly with no UUID lookup.
 * Because the value is a URL (not the picker's uuid/path space), the picker is
 * driven as a pure selection trigger (`[value]="null"`) and this widget renders
 * its own preview of the stored URL.
 *
 * Receives its value + change callback through the
 * {@link import('@coolms/ui-angular').FieldWidgetInputs}
 * contract so it renders generically via `NgComponentOutlet`.
 */
@Component({
    selector: 'app-media-field-widget',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MediaPickerComponent],
    template: `
        <div class="media-field-widget">
            @if (url(); as u) {
                <div class="media-field-widget__preview">
                    <img [src]="u" alt="" class="media-field-widget__img" />
                    <button type="button"
                            class="cms-btn cms-btn-sm cms-btn-ghost media-field-widget__clear"
                            [disabled]="disabled()"
                            (click)="clear()">
                        <i class="bi bi-x-lg"></i> Clear
                    </button>
                </div>
            }
            <app-media-picker
                [options]="pickerOptions"
                [value]="null"
                [cardinality]="'one'"
                [mode]="'inline'"
                [enableInsertModeToggle]="false"
                [disabled]="disabled()"
                (valueChange)="onPick($event)" />
        </div>
    `,
    styles: [`
        .media-field-widget {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .media-field-widget__preview {
            display: flex;
            align-items: flex-start;
            gap: 8px;
        }
        .media-field-widget__img {
            max-width: 100%;
            max-height: 120px;
            border-radius: var(--cms-radius-sm);
            border: 1px solid var(--cms-border);
            object-fit: contain;
            background: var(--cms-bg);
        }
        .media-field-widget__clear {
            flex-shrink: 0;
            font-size: .75rem;
        }
    `],
})
export class MediaFieldWidgetComponent {
    readonly value = input<unknown>();
    readonly config = input<Record<string, unknown>>({});
    readonly disabled = input(false);
    readonly valueChange = input<(value: unknown) => void>(() => {});

    private readonly media = inject(MediaService);
    private readonly destroyRef = inject(DestroyRef);

    /** Picker is image-only, single-asset, emitting the asset uuid. */
    readonly pickerOptions: MediaPickerOptions = {
        bindValue: 'uuid',
        bindTarget: 'asset',
        accept: 'image/*',
        display: 'thumb',
    };

    /** The stored value coerced to a URL string (null when unset). */
    readonly url = computed<string | null>(() => {
        const v = this.value();
        return typeof v === 'string' && v !== '' ? v : null;
    });

    /** Resolve the picked asset's public URL and store it as the field value. */
    onPick(emit: MediaPickerEmit): void {
        const uuid = typeof emit === 'string' ? emit : null;
        if (uuid === null) {
            return; // ignore clear/multi/unexpected emits; Clear button handles unset
        }
        this.media.get(uuid)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (a: MediaAssetDto) => {
                    const resolved = a.originalUrl ?? a.thumbnailUrl;
                    if (resolved) {
                        this.valueChange()(resolved);
                    }
                },
                error: () => { /* leave the current value unchanged on lookup failure */ },
            });
    }

    clear(): void {
        this.valueChange()(null);
    }
}
