import {
    ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DialogRef } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ModalComponent } from '@coolms/ui-angular';
import { ApplyNginxChanges, CreateSection, LoadSections } from './section.actions';

/**
 * Add site -- the guided path through creating a SiteSection.
 *
 * Creating a site is the one operation that cannot honestly be a single field
 * set: it takes a slug, an address (host and/or path prefix, with a precedence
 * number when they overlap), a front-end stack, a theme, and an nginx vhost
 * that has to be generated and then reloaded by hand. Today that knowledge
 * lives in the API's validation messages and in somebody's head.
 *
 * ⚠️ ONE IMPLEMENTATION, TWO FACES -- and the face is the new part, not the
 * operation. Every step dispatches the SAME NgXS actions the plain section form
 * already used ({@link CreateSection}) and the list page's Apply button already
 * used ({@link ApplyNginxChanges}), which land on `POST /api/v1/sections` and
 * `POST /api/v1/sections/_apply`. Nothing here re-implements provisioning, so
 * there is no second copy to drift.
 *
 * ⚠️ AND THERE IS NO CONSOLE COMMAND TO BE A FACE ON. Worth stating, because
 * the natural assumption is the other way round: `coolms:sites:apply` only
 * regenerates vhosts from sections that already exist, and `coolms:site:install`
 * installs one specific product website from a hardcoded page list. Creating an
 * arbitrary site is an API-only operation today. If a command is ever wanted,
 * it belongs on the same endpoint rather than beside it.
 *
 * What this deliberately does NOT do, so the omissions are decisions:
 *
 *   - Locales. `SiteSectionResource` does not expose `defaultLocale` and the
 *     per-site enabled set lives in the module-settings tier, reachable from
 *     Settings once the site exists. Offering a control that writes nowhere
 *     would be worse than not offering it.
 *   - Navigation. A section's public NaviTree is seeded per theme; there is no
 *     generic "make me a menu" endpoint to call.
 *
 * Both are named on the final step rather than left for the operator to
 * discover they are missing.
 */
