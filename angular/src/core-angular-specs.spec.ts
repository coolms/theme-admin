/**
 * Pulls @coolms/core-angular's specs into the admin suite.
 *
 * The karma builder discovers spec files under the PROJECT ROOT only, and
 * its `include` option will not climb above it -- so when core moved to
 * packages/core-angular its 3 specs left the run SILENTLY, taking the
 * suite from 656 to 623 while still reporting SUCCESS. Importing them from
 * a file that IS under the root registers their `describe` blocks the
 * moment the bundle is evaluated.
 *
 * Delete this once the package builds and tests itself (ng-packagr + its own
 * devDependencies). Until then, this file is what keeps them honest -- if you
 * add a spec to the package, add it here.
 */
import '../../../core-angular/src/interceptors/section.interceptor.spec';
import '../../../core-angular/src/navi-graph/navi-graph.service.spec';
import '../../../core-angular/src/theme/theme.service.spec';
