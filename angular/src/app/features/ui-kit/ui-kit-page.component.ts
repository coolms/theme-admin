import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';

import {
    discoverTokenNames,
    groupTokens,
    looksLikeColour,
    type UiKitToken,
    type UiKitTokenGroup,
} from './ui-kit.tokens';

/**
 * The admin UI kit, rendered from itself.
 *
 * ## Why this exists
 *
 * The platform's Angular kit was real but invisible: 50-odd `--cms-*` design
 * tokens and 47 `.cms-*` component classes, all declared in one 1200-line
 * `styles.scss` and discoverable only by reading it. The post-designer backlog
 * asked for "an extensible base theme other themes extend"; the SSR half of
 * that already exists as the `coolms-bootstrap` theme, which
 * `coolms-default` and `coolms-site` both declare `extends:` on. The Angular
 * half had no equivalent — and no surface on which to SEE what the kit even
 * contains.
 *
 * You cannot standardise, extract or extend a kit you cannot look at, so this
 * page comes before any of those. It is also the cheapest way to find the
 * inconsistency the backlog originally complained about: variants sitting side
 * by side make an odd one out obvious in a way that grepping never does.
 *
 * ## It reads the kit, it does not restate it
 *
 * The token table is built by walking the CSSOM for `--cms-*` custom
 * properties and resolving each against `:root` — see {@link discoverTokenNames}.
 * A hard-coded list would drift the moment someone edited `styles.scss`, and a
 * styleguide that lies about the palette is worse than no styleguide, because
 * it is the artefact people trust. Add a token and it appears here; delete one
 * and it stops being advertised.
 *
 * The component gallery below is necessarily hand-written markup — there is no
 * registry of classes to enumerate — so it is deliberately built from the SAME
 * class names application code uses (`.cms-btn`, `.cms-input`, …) rather than
 * bespoke styling, which would make it a drawing of the kit instead of the kit.
 */
