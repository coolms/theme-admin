import {
    ChangeDetectionStrategy, Component, computed, effect, input, model, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CmsDirectoryPickerComponent, CmsDtmplTokenInputComponent } from '@coolms/ui-angular';
import { type ContextSchemaVariable } from '../../shared/document-explorer.types';
import { USER_ENTITY_FQCN } from './mode-step.component';

/** Location preset bound to the basePath radio group. */
type LocationKind = 'inbox' | 'shared' | 'custom';

/**
 * Where a delivered document lands in the recipient's own space.
 *
 * **`docs/`, not `docs/inbox/`.** The home layout
 * (`DefaultHomeDirectoryPolicy::getSubdirectories`) ships exactly
 * `pages`/`media`/`docs`/`tmp`/`public` — there is no `inbox`, and since
 * `docs/` IS the drop-box the `document` group may write into
 * (mode 3730). Writing a level deeper would have created a directory
 * owned by whoever generated first, outside the drop-box contract.
 *
 * **`{var:audienceEntityId}`, not `{var:<alias>.id}`.** The base path is
 * rendered by `WordFormatProvider::resolveInstanceParentFolderWith` at
 * `createInstance` time, against the RAW per-instance variables — the
 * entity-reference alias is not hydrated into an object until later in
 * the render pipeline. The old preset therefore resolved to nothing and
 * every delivery died on `cannot create directory in '/home//docs'`
 * (note the empty segment). `audienceEntityId` is the recipient id as it
 * exists in that context — the same key the render hydrates the alias
 * from and the artifact query reads back to find the recipient.
 */
const PERSONAL_INBOX_PATH = '/home/{var:audienceEntityId}/docs/';
const SHARED_FOLDER_PATH = '/docs/';

/** Always-available filename tokens (independent of schema). */
const CONSTANT_TOKENS: readonly string[] = [
    '{const:templateSlug}',
    '{const:batchId}',
    '{const:counter}',
];

/**
 * Default field set surfaced for the `@user` recipient alias. Reduces
 * the round-trip to the entity-fields endpoint for the most common
 * case; richer field discovery is a future refinement when other
 * recipient classes ship.
 */
const USER_FIELD_PATHS: readonly string[] = ['id', 'email', 'username', 'displayName'];

/**
 * X-2.6b step 4 -- output location + filename pattern.
 *
 * Location is a tri-radio (personal inbox / shared / custom). The
 * Personal inbox option is offered only in Filter mode with a
 * recipient alias of `@user`; otherwise the radio hides itself so the
 * UI does not expose a path that would not resolve. Filename pattern
 * uses the standalone `cms-dtmpl-token-input` shipped in Shipment C
 * with schema-derived tokens (entity fields) plus the static
 * `{const:...}` set.
 */
