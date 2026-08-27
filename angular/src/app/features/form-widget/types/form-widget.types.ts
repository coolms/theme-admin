/**
 * Attribute set for the `formWidget` Tiptap node — the editor representation
 * of a `{widget:form formId=<id>}` dtmpl tag (rendered server-side by the Form
 * module's FormRenderWidgetRenderer).
 *
 *   formId    the form definition id (e.g. `contact`, `dynamic_entity:field_definition`).
 *   formName  display-only label for the in-editor chip; not serialized to the
 *             dtmpl tag (which carries only formId). Defaults to formId on load.
 */
export interface FormWidgetAttrs {
    readonly formId: string;
    readonly formName?: string | null;
}
