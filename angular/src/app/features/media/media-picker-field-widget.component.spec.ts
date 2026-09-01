import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MediaPickerFieldWidgetComponent } from './media-picker-field-widget.component';

/**
 * The `media-picker` field widget: config mapping in, stored value out.
 *
 * These paths shipped untested for as long as they lived inside
 * `relation-field` -- that spec covers the native `<select>` and never touched
 * the media branch, so the `bindTarget: 'either'` JSON encoding (which the
 * BACKEND is required to `json_decode`) had no test at all. Moving the code
 * into the Media module is what made the gap obvious, so it is closed here.
 *
 * The picker itself is stubbed out of the template. What is under test is the
 * adapter: which options it derives from a backend-authored blob and how it
 * encodes what the picker emits. Rendering the real 1768-line library browser
 * would test the browser, not this.
 */
describe('MediaPickerFieldWidgetComponent', () => {
    let fixture: ComponentFixture<MediaPickerFieldWidgetComponent>;
    let widget:  MediaPickerFieldWidgetComponent;
    let stored:  unknown[];

    function mount(config: Record<string, unknown> = {}, value: unknown = null): void {
        stored = [];
        fixture = TestBed.createComponent(MediaPickerFieldWidgetComponent);
        fixture.componentRef.setInput('config', config);
        fixture.componentRef.setInput('value', value);
        fixture.componentRef.setInput('valueChange', (v: unknown) => stored.push(v));
        fixture.detectChanges();
        widget = fixture.componentInstance;
    }

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [MediaPickerFieldWidgetComponent] });
        TestBed.overrideComponent(MediaPickerFieldWidgetComponent, {
            set: { template: '', imports: [] },
        });
    });

    // -- options: every key of the blob is optional ---------------------------

    it('falls back to uuid/thumb/any when the backend sent no widget options', () => {
        mount({});

        expect(widget.options()).toEqual({
            bindValue:    'uuid',
            display:      'thumb',
            accept:       '*',
            bindTarget:   'asset',
            recentlyUsed: false,
            hoverPreview: false,
        });
    });

    it('passes a preset display through, and rejects an unknown one', () => {
        mount({ display: 'preset:hero' });
        expect(widget.options().display).toBe('preset:hero');

        mount({ display: 'gigantic' });
        expect(widget.options().display)
            .withContext('an unknown display falls back rather than reaching the picker')
            .toBe('thumb');
    });

    it('reads bindValue, bindTarget and the boolean toggles', () => {
        mount({
            bindValue:    'path',
            bindTarget:   'either',
            accept:       'image/*',
            recentlyUsed: true,
            hoverPreview: true,
        });

        expect(widget.options()).toEqual({
            bindValue:    'path',
            display:      'thumb',
            accept:       'image/*',
            bindTarget:   'either',
            recentlyUsed: true,
            hoverPreview: true,
        });
    });

    // -- cardinality: the one key the FIELD contributes -----------------------

    it('takes cardinality from the config, defaulting to one', () => {
        mount({});
        expect(widget.cardinality()).toBe('one');

        mount({ cardinality: 'many' });
        expect(widget.cardinality()).toBe('many');
    });

    // -- value narrowing ------------------------------------------------------

    it('narrows the bound value to what the picker accepts', () => {
        mount({}, '');
        expect(widget.picked()).withContext('empty string is not a selection').toBeNull();

        mount({}, 'uuid-1');
        expect(widget.picked()).toBe('uuid-1');

        mount({}, ['uuid-1', '', 42, 'uuid-2']);
        expect(widget.picked())
            .withContext('non-strings in a stored array are dropped, not rendered')
            .toEqual(['uuid-1', 'uuid-2']);
    });

    // -- the encoding the backend depends on ----------------------------------

    it('stores a scalar pick unchanged', () => {
        mount();
        widget.onPick('uuid-1');
        expect(stored).toEqual(['uuid-1']);
    });

    it('stores null when the picker clears', () => {
        mount({}, 'uuid-1');
        widget.onPick(null);
        expect(stored).toEqual([null]);
    });

    it('JSON-encodes a bindTarget:either discriminator so it survives form serialisation', () => {
        mount({ bindTarget: 'either' });
        widget.onPick({ kind: 'collection', value: '/media/press' } as never);

        expect(stored).toEqual(['{"kind":"collection","value":"/media/press"}']);
    });

    it('encodes per element for a many pick, leaving plain strings alone', () => {
        mount({ bindTarget: 'either', cardinality: 'many' });
        widget.onPick(['uuid-1', { kind: 'asset', value: 'uuid-2' }] as never);

        expect(stored).toEqual([['uuid-1', '{"kind":"asset","value":"uuid-2"}']]);
    });
});
