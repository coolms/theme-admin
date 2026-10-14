/**
 * Pulls `@coolms/image-editor-angular`'s specs into the admin suite.
 *
 * Karma discovers specs under the PROJECT ROOT only, so these would leave
 * the run the moment the package moved -- silently, with the suite still
 * reporting SUCCESS. `npm run lint:specs` keeps this list honest.
 */
import '../../../image-editor-angular/src/components/coolms-image-editor.keyboard.spec';