@Component({
    selector: 'cms-wizard-output-step',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, CmsDtmplTokenInputComponent, CmsDirectoryPickerComponent],
    template: `
        <div class="cms-output-step">
            <fieldset class="cms-output-step__group">
                <legend class="cms-output-step__legend">Where do documents land?</legend>

                @if (showInbox()) {
                    <label class="cms-output-step__radio">
                        <input type="radio"
                               class="form-check-input"
                               name="cms-output-location"
                               value="inbox"
                               [checked]="kind() === 'inbox'"
                               (change)="setKind('inbox')" />
                        <span>
                            <strong>Recipient's personal documents</strong>
                            <span class="cms-output-step__path">{{ inboxPath() }}</span>
                        </span>
                    </label>
                }

                <label class="cms-output-step__radio">
                    <input type="radio"
                           class="form-check-input"
                           name="cms-output-location"
                           value="shared"
                           [checked]="kind() === 'shared'"
                           (change)="setKind('shared')" />
                    <span>
                        <strong>Shared folder</strong>
                        <span class="cms-output-step__path">{{ sharedPath }}</span>
                    </span>
                </label>

                <label class="cms-output-step__radio">
                    <input type="radio"
                           class="form-check-input"
                           name="cms-output-location"
                           value="custom"
                           [checked]="kind() === 'custom'"
                           (change)="setKind('custom')" />
                    <span><strong>Custom path</strong></span>
                </label>

                @if (kind() === 'custom') {
                    <!-- The text box stays: a custom path may carry DTMPL
                         tokens, which no tree can browse to. The picker below
                         fills it in for the ordinary case of pointing at a
                         folder that already exists. -->
                    <input type="text"
                           class="cms-output-step__custom"
                           placeholder="/docs/generated/"
                           [ngModel]="basePath()"
                           (ngModelChange)="basePath.set($event)" />

                    <div class="cms-output-step__picker">
                        <cms-directory-picker
                            [value]="pickerValue()"
                            height="240px"
                            (valueChange)="onFolderPicked($event)" />
                    </div>
                }
            </fieldset>

            <div class="cms-output-step__field">
                <label class="cms-output-step__label" for="cms-output-filename">
                    Filename pattern
                </label>
                <cms-dtmpl-token-input
                    inputId="cms-output-filename"
                    placeholder="welcome-letter-{const:batchId}.docx"
                    [availableTokens]="availableTokens()"
                    [(value)]="filenamePattern" />
                <p class="cms-output-step__help">
                    Type <code>&#123;</code> to insert a DTMPL token.
                </p>
            </div>
        </div>
    `,
    styles: [`
        :host { display: block; }

        .cms-output-step {
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
        }
        .cms-output-step__group {
            display: flex;
            flex-direction: column;
            gap: .5rem;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 6px);
            padding: .75rem 1rem 1rem;
            margin: 0;
        }
        .cms-output-step__legend {
            font-weight: 600;
            padding: 0 .25rem;
            font-size: .95rem;
        }
        .cms-output-step__radio {
            display: flex;
            gap: .5rem;
            align-items: flex-start;
            cursor: pointer;
        }
        /* These labels are two lines (title + mono path), so flex-start
           alone parks the control at the very top of the block instead of
           against the title it labels. Nudge it onto the first line's
           optical centre: the control is 1em tall inside a 1.5 line-height,
           so half the leading centres it. */
        .cms-output-step__radio .form-check-input {
            margin-top: calc((1.5em - 1em) / 2);
            flex-shrink: 0;
        }
        .cms-output-step__radio strong { color: var(--cms-text); }
        .cms-output-step__path {
            display: block;
            font-family: var(--cms-font-mono, monospace);
            color: var(--cms-text-secondary);
            font-size: .8rem;
        }
        .cms-output-step__custom {
            margin-top: .25rem;
            margin-left: 1.5rem;
            padding: 6px 10px;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm, 4px);
            background: var(--cms-surface);
            color: var(--cms-text);
            font: inherit;
        }
        .cms-output-step__custom:focus {
            outline: none;
            border-color: var(--cms-accent);
        }
        .cms-output-step__picker {
            margin-top: .5rem;
            margin-left: 1.5rem;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm, 4px);
            overflow: hidden;
        }
        .cms-output-step__field {
            display: flex;
            flex-direction: column;
            gap: .35rem;
        }
        .cms-output-step__label {
            font-weight: 600;
            font-size: .9rem;
            color: var(--cms-text);
        }
        .cms-output-step__help {
            margin: 0;
            color: var(--cms-text-secondary);
            font-size: .8rem;
        }
        .cms-output-step__help code {
            background: var(--cms-hover-bg, rgba(0, 0, 0, .04));
            padding: 1px 4px;
            border-radius: 3px;
            font-family: var(--cms-font-mono, monospace);
        }
    `],
})
export class CmsWizardOutputStepComponent {
    protected readonly sharedPath = SHARED_FOLDER_PATH;

    /** Context-schema variables -- drives token discovery. */
    readonly variables = input<readonly ContextSchemaVariable[]>([]);

    /** Two-way bound base path string. */
    readonly basePath = model<string>('');

    /** Two-way bound filename pattern string. */
    readonly filenamePattern = model<string>('');

