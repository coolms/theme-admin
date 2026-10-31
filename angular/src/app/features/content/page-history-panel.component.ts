import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DateTimeFormatService, ErrorBannerComponent } from '@coolms/ui-angular';
import { PageVersionDto, groupVersions } from './page-versions';
import { PageVersionsService } from './page-versions.service';

/**
 * A page's or a directory's history: its versions, newest first, grouped so that consecutive saves by one person are
 * one row ("Ann · 6 saves · 14:02–14:11", what they changed together), and a row opens to its versions. Each version
 * says what changed since the one before it. Older versions are asked for page by page.
 *
 * Path-addressed: bind `[path]` to the page (or the folder, or a language file of the page).
 */
@Component({
    selector: 'app-page-history-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ErrorBannerComponent],
    template: `
        <div class="ph">
            <div class="ph__head">
                <span class="ph__count">
                    @if (versions().length > 0) {
                        {{ versions().length }}{{ hasMore() ? '+' : '' }}
                        version{{ versions().length === 1 ? '' : 's' }}
                    }
                </span>
                <button type="button" class="cms-btn cms-btn-sm" title="Refresh" aria-label="Refresh"
                        data-test="history-refresh" (click)="reload()">
                    <i class="bi bi-arrow-clockwise"></i>
                </button>
            </div>

            @if (failure() !== null && versions().length === 0) {
                <!-- Nothing read yet: the failure stands in place of the list. -->
                <app-error-banner message="The history could not be read" [error]="failure()" [showRetry]="true"
                                  (retry)="reload()" />
            } @else if (loading() && versions().length === 0) {
                <p class="ph__msg">Loading…</p>
            } @else if (versions().length === 0) {
                <p class="ph__msg" data-test="history-empty">No versions yet: each save records one.</p>
            } @else {
                <ol class="ph__groups">
                    @for (group of groups(); track group.versions[0].id) {
                        <li class="ph__group" data-test="history-group">
                            <button type="button" class="ph__row" [attr.aria-expanded]="isOpen(group.versions[0].id)"
                                    [disabled]="group.versions.length === 1"
                                    (click)="toggle(group.versions[0].id)">
                                <span class="ph__who">{{ authorOf(group.versions[0]) }}</span>
                                @if (group.versions.length > 1) {
                                    <span class="ph__saves">{{ group.versions.length }} saves</span>
                                    <span class="ph__when">
                                        {{ format.dateTime(group.oldest) }} – {{ format.time(group.newest) }}
                                    </span>
                                } @else {
                                    <span class="ph__when">{{ format.dateTime(group.newest) }}</span>
                                }
                                <span class="ph__changes">
                                    @for (label of group.changes; track label) {
                                        <span class="ph__chip">{{ label }}</span>
                                    }
                                </span>
                            </button>
                            @if (group.versions.length > 1 && isOpen(group.versions[0].id)) {
                                <ol class="ph__versions" data-test="history-versions">
                                    @for (version of group.versions; track version.id) {
                                        <li class="ph__version">
                                            <span class="ph__when">{{ format.time(version.recordedAt) }}</span>
                                            @if (version.message) {
                                                <span class="ph__message">{{ version.message }}</span>
                                            }
                                            <span class="ph__changes">
                                                @for (label of version.changes; track label) {
                                                    <span class="ph__chip">{{ label }}</span>
                                                }
                                            </span>
                                        </li>
                                    }
                                </ol>
                            }
                        </li>
                    }
                </ol>
                @if (failure() !== null) {
                    <!-- An older page that failed: the versions read stay, and the failure stands where the button
                         was, its Retry asking for the same page. -->
                    <app-error-banner message="Older versions could not be read" [error]="failure()" [showRetry]="true"
                                      (retry)="more()" />
                } @else if (hasMore()) {
                    <button type="button" class="cms-btn cms-btn-sm ph__more" data-test="history-more"
                            [disabled]="loading()" (click)="more()">Older versions</button>
                }
            }
        </div>
    `,
    styles: [`
        .ph { display: flex; flex-direction: column; gap: 8px; font-size: .8125rem; }
        .ph__head { display: flex; align-items: center; justify-content: space-between; }
        .ph__count, .ph__msg, .ph__when, .ph__saves { color: var(--cms-text-muted); }
        .ph__msg { margin: 0; }
        .ph__groups, .ph__versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
        .ph__groups { gap: 4px; }
        .ph__row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; width: 100%; text-align: left;
                   padding: 6px 8px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius-sm, 4px);
                   background: var(--cms-surface); color: inherit; cursor: pointer; }
        .ph__row:disabled { cursor: default; }
        .ph__who { font-weight: 600; }
        .ph__changes { display: flex; flex-wrap: wrap; gap: 4px; width: 100%; }
        .ph__chip { padding: 0 6px; border-radius: 999px; background: var(--cms-surface-alt);
                    font-family: var(--cms-font-mono, monospace); font-size: .75rem; }
        .ph__versions { gap: 2px; margin: 4px 0 0 12px; }
        .ph__version { display: flex; flex-wrap: wrap; gap: 4px 8px; padding: 4px 0;
                       border-bottom: 1px solid var(--cms-border); }
        .ph__message { font-style: italic; }
        .ph__more { align-self: flex-start; }
    `],
})
export class PageHistoryPanelComponent {
    private readonly service = inject(PageVersionsService);
    private readonly destroyRef = inject(DestroyRef);
    /** The person's own date and time setting, as the rest of the admin writes times. */
    protected readonly format = inject(DateTimeFormatService);
    /** The latest request's number: an answer to any earlier one is dropped (a path changed, a refresh came). */
    private generation = 0;

