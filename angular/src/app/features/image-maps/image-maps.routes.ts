import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '@coolms/ui-angular';

/**
 * ImageMap feature routes (`/admin/image-maps`). List-only — create/edit run
 * in a modal dialog; region authoring (Fabric.js surface) is a later slice.
 */
export const IMAGE_MAP_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./image-maps-list.page').then(m => m.ImageMapsListPageComponent),
    },
    {
        path: ':slug/regions',
        loadComponent: () => import('./image-map-regions.page').then(m => m.ImageMapRegionsPageComponent),
        canDeactivate: [unsavedChangesGuard],
    },
];
