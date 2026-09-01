import { adoptSavedBlock, withoutPinnedKeys } from './settings-payload.util';
import { ModuleSettingsBlockDto } from './module-settings.types';

/**
 * The save payload drops environment-pinned keys.
 *
 * Covered here rather than on the hub because a spec importing the hub fails the
 * whole karma build — see the note in the util.
 */
describe('withoutPinnedKeys', () => {
    it('drops a pinned key and keeps everything else', () => {
        const sent = withoutPinnedKeys(
            { ttl: 300, enabled: true, label: 'Pages' },
            { ttl: 'PAGE_CACHE_TTL' },
        );

        expect(sent).toEqual({ enabled: true, label: 'Pages' });
    });

    it('drops a pinned key even when its value is falsy', () => {
        // `in`, not a truthiness check: 0 and '' and null are all real values an
        // admin could be looking at, and all of them must still be dropped.
        const sent = withoutPinnedKeys(
            { ttl: 0, enabled: false, note: '' },
            { ttl: 'PAGE_CACHE_TTL', enabled: 'PAGE_CACHE_ENABLED' },
        );

        expect(sent).toEqual({ note: '' });
    });

    it('sends everything when nothing is pinned', () => {
        const value = { ttl: 300, enabled: true };

        expect(withoutPinnedKeys(value, {})).toEqual(value);
    });

    it('ignores a pin for a key the form did not carry', () => {
        // A block can pin a key its form does not render; that must not invent
        // one in the payload or drop an unrelated field.
        expect(withoutPinnedKeys({ enabled: true }, { ttl: 'PAGE_CACHE_TTL' })).toEqual({ enabled: true });
    });

    it('keeps a key whose name merely resembles a pinned one', () => {
        expect(withoutPinnedKeys({ ttl_seconds: 300 }, { ttl: 'PAGE_CACHE_TTL' })).toEqual({ ttl_seconds: 300 });
    });
});

/**
 * Where a save response belongs.
 *
 *  Written after the bug, not before it. Saving a TTL of 60 for one site made
 * the PLATFORM view read 60 on the real screen, because the scoped response was
 * written into the platform-wide list. The stored file proved the platform was
 * untouched — so the data was right and the screen was lying, which is the
 * failure this whole tier exists to prevent, arriving through the one path that
 * had no test.
 */
describe('adoptSavedBlock', () => {
    function block(over: Partial<ModuleSettingsBlockDto> = {}): ModuleSettingsBlockDto {
        return {
            key: 'web.page_cache',
            module: 'web',
            label: 'Page cache',
            moduleLabel: null,
            moduleIcon: null,
            moduleRoute: null,
            formId: null,
            data: {},
            defaults: {},
            effective: {},
            locked: {},
            siteScopable: true,
            scope: null,
            storedAt: null,
            ...over,
        };
    }

    it('keeps a SITE response out of the platform list', () => {
        const platform = [block({ effective: { ttl: 300 } })];
        const saved = block({ scope: 'site-a', effective: { ttl: 60 } });

        const { blocks, scoped } = adoptSavedBlock(platform, saved, 'site-a');

        expect(blocks[0].effective).toEqual({ ttl: 300 }, 'the platform view is untouched');
        expect(scoped).toBe(saved);
    });

    it('puts a PLATFORM response into the platform list', () => {
        const platform = [block({ effective: { ttl: 300 } }), block({ key: 'other.block' })];
        const saved = block({ effective: { ttl: 120 } });

        const { blocks, scoped } = adoptSavedBlock(platform, saved, null);

        expect(blocks[0].effective).toEqual({ ttl: 120 });
        expect(blocks[1].key).toBe('other.block', 'and leaves every other block alone');
        expect(scoped).toBeNull();
    });

    it('does not invent a row for a key the list never had', () => {
        const { blocks } = adoptSavedBlock([block({ key: 'a.b' })], block({ key: 'c.d' }), null);

        expect(blocks.length).toBe(1);
        expect(blocks[0].key).toBe('a.b');
    });
});
