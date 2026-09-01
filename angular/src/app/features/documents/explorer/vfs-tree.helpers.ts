import type { NodeDto } from '../../../api/api.service';
import { type DocumentTemplate } from '../shared/document-explorer.types';

/**
 * Pure helpers that turn a VFS `listDirectory(path)` payload into the
 * data the Document Explorer's folders tree consumes:
 *
 *   - directories become tree nodes (with `path` as the stable id)
 *   - the `.templates/` discriminator directory is flattened -- its
 *     templates surface inside the parent folder rather than showing
 *     up as a sibling sub-tree
 *   - non-template files (instances, sources, anything VFS-native
 *     but not a registered template) are dropped from the tree view;
 *     they're surfaced through the per-template detail panel instead
 *
 * The helpers are pure on purpose so we can unit-test them without
 * spinning Angular: the components do nothing more than feed the
 * `NodeDto[]` returned by `ApiService.listDirectory()` through here
 * and bind the result.
 */

export interface VfsTreeNode {
    /** Stable id — VFS path, used for selection state and trackBy. */
    readonly path: string;
    /** Display name (last path segment). */
    readonly name: string;
    /** True for nodes the user can expand to fetch children. */
    readonly hasChildren: boolean;
    /**
     * `null` until the node is expanded — children are loaded lazily
     * via a follow-up `listDirectory()` call. An empty array means
     * "expanded but no children" (rendered as a leaf at runtime).
     */
    readonly children: VfsTreeNode[] | null;
}

/**
 * Filter a `listDirectory()` payload to the directory entries the
 * tree should render. Drops files (templates surface in the main
 * panel, not in the tree) and the `.templates/` discriminator (its
 * templates are flattened into the parent's content view).
 *
 * Order: alphabetic by name, case-insensitive -- matches the Media
 * tree's stable ordering and is what users expect for a folder list.
 */
export function filterTreeDirectories(nodes: readonly NodeDto[]): NodeDto[] {
    return nodes
        .filter((n) => n.type === 'directory' && n.name !== '.templates')
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Build a single tree node from a VFS directory payload. Children
 * stay `null` so the caller can decide when to load them — typically
 * on the user's first click on the row's expand chevron.
 */
export function nodeFromDto(dto: NodeDto): VfsTreeNode {
    return {
        path: dto.path,
        // — `Node.title` when the folder carries one, so a folder
        // created as "Счета" reads that way instead of showing its
        // `scheta` slug. Falls back to the on-disk name, which is what
        // every pre-existing folder has.
        name: dto.title ?? dto.name,
        // VFS doesn't tell us up-front whether a directory has children;
        // we optimistically assume "yes" so the chevron renders, then
        // the lazy expand reveals an empty list if the directory is
        // genuinely empty.
        hasChildren: true,
        children: null,
    };
}

/**
 * Top-level transform consumed by the folders-tree component: take
 * the raw `listDirectory(parent)` payload, return the tree nodes the
 * UI should render under that parent.
 */
export function transformVfsToTree(nodes: readonly NodeDto[]): VfsTreeNode[] {
    return filterTreeDirectories(nodes).map(nodeFromDto);
}

/**
 * Filter a `listDirectory()` payload to the templates the parent
 * folder's content view should show. After the Node-as-template
 * rewrite, each `DocumentTemplate.id` IS the backing Node's UUID, so
 * we match templates against listed file Nodes by id directly:
 *
 *   - templates from the parent's `.templates/` subdirectory surface
 *     here (the caller flattens by listing both `path` and
 *     `path/.templates/` and merging)
 *   - rendered instances or stray files in the same directory are
 *     not shown here — they belong on the template-detail panel
 *
 * If the explorer ever wants to surface raw files that aren't
 * registered templates (e.g. an "uploaded but not yet processed"
 * staging row), that's an additive overlay over this filter.
 */
export function filterTemplatesForFolder(
    nodes: readonly NodeDto[],
    templates: readonly DocumentTemplate[],
): DocumentTemplate[] {
    const fileIds = new Set<string>();
    for (const n of nodes) {
        if (n.type === 'file') {
            fileIds.add(n.id);
        }
    }
    return templates
        .filter((t) => fileIds.has(t.id))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
