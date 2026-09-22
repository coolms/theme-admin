import { consoleEntry } from '@coolms/core-angular';
import { provideFieldWidget } from '@coolms/ui-angular';
import { CollectionsTreeComponent } from '../collections-tree.component';
import { MediaDetailSlotComponent } from '../media-detail-slot.component';
import { MediaFieldWidgetComponent } from '../media-field-widget.component';
import { MediaGridSlotComponent } from '../media-grid-slot.component';
import { MediaLibraryPage } from '../media-library.page';
import { MediaPermissionsComponent } from '../media-permissions.component';
import { MediaPickerFieldWidgetComponent } from '../media-picker-field-widget.component';
import { MediaSpaceAccordionComponent } from '../media-space-accordion.component';
import { MoveToDialogComponent } from '../move-to-dialog.component';
import { provideCoolmsEditorMedia } from '../providers/provide-coolms-editor-media';
import { provideCoolmsPdfMedia } from '../providers/provide-coolms-pdf-media';

/**
 * Media's console entry: the media library (full height), the slot components
 * its server layouts name, the editor's media widgets and picker actions, the
 * image and media-picker field widgets, and the PDF viewer's image tool
 * (console@1).
 */
export default consoleEntry({
    module:   'media',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'media',
            component: () => import('../media-library.page').then(m => m.MediaLibraryPage),
            nav:       { fullHeight: true },
        },
    ],
    bindings: [
        { name: 'MediaLibraryPage',          component: MediaLibraryPage },
        { name: 'CollectionsTree',           component: CollectionsTreeComponent },
        { name: 'MediaSpaceAccordion',       component: MediaSpaceAccordionComponent },
        { name: 'MediaGrid',                 component: MediaGridSlotComponent },
        { name: 'MediaDetail',               component: MediaDetailSlotComponent },
        { name: 'MediaPermissionsComponent', component: MediaPermissionsComponent },
        { name: 'MoveToDialogComponent',     component: MoveToDialogComponent },
    ],
    providers: [
        // The editor's media.openPicker / media.openGalleryPicker handlers and
        // the mediaWidget / mediaGalleryWidget extension factories.
        ...provideCoolmsEditorMedia(),
        // A field declared `type: image` renders the Media Library picker; a
        // relation field declaring `widget: media-picker` resolves here.
        provideFieldWidget('image', MediaFieldWidgetComponent),
        provideFieldWidget('media-picker', MediaPickerFieldWidgetComponent),
        // The PDF viewer's image tool opens the Media Library.
        provideCoolmsPdfMedia(),
    ],
});
