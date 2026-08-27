import {
    filterTemplatesForFolder,
    filterTreeDirectories,
    transformVfsToTree,
} from './vfs-tree.helpers';
import type { NodeDto } from '../../../api/api.service';
import { type DocumentTemplate } from '../shared/document-explorer.types';

/**
 * Spec for the pure VFS-tree helpers.
 */

function makeNode(overrides: Partial<NodeDto> & Pick<NodeDto, 'name' | 'path' | 'type'>): NodeDto {
    return {
        '@id': `/api/v1/vfs/files?path=${overrides.path}`,
        id: overrides.path.replace(/\W+/g, '-'),
        mode: '0755',
        modeString: 'rwxr-xr-x',
        size: 0,
        humanSize: '0 B',
        mimeType: null,
        extension: null,
        uid: '00000000-0000-0000-0000-000000000000',
        gid: '00000000-0000-0000-0000-000000000000',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

describe('filterTreeDirectories', () => {
    it('returns an empty list when the input is empty', () => {
        expect(filterTreeDirectories([])).toEqual([]);
    });

    it('drops file entries — files surface in the content view, not the tree', () => {
        const nodes = [
            makeNode({ name: 'README.txt', path: '/documents/README.txt', type: 'file' }),
            makeNode({ name: 'reports', path: '/documents/reports', type: 'directory' }),
        ];
        expect(filterTreeDirectories(nodes).map((n) => n.name)).toEqual(['reports']);
    });

    it('drops the `.templates` discriminator directory', () => {
        const nodes = [
            makeNode({ name: '.templates', path: '/documents/.templates', type: 'directory' }),
            makeNode({ name: 'reports', path: '/documents/reports', type: 'directory' }),
        ];
        expect(filterTreeDirectories(nodes).map((n) => n.name)).toEqual(['reports']);
    });

    it('sorts results alphabetically (case-insensitive)', () => {
        const nodes = [
            makeNode({ name: 'Zeta', path: '/documents/Zeta', type: 'directory' }),
            makeNode({ name: 'alpha', path: '/documents/alpha', type: 'directory' }),
            makeNode({ name: 'Beta', path: '/documents/Beta', type: 'directory' }),
        ];
        expect(filterTreeDirectories(nodes).map((n) => n.name)).toEqual(['alpha', 'Beta', 'Zeta']);
    });

    it('does not mutate the input array', () => {
        const nodes = [
            makeNode({ name: 'b', path: '/documents/b', type: 'directory' }),
            makeNode({ name: 'a', path: '/documents/a', type: 'directory' }),
        ];
        const snapshot = [...nodes];
        filterTreeDirectories(nodes);
        expect(nodes).toEqual(snapshot);
    });
});

describe('transformVfsToTree', () => {
    it('returns nodes with hasChildren=true and children=null (lazy-load contract)', () => {
        const nodes = [
            makeNode({ name: 'reports', path: '/documents/reports', type: 'directory' }),
        ];
        const tree = transformVfsToTree(nodes);
        expect(tree.length).toBe(1);
        expect(tree[0].path).toBe('/documents/reports');
        expect(tree[0].name).toBe('reports');
        expect(tree[0].hasChildren).toBe(true);
        expect(tree[0].children).toBeNull();
    });

    it('flattens nested input — only the directory entries at the listed level are surfaced', () => {
        // listDirectory is intentionally non-recursive; transformVfsToTree
        // mirrors that — children stay null until lazily loaded.
        const nodes = [
            makeNode({ name: 'a', path: '/documents/a', type: 'directory' }),
            makeNode({ name: 'b', path: '/documents/b', type: 'directory' }),
        ];
        expect(transformVfsToTree(nodes).map((n) => n.name)).toEqual(['a', 'b']);
    });

    it('returns an empty list when no directory entries match', () => {
        const nodes = [
            makeNode({ name: 'README.txt', path: '/documents/README.txt', type: 'file' }),
            makeNode({ name: '.templates', path: '/documents/.templates', type: 'directory' }),
        ];
        expect(transformVfsToTree(nodes)).toEqual([]);
    });
});

describe('filterTemplatesForFolder', () => {
    function makeTemplate(overrides: Partial<DocumentTemplate> & Pick<DocumentTemplate, 'id' | 'name'>): DocumentTemplate {
        return {
            slug: overrides.name.toLowerCase(),
            description: null,
            native: false,
            sourceMimeType: null,
            contextSchema: null,
            defaultOutputFormat: 'docx',
            format: 'word',
            instanceNameSuffix: null,
            publiclyAccessible: false,
            createdAt: null,
            updatedAt: null,
            ...overrides,
            // AFTER the spread on purpose. `DocumentTemplate` gained `path`
            // when native templates started opening through FileEditorRegistry,
            // and `Partial<DocumentTemplate>` makes it `string | null |
            // undefined` — spreading it over a default widens the property and
            // the whole object stops satisfying `DocumentTemplate`, which broke
            // the compile and with it the ENTIRE suite (karma reports one load
            // error and runs zero specs). No caller overrides `path`, so
            // pinning it here is exact rather than merely quiet.
            path: null,
        };
    }

    it('returns templates whose id matches a file node in the listing', () => {
        const nodes = [
            makeNode({ name: 'a.docx', path: '/documents/.templates/a.docx', type: 'file', id: 't-a' }),
            makeNode({ name: 'b.docx', path: '/documents/.templates/b.docx', type: 'file', id: 't-b' }),
        ];
        const templates = [
            makeTemplate({ id: 't-a', name: 'A' }),
            makeTemplate({ id: 't-b', name: 'B' }),
            makeTemplate({ id: 't-c-elsewhere', name: 'C' }),
        ];
        const result = filterTemplatesForFolder(nodes, templates);
        expect(result.map((t) => t.name)).toEqual(['A', 'B']);
    });

    it('ignores directory entries when matching templates', () => {
        const nodes = [
            // Stray directory whose id collides with a template id.
            // Filter must ignore directories — only file entries qualify.
            makeNode({ name: 'a', path: '/documents/.templates/a', type: 'directory', id: 't-a' }),
        ];
        const templates = [
            makeTemplate({ id: 't-a', name: 'A' }),
        ];
        expect(filterTemplatesForFolder(nodes, templates)).toEqual([]);
    });

    it('returns templates sorted alphabetically (case-insensitive)', () => {
        const nodes = [
            makeNode({ name: 'a.docx', path: '/p/a.docx', type: 'file', id: '1' }),
            makeNode({ name: 'b.docx', path: '/p/b.docx', type: 'file', id: '2' }),
            makeNode({ name: 'c.docx', path: '/p/c.docx', type: 'file', id: '3' }),
        ];
        const templates = [
            makeTemplate({ id: '3', name: 'Zebra' }),
            makeTemplate({ id: '1', name: 'apple' }),
            makeTemplate({ id: '2', name: 'Banana' }),
        ];
        expect(filterTemplatesForFolder(nodes, templates).map((t) => t.name)).toEqual(['apple', 'Banana', 'Zebra']);
    });

    it('returns an empty list when there are no file nodes', () => {
        const nodes = [
            makeNode({ name: 'sub', path: '/documents/sub', type: 'directory' }),
        ];
        const templates = [makeTemplate({ id: 't-a', name: 'A' })];
        expect(filterTemplatesForFolder(nodes, templates)).toEqual([]);
    });
});
