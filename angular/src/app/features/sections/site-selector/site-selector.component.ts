import {
    ChangeDetectionStrategy, Component, computed, inject, input, OnInit,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { SectionState } from '../section.state';
import { LoadSections, SetCurrentSection } from '../section.actions';
import { SiteSectionDto } from '../../../api/api.service';

/**
 * H7 -- admin Site Selector dropdown.
 *
 * Renders the list of {@link SiteSectionDto} the operator can switch into.
 * The selected slug is dispatched via {@link SetCurrentSection}; downstream
 * the section interceptor stamps every `/api/v1/*` request with
 * `X-CoolMS-Section: <slug>` so site-scoped backend providers honour it.
 *
 * The component is hidden by default when only a single section exists
 * (single-tenant dev): the dropdown adds visual noise with no decision to
 * make. Force-show via `[alwaysShow]="true"` for testing/multi-site demos.
 */
@Component({
    selector: 'app-site-selector',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [`
        .site-selector-root {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .site-selector-icon { font-size: .9rem; opacity: .7; }
        .site-selector-select {
            background: transparent;
            color: inherit;
            border: 1px solid rgba(255, 255, 255, .15);
            border-radius: 3px;
            padding: 2px 6px;
            font-size: .78rem;
            min-width: 130px;
            cursor: pointer;
        }
        .site-selector-select option {
            color: #222;
            background: var(--cms-surface);
        }
        .site-selector-select:focus {
            outline: none;
            border-color: rgba(255, 255, 255, .35);
        }
    `],
    template: `
        @if (visible()) {
            <span class="site-selector-root" title="Active site (X-CoolMS-Section)">
                <i class="bi bi-globe2 site-selector-icon" aria-hidden="true"></i>
                <select class="site-selector-select"
                        [value]="currentSlug() ?? ''"
                        (change)="onSelect($event)"
                        aria-label="Active site">
                    <option value="">(host-derived)</option>
                    @for (s of sections(); track s.slug) {
                        <option [value]="s.slug ?? ''">{{ s.label }}</option>
                    }
                </select>
            </span>
        }
    `,
})
export class SiteSelectorComponent implements OnInit {
    /**
     * Force-show the dropdown even when only one site is available.
     * Useful for testing and multi-site demos; default behaviour hides
     * the control in single-tenant dev to avoid clutter.
     */
    readonly alwaysShow = input<boolean>(false);

    private readonly store = inject(Store);

    readonly sections     = toSignal(this.store.select(SectionState.availableSections), { initialValue: [] as SiteSectionDto[] });
    readonly currentSlug  = toSignal(this.store.select(SectionState.currentSectionSlug), { initialValue: null });

    readonly visible = computed(() => this.alwaysShow() || this.sections().length > 1);

    ngOnInit(): void {
        // Lazy load on first mount; SectionState.LoadSections is idempotent
        // (always replaces the list) so calling it again is safe.
        if (this.sections().length === 0) {
            this.store.dispatch(new LoadSections());
        }
    }

    onSelect(event: Event): void {
        const value = (event.target as HTMLSelectElement).value;
        this.store.dispatch(new SetCurrentSection(value || null));
    }
}
