import { deslugify, groupBlocks, isEdited } from './settings-grouping.util';
import { ModuleSettingsBlockDto } from './module-settings.types';

/**
 * The hub is GENERATED from the registry, never a maintained list, so what it
 * has to get right is the shaping: group by owning module, order both levels,
 * name the group in something a person would say out loud, and mark the blocks
 * that are actually overriding their shipped defaults.
 *
 * These live in a util spec rather than a component one because the hub imports
 * the settings dialog, which imports DynamicFormComponent, which reaches
 * `@coolms/editor-angular` — the karma builder cannot resolve that package and
 * any spec pulling the hub in fails the WHOLE suite at build time.
 */
describe('settings grouping', () => {
    function block(over: Partial<ModuleSettingsBlockDto>): ModuleSettingsBlockDto {
        return {
            key: 'x.y',
            module: 'x',
            label: 'X',
            moduleLabel: null,
            moduleIcon: null,
            moduleRoute: null,
            formId: null,
            data: {},
            defaults: {},
            effective: {},
            locked: {},
 // Added with per-site overrides; the normaliser defaults an
 // omitting payload to exactly this pair.
            siteScopable: false,
            scope: null,
            storedAt: null,
            ...over,
        };
    }

 it('survives a block whose moduleRoute the server omitted', () => {
 // The crash that took the settings screen down: the guard tested
 // `null !== moduleRoute` while the wire omits null properties outright,
 // so an absent route reached `.replace`. Cast because the DTO types the
 // field as `string | null` — which is exactly the promise the wire does
 // not keep.
        const groups = groupBlocks([
            block({ key: 'web.page_cache', module: 'web', moduleRoute: undefined as unknown as null }),
        ]);

        expect(groups.length).toBe(1);
        expect(groups[0].route).toBeNull();
    });

 it('groups blocks by module, both levels alphabetical', () => {
        const groups = groupBlocks([
            block({ key: 'navi.b', module: 'navi', label: 'Zebra' }),
            block({ key: 'chat.a', module: 'dynamic-chat', label: 'Pre-chat form policy' }),
            block({ key: 'navi.a', module: 'navi', label: 'Alpha' }),
        ]);

        expect(groups.map(g => g.module)).toEqual(['dynamic-chat', 'navi']);
        expect(groups[1].blocks.map(b => b.label)).toEqual(['Alpha', 'Zebra']);
    });

 it('heads a group with the name and icon the module declared', () => {
        const [group] = groupBlocks([
            block({ module: 'dynamic-chat', moduleLabel: 'Dynamic Chat', moduleIcon: 'chat-left-dots' }),
        ]);

        expect(group.label).toBe('Dynamic Chat');
        expect(group.icon).toBe('chat-left-dots');
 // The slug still groups and still tracks; it just never reaches a heading.
        expect(group.module).toBe('dynamic-chat');
    });

 it('links the heading to the module page, rooted at the router', () => {
 // The module declares a bare `dynamic-chat`; a heading link has to
 // resolve from the router root, not from wherever the hub sits.
        const [group] = groupBlocks([block({ module: 'dynamic-chat', moduleRoute: 'dynamic-chat' })]);
        expect(group.route).toBe('/dynamic-chat');

 // Already-absolute is left alone rather than doubled.
        const [absolute] = groupBlocks([block({ module: 'x', moduleRoute: '/x/page' })]);
        expect(absolute.route).toBe('/x/page');
    });

 it('leaves the heading as plain text for a module with no page', () => {
        expect(groupBlocks([block({})])[0].route).toBeNull();
    });

 it('reads a slug back as words when the module did not name itself', () => {
 // Otherwise the heading is a slug shouting: DYNAMIC-CHAT.
        expect(deslugify('dynamic-chat')).toBe('Dynamic Chat');
        expect(deslugify('dynamic_entity')).toBe('Dynamic Entity');

        const [group] = groupBlocks([block({ module: 'dynamic_chat' })]);
        expect(group.label).toBe('Dynamic Chat');
        expect(group.icon).toBe('puzzle');
    });

 it('counts a group only when the count says something', () => {
        const [multi, solo] = groupBlocks([
            block({ key: 'm.a', module: 'm', label: 'A' }),
            block({ key: 'm.b', module: 'm', label: 'B' }),
            block({ key: 'solo.a', module: 'solo' }),
        ]);

        expect(multi.badge).toBe('2');
 // A badge reading "1" beside a single visible row is noise.
        expect(solo.badge).toBe('');
    });

 it('marks only the blocks that have saved values', () => {
        expect(isEdited(block({ data: { countries: ['BY'] } }))).toBeTrue();
        expect(isEdited(block({}))).toBeFalse();
    });
});
