import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MediaPickerComponent } from './media-picker.component';
import { MediaPickerEmit, MediaPickerOptions } from './media-picker.types';

/**
 * The `media-picker` field widget: the Media Library browser as a relation
 * field, storing the picked asset/collection reference itself (uuid or path)
 * rather than a resolved URL.
 *
 * Sibling of {@link MediaFieldWidgetComponent}, which serves `type: image` and
 * stores a public URL. This one serves a relation whose `dataSource.widget` is
 * `media-picker`, so the stored value is the picker's own value space and
 * supports `cardinality: many`.
 *
 * Lives in the Media module because everything it knows is a Media fact -- the
 * `widgetOptions` blob, the picker's value space, and the encoding below.
 * `shared/dynamic-form` reaches it through the field-widget registry, so the
 * generic form machinery never names this module.
 */
@Component({
    selector: 'app-media-picker-field-widget',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MediaPickerComponent],
    template: `
        <app-media-picker
            [options]="options()"
            [value]="picked()"
            [disabled]="disabled()"
            [cardinality]="cardinality()"
            (valueChange)="onPick($event)" />
    `,
})
export class MediaPickerFieldWidgetComponent {
    readonly value = input<unknown>();
    readonly config = input<Record<string, unknown>>({});
    readonly disabled = input(false);
    readonly valueChange = input<(value: unknown) => void>(() => {});

    /**
     * Picker options from the field's `dataSource.widgetOptions` blob, handed
     * over as the widget `config`. Falls back to `bindValue: 'uuid'`,
     * `display: 'thumb'`, `accept: '*'` when a key is absent -- the blob is
     * backend-authored and every key is optional.
     */
    readonly options = computed<MediaPickerOptions>(() => {
        const raw = this.config();
        const display = typeof raw['display'] === 'string' ? raw['display'] : 'thumb';
        const validDisplay: MediaPickerOptions['display'] =
            display === 'original' ? 'original'
            : display.startsWith('preset:') ? (display as `preset:${string}`)
            : 'thumb';
        const bindTarget = raw['bindTarget'];
        return {
            bindValue:    raw['bindValue'] === 'path' ? 'path' : 'uuid',
            display:      validDisplay,
            accept:       typeof raw['accept'] === 'string' ? (raw['accept']) : '*',
            bindTarget:   bindTarget === 'collection' ? 'collection'
                : bindTarget === 'either'             ? 'either'
                                                       : 'asset',
            recentlyUsed: raw['recentlyUsed'] === true,
            hoverPreview: raw['hoverPreview'] === true,
        };
    });

    /** Set by the field surface, since only it knows the relation's cardinality. */
    readonly cardinality = computed<'one' | 'many'>(() =>
        this.config()['cardinality'] === 'many' ? 'many' : 'one',
    );

    /** The bound value narrowed to what the picker accepts. */
    readonly picked = computed<string | string[] | null>(() => {
        const v = this.value();
        if (Array.isArray(v)) {
            return (v as unknown[]).filter((x): x is string => typeof x === 'string' && x !== '');
        }
        return typeof v === 'string' && v !== '' ? v : null;
    });

    /**
     * Encode the picker's emit into the stored field value.
     *
     * Cardinality:
     *   - 'one'  -> picker emits scalar (or null on clear). Stored as-is.
     *   - 'many' -> picker emits array. Stored as array (or null on clear).
     *
     * Backend integration contract for `bindTarget: 'either'`:
     *   The picker emits discriminator object(s) `{kind, value}` -- one per
     *   selection. Each is JSON-encoded into a string (or array of strings) so
     *   values survive standard form serialisation. Backend resources
     *   receiving the field MUST `json_decode($value, true,
     *   JSON_THROW_ON_ERROR)` per element and dispatch on `$payload['kind']`
     *   to resolve either an asset (uuid|path) or a collection (path).
     *
     * For `bindTarget: 'asset'` and `'collection'` the picker emits plain
     * string(s) and they pass through unchanged -- no decoding needed on the
     * backend side.
     *
     * The encoding lives HERE rather than in the field: which shapes the
     * picker emits is a Media fact, and the field only has to store what it
     * is handed.
     */
    onPick(next: MediaPickerEmit): void {
        let stored: string | string[] | null;
        if (next === null) {
            stored = null;
        } else if (Array.isArray(next)) {
            stored = (next as ReadonlyArray<unknown>).map(item =>
                typeof item === 'string' ? item : JSON.stringify(item),
            );
        } else if (typeof next === 'string') {
            stored = next;
        } else {
            stored = JSON.stringify(next);
        }
        this.valueChange()(stored);
    }
}
