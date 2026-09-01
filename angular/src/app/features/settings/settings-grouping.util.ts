import type { ModuleSettingsBlockDto } from './module-settings.types';

/** One module's blocks, as the hub renders them. */
export interface ModuleGroup {
    /** The slug — the grouping key and the track key, never a heading. */
    readonly module: string;
    /** What the heading says: the module's declared name, or the slug read as words. */
    readonly label: string;
    /** Bootstrap Icons name for the heading, or a neutral fallback. */
    readonly icon: string;
    /** Router path the heading links to, or null when the module has no page. */
    readonly route: string | null;
    /** Count pill; empty for a single block, where "1" says nothing. */
    readonly badge: string;
    readonly blocks: readonly ModuleSettingsBlockDto[];
}

/**
 * Pure grouping for the settings hub.
 *
 * Lives in a util rather than on the component because the hub imports the
 * settings dialog, which imports DynamicFormComponent, which reaches
 * `@coolms/editor-angular` — and the karma builder cannot resolve that
 * package's `./x.js` specifiers to its `.ts` sources, so ANY spec that pulls
 * the hub in fails the whole suite at build time. Same boundary the profile
 * page hit. Keeping the decisions here keeps them covered.
 */

/**
 * `dynamic-chat` reads as DYNAMIC-CHAT in a heading, which is a slug shouting.
 * A module that declares `moduleLabel` gets what it asked for; this is the
 * fallback for one that did not.
 */
export function deslugify(slug: string): string {
    return slug
        .split(/[-_]+/)
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/** Has this block been saved, i.e. is it overriding the shipped defaults? */
export function isEdited(block: ModuleSettingsBlockDto): boolean {
    return Object.keys(block.data).length > 0;
}

/** Blocks grouped by owning module, both levels alphabetical. */
export function groupBlocks(blocks: readonly ModuleSettingsBlockDto[]): ModuleGroup[] {
    const byModule = new Map<string, ModuleSettingsBlockDto[]>();
    for (const block of blocks) {
        const bucket = byModule.get(block.module);
        if (bucket) {
            bucket.push(block);
        } else {
            byModule.set(block.module, [block]);
        }
    }

    return [...byModule.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([module, bucket]): ModuleGroup => {
            const sorted = [...bucket].sort((a, b) => a.label.localeCompare(b.label));
            // First block wins: every block of a module carries the same
            // presentation, and disagreeing about it is not a case worth
            // arbitrating in a heading.
            const first = sorted[0];

            return {
                module,
                label: first.moduleLabel ?? deslugify(module),
                icon: first.moduleIcon ?? 'puzzle',
                // Normalised to an absolute admin path: a module declares
                // `dynamic-chat`, and a heading link has to resolve from the
                // router root, not from wherever the hub happens to sit.
                // A TRUTHY test, not `null !== …`: the wire omits null
                // properties entirely (API Platform's `skip_null_values`), so a
                // field the DTO types as `string | null` can arrive `undefined`
                // and an explicit null comparison lets it through to `.replace`.
                // The service normalises this now; the guard stays honest anyway
                // because this helper takes whatever it is handed.
                route: first.moduleRoute
                    ? `/${first.moduleRoute.replace(/^\//, '')}`
                    : null,
                badge: sorted.length > 1 ? String(sorted.length) : '',
                blocks: sorted,
            };
        });
}
