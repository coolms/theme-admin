import { ComponentRegistry } from '@coolms/core-angular';
import { WordDetailComponent } from './word-detail.component';

/**
 * F.14c-1 — registers Word-specific UI components in the global
 * `ComponentRegistry`. The cross-format `DocumentDetailComponent`
 * looks up `'document-detail-word'` via `NgComponentOutlet` to
 * dispatch tile clicks to the right format-specific panel; this
 * function is the single touch-point app.config calls during
 * bootstrap.
 *
 * Adding a future Spreadsheet detail panel mirrors this shape:
 * `ComponentRegistry.register('document-detail-spreadsheet',
 * SpreadsheetDetailComponent)` from a sibling
 * `spreadsheet-detail-registration.ts`. The explorer never has to
 * change.
 */
export function registerWordComponents(): void {
    ComponentRegistry.register('document-detail-word', WordDetailComponent);
}
