import { consoleEntry } from '@coolms/core-angular';
import { provideCoolmsEditorForm } from '../../form-widget/providers/provide-coolms-editor-form';

/**
 * Form's console entry: the form builder admin and the editor's form widget
 * (console@1). The form-widget feature directory is this module's.
 */
export default consoleEntry({
    module:   'form',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'forms',
            children: () => import('../forms.routes').then(m => m.FORM_ROUTES),
            nav:      { activeNav: '/forms' },
        },
    ],
    providers: [...provideCoolmsEditorForm()],
});
