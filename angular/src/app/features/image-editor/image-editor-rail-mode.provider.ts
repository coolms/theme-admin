import { inject, type Provider } from '@angular/core';
import { UserPreferencesService } from '@coolms/core-angular';
import { IMAGE_EDITOR_RAIL_MODE, railModeFrom, type RailModeStore } from '@coolms/image-editor-angular';

/**
 * The image editor's rail mode -- tools with their names, or as icons -- remembered in the person's preferences (the
 * page state `imageEditor`), which follow them to another browser.
 */
export function provideImageEditorRailMode(): Provider {
    return {
        provide: IMAGE_EDITOR_RAIL_MODE,
        useFactory: (): RailModeStore => {
            const prefs = inject(UserPreferencesService);
            return {
                read: () => {
                    const stored = prefs.getPageState<{ railMode?: unknown }>('imageEditor')?.railMode;
                    return stored === undefined ? null : railModeFrom(stored);
                },
                write: mode => prefs.setPageState('imageEditor', { railMode: mode }),
            };
        },
    };
}
