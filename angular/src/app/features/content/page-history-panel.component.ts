import {
    ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DateTimeFormatService, ErrorBannerComponent } from '@coolms/ui-angular';
import { PageBlameDto, PageVersionDiffDto, PageVersionDto, groupVersions } from './page-versions';
import { PageVersionsService } from './page-versions.service';
import { PageVersionDiffComponent } from './page-version-diff.component';

/** How many rows the compact history (a folder's dialog) shows before "Show all". */
export const COMPACT_GROUPS = 5;

/** A version's changes as the panel holds them: being read, read, or refused (with why). */
type DiffState =
    | { readonly state: 'loading' }
    | { readonly state: 'read'; readonly diff: PageVersionDiffDto }
    | { readonly state: 'failed'; readonly error: unknown };

/**
 * A page's or a directory's history: its versions, newest first, grouped so that consecutive saves by one person are
 * one row ("Ann · 6 saves · 14:02–14:11", what they changed together), and a row opens to its versions. Each version
 * says what changed since the one before it, and opens to the changes themselves: the page's fields, its sections one
 * by one, each language body line by line. Older versions are asked for page by page.
 *
 * "By section" answers, for each section the page has now, who last changed it and each of its fields.
 *
 * `compact` (a folder's dialog) shows the latest rows only, with "Show all", and no "By section": a folder has no
 * sections.
 *
 * Path-addressed: bind `[path]` to the page (or the folder, or a language file of the page). Another path clears what
 * was shown at once: the old page's versions never stand under the new one's name while it is read.
 */
