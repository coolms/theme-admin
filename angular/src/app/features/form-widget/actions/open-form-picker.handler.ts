import { Injectable } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import type { EditorActionContext, EditorActionHandler } from '@coolms/editor-angular';
import { FormPickerComponent } from '../form-picker.component';

/**
 * Handles the `form.openPicker` editor action (dispatched by the backend
 * `block:form` toolbar/slash contributor). Opens the form picker; on selection
 * inserts a `formWidget` node, which round-trips to `{widget:form formId=…}`.
 *
 * Dialog is fetched lazily through `ctx.injector.get(Dialog)` so the handler
 * stays construction-light and testable (mirrors OpenLinkPickerHandler).
 */
@Injectable()
export class OpenFormPickerHandler implements EditorActionHandler {
    async execute(
        _params: Readonly<Record<string, unknown>>,
        ctx: EditorActionContext,
    ): Promise<void> {
        const dialog = ctx.injector.get(Dialog);
        const ref = dialog.open<string | null>(FormPickerComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        const formId = await firstValueFrom(ref.closed);
        if (!formId) return; // cancelled

        ctx.editor.chain().focus().insertFormWidget({ formId, formName: formId }).run();
    }
}
