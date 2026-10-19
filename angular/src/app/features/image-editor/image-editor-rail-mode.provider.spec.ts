import { TestBed } from '@angular/core/testing';
import { UserPreferencesService } from '@coolms/core-angular';
import { IMAGE_EDITOR_RAIL_MODE } from '@coolms/image-editor-angular';
import { provideImageEditorRailMode } from './image-editor-rail-mode.provider';

/** The image editor's rail mode is remembered in the person's preferences: read back, written, and a stray value is the default. */
describe('provideImageEditorRailMode -- the rail mode in the person\'s preferences', () => {
    let page: Record<string, unknown> | null;
    let writes: [string, Record<string, unknown>][];

    beforeEach(() => {
        page = null;
        writes = [];
        TestBed.configureTestingModule({
            providers: [
                provideImageEditorRailMode(),
                {
                    provide: UserPreferencesService,
                    useValue: {
                        getPageState: (key: string) => (key === 'imageEditor' ? page : null),
                        setPageState: (key: string, state: Record<string, unknown>) => { writes.push([key, state]); },
                    },
                },
            ],
        });
    });

    it('nothing chosen yet reads as null, so the editor uses its default', () => {
        expect(TestBed.inject(IMAGE_EDITOR_RAIL_MODE).read()).toBeNull();
    });

    it('a chosen mode is read back, and a stray stored value reads as the default', () => {
        page = { railMode: 'icons' };
        expect(TestBed.inject(IMAGE_EDITOR_RAIL_MODE).read()).toBe('icons');
        page = { railMode: 'sideways' };
        expect(TestBed.inject(IMAGE_EDITOR_RAIL_MODE).read()).toBe('labels');
    });

    it('a new mode is written to the page state imageEditor', () => {
        TestBed.inject(IMAGE_EDITOR_RAIL_MODE).write('icons');
        expect(writes).toEqual([['imageEditor', { railMode: 'icons' }]]);
    });
});
