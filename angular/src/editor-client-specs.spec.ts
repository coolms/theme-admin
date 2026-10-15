/**
 * Runs @coolms/editor-client's own browser specs in the admin's suite, against the INSTALLED package: the
 * client's repository has no browser runner yet, and a spec that runs nowhere is a check that cannot fail. The
 * copies live in src/editor-client/ under a suffix karma does not discover by itself, so they run here, once,
 * counted as editor-client's. `npm run lint:specs` keeps this list equal to the copies on disk.
 */
import './spec-origin/editor-client';
import './editor-client/document-schema-round-trip.client-spec';
import './editor-client/extensions/embed/embed-widget-transform.client-spec';
import './editor-client/extensions/footnote/footnote-ids.client-spec';
import './editor-client/extensions/paste-cleanup/paste-cleanup.client-spec';
import './editor-client/extensions/slash-menu/slash-command-filter.client-spec';
import './editor-client/fit-zoom.client-spec';
import './editor-client/pagination/document-fonts.client-spec';
import './editor-client/pagination/flow-blocks.client-spec';
import './editor-client/pagination/pagination-extension.client-spec';
import './editor-client/pagination/repeated-headers.client-spec';

import { endSpecOrigin } from './spec-origin/record';

endSpecOrigin();
