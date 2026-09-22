import { consoleEntry } from '@coolms/core-angular';
import { TranslationDetailComponent } from '../translation-detail.component';

/**
 * I18n's console entry: the translations admin -- catalogues and the
 * per-catalogue editor -- and the detail slot its list layout names
 * (console@1).
 */
export default consoleEntry({
    module:   'i18n',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'i18n/translations',
            children: () => import('../translations.routes').then(m => m.TRANSLATION_ROUTES),
            nav:      { activeNav: '/i18n/translations' },
        },
    ],
    bindings: [{ name: 'TranslationDetail', component: TranslationDetailComponent }],
});
