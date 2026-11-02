import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngxs/store';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { changesOf, formChanged, formOf, type RobotsFormGroup, type RobotsNewGroup } from './site-robots-form';

/** A crawler the editor picks from, as the server lists them. */
export interface RobotsCrawler {
    readonly agent: string;
    /** `search`, `ai-training` or `ai-answers`. */
    readonly purpose: string;
    readonly operator: string;
}

/** A site's robots.txt as the server answers it. */
export interface SiteRobotsTxt {
    readonly site: string;
    readonly text: string;
    /** Null while the site has never had its own: the text is the default. */
    readonly version: string | null;
    readonly groups: readonly {
        readonly agents: readonly string[];
        readonly rules: readonly (readonly [string, string])[];
        /** The line index of each agent and rule, for a change made line by line. */
        readonly agentLines: readonly number[];
        readonly ruleLines: readonly number[];
    }[];
    readonly host: string;
    readonly rendered: string;
    readonly findings: readonly { readonly error: boolean; readonly line: number; readonly message: string }[];
    readonly crawlers: readonly RobotsCrawler[];
}

const PURPOSES: Record<string, string> = {
    'search': 'Search engines',
    'ai-training': 'AI training',
    'ai-answers': 'AI assistants and answers',
};

/**
 * A site's robots.txt, two ways. As a form: each group's crawlers and rules, edited in place, a crawler removed, a
 * group added from the built-in crawlers or a typed one; a save sends only the lines that changed, so every other
 * line -- comments, spacing -- stays as written. As text: the text it is kept as, saved whole. Either save names the
 * version it was read at, so a save made from an older version is refused rather than overwriting someone else's.
 * Beside it, what the site's main host serves and the check's findings (errors refuse a save; warnings are said).
 */
