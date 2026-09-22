import { consoleEntry } from '@coolms/core-angular';
import { provideCoolmsEditorImageMap } from '../../image-map-widget/providers/provide-coolms-editor-image-map';

/**
 * ImageMap's console entry: the image maps admin and the editor's image map
 * widget (console@1). The image-map-widget feature directory is this module's.
 */
export default consoleEntry({
    module:   'imagemap',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'image-maps',
            children: () => import('../image-maps.routes').then(m => m.IMAGE_MAP_ROUTES),
            nav:      { activeNav: '/image-maps' },
        },
    ],
    providers: [...provideCoolmsEditorImageMap()],
});