@Component({
    selector: 'app-page-history-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ErrorBannerComponent, NgTemplateOutlet, PageVersionDiffComponent],
    template: `
        <div class="ph">
            <div class="ph__head">
                @if (!compact()) {
                    <div class="ph__views" role="tablist" aria-label="History view">
                        <button type="button" role="tab" class="cms-btn cms-btn-sm" data-test="history-view-versions"
                                [class.ph__view--on]="view() === 'versions'" [attr.aria-selected]="view() === 'versions'"
                                (click)="show('versions')">Versions</button>
                        <button type="button" role="tab" class="cms-btn cms-btn-sm" data-test="history-view-blame"
                                [class.ph__view--on]="view() === 'blame'" [attr.aria-selected]="view() === 'blame'"
                                (click)="show('blame')">By section</button>
                    </div>
                }
                <span class="ph__count">
                    @if (view() === 'versions' && versions().length > 0) {
                        {{ versions().length }}{{ hasMore() ? '+' : '' }}
                        version{{ versions().length === 1 ? '' : 's' }}
                    }
                </span>
                <button type="button" class="cms-btn cms-btn-sm" title="Refresh" aria-label="Refresh"
                        data-test="history-refresh" (click)="reload()">
                    <i class="bi bi-arrow-clockwise"></i>
                </button>
            </div>

            @if (view() === 'blame') {
                @if (blameFailure() !== null) {
                    <app-error-banner message="Who changed the sections could not be read" [error]="blameFailure()"
                                      [showRetry]="true" (retry)="loadBlame()" />
                } @else if (blame(); as b) {
                    @if (b.blocks.length === 0) {
                        <p class="ph__msg" data-test="blame-empty">This page has no sections.</p>
                    } @else {
                        <ol class="ph__groups">
                            @for (block of b.blocks; track block.id ?? block.index) {
                                <li class="ph__group" data-test="blame-section">
                                    <button type="button" class="ph__row" [attr.aria-expanded]="isOpen('blame:' + block.index)"
                                            (click)="toggle('blame:' + block.index)">
                                        <span class="ph__who">{{ block.index + 1 }}. {{ typeLabel(block.type) }}</span>
                                        <span class="ph__when">{{ changedBy(b, block.seq) }}</span>
                                    </button>
                                    @if (isOpen('blame:' + block.index)) {
                                        <ol class="ph__versions" data-test="blame-fields">
                                            @for (field of fieldsOf(block.fields); track field.name) {
                                                <li class="ph__version">
                                                    <span class="ph__name">{{ field.name }}</span>
                                                    <span class="ph__when">{{ changedBy(b, field.seq) }}</span>
                                                </li>
                                            }
                                        </ol>
                                    }
                                </li>
                            }
                        </ol>
                        @if (!b.complete) {
                            <p class="ph__msg" data-test="blame-incomplete">
                                Some fields were last changed before the versions read; they say "earlier".
                            </p>
                        }
                    }
                } @else {
                    <p class="ph__msg">Loading…</p>
                }
            } @else if (failure() !== null && versions().length === 0) {
                <!-- Nothing read yet: the failure stands in place of the list. -->
                <app-error-banner message="The history could not be read" [error]="failure()" [showRetry]="true"
                                  (retry)="reload()" />
            } @else if (loading() && versions().length === 0) {
                <p class="ph__msg">Loading…</p>
            } @else if (versions().length === 0) {
                <p class="ph__msg" data-test="history-empty">No versions yet: each save records one.</p>
            } @else {
                <ol class="ph__groups">
                    @for (group of shownGroups(); track group.versions[0].id) {
                        <li class="ph__group" data-test="history-group">
                            <button type="button" class="ph__row" [attr.aria-expanded]="isOpen(group.versions[0].id)"
                                    (click)="openGroup(group.versions)">
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
                            @if (isOpen(group.versions[0].id)) {
                                @if (group.versions.length === 1) {
                                    <ng-container
                                        *ngTemplateOutlet="changesOf; context: { $implicit: group.versions[0] }" />
                                } @else {
                                    <ol class="ph__versions" data-test="history-versions">
                                        @for (version of group.versions; track version.id) {
                                            <li class="ph__version ph__version--stack">
                                                <button type="button" class="ph__line" data-test="history-version"
                                                        [attr.aria-expanded]="openDiff() === version.seq"
                                                        (click)="toggleDiff(version.seq)">
                                                    <span class="ph__when">{{ format.time(version.recordedAt) }}</span>
                                                    @if (version.message) {
                                                        <span class="ph__message">{{ version.message }}</span>
                                                    }
                                                    <span class="ph__changes">
                                                        @for (label of version.changes; track label) {
                                                            <span class="ph__chip">{{ label }}</span>
                                                        }
                                                    </span>
                                                </button>
                                                @if (openDiff() === version.seq) {
                                                    <ng-container
                                                        *ngTemplateOutlet="changesOf; context: { $implicit: version }" />
                                                }
                                            </li>
                                        }
                                    </ol>
                                }
                            }
                        </li>
                    }
                </ol>
                @if (compact() && !showAll() && groups().length > shownGroups().length) {
                    <button type="button" class="cms-btn cms-btn-sm ph__more" data-test="history-show-all"
                            (click)="showAll.set(true)">Show all</button>
                } @else if (failure() !== null) {
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

        <ng-template #changesOf let-version>
            @let state = diffOf(version.seq);
            @switch (state?.state) {
                @case ('read') {
                    <app-page-version-diff [diff]="$any(state).diff" />
                }
                @case ('failed') {
                    <app-error-banner message="What changed in this version could not be read" [error]="$any(state).error"
                                      [showRetry]="true" (retry)="loadDiff(version.seq)" />
                }
                @default {
                    <p class="ph__msg">Loading…</p>
                }
            }
        </ng-template>
    `,
    styles: [`
        .ph { display: flex; flex-direction: column; gap: 8px; font-size: .8125rem; }
        .ph__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .ph__views { display: flex; gap: 4px; }
        .ph__view--on { background: var(--cms-surface-alt); font-weight: 600; }
        .ph__count { flex: 1; }
        .ph__count, .ph__msg, .ph__when, .ph__saves { color: var(--cms-text-muted); }
        .ph__msg { margin: 0; }
        .ph__groups, .ph__versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
        .ph__groups { gap: 4px; }
        .ph__row, .ph__line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; width: 100%;
                              text-align: left; color: inherit; cursor: pointer; }
        .ph__row { padding: 6px 8px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius-sm, 4px);
                   background: var(--cms-surface); }
        .ph__line { padding: 0; border: 0; background: none; }
        .ph__who, .ph__name { font-weight: 600; }
        .ph__changes { display: flex; flex-wrap: wrap; gap: 4px; width: 100%; }
        .ph__chip { padding: 0 6px; border-radius: 999px; background: var(--cms-surface-alt);
                    font-family: var(--cms-font-mono, monospace); font-size: .75rem; }
        .ph__versions { gap: 2px; margin: 4px 0 0 12px; }
        .ph__version { display: flex; flex-wrap: wrap; gap: 4px 8px; padding: 4px 0;
                       border-bottom: 1px solid var(--cms-border); }
        .ph__version--stack { flex-direction: column; }
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
    /** The path the list shown belongs to; another one clears the list before it is read. */
    private shownPath = '';

    /** The page, the folder, or a language file of the page. */
    readonly path = input<string>('');
    /** The folder dialog's history: the latest rows, "Show all", and no "By section". */
    readonly compact = input(false);

    readonly view = signal<'versions' | 'blame'>('versions');
    readonly versions = signal<readonly PageVersionDto[]>([]);
    readonly hasMore = signal(false);
    readonly loading = signal(false);
    /** Why the history could not be read; null once it was. */
    readonly failure = signal<unknown>(null);
    readonly groups = computed(() => groupVersions(this.versions()));
    readonly showAll = signal(false);
    readonly shownGroups = computed(() => this.compact() && !this.showAll()
        ? this.groups().slice(0, COMPACT_GROUPS)
        : this.groups());
    /** The version whose changes are open in a group of several. */
    readonly openDiff = signal<number | null>(null);
    readonly blame = signal<PageBlameDto | null>(null);
    readonly blameFailure = signal<unknown>(null);
    private readonly open = signal<ReadonlySet<string>>(new Set());
    private readonly diffs = signal<ReadonlyMap<number, DiffState>>(new Map());
    private blameGeneration = 0;

    constructor() {
        // Only the path is this effect's: what load() reads (the view, the list) is read untracked, or switching
        // between Versions and By section would read the first page again and drop the older ones paged in.
        effect(() => {
            const path = this.path();
            if (path) {
                untracked(() => this.load(path, null));
            }
        });
    }

    reload(): void {
        const path = this.path();
        if (!path) {
            return;
        }
        this.load(path, null);
        if (this.view() === 'blame') {
            this.loadBlame();
        }
    }

    /** The next, older page: before the oldest version shown. */
    more(): void {
        const oldest = this.versions().at(-1);
        if (oldest && this.path()) {
            this.load(this.path(), oldest.seq);
        }
    }

    show(view: 'versions' | 'blame'): void {
        this.view.set(view);
        if (view === 'blame' && this.blame() === null) {
            this.loadBlame();
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

    /** A row opens: a single version straight to its changes, a group of several to its versions. */
    openGroup(versions: readonly PageVersionDto[]): void {
        this.toggle(versions[0].id);
        if (versions.length === 1 && this.isOpen(versions[0].id)) {
            this.ensureDiff(versions[0].seq);
        }
    }

    toggleDiff(seq: number): void {
        if (this.openDiff() === seq) {
            this.openDiff.set(null);
            return;
        }
        this.openDiff.set(seq);
        this.ensureDiff(seq);
    }

    diffOf(seq: number): DiffState | undefined {
        return this.diffs().get(seq);
    }

    /** Reads (again) what changed in the version `seq`. */
    loadDiff(seq: number): void {
        const path = this.path();
        if (!path) {
            return;
        }
        this.setDiff(seq, { state: 'loading' });
        // A version's changes never change: kept across a refresh, dropped only when the panel shows another path.
        this.service.diff(path, seq).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: diff => {
                if (this.shownPath === path) {
                    this.setDiff(seq, { state: 'read', diff });
                }
            },
            error: (error: unknown) => {
                if (this.shownPath === path) {
                    this.setDiff(seq, { state: 'failed', error });
                }
            },
        });
    }

    loadBlame(): void {
        const path = this.path();
        if (!path) {
            return;
        }
        const generation = ++this.blameGeneration;
        this.blameFailure.set(null);
        this.service.blame(path).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: blame => {
                if (generation === this.blameGeneration) {
                    this.blame.set(blame);
                }
            },
            error: (error: unknown) => {
                if (generation === this.blameGeneration) {
                    this.blameFailure.set(error);
                }
            },
        });
    }

    authorOf(version: PageVersionDto): string {
        return this.nameOf(version.author);
    }

    /** "Ann · 31 Oct 14:02" for a version the blame names; "earlier" for a field changed before the versions read. */
    changedBy(blame: PageBlameDto, seq: number | null): string {
        const who = seq === null ? undefined : blame.versions[String(seq)];
        if (who === undefined) {
            return 'earlier';
        }
        return this.nameOf(who.author) + ' · ' + this.format.dateTime(who.recordedAt);
    }

    fieldsOf(fields: Readonly<Record<string, number | null>>): { name: string; seq: number | null }[] {
        return Object.keys(fields).map(name => ({ name, seq: fields[name] }));
    }

    /** A block type's id as words: "faq_list" -> "Faq list". */
    typeLabel(type: string | null): string {
        if (type === null || type === '') {
            return 'Section';
        }
        const words = type.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
        return words.charAt(0).toUpperCase() + words.slice(1);
    }

    private nameOf(author: PageVersionDto['author']): string {
        if (author === null) {
            return 'The platform';
        }
        return author.name ?? 'An account no longer listed';
    }

    private ensureDiff(seq: number): void {
        const state = this.diffs().get(seq);
        if (state === undefined || state.state === 'failed') {
            this.loadDiff(seq);
        }
    }

    private setDiff(seq: number, state: DiffState): void {
        this.diffs.update(diffs => new Map(diffs).set(seq, state));
    }

    private load(path: string, before: number | null): void {
        const generation = ++this.generation;
        if (path !== this.shownPath) {
            // Another page: nothing of the old one stays on screen under the new one's name while it is read.
            this.shownPath = path;
            this.versions.set([]);
            this.open.set(new Set());
            this.openDiff.set(null);
            this.diffs.set(new Map());
            this.blame.set(null);
            this.blameFailure.set(null);
            this.showAll.set(false);
            ++this.blameGeneration;
            if (this.view() === 'blame') {
                this.loadBlame();
            }
        }
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
