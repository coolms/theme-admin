import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';

/**
 * Which entity a filter-mode audience can be built from, as the SERVER says.
 *
 * ⚠️ This replaced a constant compiled into this bundle:
 *
 *     const USER_ENTITY_FQCN = 'App\\Identity\\Domain\\Entity\\User';
 *
 * Two things were wrong with it and only one was obvious. It shipped the
 * consuming application's class name inside a published npm package. It also
 * made the package work only against an installation that happens to have that
 * class -- a theme is meant to be installable beside an application, not to
 * know its namespace.
 *
 * The server already owns the answer: `FilterAudienceMaterializer` REJECTS
 * every other type, so a second copy here was a second answer to a question
 * with one authority. It arrives in the boot manifest.
 *
 * ⚠️ Absent arrives as `''`, not `undefined` -- the producer declares a
 * non-nullable string defaulting to empty. Guard on falsiness. `=== undefined`
 * treats the empty string as a real class name and compares entity types
 * against `''`, which matches nothing and silently disables Filter mode with no
 * way to tell that from a template that genuinely has no recipient variable.
 */
@Injectable({ providedIn: 'root' })
export class FilterAudienceEntity {
    private readonly ngxs = inject(Store);

    /** The FQCN, or `''` when the server did not say. */
    value(): string {
        return this.ngxs.selectSnapshot(AppConfigState.manifest)?.document?.filterAudienceEntity ?? '';
    }

    /**
     * Whether `entityType` is the recipient entity.
     *
     * ⚠️ Never true when the server said nothing. Filter mode has to be
     * unavailable in that case rather than optimistically offered: the server
     * is the thing that refuses, so offering it produces a wizard whose last
     * step fails.
     */
    matches(entityType: string | null | undefined): boolean {
        const known = this.value();

        return Boolean(known) && entityType === known;
    }
}