@Component({
    selector: 'app-site-robots-card',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="card">
            <header class="card__head">
                <h2 class="card__title"><i class="bi bi-robot"></i> robots.txt</h2>
                @if (robots()) {
                    <div class="robots__modes" role="group" aria-label="Edit as">
                        <button type="button" class="cms-btn cms-btn-sm" [class.cms-btn-primary]="mode() === 'form'"
                                [class.cms-btn-secondary]="mode() !== 'form'" [attr.aria-pressed]="mode() === 'form'"
                                (click)="mode.set('form')">Form</button>
                        <button type="button" class="cms-btn cms-btn-sm" [class.cms-btn-primary]="mode() === 'text'"
                                [class.cms-btn-secondary]="mode() !== 'text'" [attr.aria-pressed]="mode() === 'text'"
                                (click)="mode.set('text')">Text</button>
                    </div>
                }
            </header>
            <div class="card__body">
                @if (robots(); as r) {
                    @if (r.version === null) {
                        <p class="robots__hint">This site serves the default robots.txt: every crawler may read every page.</p>
                    }
                    @if (mode() === 'form') {
                        @for (g of form; track $index; let gi = $index) {
                            <fieldset class="robots__group">
                                <legend>Group {{ gi + 1 }}</legend>
                                @for (a of g.agents; track a.line) {
                                    <div class="robots__row" [class.robots__removed]="a.removed">
                                        <label class="robots__field" [for]="'agent-' + a.line">Crawler</label>
                                        <input class="cms-input" [id]="'agent-' + a.line" [(ngModel)]="a.value"
                                               [disabled]="a.removed" spellcheck="false">
                                        <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm"
                                                (click)="a.removed = !a.removed">{{ a.removed ? 'Keep' : 'Remove' }}</button>
                                    </div>
                                }
                                @for (rule of g.rules; track rule.line) {
                                    <div class="robots__row" [class.robots__removed]="rule.removed">
                                        @if (rule.kind !== null) {
                                            <select class="cms-select robots__field" [(ngModel)]="rule.kind"
                                                    [disabled]="rule.removed" [attr.aria-label]="'Rule on line ' + (rule.line + 1)">
                                                <option value="allow">Allow</option>
                                                <option value="disallow">Disallow</option>
                                            </select>
                                        } @else {
                                            <span class="robots__field">{{ rule.field }}</span>
                                        }
                                        <input class="cms-input" [(ngModel)]="rule.value" [disabled]="rule.removed"
                                               spellcheck="false" [attr.aria-label]="'Path on line ' + (rule.line + 1)">
                                        <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm"
                                                (click)="rule.removed = !rule.removed">{{ rule.removed ? 'Keep' : 'Remove' }}</button>
                                    </div>
                                }
                            </fieldset>
                        }
                        <fieldset class="robots__group">
                            <legend>Add a group</legend>
                            <div class="robots__row">
                                <label class="robots__field" for="robots-pick">Crawler</label>
                                <select id="robots-pick" class="cms-select" [(ngModel)]="picked">
                                    <option value="">Choose a crawler</option>
                                    @for (p of purposes(r); track p.purpose) {
                                        <optgroup [label]="p.label">
                                            @for (c of p.crawlers; track c.agent) {
                                                <option [value]="c.agent">{{ c.agent }} ({{ c.operator }})</option>
                                            }
                                        </optgroup>
                                    }
                                </select>
                                <button type="button" class="cms-btn cms-btn-secondary cms-btn-sm" (click)="addAgent(picked)"
                                        [disabled]="!picked">Add</button>
                            </div>
                            <div class="robots__row">
                                <label class="robots__field" for="robots-custom">Or another</label>
                                <input id="robots-custom" class="cms-input" [(ngModel)]="custom" spellcheck="false"
                                       placeholder="Its user-agent token">
                                <button type="button" class="cms-btn cms-btn-secondary cms-btn-sm" (click)="addAgent(custom)"
                                        [disabled]="!custom.trim()">Add</button>
                            </div>
                            @if (added.agents.length > 0) {
                                <p class="robots__chips">
                                    @for (agent of added.agents; track agent) {
                                        <span class="robots__chip">{{ agent }}
                                            <button type="button" class="robots__chip-x" [attr.aria-label]="'Take ' + agent + ' out'"
                                                    (click)="takeAgent(agent)">&times;</button>
                                        </span>
                                    }
                                </p>
                            }
                            @for (rule of added.rules; track $index; let ri = $index) {
                                <div class="robots__row">
                                    <select class="cms-select robots__field" [(ngModel)]="rule.kind"
                                            [attr.aria-label]="'New rule ' + (ri + 1)">
                                        <option value="allow">Allow</option>
                                        <option value="disallow">Disallow</option>
                                    </select>
                                    <input class="cms-input" [(ngModel)]="rule.value" spellcheck="false" placeholder="/path"
                                           [attr.aria-label]="'Path of new rule ' + (ri + 1)">
                                    <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm"
                                            (click)="added.rules.splice(ri, 1)">Remove</button>
                                </div>
                            }
                            <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm"
                                    (click)="added.rules.push({ kind: 'disallow', value: '' })">Add a rule</button>
                        </fieldset>
                    } @else {
                        <label class="robots__label" for="robots-text">The text, as it is kept</label>
                        <textarea id="robots-text" class="cms-input robots__text" rows="12" spellcheck="false"
                                  [(ngModel)]="draft"></textarea>
                        <p class="robots__hint">
                            {{ '{' }}var:site.mainUrl{{ '}' }} is the site's main address on each host it is served on.
                        </p>
                    }
                    @if (r.findings.length > 0) {
                        <ul class="robots__findings">
                            @for (f of r.findings; track $index) {
                                <li [class.robots__error]="f.error" [class.robots__warning]="!f.error">
                                    {{ f.line > 0 ? 'Line ' + f.line + ': ' : '' }}{{ f.message }}
                                </li>
                            }
                        </ul>
                    }
                    <details class="robots__served">
                        <summary>What {{ r.host }} serves</summary>
                        <pre>{{ r.rendered }}</pre>
                    </details>
                    @if (error(); as e) {
                        <p class="robots__error" role="alert">{{ e }}</p>
                    }
                    <div class="robots__actions">
                        @if (stale()) {
                            <button type="button" class="cms-btn cms-btn-secondary cms-btn-sm" (click)="readAgain()">
                                {{ mode() === 'text' ? 'Read it again, keeping my text' : 'Read it again' }}
                            </button>
                        }
                        <button type="button" class="cms-btn cms-btn-primary cms-btn-sm" (click)="save()"
                                [disabled]="saving() || !changed(r)">
                            Save robots.txt
                        </button>
                    </div>
                } @else if (error(); as e) {
                    <p class="robots__error" role="alert">{{ e }}</p>
                }
            </div>
        </section>
    `,
    styles: [`
        .card__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .robots__modes { display: flex; gap: 4px; }
        .robots__label { display: block; font-weight: 600; margin-bottom: 4px; }
        .robots__text { width: 100%; font-family: var(--cms-font-mono, monospace); font-size: .85rem; }
        .robots__hint { color: var(--cms-text-muted); font-size: .85rem; }
        .robots__group { border: 1px solid var(--cms-border); border-radius: var(--cms-radius); padding: 8px 12px; margin: 0 0 12px; }
        .robots__group legend { font-size: .85rem; font-weight: 600; padding: 0 4px; width: auto; }
        .robots__row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .robots__row .cms-input { flex: 1; font-family: var(--cms-font-mono, monospace); font-size: .85rem; }
        .robots__field { flex: 0 0 110px; font-size: .85rem; }
        .robots__removed .cms-input { text-decoration: line-through; }
        .robots__chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
        .robots__chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px;
            background: var(--cms-surface-muted); font-size: .8rem; font-family: var(--cms-font-mono, monospace); }
        .robots__chip-x { border: 0; background: none; padding: 0 2px; cursor: pointer; color: inherit; }
        .robots__findings { margin: 0 0 8px; padding-left: 18px; font-size: .85rem; }
        .robots__error { color: var(--cms-danger-text); }
        .robots__warning { color: var(--cms-warning-text); }
        .robots__served pre { white-space: pre-wrap; font-size: .8rem; }
        .robots__actions { display: flex; gap: 8px; }
    `],
})
export class SiteRobotsCardComponent {
    readonly slug = input.required<string>();

    private readonly http       = inject(HttpClient);
    private readonly store      = inject(Store);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly toast      = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);

    readonly robots = signal<SiteRobotsTxt | null>(null);
    readonly error  = signal<string | null>(null);
    readonly saving = signal(false);
    /** A save was refused because someone saved meanwhile: the version this card holds is not the current one. */
    readonly stale  = signal(false);
    readonly mode   = signal<'form' | 'text'>('form');
    draft = '';
    form: RobotsFormGroup[] = [];
    added: RobotsNewGroup = { agents: [], rules: [] };
    picked = '';
    custom = '';

    constructor() {
        effect(() => this.load(this.slug()));
    }

    changed(robots: SiteRobotsTxt): boolean {
        return this.mode() === 'text' ? this.draft !== robots.text : formChanged(this.form, this.added);
    }

    purposes(robots: SiteRobotsTxt): { purpose: string; label: string; crawlers: RobotsCrawler[] }[] {
        return Object.keys(PURPOSES)
            .map((purpose) => ({
                purpose,
                label: PURPOSES[purpose],
                crawlers: robots.crawlers.filter((c) => c.purpose === purpose),
            }))
            .filter((p) => p.crawlers.length > 0);
    }

    addAgent(agent: string): void {
        const token = agent.trim();
        if (token !== '' && !this.added.agents.some((a) => a.toLowerCase() === token.toLowerCase())) {
            this.added.agents.push(token);
        }
        this.picked = '';
        this.custom = '';
    }

    takeAgent(agent: string): void {
        this.added.agents = this.added.agents.filter((a) => a !== agent);
    }

    save(): void {
        const current = this.robots();
        if (current === null) {
            return;
        }
        const body = this.mode() === 'text'
            ? { site: current.site, text: this.draft, version: current.version }
            : { site: current.site, version: current.version, ...changesOf(this.form, this.added) };
        this.saving.set(true);
        this.error.set(null);
        this.http.post<SiteRobotsTxt>(`${this.apiBase}/web/robots-txt`, body)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (saved) => {
                    this.saving.set(false);
                    this.show(saved);
                    this.toast.success('robots.txt saved.');
                },
                error: (err: unknown) => {
                    this.saving.set(false);
                    if (err instanceof HttpErrorResponse && err.status === 412) {
                        this.stale.set(true);
                        this.error.set(this.mode() === 'text'
                            ? 'Someone saved the robots.txt meanwhile: read it again and make the change on theirs.'
                            : 'Someone saved the robots.txt meanwhile: read it again, then make your change on theirs.');
                        return;
                    }
                    this.error.set(this.errors.humanize(err));
                },
            });
    }

    /**
     * After a refused save: the current text and its version, read again. In the text, the person's own text is kept,
     * so the next save names the current version and nothing typed is lost. In the form, the lines may have moved, so
     * the form shows the current file and the change is made again.
     */
    readAgain(): void {
        this.load(this.slug(), this.mode() === 'text');
    }

    private load(slug: string, keepDraft = false): void {
        this.http.get<SiteRobotsTxt>(`${this.apiBase}/web/robots-txt`, { params: { site: slug } })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (robots) => this.show(robots, keepDraft),
                error: (err: unknown) => this.error.set(this.errors.humanize(err)),
            });
    }

    private show(robots: SiteRobotsTxt, keepDraft = false): void {
        this.robots.set(robots);
        this.stale.set(false);
        this.error.set(null);
        this.form = formOf(robots);
        this.added = { agents: [], rules: [] };
        if (!keepDraft) {
            this.draft = robots.text;
        }
    }

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }
}