@Component({
    selector: 'app-site-wizard',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [ModalComponent, FormsModule],
    template: `
        <app-modal title="Add site" [width]="620">
            <ol class="wiz-steps" aria-label="Steps">
                @for (s of stepLabels; track s; let i = $index) {
                    <li [class.is-done]="i < step()" [class.is-current]="i === step()">
                        <span class="n">{{ i + 1 }}</span>{{ s }}
                    </li>
                }
            </ol>

            @if (0 === step()) {
                <p class="cms-field-hint wiz-intro">
                    A site is a slug the platform knows it by and a label people read.
                    The slug also names its content tree at <code>/content/&lt;slug&gt;</code>.
                </p>
                <label class="cms-label" for="wiz-slug">Slug</label>
                <input id="wiz-slug" class="cms-input" [(ngModel)]="slug" name="slug"
                       placeholder="marketing" autocomplete="off">
                <p class="cms-field-hint">Lowercase letters, digits and hyphens. <code>default</code> is reserved.</p>

                <label class="cms-label" for="wiz-label">Label</label>
                <input id="wiz-label" class="cms-input" [(ngModel)]="label" name="label"
                       placeholder="Marketing site" autocomplete="off">
            }

            @if (1 === step()) {
                <p class="cms-field-hint wiz-intro">
                    How a request finds this site. A host, a path prefix, or both &mdash;
                    an empty host matches every domain.
                </p>
                <label class="cms-label" for="wiz-host">Host</label>
                <input id="wiz-host" class="cms-input" [(ngModel)]="host" name="host"
                       placeholder="www.example.com" autocomplete="off">
                <p class="cms-field-hint">Leave empty to match any domain.</p>

                <label class="cms-label" for="wiz-prefix">Path prefix</label>
                <input id="wiz-prefix" class="cms-input" [(ngModel)]="prefix" name="prefix"
                       placeholder="/" autocomplete="off">

                <label class="cms-label" for="wiz-priority">Priority</label>
                <input id="wiz-priority" class="cms-input cms-input-sm" type="number"
                       [(ngModel)]="priority" name="priority">
                <p class="cms-field-hint">
                    Higher wins when two sites could both answer. Overlap is allowed and
                    resolved by this number; two sites claiming the <em>identical</em>
                    host and path are refused.
                </p>
            }

            @if (2 === step()) {
                <p class="cms-field-hint wiz-intro">
                    What renders the site. The theme set here is the section's own binding,
                    which decides the theme directly rather than following whichever theme
                    is globally active.
                </p>
                <label class="cms-label" for="wiz-stack">Front-end stack</label>
                <select id="wiz-stack" class="cms-select cms-input" [(ngModel)]="feStack" name="feStack">
                    @for (o of stacks; track o.value) {
                        <option [value]="o.value">{{ o.label }}</option>
                    }
                </select>

                <label class="cms-label" for="wiz-theme">Theme</label>
                <select id="wiz-theme" class="cms-select cms-input" [(ngModel)]="themeSlug" name="themeSlug">
                    <option value="">No theme (follow the active one)</option>
                    @for (t of themes(); track t.value) {
                        <option [value]="t.value">{{ t.label }}</option>
                    }
                </select>
                <p class="cms-field-hint">
                    Themes come from <code>theme.themes</code>; install one first if the list is short.
                </p>
            }

            @if (3 === step()) {
                <dl class="wiz-review">
                    <dt>Slug</dt><dd>{{ slug || '—' }}</dd>
                    <dt>Label</dt><dd>{{ label || '—' }}</dd>
                    <dt>Address</dt><dd>{{ addressSummary() }}</dd>
                    <dt>Priority</dt><dd>{{ priority }}</dd>
                    <dt>Stack</dt><dd>{{ feStack }}</dd>
                    <dt>Theme</dt><dd>{{ themeSlug || 'the active theme' }}</dd>
                </dl>
                <label class="wiz-check">
                    <input type="checkbox" [(ngModel)]="applyNginx" name="applyNginx">
                    Generate the nginx vhost after creating
                </label>
                <p class="cms-field-hint">
                    nginx is never reloaded for you. The command to run is shown when this finishes.
                </p>
                <p class="cms-field-hint">
                    Not set here, because there is nowhere to set them yet: the site's locales
                    (Settings, once it exists) and its public navigation (seeded per theme).
                </p>
            }

            @if (error(); as e) {
                <p class="wiz-error" role="alert">{{ e }}</p>
            }

            <div footer>
                <button type="button" class="cms-btn cms-btn-sm"
                        [disabled]="0 === step() || saving()"
                        (click)="back()">Back</button>
                @if (step() < 3) {
                    <button type="button" class="cms-btn cms-btn-primary cms-btn-sm"
                            [disabled]="!stepValid()"
                            (click)="next()">Next</button>
                } @else {
                    <button type="button" class="cms-btn cms-btn-primary cms-btn-sm"
                            [disabled]="saving() || !stepValid()"
                            (click)="create()">{{ saving() ? 'Creating…' : 'Create site' }}</button>
                }
            </div>
        </app-modal>
    `,
    styles: [`
        .wiz-steps {
            display: flex; gap: .35rem; list-style: none; margin: 0 0 1rem; padding: 0;
            font-size: .78rem; flex-wrap: wrap;
        }
        .wiz-steps li {
            display: inline-flex; align-items: center; gap: .35rem;
            padding: .2rem .55rem; border-radius: var(--cms-radius-sm);
            color: var(--cms-text-muted); border: 1px solid transparent;
        }
        .wiz-steps li .n {
            display: inline-flex; align-items: center; justify-content: center;
            width: 1.15rem; height: 1.15rem; border-radius: var(--cms-radius-sm);
            background: var(--cms-bg-muted); font-size: .7rem;
        }
        .wiz-steps li.is-current { color: var(--cms-text); border-color: var(--cms-border); }
        .wiz-steps li.is-current .n { background: var(--cms-accent); color: var(--cms-accent-fg); }
        .wiz-steps li.is-done .n { background: var(--cms-accent-light); }
        .wiz-intro { margin-top: 0; }
        .wiz-review { display: grid; grid-template-columns: 8rem 1fr; gap: .3rem .75rem; margin: 0 0 1rem; }
        .wiz-review dt { color: var(--cms-text-muted); font-size: .8rem; }
        .wiz-review dd { margin: 0; font-size: .85rem; }
        .wiz-check { display: flex; align-items: center; gap: .45rem; font-size: .85rem; margin-bottom: .5rem; }
        .wiz-error { color: var(--cms-danger-text); font-size: .85rem; margin: .75rem 0 0; }
        .cms-label { margin-top: .65rem; }
    `],
})
export class SiteWizardComponent {
    readonly stepLabels = ['Identity', 'Address', 'Look', 'Review'];

