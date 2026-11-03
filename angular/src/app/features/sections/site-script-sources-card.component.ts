import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { filter, switchMap } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';
import { SectionsApiService } from './sections-api.service';
import { AddSiteScriptSourceDto, SiteScriptSourceDto } from './sections.types';

/**
 * A site's allow-list of external scripts and style sheets: the only files from outside the site its pages may load,
 * each by its exact https address and its integrity hash. The site's Content-Security-Policy names each one; a page's
 * scripts and styles may name only these, with this very hash.
 *
 * Every member of admin reads the list. Adding and removing admit or withdraw code that runs on the site's pages, so
 * both are elevated acts: the refusal prompts elevation through the interceptor and the same request is re-sent.
 * The server asks a new address once and refuses one that redirects, does not answer the file, is not https, names a
 * folder, or carries a malformed hash; it keeps an entry a page still names and says which pages. Each refusal is
 * shown in the server's words.
 */
@Component({
    selector: 'app-site-script-sources-card',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="card">
            <header class="card__head">
                <h2 class="card__title"><i class="bi bi-shield-check"></i> External scripts and styles</h2>
                <span class="card__count">{{ sources().length }}</span>
            </header>
            <div class="card__body">
                @if (sources().length === 0) {
                    <p class="sources__empty">This site's pages load no script or style sheet from outside the site.</p>
                }
                @for (s of sources(); track s.id) {
                    <div class="sources__row" data-test="script-source">
                        <span class="sources__kind">{{ s.kind === 'script' ? 'Script' : 'Style sheet' }}</span>
                        <span class="sources__url mono" [title]="s.url">{{ s.url }}</span>
                        <span class="sources__hash mono" [title]="s.integrity">{{ s.integrity }}</span>
                        <button type="button" class="cms-btn cms-btn-link cms-btn-sm" (click)="remove(s)"
                                [attr.aria-label]="'Remove ' + s.url">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                }
                <div class="sources__add">
                    <select class="cms-select" [(ngModel)]="draft.kind" aria-label="Kind of file">
                        <option value="script">Script</option>
                        <option value="style">Style sheet</option>
                    </select>
                    <input class="cms-input sources__input" type="url" [(ngModel)]="draft.url" aria-label="Address"
                           placeholder="https://cdn.example.net/lib@1.2.3/lib.min.js" />
                    <input class="cms-input sources__input" type="text" [(ngModel)]="draft.integrity"
                           aria-label="Integrity hash" placeholder="sha384-..." />
                    <button type="button" class="cms-btn cms-btn-primary cms-btn-sm" (click)="add()"
                            [disabled]="busy()">
                        Add
                    </button>
                </div>
                <p class="sources__hint">
                    One file per entry, not a folder. Prefer a copy served from the site itself; a file from elsewhere
                    is admitted only with its hash, so the browser refuses it if its bytes ever change.
                </p>
                @if (error(); as e) {
                    <p class="sources__error" role="alert">{{ e }}</p>
                }
            </div>
        </section>
    `,
    styles: [`
        .sources__row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
        .sources__kind { flex: 0 0 auto; color: var(--cms-text-muted); font-size: .85rem; min-width: 6rem; }
        .sources__url { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sources__hash { flex: 0 1 12rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            color: var(--cms-text-muted); font-size: .85rem; }
        .sources__add { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
        .sources__input { flex: 1 1 14rem; min-width: 0; }
        .sources__hint, .sources__empty { color: var(--cms-text-muted); font-size: .85rem; }
        .sources__error { color: var(--cms-danger-text); }
    `],
})
export class SiteScriptSourcesCardComponent {
    readonly sectionId = input.required<string>();

    private readonly api        = inject(SectionsApiService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly toast      = inject(ToastService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);

    readonly sources = signal<SiteScriptSourceDto[]>([]);
    readonly error   = signal<string | null>(null);
    readonly busy    = signal(false);

    draft: AddSiteScriptSourceDto = { kind: 'script', url: '', integrity: '' };

    constructor() {
        effect(() => this.load(this.sectionId()));
    }

    add(): void {
        const dto: AddSiteScriptSourceDto = {
            kind:      this.draft.kind,
            url:       this.draft.url.trim(),
            integrity: this.draft.integrity.trim(),
        };
        this.busy.set(true);
        this.error.set(null);
        this.api.addScriptSource(this.sectionId(), dto).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.busy.set(false);
                this.draft = { kind: dto.kind, url: '', integrity: '' };
                this.toast.success('Added to the site\'s allow-list');
                this.load(this.sectionId());
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.error.set(this.errors.humanize(err));
            },
        });
    }

    remove(source: SiteScriptSourceDto): void {
        this.error.set(null);
        this.confirmSvc.open({
            title:        'Remove this file from the allow-list?',
            message:      `${source.url} will no longer be loaded by any page of this site.`,
            confirmLabel: 'Remove',
            danger:       true,
        }).pipe(
            filter(Boolean),
            switchMap(() => this.api.removeScriptSource(this.sectionId(), source.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Removed from the site\'s allow-list'); this.load(this.sectionId()); },
            error: (err: unknown) => this.error.set(this.errors.humanize(err)),
        });
    }

    private load(sectionId: string): void {
        this.api.listScriptSources(sectionId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next:  sources => this.sources.set(sources),
            error: (err: unknown) => this.error.set(this.errors.humanize(err)),
        });
    }
}
