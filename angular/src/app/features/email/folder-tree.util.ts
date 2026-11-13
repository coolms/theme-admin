import type { EmailFolderDto, EmailFolderTreeNodeDto } from './email.types';
import { type FolderFlags, flagsOf } from './mail-folder-actions';

/** One row of the mail rail. */
export interface FolderRow {
    readonly folder: EmailFolderDto;
    readonly name: string;
    readonly depth: number;
    readonly selectable: boolean;
    /** What the server says the person may do with the folder, and the job running on it; absent: nothing. */
    readonly flags?: FolderFlags;
}

/**
 * The rail's rows: the server's tree in the order it answers, with the names it gives; nothing is sorted, nested or
 * named here. The counts come from the flat list where it holds the folder, matched by path, since those move as mail
 * is read; the flat list never adds, orders or names a row. The flags are always the tree's.
 */
export function folderRows(tree: readonly EmailFolderTreeNodeDto[], flat: readonly EmailFolderDto[]): FolderRow[] {
    const counts = new Map(flat.map(f => [f.folder, f]));
    const rows: FolderRow[] = [];
    const walk = (nodes: readonly EmailFolderTreeNodeDto[], depth: number): void => {
        for (const node of nodes) {
            rows.push({
                folder: counts.get(node.folder) ?? node,
                name: node.name,
                depth,
                selectable: node.selectable,
                flags: flagsOf(node),
            });
            walk(node.children, depth + 1);
        }
    };
    walk(tree, 0);

    return rows;
}
