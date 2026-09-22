import { consoleEntry } from '@coolms/core-angular';
import { provideCoolmsEditorLink } from '../providers/provide-coolms-editor-link';

/**
 * Link's console entry: the editor's linkWidget extension factory and the
 * link picker (console@1).
 */
export default consoleEntry({
    module:   'link',
    contract: 'console',
    range:    '^1.0',
    providers: [...provideCoolmsEditorLink()],
});
