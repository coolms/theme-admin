/**
 * Pulls `@coolms/sheet-editor-angular`'s specs into the admin suite.
 *
 * Karma discovers specs under the PROJECT ROOT only, so these would leave
 * the run the moment the package moved -- silently, with the suite still
 * reporting SUCCESS. `npm run lint:specs` keeps this list honest.
 */
import '../../../sheet-editor-angular/src/clipboard.spec';
import '../../../sheet-editor-angular/src/conditional.spec';
import '../../../sheet-editor-angular/src/find-replace.spec';
import '../../../sheet-editor-angular/src/font-families.spec';
import '../../../sheet-editor-angular/src/defined-names.spec';
import '../../../sheet-editor-angular/src/formula/defined-names.spec';
import '../../../sheet-editor-angular/src/formula/formula-oracle.spec';
import '../../../sheet-editor-angular/src/formula/formula.spec';
import '../../../sheet-editor-angular/src/formula/helper.spec';
import '../../../sheet-editor-angular/src/number-format.spec';
import '../../../sheet-editor-angular/src/sheet-document.model.spec';
import '../../../sheet-editor-angular/src/sheet-editor-dialog.component.spec';
