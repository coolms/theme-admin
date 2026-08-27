import { Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import type { Editor } from '@tiptap/core';
import type { EditorActionContext, EditorActionHandler } from '@coolms/editor-angular';
import { LinkPickerHostComponent } from '../link-picker-host.component';
import type {
    LinkPickerHostData, LinkPickerHostResult,
} from '../types/link-picker.types';
import type { LinkTargetType, LinkWidgetAttrs } from '../types/link-widget.types';
import { LinkPickerRecentService } from '../services/link-picker-recent.service';

interface ExistingLink {
    readonly target: { readonly type: LinkTargetType; readonly identifier: string };
    readonly config: {
        readonly label?: string;
        readonly target?: '_self' | '_blank';
        readonly rel?: string | null;
        readonly className?: string | null;
        readonly useLatestLabel?: boolean;
    };
    /** ProseMirror position of the existing linkWidget node. */
    readonly position: number;
}

/**
 * Handles `editor.openLinkPicker`. Replaces the legacy inline URL prompt
 * (`editor.openLinkDialog`) with the 3-tab LinkPickerHost (B2).
 *
 * Flow:
 *   1. Detect a linkWidget node at the current cursor position. When
 *      present, the picker opens pre-selected on that target so the user
 *      edits in place rather than inserting a duplicate.
 *   2. Open the picker dialog. The result shape (LinkPickerHostResult)
 *      mirrors LinkWidgetAttrs.
 *   3. Insert (new) or replace (edit) via Tiptap's `insertLink` command
 *      contributed by B1's LinkWidget node.
 *   4. On successful insert, record the chosen target in the recent
 *      LRU. Cancellation returns null and skips the LRU update.
 *
 * Dialog is fetched lazily through `ctx.injector.get(Dialog)` so the
 * handler stays testable without importing CDK at construction time.
 */
@Injectable()
export class OpenLinkPickerHandler implements EditorActionHandler {
    private readonly recent = inject(LinkPickerRecentService);

    async execute(
        _params: Readonly<Record<string, unknown>>,
        ctx: EditorActionContext,
    ): Promise<void> {
        const dialog = ctx.injector.get(Dialog);
        const existing = this.detectExistingLink(ctx.editor);

        const data: LinkPickerHostData = {
            initialTab: this.initialTabFor(existing),
            initialTarget: existing?.target,
            initialConfig: existing?.config,
        };

        const ref = dialog.open<LinkPickerHostResult | null>(LinkPickerHostComponent, {
            data,
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        const result = await firstValueFrom(ref.closed);
        if (!result) return; // cancelled

        const attrs: LinkWidgetAttrs = {
            targetType:     result.type,
            targetId:       result.identifier,
            label:          result.label,
            target:         result.target,
            rel:            result.rel,
            className:      result.className,
            routeParams:    result.routeParams,
            useLatestLabel: result.useLatestLabel,
        };

        if (existing) {
            // Replace the existing linkWidget at its known position. The
            // chain selects the node, deletes it, then inserts the new
            // widget at the same position so cursor placement after insert
            // matches authorial intent.
            ctx.editor.chain()
                .focus()
                .setNodeSelection(existing.position)
                .deleteSelection()
                .insertLink(attrs)
                .run();
        } else {
            ctx.editor.chain().focus().insertLink(attrs).run();
        }

        this.recent.record({
            type:       result.type,
            identifier: result.identifier,
            label:      result.label,
        });
    }

    /**
     * Probe the current selection for a linkWidget node. Returns null when
     * the cursor is not on (or directly adjacent to) such a node, in which
     * case the picker opens in fresh-insert mode.
     *
     * Two checks: (1) NodeSelection on a linkWidget; (2) cursor immediately
     * after a linkWidget atom (typical when user just inserted one and
     * clicked the toolbar to edit).
     */
    private detectExistingLink(editor: Editor): ExistingLink | null {
        const sel = editor.state.selection;

        const direct = (sel as { node?: { type: { name: string }; attrs: LinkWidgetAttrs } }).node;
        if (direct && direct.type.name === 'linkWidget') {
            return this.fromAttrs(direct.attrs, sel.from);
        }

        const before = editor.state.doc.nodeAt(Math.max(0, sel.from - 1));
        if (before && before.type.name === 'linkWidget') {
            return this.fromAttrs(before.attrs as LinkWidgetAttrs, sel.from - 1);
        }

        return null;
    }

    private fromAttrs(attrs: LinkWidgetAttrs, position: number): ExistingLink {
        return {
            target: {
                type:       attrs.targetType,
                identifier: attrs.targetId,
            },
            config: {
                label:          attrs.label,
                target:         attrs.target === '_blank' ? '_blank' : '_self',
                rel:            attrs.rel,
                className:      attrs.className,
                useLatestLabel: attrs.useLatestLabel,
            },
            position,
        };
    }

    private initialTabFor(existing: ExistingLink | null): LinkPickerHostData['initialTab'] {
        if (!existing) return 'internal';
        return existing.target.type === 'url' || existing.target.type === 'route'
            ? 'external'
            : 'internal';
    }
}
