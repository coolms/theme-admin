import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngxs/store';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';

/** A site's robots.txt as the server answers it. */
export interface SiteRobotsTxt {
    readonly site: string;
    readonly text: string;
    /** Null while the site has never had its own: the text is the default. */
    readonly version: string | null;
    readonly groups: readonly { readonly agents: readonly string[]; readonly rules: readonly (readonly [string, string])[] }[];
    readonly host: string;
    readonly rendered: string;
    readonly findings: readonly { readonly error: boolean; readonly line: number; readonly message: string }[];
}

/**
 * A site's robots.txt: the text it is kept as, edited as text and saved whole against the version it was read at, so
 * a save made from an older version is refused rather than overwriting someone else's. Beside it, its groups as a
 * crawler reads them, what the site's main host serves, and the check's findings (errors refuse a save; warnings are
 * said). Never written, the site serves the default, and the card says so.
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
            </header>
            <div class="card__body">
                @if (robots(); as r) {
                    @if (r.version === null) {
                        <p class="robots__hint">This site serves the default robots.txt: every crawler may read every page.</p>
                    }
                    <label class="robots__label" for="robots-text">The text, as it is kept</label>
                    <textarea id="robots-text" class="cms-input robots__text" rows="12" spellcheck="false"
                              [(ngModel)]="draft"></textarea>
                    <p class="robots__hint">
                        {{ '{' }}var:site.mainUrl{{ '}' }} is the site's main address on each host it is served on.
                    </p>
                    @if (r.groups.length > 0) {
                        <h3 class="robots__subtitle">Groups</h3>
                        <ul class="robots__groups">
                            @for (g of r.groups; track $index) {
                                <li>
                                    <strong>{{ g.agents.join(', ') }}</strong>:
                                    @for (rule of g.rules; track $index) {
                                        <span class="robots__rule">{{ rule[0] }} {{ rule[1] }}</span>
                                    } @empty {
                                        <span class="robots__rule">no rules</span>
                                    }
                                </li>
                            }
                        </ul>
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
                        <button type="button" class="cms-btn cms-btn-primary cms-btn-sm" (click)="save()"
                                [disabled]="saving() || draft === r.text">
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
        .robots__label { display: block; font-weight: 600; margin-bottom: 4px; }
        .robots__text { width: 100%; font-family: var(--cms-font-mono, monospace); font-size: .85rem; }
        .robots__hint { color: var(--cms-text-muted); font-size: .85rem; }
        .robots__subtitle { font-size: .9rem; margin: 12px 0 4px; }
        .robots__groups, .robots__findings { margin: 0 0 8px; padding-left: 18px; font-size: .85rem; }
        .robots__rule { margin-right: 8px; font-family: var(--cms-font-mono, monospace); }
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
    draft = '';

    constructor() {
        effect(() => this.load(this.slug()));
    }

    save(): void {
        const current = this.robots();
        if (current === null) {
            return;
        }
        this.saving.set(true);
        this.error.set(null);
        this.http.post<SiteRobotsTxt>(`${this.apiBase}/web/robots-txt`, {
            site: current.site,
            text: this.draft,
            version: current.version,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (saved) => {
                this.saving.set(false);
                this.show(saved);
                this.toast.success('robots.txt saved.');
            },
            error: (err: unknown) => {
                this.saving.set(false);
                if (err instanceof HttpErrorResponse && err.status === 412) {
                    this.error.set('Someone saved the robots.txt meanwhile: read it again and make the change on theirs.');
                    return;
                }
                this.error.set(this.errors.humanize(err));
            },
        });
    }

    private load(slug: string): void {
        this.http.get<SiteRobotsTxt>(`${this.apiBase}/web/robots-txt`, { params: { site: slug } })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (robots) => this.show(robots),
                error: (err: unknown) => this.error.set(this.errors.humanize(err)),
            });
    }

    private show(robots: SiteRobotsTxt): void {
        this.robots.set(robots);
        this.draft = robots.text;
    }

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }
}
