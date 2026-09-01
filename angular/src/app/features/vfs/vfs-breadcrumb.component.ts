import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { VfsPageStateService } from './vfs-page-state.service';
import { VfsHomeLabelService } from './vfs-home-label.service';
import { VfsBreadcrumb } from '@coolms/ui-angular';

@Component({
    selector: 'app-vfs-breadcrumb',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    template: `
        <nav class="d-flex align-items-center gap-1 flex-wrap py-1"
             style="font-size: .875rem" aria-label="Path">
            @for (crumb of breadcrumbs(); track crumb.path; let last = $last) {
                @if (!last) {
                    <button class="btn btn-link btn-sm p-0 text-decoration-none"
                            style="color: var(--cms-text-secondary)"
                            (click)="navigate(crumb.path)">
                        {{ crumb.label }}
                    </button>
                    <span class="text-muted">/</span>
                } @else {
                    <span class="fw-semibold text-dark">{{ crumb.label }}</span>
                }
            }
        </nav>
    `,
})
export class VfsBreadcrumbComponent {
    private readonly state      = inject(VfsPageStateService);
    private readonly homeLabels = inject(VfsHomeLabelService);

    currentPath = this.state.currentPath;

    breadcrumbs = computed<VfsBreadcrumb[]>(() => {
        const path     = this.currentPath();
        const segments = path.split('/').filter(Boolean);
        const crumbs: VfsBreadcrumb[] = [{ label: 'Root', path: '/' }];
        let built = '';
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            built += '/' + seg;
            // /home/{uuid} -> resolve to the owning user's identifier.
            // Reading labelFor(seg)() inside computed() registers it as a
            // reactive dependency — the breadcrumb re-renders automatically
            // when the label cache is populated after the /home listing loads.
            const label = VfsHomeLabelService.isHomeUuidSegment(segments, i)
                ? this.homeLabels.labelFor(seg)()
                : seg;
            crumbs.push({ label, path: built });
        }
        return crumbs;
    });

    navigate(path: string): void {
        this.state.navigateTo(path);
    }
}