    /** The page, the folder, or a language file of the page. */
    readonly path = input<string>('');

    readonly versions = signal<readonly PageVersionDto[]>([]);
    readonly hasMore = signal(false);
    readonly loading = signal(false);
    /** Why the history could not be read; null once it was. */
    readonly failure = signal<unknown>(null);
    readonly groups = computed(() => groupVersions(this.versions()));
    private readonly open = signal<ReadonlySet<string>>(new Set());

    constructor() {
        effect(() => {
            const path = this.path();
            if (path) {
                this.load(path, null);
            }
        });
    }

    reload(): void {
        const path = this.path();
        if (path) {
            this.load(path, null);
        }
    }

    /** The next, older page: before the oldest version shown. */
    more(): void {
        const oldest = this.versions().at(-1);
        if (oldest && this.path()) {
            this.load(this.path(), oldest.seq);
        }
    }

    isOpen(id: string): boolean {
        return this.open().has(id);
    }

    toggle(id: string): void {
        this.open.update(open => {
            const next = new Set(open);
            if (!next.delete(id)) {
                next.add(id);
            }
            return next;
        });
    }

    authorOf(version: PageVersionDto): string {
        if (version.author === null) {
            return 'The platform';
        }
        return version.author.name ?? 'An account no longer listed';
    }

    private load(path: string, before: number | null): void {
        const generation = ++this.generation;
        this.loading.set(true);
        this.failure.set(null);
        if (before === null) {
            // A first page replaces the list; until it answers, nothing older is offered on top of the old one.
            this.hasMore.set(false);
        }
        this.service.list(path, before).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: page => {
                if (generation !== this.generation) {
                    return;
                }
                this.versions.set(before === null ? page.versions : [...this.versions(), ...page.versions]);
                this.hasMore.set(page.hasMore);
                this.loading.set(false);
            },
            error: (err: unknown) => {
                if (generation !== this.generation) {
                    return;
                }
                if (before === null) {
                    // The list read was refused: what was shown belongs to another path or an older read.
                    this.versions.set([]);
                }
                this.failure.set(err);
                this.loading.set(false);
            },
        });
    }
}
