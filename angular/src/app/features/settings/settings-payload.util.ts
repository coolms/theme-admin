import { ModuleSettingsBlockDto } from './module-settings.types';

/**
 * What a settings save actually sends.
 *
 * A free function, and in its own file, for the same reason
 * `settings-grouping.util.ts` is: the hub imports DynamicFormComponent, which
 * reaches `@coolms/editor-angular`, which the karma builder cannot resolve — so
 * any spec that pulls the hub in fails the WHOLE suite at build time. Logic that
 * needs covering has to live outside the component.
 */

/**
 * Drop the keys this deployment pins in its environment.
 *
 *  **Not cosmetic — the save fails without it.** Pinned controls are rendered
 * disabled, but Angular still reports a disabled control in `getRawValue()`,
 * which is what the dynamic form submits. So a pinned key would ride along, and
 * the server refuses any write carrying one (it would be stored and then ignored
 * by the reader, which is the "saves and does nothing" bug the pin exists to
 * prevent). The whole block's edit would 422 because of a field the admin was
 * never allowed to touch.
 *
 * Done here rather than in the shared form: changing what a disabled control
 * submits would silently affect every other consumer, several of which rely on
 * readonly identifier fields being sent.
 *
 * @param value  the form's raw value
 * @param locked `settings key -> env var name`, from the block
 */
export function withoutPinnedKeys(
    value: Record<string, unknown>,
    locked: Record<string, string>,
): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([alias]) => !(alias in locked)));
}

/**
 * Where a save response belongs.
 *
 *  **A scoped response must NOT be written into the platform list.** That list
 * is the platform-wide view the rail renders and the scope selector returns to.
 * Folding one site's values into it makes the screen show that site's numbers
 * under "Platform (every site)" — which is not a cosmetic slip: an operator
 * reads it as the platform having changed, and the next thing they do is act on
 * a value nothing is running.
 *
 * Found on the real screen, not in a test: saving a TTL of 60 for one site made
 * the platform view read 60, while the stored file proved the platform was
 * untouched.
 *
 * @param blocks the platform-wide list backing the rail
 * @param saved  the block as the server echoed it
 * @param site   the scope that was saved, or null for the platform
 */
export function adoptSavedBlock(
    blocks: readonly ModuleSettingsBlockDto[],
    saved: ModuleSettingsBlockDto,
    site: string | null,
): { blocks: ModuleSettingsBlockDto[]; scoped: ModuleSettingsBlockDto | null } {
    if (null !== site) {
        return { blocks: [...blocks], scoped: saved };
    }

    return { blocks: blocks.map(b => (b.key === saved.key ? saved : b)), scoped: null };
}