    /** Internal radio selection, derived from `basePath` on mount. */
    protected readonly kind = signal<LocationKind>('shared');

    /**
     * The template's own alias for its user recipient, e.g. `@identity_user`.
     *
     * Matched by ENTITY TYPE, not by name. This used to test
     * `v.path === '@user'` — a literal no shipped template uses. The
     * welcome-letter declares `@identity_user`, so the personal-space option
     * was unreachable for every template in the system, which is why the
     * only way to deliver into someone's home was to hand-type the DTMPL
     * token into Custom path.
     */
    protected readonly recipientAlias = computed<string | null>(() => {
        for (const v of this.variables()) {
            if (v.entityType === USER_ENTITY_FQCN) {
                return v.path;
            }
        }

        return null;
    });

    /** Resolved preset path, or `''` when no user recipient exists. */
    protected readonly inboxPath = computed<string>(
        () => null === this.recipientAlias() ? '' : PERSONAL_INBOX_PATH,
    );

    /**
     * Offered whenever the template HAS a user recipient — in Single mode
     * too. The mode gate used to also require `filter`, but the token
     * resolves per generated instance either way: Single mode materialises
     * exactly one recipient and binds it to the same variable, so
     * "deliver this invoice into that customer's documents" — the case
     * built the drop-box for — was being refused for no reason.
     */
    protected readonly showInbox = computed<boolean>(() => null !== this.recipientAlias());

    /**
     * Token list shown by `cms-dtmpl-token-input`. Combines the
     * always-on constants with per-entity-ref field tokens derived
     * from schema. For the `@user` alias a sensible default field
     * set is used; other entity refs only contribute their root
     * token (`{var:@invoice}`) until a richer field-discovery
     * service lands.
     */
    protected readonly availableTokens = computed<readonly string[]>(() => {
        const tokens: string[] = [...CONSTANT_TOKENS];
        for (const v of this.variables()) {
            if (!v.entityType) {
                tokens.push('{var:' + v.path + '}');
                continue;
            }
            if (v.path === '@user') {
                for (const field of USER_FIELD_PATHS) {
                    tokens.push('{var:@user.' + field + '}');
                }
            } else {
                tokens.push('{var:' + v.path + '.id}');
            }
        }

        return tokens;
    });

    constructor() {
        // Derive `kind` from `basePath` whenever the parent restores a
        // draft. Custom path is the catch-all so any non-preset value
        // ends up there.
        effect(() => {
            const current = this.basePath();
            if (current !== '' && current === this.inboxPath()) {
                this.kind.set('inbox');
            } else if (current === SHARED_FOLDER_PATH) {
                this.kind.set('shared');
            } else if (current === '') {
                // Empty seeds default to "shared" but do not stamp the
                // path until the user chooses -- keep submit gating
                // honest.
                this.kind.set('shared');
            } else {
                this.kind.set('custom');
            }
        }, { allowSignalWrites: true });
    }

    /**
     * What the tree should show as selected. A path carrying DTMPL tokens
     * cannot correspond to a real node, so nothing is highlighted rather than
     * the tree pretending to resolve it. The stored value keeps a trailing
     * slash (the backend's `outputBasePath` convention); VFS node paths do
     * not, so it is stripped on the way in.
     */
    protected readonly pickerValue = computed<string | null>(() => {
        const path = this.basePath();
        if ('' === path || path.includes('{')) {
            return null;
        }

        return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    });

    /** Selecting a folder fills the text box, which stays the source of truth. */
    protected onFolderPicked(path: string): void {
        this.basePath.set(path.endsWith('/') ? path : path + '/');
    }

    protected setKind(kind: LocationKind): void {
        this.kind.set(kind);
        if (kind === 'inbox') {
            this.basePath.set(this.inboxPath());
        } else if (kind === 'shared') {
            this.basePath.set(SHARED_FOLDER_PATH);
        }
        // Custom keeps the existing value so the user-typed text
        // survives toggling between radios.
    }
}
