import { consoleEntry } from '@coolms/core-angular';

import { PersonSettingsPaneComponent } from '../person-settings-pane.component';

/**
 * Identity's console entry: the profile page, users, groups, deletions, signed-in sessions (console@1). The profile page owns the profile.tab slot other modules fill.
 */
export default consoleEntry({
    module:   'identity',
    contract: 'console',
    range:    '^1.0',
    // Settings' settings.pane slot: what people may set, for the whole installation.
    bindings: [
        { name: 'settings.pane:identity.person_settings', component: PersonSettingsPaneComponent },
    ],
    routes: [
        {
            path:      'profile',
            component: () => import('../profile-page.component').then(m => m.ProfilePageComponent),
            nav:       { activeNav: '/profile' },
        },
        { path: 'identity', redirectTo: 'identity/users' },
        {
            path:      'identity/users',
            component: () => import('../users-list.component').then(m => m.UsersListComponent),
            nav:       { activeNav: '/identity/users', fullHeight: true },
        },
        {
            path:      'identity/groups',
            component: () => import('../groups-list.component').then(m => m.GroupsListComponent),
            nav:       { activeNav: '/identity/groups', fullHeight: true },
        },
        {
            path:      'identity/deletions',
            component: () => import('../deletions-list.component').then(m => m.DeletionsListComponent),
            nav:       { activeNav: '/identity/deletions', fullHeight: true },
        },
        {
            path:      'identity/sessions',
            component: () => import('../sessions-list.component').then(m => m.SessionsListComponent),
            nav:       { activeNav: '/identity/sessions', fullHeight: true },
        },
    ],
});
