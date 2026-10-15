// Copied from @coolms/editor-client's own specs (src/extensions/slash-menu/slash-command-filter.spec.ts, source commit 99d1aec), imports
// pointed at the installed package: they run in the admin's suite against what npm serves, through
// src/editor-client-specs.spec.ts. Refresh the copy when the client's spec changes.
import type { EditorToolbarNodeManifest } from '@coolms/editor-client';
import {
    buildSlashItems, filterSlashItems, groupSlashItems, humaniseGroup, scoreSlashItem,
} from '@coolms/editor-client';
import type { SlashCommandItem } from '@coolms/editor-client';

/**
 * Spec for the slash-command palette filtering / grouping logic.
 *
 * Key invariants:
 *   - the palette is built ONLY from manifest entries flagged `slashable`
 *     (no hardcoded command list anywhere);
 *   - labels are resolved through the host translator at build time;
 *   - the query matches on label + keywords + the id's last segment, ranked
 *     exact > prefix > substring > subsequence, label-weighted;
 *   - grouping preserves manifest order.
 */

const TRANSLATE = (key: string): string => {
    const dict: Record<string, string> = {
        'editor.toolbar.format.bold': 'Bold',
        'editor.toolbar.block.h1':    'Heading 1',
        'editor.toolbar.block.h2':    'Heading 2',
        'editor.toolbar.block.bulletList': 'Bullet list',
        'editor.toolbar.block.blockquote': 'Blockquote',
        'editor.toolbar.insert.table': 'Insert table',
    };
    return dict[key] ?? key;
};

function node(over: Partial<EditorToolbarNodeManifest> & Pick<EditorToolbarNodeManifest, 'id'>): EditorToolbarNodeManifest {
    return {
        id: over.id,
        group: over.group ?? 'block',
        priority: over.priority ?? 10,
        icon: over.icon ?? 'bi-square',
        label: over.label ?? over.id,
        actionType: over.actionType ?? 'tiptap.toggleNode',
        actionParams: over.actionParams ?? {},
        extensions: over.extensions ?? [],
        stateKeys: over.stateKeys ?? [],
        slashable: over.slashable,
        keywords: over.keywords,
    };
}

const NODES: ReadonlyArray<EditorToolbarNodeManifest> = [
    node({ id: 'format:bold', group: 'format', label: 'editor.toolbar.format.bold', slashable: false }),
    node({ id: 'block:h1', group: 'block', label: 'editor.toolbar.block.h1', slashable: true, keywords: ['h1', 'title'] }),
    node({ id: 'block:h2', group: 'block', label: 'editor.toolbar.block.h2', slashable: true, keywords: ['h2'] }),
    node({ id: 'block:bulletList', group: 'block', label: 'editor.toolbar.block.bulletList', slashable: true, keywords: ['ul', 'bullets'] }),
    node({ id: 'block:blockquote', group: 'block', label: 'editor.toolbar.block.blockquote', slashable: true, keywords: ['quote', 'bq'] }),
    node({ id: 'insert:table', group: 'insert', label: 'editor.toolbar.insert.table', slashable: true, keywords: ['grid'] }),
    node({ id: 'meta:source', group: 'meta', label: 'editor.toolbar.meta.source', slashable: false }),
];

describe('buildSlashItems', () => {
    it('keeps only slashable entries and resolves labels', () => {
        const items = buildSlashItems(NODES, TRANSLATE);
        expect(items.map((i) => i.id)).toEqual([
            'block:h1', 'block:h2', 'block:bulletList', 'block:blockquote', 'insert:table',
        ]);
        expect(items[0].label).toBe('Heading 1');
    });

    it('treats a missing slashable flag as not slashable (back-compat)', () => {
        const items = buildSlashItems([node({ id: 'block:x', label: 'X' })], TRANSLATE);
        expect(items).toEqual([]);
    });

    it('defaults keywords to an empty array', () => {
        const items = buildSlashItems([node({ id: 'block:x', label: 'X', slashable: true })], TRANSLATE);
        expect(items[0].keywords).toEqual([]);
    });
});

describe('scoreSlashItem', () => {
    const items = buildSlashItems(NODES, TRANSLATE);
    const byId = (id: string): SlashCommandItem => items.find((i) => i.id === id)!;

    it('matches an empty query (full list)', () => {
        expect(scoreSlashItem(byId('block:h1'), '')).toBe(0);
    });

    it('scores a label prefix above a substring', () => {
        const prefix = scoreSlashItem(byId('block:h1'), 'head');   // "Heading 1"
        const sub = scoreSlashItem(byId('block:blockquote'), 'quo'); // "Blockquote" substring
        expect(prefix).not.toBeNull();
        expect(sub).not.toBeNull();
        expect(prefix!).toBeGreaterThan(sub!);
    });

    it('matches a keyword that the label does not contain', () => {
        expect(scoreSlashItem(byId('block:h1'), 'title')).not.toBeNull();   // keyword
        expect(scoreSlashItem(byId('block:bulletList'), 'ul')).not.toBeNull();
    });

    it('matches the id alias', () => {
        expect(scoreSlashItem(byId('block:blockquote'), 'blockquote')).not.toBeNull();
    });

    it('matches a loose subsequence', () => {
        expect(scoreSlashItem(byId('block:blockquote'), 'bq')).not.toBeNull(); // keyword exact, but also subseq of label
    });

    it('returns null for no match', () => {
        expect(scoreSlashItem(byId('block:h1'), 'zzz')).toBeNull();
    });
});

describe('filterSlashItems', () => {
    const items = buildSlashItems(NODES, TRANSLATE);

    it('returns the full list for an empty query', () => {
        expect(filterSlashItems(items, '').length).toBe(items.length);
    });

    it('ranks the best match first', () => {
        const out = filterSlashItems(items, 'h1');
        expect(out[0].id).toBe('block:h1');
    });

    it('drops non-matching items', () => {
        const out = filterSlashItems(items, 'table');
        expect(out.map((i) => i.id)).toEqual(['insert:table']);
    });

    it('is stable on equal scores (manifest order preserved)', () => {
        const out = filterSlashItems(items, 'h'); // h1, h2 both prefix-match a keyword
        expect(out.map((i) => i.id).slice(0, 2)).toEqual(['block:h1', 'block:h2']);
    });
});

describe('groupSlashItems', () => {
    it('groups by manifest group, preserving order', () => {
        const groups = groupSlashItems(buildSlashItems(NODES, TRANSLATE));
        expect(groups.map((g) => g.key)).toEqual(['block', 'insert']);
        expect(groups[0].heading).toBe('Blocks');
        expect(groups[1].heading).toBe('Insert');
        expect(groups[0].items.length).toBe(4);
    });
});

describe('humaniseGroup', () => {
    it('maps known keys and capitalises the rest', () => {
        expect(humaniseGroup('block')).toBe('Blocks');
        expect(humaniseGroup('insert')).toBe('Insert');
        expect(humaniseGroup('custom')).toBe('Custom');
    });
});
