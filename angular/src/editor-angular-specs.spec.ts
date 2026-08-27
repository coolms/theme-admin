/**
 * Pulls `@coolms/editor-angular`'s specs into the admin suite.
 *
 * Karma discovers spec files under the PROJECT ROOT only, so these 4 left the
 * run the moment the editor became a package -- silently, and with the suite
 * still reporting SUCCESS. `npm run lint:specs` is what keeps this list honest;
 * add a spec to the package and add it here, or let the check tell you that you
 * did not.
 */
import '../../../editor-angular/src/lib/document-schema-round-trip.spec';
import '../../../editor-angular/src/lib/extensions/embed/embed-widget-transform.spec';
import '../../../editor-angular/src/lib/extensions/footnote/footnote-ids.spec';
import '../../../editor-angular/src/lib/extensions/paste-cleanup/paste-cleanup.spec';
import '../../../editor-angular/src/lib/extensions/slash-menu/slash-command-filter.spec';
import '../../../editor-angular/src/lib/fit-zoom.spec';
import '../../../editor-angular/src/lib/page-frame.spec';
import '../../../editor-angular/src/lib/pagination/document-fonts.spec';
import '../../../editor-angular/src/lib/pagination/flow-blocks.spec';
import '../../../editor-angular/src/lib/pagination/pagination-extension.spec';
import '../../../editor-angular/src/lib/pagination/repeated-headers.spec';
