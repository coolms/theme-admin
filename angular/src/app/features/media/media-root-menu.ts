import { ContextMenuItem } from '@coolms/ui-angular';

/**
 * What a media ROOT offers on right-click — the tree's "All media" row and,
 *, every SPACE row in the accordion.
 *
 * ## Why this is not the toolbar node set
 *
 * Every other Media surface builds its menu from `state.toolbarNodes()` with a
 * `_context`. A root cannot: that set includes `rename` and `delete-col`, and
 * both act on `state.currentDir()`. Offered on a space row — where the current
 * directory IS the space root — "Delete collection" would delete the space
 * itself. The two entries here are the ones that mean something at a root and
 * cannot destroy it.
 *
 * Shared so the two surfaces cannot drift: they answer the same question, and
 * an operator who learns the menu on "All media" should find the same one on
 * Personal.
 */
export const MEDIA_ROOT_MENU_ITEMS: readonly ContextMenuItem[] = [
    { id: 'new-sub', label: 'New collection', icon: 'folder-plus' },
    { id: 'upload', label: 'Upload', icon: 'cloud-upload' },
];
