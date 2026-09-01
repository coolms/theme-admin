/**
 * Pulls `@coolms/ui-angular`'s specs into the admin suite.
 *
 * The karma builder discovers spec files under the PROJECT ROOT only, and its
 * `include` will not climb above it -- an `../../ui-angular/**` glob is
 * accepted and silently matches nothing. So when the kit moved out of
 * src/app/shared the 23 spec files it had then left the run without a word,
 * taking the suite from 656 to 375 while still reporting SUCCESS. (Two of them
 * have since moved on again, into `@coolms/sheet-editor-angular`.) Importing
 * them from a
 * file that IS under the root registers their `describe` blocks when the
 * bundle is evaluated.
 *
 * This list is hand-maintained and would rot in exactly the same silence, so
 * `npm run lint:specs` compares it against the files on disk and fails if they
 * disagree. Add a spec to the package, add it here -- or let the check tell
 * you that you did not.
 */
import '../../../ui-angular/src/datagrid/datagrid-empty-state.spec';
import '../../../ui-angular/src/datagrid/datagrid-keyboard-overlay.spec';
import '../../../ui-angular/src/datagrid/datagrid-range-filters.spec';
import '../../../ui-angular/src/dynamic-form/dynamic-form-readonly-fields.spec';
import '../../../ui-angular/src/dynamic-form/fields/relation-field.component.spec';
import '../../../ui-angular/src/dynamic-form/fields/select-field.component.spec';
import '../../../ui-angular/src/ui/dialog/input-dialog.component.spec';
import '../../../ui-angular/src/ui/dialog/native-dialog.service.spec';
import '../../../ui-angular/src/ui/directory-picker/cms-directory-picker.component.spec';
import '../../../ui-angular/src/ui/dropzone/cms-dropzone.directive.spec';
import '../../../ui-angular/src/ui/dtmpl-token-input/cms-dtmpl-token-input.component.spec';
import '../../../ui-angular/src/ui/esc-coordinator/esc-coordinator.service.spec';
import '../../../ui-angular/src/ui/explorer-accordion/space-selection.store.spec';
import '../../../ui-angular/src/ui/filter-builder/cms-filter-builder.component.spec';
import '../../../ui-angular/src/ui/item-interactions/cms-item-interactions.directive.spec';
import '../../../ui-angular/src/ui/layout-actions.service.spec';
import '../../../ui-angular/src/ui/lazy-select/lazy-select.component.spec';
import '../../../ui-angular/src/ui/page-toolbar.component.spec';
import '../../../ui-angular/src/ui/range-picker/prefs-format.spec';
import '../../../ui-angular/src/ui/tree-picker/cms-tree-picker.component.spec';
import '../../../ui-angular/src/ui/wizard/cms-wizard.component.spec';
import '../../../ui-angular/src/util/user-calendar-preferences.service.spec';
