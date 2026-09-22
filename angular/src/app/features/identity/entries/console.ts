import { consoleEntry } from '@coolms/core-angular';

/**
 * Identity's console entry: the profile page, users, groups, deletions (console@1). The profile page owns the profile.tab slot other modules fill.
 */
export default consoleEntry({
    module:   'identity',
    contract: 'console',
    range:    '^1.0',
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
    ],
});
