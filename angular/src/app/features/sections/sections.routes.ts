import { type Routes } from '@angular/router';
import { SectionsListComponent } from './sections-list.component';
import { SiteDetailPageComponent } from './site-detail.page';
import { SiteMembersPageComponent } from './site-members.page';

export const SECTION_ROUTES: Routes = [
    { path: '', component: SectionsListComponent },
    // Layer 3d.1 — Site Detail composition view.
    // Lazy-load not needed: the component is small and only one
    // chunk is added.
    { path: ':slug', component: SiteDetailPageComponent },
    // Layer 3d.3 — Members management page.
    // Deep-linked from Site Detail's Members card "Manage members"
    // link. Add/remove editors -> Identity group-assign endpoint;
    // transfer ownership -> VFS chown endpoint. No new BE endpoints.
    { path: ':slug/members', component: SiteMembersPageComponent },
];
