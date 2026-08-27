import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ListLayoutComponent, PageActionsService, PageFooterService } from '@coolms/ui-angular';

/**
 * F5.d -- Translation detail page wrapper.
 *
 * Mirrors the Navigation precedent (`NaviNodesPageComponent`):
 * a thin wrapper that mounts the platform `cms-list-layout` shell
 * bound to the `i18n:translation-detail` layout id. The layout YAML
 * supplies the icon (and a fallback title); the registered
 * `TranslationDetailComponent` slot fills `content.main` and sets
 * the live title via `PageTitleService` once the catalogue loads.
 */
@Component({
    selector: 'app-translation-detail-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ListLayoutComponent],
    providers: [PageActionsService, PageFooterService],
    styles: [':host { display: flex; flex: 1; flex-direction: column; min-height: 0; }'],
    template: `<cms-list-layout layoutId="i18n:translation-detail" />`,
})
export class TranslationDetailPageComponent {}
