import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PageService } from './page.service';
import { PageDto, PagePlacementDto, PageSurfaceDto } from './page.types';
import { SpaceDto, ToastService } from '@coolms/ui-angular';

export interface PlacePageDialogData {
    readonly page: PageDto;
}

/**
 * Where a page appears — add or remove a surface placement ( step (c),
 * ).
 *
 * ## The verb this dialog is NOT
 *
 * It does not publish. Publishing is variant lifecycle — which locale is live
 * — and lives in the page editor. This is DISTRIBUTION: the same page linked
 * into a site's blog or news surface, still authored in one place. A personal
 * draft can be placed on a site's blog without ever being copied there, which
 * is the motivating case was written for.
 *
 * ## Why the site list comes from page spaces
 *
 * A surface is `(site, surface key)`, and the sites a user may target are
 * exactly the site page-spaces the registry offers them — so the list is
 * derived from the same endpoint the explorer's accordion uses rather than
 * from a sites API this module would otherwise have no reason to know about.
 * A user with no site space sees an explicit "nowhere to place" state instead
 * of an empty dropdown.
 */
@Component({
    selector: 'app-place-page-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog" style="width: 520px; max-width: 92vw;">
            <!-- Same fix as the metadata dialog: cms-dialog-title is
                 defined nowhere, so this heading rendered at the browser's 2em
                 default, and the dialog had no close button. -->
            <div class="cms-dialog-header">
                <i class="bi bi-box-arrow-up-right"></i>
                <span>Where this page appears</span>
                <button type="button" class="cms-dialog-close" (click)="close()" aria-label="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="cms-dialog-body" style="display: flex; flex-direction: column; gap: 14px;">
                <div class="cms-field-hint">
                    Placing links <strong>{{ data.page.slug }}</strong> into a site surface. The page keeps
                    living where it is — a link is not a copy, so edits show up everywhere it appears.
                </div>

                @if (loading()) {
                    <div class="cms-field-hint">Loading…</div>
                } @else {
                    <!-- Current placements -->
                    <div>
                        <label class="cms-label">Currently placed on</label>
                        @if (placements().length === 0) {
                            <div class="cms-field-hint">
                                Nowhere yet — this page is reachable only at its own URL.
                            </div>
                        } @else {
                            <ul class="place-list">
                                @for (p of placements(); track p.linkPath) {
                                    <li class="place-list__row">
                                        <span class="place-list__where">
                                            {{ p.siteSlug }} / {{ surfaceLabel(p.surfaceKey) }}
                                        </span>
                                        <code class="place-list__path">{{ p.linkPath }}</code>
                                        <button type="button"
                                                class="cms-btn cms-btn-sm cms-btn-danger"
                                                [disabled]="busy()"
                                                (click)="remove(p)">
                                            Remove
                                        </button>
                                    </li>
                                }
                            </ul>
                        }
                    </div>

                    <!-- Add a placement -->
                    @if (sites().length === 0) {
                        <div class="cms-field-hint">
                            You have no site space to place this page into.
                        </div>
                    } @else {
                        <div style="display: flex; gap: 8px; align-items: flex-end;">
                            <div style="flex: 1;">
                                <label class="cms-label">Site</label>
                                <select class="cms-input" [(ngModel)]="site" [disabled]="busy()">
                                    @for (s of sites(); track s.siteSlug) {
                                        <option [value]="s.siteSlug">{{ s.label }}</option>
                                    }
                                </select>
                            </div>
                            <div style="flex: 1;">
                                <label class="cms-label">Surface</label>
                                <select class="cms-input" [(ngModel)]="surface" [disabled]="busy()">
                                    @for (s of surfaces(); track s.key) {
                                        <option [value]="s.key">{{ s.label }}</option>
                                    }
                                </select>
                            </div>
                            <button type="button"
                                    class="cms-btn cms-btn-primary"
                                    [disabled]="busy() || !site || !surface"
                                    (click)="add()">
                                {{ busy() ? 'Working…' : 'Place' }}
                            </button>
                        </div>
                    }
                }
            </div>

            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn" (click)="close()">Close</button>
            </div>
        </div>
    `,
    styles: [`
        .place-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .place-list__row { display: flex; align-items: center; gap: 8px; }
        .place-list__where { font-weight: 500; white-space: nowrap; }
        .place-list__path {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: .75rem;
            color: var(--cms-text-muted);
        }
    `],
})
export class PlacePageDialogComponent {
    protected readonly data = inject<PlacePageDialogData>(DIALOG_DATA);

    private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
    private readonly pageSvc = inject(PageService);
    private readonly toast = inject(ToastService);
    /**
     * Needed explicitly: `takeUntilDestroyed()` resolves its own DestroyRef
     * only inside an injection context, and the place/remove handlers run
     * from a click. Without it they throw NG0203 the moment the button is
     * pressed — a failure no build or lint sees, because the call is legal
     * everywhere the compiler looks.
     */
    private readonly destroyRef = inject(DestroyRef);

    protected readonly loading = signal(true);
    protected readonly busy = signal(false);
    protected readonly surfaces = signal<PageSurfaceDto[]>([]);
    protected readonly sites = signal<{ siteSlug: string; label: string }[]>([]);
    protected readonly placements = signal<PagePlacementDto[]>(this.data.page.placements ?? []);

    protected site = '';
    protected surface = '';

    /** True once anything was placed or removed — the caller reloads on close. */
    private changed = false;

    constructor() {
        forkJoin({
            surfaces: this.pageSvc.listSurfaces().pipe(catchError(() => of([] as PageSurfaceDto[]))),
            spaces: this.pageSvc.listPageSpaces().pipe(catchError(() => of([] as SpaceDto[]))),
        })
            .pipe(takeUntilDestroyed())
            .subscribe(({ surfaces, spaces }) => {
                this.surfaces.set(surfaces);
                // Only spaces that BELONG to a site can host a placement; the
                // personal space carries `siteSlug: null` precisely so this
                // distinction is answerable without parsing the space key.
                this.sites.set(
                    spaces
                        .filter(s => !!s.siteSlug)
                        .map(s => ({ siteSlug: s.siteSlug as string, label: s.label })),
                );
                this.site = this.sites()[0]?.siteSlug ?? '';
                this.surface = surfaces[0]?.key ?? '';
                this.loading.set(false);
            });
    }

    protected surfaceLabel(key: string): string {
        return this.surfaces().find(s => s.key === key)?.label ?? key;
    }

    protected add(): void {
        const path = this.data.page.vfsPath;
        if (!path) {
            this.toast.error('This page has no path, so it cannot be placed.');

            return;
        }
        this.busy.set(true);
        this.pageSvc.placePage(path, this.site, this.surface)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.busy.set(false);
                    this.changed = true;
                    // Reflect it locally rather than re-fetching the page: the
                    // server just told us the link exists, and the link path is
                    // the surface path plus the page's own basename.
                    this.placements.update(list => [...list, {
                        siteSlug: this.site,
                        surfaceKey: this.surface,
                        linkPath: this.linkPathFor(this.site, this.surface, path),
                    }]);
                    this.toast.success('Placed', `${this.site} / ${this.surfaceLabel(this.surface)}`);
                },
                error: (e: { error?: { detail?: string }; message?: string }) => {
                    this.busy.set(false);
                    // The surface's OWN permissions decide this, per site and
                    // per surface — so the server's reason is the useful one.
                    this.toast.error(e.error?.detail ?? e.message ?? 'Could not place the page.');
                },
            });
    }

    protected remove(placement: PagePlacementDto): void {
        const path = this.data.page.vfsPath;
        if (!path) return;

        this.busy.set(true);
        this.pageSvc.unplacePage(path, placement.siteSlug, placement.surfaceKey)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.busy.set(false);
                    this.changed = true;
                    this.placements.update(list => list.filter(p => p.linkPath !== placement.linkPath));
                    this.toast.success('Removed', `${placement.siteSlug} / ${this.surfaceLabel(placement.surfaceKey)}`);
                },
                error: (e: { error?: { detail?: string }; message?: string }) => {
                    this.busy.set(false);
                    this.toast.error(e.error?.detail ?? e.message ?? 'Could not remove the placement.');
                },
            });
    }

    protected close(): void {
        this.dialogRef.close(this.changed);
    }

    /** `/content/{site}/{surfaceRelativePath}/{basename}` — the server's own rule. */
    private linkPathFor(site: string, surfaceKey: string, pagePath: string): string {
        const relative = this.surfaces().find(s => s.key === surfaceKey)?.relativePath ?? surfaceKey;
        const basename = pagePath.slice(pagePath.lastIndexOf('/') + 1);

        return `/content/${site}/${relative}/${basename}`;
    }
}
