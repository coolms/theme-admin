/**
 * Pulls `@coolms/pdf-angular`'s specs into the admin suite.
 *
 * Karma discovers specs under the PROJECT ROOT only, so these would leave
 * the run the moment the package moved -- silently, with the suite still
 * reporting SUCCESS. `npm run lint:specs` keeps this list honest.
 */
import './spec-origin/pdf-angular';
import '../../../pdf-angular/src/pdf-safety.spec';

import { endSpecOrigin } from './spec-origin/record';

endSpecOrigin();
