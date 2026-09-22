/**
 * Pulls `@coolms/dtmpl-angular`'s specs into the admin suite.
 *
 * Karma discovers specs under the PROJECT ROOT only, so these would leave
 * the run the moment the package moved -- silently, with the suite still
 * reporting SUCCESS. `npm run lint:specs` keeps this list honest.
 */
import '../../../dtmpl-angular/src/ddoc-document.service.spec';
import '../../../dtmpl-angular/src/provide-dtmpl-editors.spec';