@Component({
    selector: 'app-ui-kit-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="ui-kit">
            <header class="ui-kit__header">
                <h1 class="cms-page-title">UI kit</h1>
                <p class="cms-field-hint">
                    The Angular admin kit, read from the live stylesheet.
                    {{ tokenCount() }} design tokens in {{ groups().length }} groups.
                </p>
            </header>

            <section class="ui-kit__section">
                <h2 class="cms-h2">Design tokens</h2>
                @if (groups().length === 0) {
                    <p class="cms-field-hint">
                        No <code>--cms-*</code> custom properties were readable. That usually means
                        the stylesheet failed to load, not that the kit is empty.
                    </p>
                }
                @for (group of groups(); track group.title) {
                    <h3 class="cms-h4 ui-kit__group-title">{{ group.title }}</h3>
                    <div class="ui-kit__tokens">
                        @for (token of group.tokens; track token.name) {
                            <div class="ui-kit__token">
                                @if (token.isColour) {
                                    <span class="ui-kit__swatch" [style.background]="token.value"></span>
                                } @else {
                                    <span class="ui-kit__swatch ui-kit__swatch--none"></span>
                                }
                                <code class="ui-kit__token-name">{{ token.name }}</code>
                                <code class="ui-kit__token-value">{{ token.value }}</code>
                            </div>
                        }
                    </div>
                }
            </section>

            <section class="ui-kit__section">
                <h2 class="cms-h2">Buttons</h2>
                <div class="ui-kit__row">
                    <button class="cms-btn">Default</button>
                    <button class="cms-btn cms-btn-primary">Primary</button>
                    <button class="cms-btn cms-btn-danger">Danger</button>
                    <button class="cms-btn cms-btn-ghost">Ghost</button>
                    <button class="cms-btn cms-btn-link">Link</button>
                    <button class="cms-btn cms-btn-active">Active</button>
                    <button class="cms-btn" disabled>Disabled</button>
                </div>
                <div class="ui-kit__row">
                    <button class="cms-btn cms-btn-sm">Small</button>
                    <button class="cms-btn">Default size</button>
                    <button class="cms-btn cms-btn-lg">Large</button>
                </div>
            </section>

            <section class="ui-kit__section">
                <h2 class="cms-h2">Form controls</h2>
                <div class="ui-kit__row">
                    <label class="cms-label">
                        Text
                        <input class="cms-input" value="A value" />
                    </label>
                    <label class="cms-label">
                        Small
                        <input class="cms-input cms-input-sm" value="Compact" />
                    </label>
                    <label class="cms-label">
                        Select
                        <select class="cms-input">
                            <option>One</option>
                            <option>Two</option>
                        </select>
                    </label>
                    <label class="cms-label">
                        Disabled
                        <input class="cms-input" value="Read only" disabled />
                    </label>
                </div>
                <div class="ui-kit__row ui-kit__row--controls">
                    <label><input type="checkbox" checked /> Checked</label>
                    <label><input type="checkbox" /> Unchecked</label>
                    <!-- indeterminate is a DOM PROPERTY with no attribute form, so
                         it needs a binding; an indeterminate attribute in the
                         markup would be silently ignored. -->
                    <label><input type="checkbox" [indeterminate]="true" /> Indeterminate</label>
                    <label><input type="checkbox" checked disabled /> Disabled</label>
                    <label><input type="radio" name="uikit-demo" checked /> Radio on</label>
                    <label><input type="radio" name="uikit-demo" /> Radio off</label>
                    <label><input type="radio" disabled /> Radio disabled</label>
                </div>
                <p class="cms-field-hint">Hint text uses <code>.cms-field-hint</code>.</p>
            </section>

            <section class="ui-kit__section">
                <h2 class="cms-h2">Toggles</h2>
                <div class="ui-kit__row ui-kit__row--controls">
                    <label class="ui-kit__toggle-label">
                        <span class="cms-toggle">
                            <input type="checkbox" checked />
                            <span class="cms-toggle__slider"></span>
                        </span>
                        On
                    </label>
                    <label class="ui-kit__toggle-label">
                        <span class="cms-toggle">
                            <input type="checkbox" />
                            <span class="cms-toggle__slider"></span>
                        </span>
                        Off
                    </label>
                    <label class="ui-kit__toggle-label">
                        <span class="cms-toggle">
                            <input type="checkbox" checked disabled />
                            <span class="cms-toggle__slider"></span>
                        </span>
                        Disabled
                    </label>
                </div>
                <p class="cms-field-hint">
                    <code>.cms-toggle</code> was defined inside the datagrid's scoped styles until
                    it was promoted to the kit, which is why it was the only toggle in the admin.
                </p>
            </section>

            <section class="ui-kit__section">
                <h2 class="cms-h2">Badges</h2>
                <div class="ui-kit__row">
                    <span class="cms-badge">Neutral</span>
                    <span class="cms-badge cms-badge--success">Success</span>
                    <span class="cms-badge cms-badge--warning">Warning</span>
                    <span class="cms-badge cms-badge--danger">Danger</span>
                    <span class="cms-badge cms-badge--info">Info</span>
                    <span class="cms-badge cms-badge--muted">Muted</span>
                </div>
                <p class="cms-field-hint">
                    Modifiers are BEM double-dash (<code>.cms-badge--success</code>). Writing a
                    single dash silently yields a plain badge — which is how this gallery first
                    rendered five identical grey pills.
                </p>
            </section>

            <section class="ui-kit__section">
                <h2 class="cms-h2">Headings</h2>
                <p class="cms-h1">Heading 1</p>
                <p class="cms-h2">Heading 2</p>
                <p class="cms-h3">Heading 3</p>
                <p class="cms-h4">Heading 4</p>
                <p class="cms-section-title">Section title</p>
            </section>

            <section class="ui-kit__section">
                <h2 class="cms-h2">Surfaces</h2>
                <div class="ui-kit__row ui-kit__row--wide">
                    <div class="cms-card ui-kit__demo-surface">
                        <p class="cms-section-title">Card</p>
                        <p class="cms-field-hint"><code>.cms-card</code></p>
                    </div>
                    <div class="cms-panel ui-kit__demo-surface">
                        <p class="cms-section-title">Panel</p>
                        <p class="cms-field-hint"><code>.cms-panel</code></p>
                    </div>
                </div>
            </section>

            <section class="ui-kit__section">
                <h2 class="cms-h2">Dialog chrome</h2>
                <div class="cms-card ui-kit__dialog">
                    <div class="cms-dialog-header">
                        <span class="cms-section-title">Dialog title</span>
                        <button class="cms-dialog-close" aria-label="Close">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                    <div class="cms-dialog-body">
                        <p class="cms-field-hint">
                            Footer spacing comes from <code>.cms-dialog-footer</code>, which
                            most dialogs get from the shared <code>&lt;app-modal&gt;</code> shell
                            rather than applying themselves.
                        </p>
                    </div>
                    <div class="cms-dialog-footer">
                        <button class="cms-btn cms-btn-sm">Cancel</button>
                        <button class="cms-btn cms-btn-primary cms-btn-sm">Save</button>
                    </div>
                </div>
            </section>
        </div>
    `,
    styles: [`
        .ui-kit { padding: 16px 24px 48px; max-width: 1100px; }
        .ui-kit__header { margin-bottom: 24px; }
        .ui-kit__section {
            padding: 20px 0;
            border-top: 1px solid var(--cms-border);
        }
        .ui-kit__group-title { margin: 16px 0 8px; text-transform: capitalize; }
        .ui-kit__tokens {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 6px 16px;
        }
        .ui-kit__token { display: flex; align-items: center; gap: 8px; font-size: .8125rem; }
        .ui-kit__swatch {
            width: 20px; height: 20px; flex-shrink: 0;
            border: 1px solid var(--cms-border);
            border-radius: 4px;
        }
        /* A non-colour token still gets a slot so the columns stay aligned. */
        .ui-kit__swatch--none { background: repeating-linear-gradient(45deg, var(--cms-border-light) 0 4px, transparent 4px 8px); }
        .ui-kit__token-name { color: var(--cms-text); }
        .ui-kit__token-value { color: var(--cms-text-muted); margin-left: auto; }
        .ui-kit__row {
            display: flex; flex-wrap: wrap; align-items: flex-end;
            gap: 12px; margin-bottom: 12px;
        }
        .ui-kit__row--wide > * { flex: 1 1 260px; }
        /* Controls sit on the text baseline, so their labels need aligning. */
        .ui-kit__row--controls label {
            display: inline-flex; align-items: center; gap: 8px;
            margin: 0; font-size: .8125rem;
        }
        .ui-kit__toggle-label { cursor: pointer; }
        .ui-kit__demo-surface { padding: 16px; }
        .ui-kit__dialog { max-width: 460px; padding: 0; overflow: hidden; }
    `],
})
export class UiKitPageComponent implements OnInit {
    protected readonly groups = signal<UiKitTokenGroup[]>([]);
    protected readonly tokenCount = signal(0);

    ngOnInit(): void {
        const root = document.documentElement;
        const computed = getComputedStyle(root);

        const tokens: UiKitToken[] = discoverTokenNames(Array.from(document.styleSheets))
            .map(name => {
                // `getPropertyValue` resolves `var()` indirection for us, so a
                // token defined as `var(--cms-accent)` shows the colour it ends
                // up being rather than the reference — which is what someone
                // picking a colour needs to see.
                const value = computed.getPropertyValue(name).trim();

                return { name, value, isColour: looksLikeColour(value) };
            })
            .filter(token => token.value !== '');

        this.tokenCount.set(tokens.length);
        this.groups.set(groupTokens(tokens));
    }
}
