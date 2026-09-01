import { type Routes } from '@angular/router';
import { FileEditorRegistry } from '@coolms/ui-angular';
import { PageEditorComponent } from './page-editor.component';

FileEditorRegistry.register('package', { component: PageEditorComponent, mode: 'dialog' });

export const CONTENT_ROUTES: Routes = [
    // — Pages is an EXPLORER now (spaces + tree), not a bare list, so
    // the route mounts the thin host and the grid arrives as the
    // `content.main` slot. `fullHeight` matches the other explorers; without
    // it the layout cannot pin its footer.
    {
        path: 'pages',
        loadComponent: () =>
            import('./pages-explorer.page').then(m => m.PagesExplorerPage),
        data: { fullHeight: true, activeNav: '/admin/content/pages' },
    },
    // F.13b: Document Library lives under /content/documents to match
    // its sidebar placement in the Content group.
    {
        path: 'documents',
        loadComponent: () =>
            import('../documents/explorer/document-library.page').then(m => m.DocumentLibraryPage),
        data: { fullHeight: true, activeNav: '/admin/content/documents' },
    },
    // (d), — the `articles` route is GONE. Pages absorbed it:
    // same Packages, same mime, and now the same spaces, per-space creation,
    // surface placement and editor. A bookmark to /admin/content/articles now
    // falls through the `**` catch-all to the dashboard, which is the same
    // thing that happens to any other retired route.
];
