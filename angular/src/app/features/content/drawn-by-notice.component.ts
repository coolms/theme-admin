import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * "Drawn by" as `/content/landing-blocks` answers it (decided 2026-10-20: which pipeline and which frame draw a page,
 * said where an editor works on it; answered by the module that renders, from the renderer's own pieces).
 */
export interface DrawnByDto {
    /** `frame` -- a frame draws the page through `{content}`; `template` -- the old template pipeline. */
    readonly path: 'frame' | 'template' | string;
    readonly frame?: string | null;
    /** `page` | `directory` | `section_root` | `theme` | `fallback` */
    readonly origin?: string | null;
    /** The VFS path of the node that named the frame (page or directory), when one did. */
    readonly namedBy?: string | null;
    /** Whether that frame draws the page's content at all (it holds a `{content}` tag). */
    readonly hasContent?: boolean | null;
    /** The content renderer the page's type names; null when nothing renders that type. */
    readonly content?: string | null;
    /** How many of the section's framed pages this frame draws, of `pages`. */
    readonly sharedBy?: number | null;
    readonly pages?: number | null;
    /** On the template pipeline: the page template it resolves to. */
    readonly template?: string | null;
}

/** What the editor is told, worked out once from the answer. */
export interface DrawnByView {
    readonly tone: 'info' | 'warning';
    readonly text: string;
    readonly detail: string | null;
}

/**
 * The page editor's "drawn by" line. Quiet when the page's frame draws its content; a warning when an edit would not
 * show -- the frame has no `{content}`, or nothing renders the page's content type -- so no editor edits something
 * that never renders. The test is whether the frame DRAWS the content, not whether one is named. On the old template
 * pipeline it names the template, and claims nothing it was not told.
 */
@Component({
    selector: 'app-drawn-by-notice',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (view(); as v) {
            <div class="drawn-by" [class.drawn-by--warning]="v.tone === 'warning'"
                 [attr.role]="v.tone === 'warning' ? 'alert' : 'note'">
                <i class="bi" [class.bi-exclamation-triangle]="v.tone === 'warning'"
                   [class.bi-layout-text-window]="v.tone === 'info'" aria-hidden="true"></i>
                <span class="drawn-by__text">
                    {{ v.text }}
                    @if (v.detail) {
                        <span class="drawn-by__detail">{{ v.detail }}</span>
                    }
                </span>
            </div>
        }
    `,
    styles: [`
        .drawn-by {
            display: flex; align-items: flex-start; gap: 8px;
            margin: 0 0 8px; padding: 6px 10px; border-radius: var(--cms-radius-sm, 4px);
            background: var(--cms-surface-muted); color: var(--cms-text-secondary); font-size: .8125rem;
        }
        .drawn-by--warning {
            border: 1px solid var(--cms-border);
            background: var(--cms-warning-light); color: var(--cms-warning-text);
        }
        .drawn-by__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
        .drawn-by__detail { opacity: .85; }
    `],
})
export class DrawnByNoticeComponent {
    readonly drawing = input<DrawnByDto | null | undefined>(null);

    readonly view = computed<DrawnByView | null>(() => describeDrawing(this.drawing()));
}

/** The sentence for an answer; null when there is nothing to say (no answer, or one of a shape not known here). */
export function describeDrawing(d: DrawnByDto | null | undefined): DrawnByView | null {
    if (!d) {
        return null;
    }
    if (d.path === 'template') {
        return d.template
            ? {
                tone: 'info',
                text: `Drawn by the template ${d.template}, not by a frame.`,
                detail: 'This page is still on the template pipeline.',
            }
            : null;
    }
    if (d.path !== 'frame' || !d.frame) {
        return null;
    }
    const where = originText(d.origin, d.namedBy);
    if (d.hasContent === false) {
        return {
            tone: 'warning',
            text: `This page is drawn by ${d.frame}, which does not draw the page's content: edits to its content `
                + 'will not show.',
            detail: where,
        };
    }
    if (!d.content) {
        return {
            tone: 'warning',
            text: `Drawn by ${d.frame}, but nothing renders this page's content type: edits to its content will not `
                + 'show.',
            detail: where,
        };
    }
    const shared = typeof d.sharedBy === 'number' && typeof d.pages === 'number' && d.pages > 1
        ? `; this frame draws ${d.sharedBy} of the section's ${d.pages} pages`
        : '';
    return {
        tone: 'info',
        text: `Drawn by ${d.frame}, its content by ${d.content}.`,
        detail: where ? `${where}${shared}.` : (shared ? `${shared.slice(2, 3).toUpperCase()}${shared.slice(3)}.` : null),
    };
}

function originText(origin: string | null | undefined, namedBy: string | null | undefined): string | null {
    switch (origin) {
        case 'page':
            return 'The frame is set on this page';
        case 'directory':
            return namedBy ? `The frame is inherited from ${namedBy}` : 'The frame is inherited from a folder';
        case 'section_root':
            return "The frame is the section's own";
        case 'theme':
            return "The frame is the theme's default";
        case 'fallback':
            return "The theme has no default frame: the platform's plain one draws it";
        default:
            return null;
    }
}
