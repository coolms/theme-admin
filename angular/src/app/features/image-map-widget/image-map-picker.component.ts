import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DialogRef } from '@angular/cdk/dialog';
import { ImageMapService } from '../image-maps/image-map.service';
import type { ImageMapDto } from '../image-maps/image-map.types';

/** What the picker hands back — enough to insert the node without a refetch. */
export interface ImageMapPick {
    readonly slug: string;
    readonly title: string;
}

/**
 * CDK dialog listing the available image maps, returning the chosen one to
 * {@link OpenImageMapPickerHandler}, which inserts an `imageMapWidget` node.
 *
 * A DISABLED map is shown but not selectable: the SSR widget renders nothing
 * for one, so letting an author embed it would produce a page with a silently
 * missing map and no way to tell why. The same applies to a map with no
 * regions — it renders the base image with an empty overlay, which is legal
 * but almost never what someone meant, so it is flagged rather than blocked.
 *
 * Colours come from `--cms-*` throughout: this dialog is new code, and the
 * older pickers it is modelled on are part of the hard-coded stock the theming
 * arc is still working down.
 */
@Component({
    selector: 'app-image-map-picker',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="imp">
            <header class="imp__head">
                <h3>Insert image map</h3>
                <button type="button" class="imp__x" (click)="cancel()" aria-label="Close">×</button>
            </header>

            <input class="cms-input imp__search" type="text" placeholder="Filter maps…"
                   [(ngModel)]="query" autocomplete="off" />

            @if (loading()) {
                <div class="imp__msg">Loading image maps…</div>
            } @else if (error()) {
                <div class="imp__msg imp__msg--err">{{ error() }}</div>
            } @else if (filtered().length === 0) {
                <div class="imp__msg">
                    @if (all().length === 0) {
                        No image maps yet — create one under Image Maps first.
                    } @else {
                        No maps match.
                    }
                </div>
            } @else {
                <ul class="imp__list">
                    @for (m of filtered(); track m.slug) {
                        <li>
                            <button type="button" class="imp__item"
                                    [disabled]="!m.enabled"
                                    [title]="m.enabled ? m.slug : 'Disabled maps render nothing on the page'"
                                    (click)="pick(m)">
                                <span class="imp__title">{{ m.title || m.slug }}</span>
                                <span class="imp__slug">{{ m.slug }}</span>
                                @if (!m.enabled) {
                                    <span class="imp__badge imp__badge--off">disabled</span>
                                } @else if (m.regions.length === 0) {
                                    <span class="imp__badge">no regions</span>
                                } @else {
                                    <span class="imp__badge">{{ m.regions.length }} regions</span>
                                }
                            </button>
                        </li>
                    }
                </ul>
            }

            <footer class="imp__foot">
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
            </footer>
        </div>
    `,
    styles: [`
        .imp {
            width: 460px; max-width: 92vw;
            background: var(--cms-surface);
            border-radius: var(--cms-radius-lg);
            box-shadow: var(--cms-shadow-lg);
            overflow: hidden; display: flex; flex-direction: column;
        }
        .imp__head {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 16px; border-bottom: 1px solid var(--cms-border);
        }
        .imp__head h3 { margin: 0; font-size: 15px; color: var(--cms-text); }
        .imp__x {
            border: none; background: none; font-size: 22px; line-height: 1;
            cursor: pointer; color: var(--cms-text-secondary);
        }
        .imp__x:hover { color: var(--cms-text); }
        .imp .imp__search { margin: 12px 16px 6px; width: auto; }
        .imp__list { list-style: none; margin: 0; padding: 4px 8px; max-height: 46vh; overflow: auto; }
        .imp__item {
            display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
            border: none; background: none; padding: 8px 10px;
            border-radius: var(--cms-radius); cursor: pointer; font-size: 13px;
            color: var(--cms-text);
        }
        .imp__item:hover:not(:disabled) { background: var(--cms-surface-muted); }
        .imp__item:disabled { opacity: .55; cursor: not-allowed; }
        .imp__title { font-weight: 600; }
        .imp__slug { color: var(--cms-text-secondary); font-family: var(--cms-font-mono); font-size: 11px; }
        .imp__badge {
            margin-left: auto; font-size: 10px; text-transform: uppercase; letter-spacing: .4px;
            color: var(--cms-text-secondary); background: var(--cms-surface-muted);
            border-radius: 20px; padding: 2px 8px; white-space: nowrap;
        }
        .imp__badge--off { color: var(--cms-danger-text); background: var(--cms-danger-subtle); }
        .imp__msg { padding: 18px 16px; color: var(--cms-text-secondary); font-size: 13px; }
        .imp__msg--err { color: var(--cms-danger-text); }
        .imp__foot { padding: 10px 16px; border-top: 1px solid var(--cms-border); text-align: right; }
    `],
})
export class ImageMapPickerComponent implements OnInit {
    private readonly svc = inject(ImageMapService);
    private readonly ref = inject<DialogRef<ImageMapPick | null>>(DialogRef);

    readonly all = signal<ImageMapDto[]>([]);
    readonly loading = signal(true);
    readonly error = signal<string | null>(null);

    query = '';

    readonly filtered = computed(() => {
        const q = this.query.trim().toLowerCase();
        const maps = this.all();
        if (!q) return maps;

        return maps.filter(m =>
            m.slug.toLowerCase().includes(q) || (m.title ?? '').toLowerCase().includes(q));
    });

    ngOnInit(): void {
        this.svc.listImageMaps().subscribe({
            next: maps => {
                this.all.set(maps);
                this.loading.set(false);
            },
            error: () => {
                this.error.set('Could not load image maps.');
                this.loading.set(false);
            },
        });
    }

    pick(m: ImageMapDto): void {
        if (!m.enabled) return;
        this.ref.close({ slug: m.slug, title: m.title || m.slug });
    }

    cancel(): void {
        this.ref.close(null);
    }
}