    /** Every value `FeStackType` accepts; an unknown one is a 400 from the API. */
    readonly stacks = [
        { value: 'ssr', label: 'SSR — server-rendered from a theme' },
        { value: 'spa', label: 'SPA — a single-page app' },
        { value: 'inertia', label: 'Inertia' },
        { value: 'hybrid', label: 'Hybrid' },
        { value: 'api', label: 'API only — no public pages' },
    ];

    slug = '';
    label = '';
    host = '';
    prefix = '/';
    priority = 0;
    feStack = 'ssr';
    themeSlug = '';
    applyNginx = true;

    readonly step = signal(0);
    readonly saving = signal(false);
    readonly error = signal<string | null>(null);
    readonly themes = signal<{ value: string; label: string }[]>([]);

    readonly dialogRef = inject(DialogRef);
    private readonly store = inject(Store);
    private readonly http = inject(HttpClient);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    readonly addressSummary = computed(() => {
        const h = this.host.trim() || 'any domain';
        const p = this.prefix.trim() || '/';
        return `${h} at ${p}`;
    });

    constructor() {
        // The same option source the section form's theme select reads, so the
        // two lists cannot disagree about what is installed.
        this.http.get<{ member?: { value: string; label: string }[] }>('/api/v1/options/theme.themes')
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: res => this.themes.set(res.member ?? []),
                // A theme list that fails to load must not block creating a
                // site: the binding is optional and can be set afterwards.
                error: () => this.themes.set([]),
            });
    }

    /**
     * Whether the CURRENT step may be left.
     *
     * Deliberately shallow: slug format, reserved names and address collisions
     * are all enforced by the API, and duplicating those rules here would put a
     * second copy of them in a place that cannot see the database. This only
     * stops a step that is obviously incomplete.
     */
    stepValid(): boolean {
        if (0 === this.step()) {
            return '' !== this.slug.trim() && '' !== this.label.trim();
        }
        if (1 === this.step()) {
            // An empty host AND an empty prefix is a section that claims
            // everything, which is what `default` already is.
            return '' !== this.host.trim() || '' !== this.prefix.trim();
        }
        return true;
    }

    next(): void {
        this.error.set(null);
        this.step.update(s => Math.min(s + 1, 3));
    }

    back(): void {
        this.error.set(null);
        this.step.update(s => Math.max(s - 1, 0));
    }

    create(): void {
        this.saving.set(true);
        this.error.set(null);
        this.store.dispatch(new CreateSection({
            slug: this.slug.trim(),
            label: this.label.trim(),
            feStack: this.feStack,
            matchHost: this.host.trim() || undefined,
            matchPathPrefix: this.prefix.trim() || undefined,
            matchPriority: this.priority,
            // ⚠️ The gap this wizard closes. The plain create form omitted
            // `themeSlug` while the edit form set it, so every new site was
            // born with no theme and had to be edited immediately. The create
            // endpoint has always accepted it.
            themeSlug: this.themeSlug || undefined,
        })).subscribe({
            next: () => {
                this.store.dispatch(new LoadSections());
                if (!this.applyNginx) {
                    this.dialogRef.close(true);
                    return;
                }
                // Same action the list page's Apply button dispatches, so the
                // vhost is generated exactly the way it is generated by hand.
                this.store.dispatch(new ApplyNginxChanges()).subscribe({
                    next: () => this.dialogRef.close(true),
                    // The site EXISTS at this point. A vhost failure must not
                    // read as "creation failed" -- it is a follow-up step the
                    // operator can retry from the Apply button.
                    error: (err: unknown) => {
                        this.saving.set(false);
                        this.error.set(`Site created. Generating the nginx vhost failed: ${this.errors.humanize(err)}`);
                    },
                });
            },
            error: (err: unknown) => {
                this.saving.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }
}
