import {
    AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter,
    Input, OnInit, Output, ViewChild,
} from '@angular/core';

import { FormsModule } from '@angular/forms';

/**
 * Floating popup that edits the `alt` attribute of a selected MediaWidget
 * Tiptap node. Hosted by the MediaNodeView inside a CDK Overlay positioned
 * above the selected image.
 *
 * Behaviour (matches prompt-tiptap-alt-editor.md):
 *   - Auto-focuses the input on open.
 *   - Save fires on blur OR Enter — emits `save` with the current value.
 *   - Esc reverts to the initial value and emits `cancel` (parent closes
 *     the overlay without applying changes).
 *   - Empty alt is allowed; the renderer then falls back to the asset's
 *     translation, so we just emit the empty string.
 *
 * The component is presentational. The NodeView owns the Tiptap node update
 * via `editor.chain().command(({ tr }) => tr.setNodeAttribute(pos, 'alt', …))`
 * and the overlay lifecycle.
 */
@Component({
    selector: 'app-media-alt-editor',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="alt-editor" (mousedown)="$event.stopPropagation()">
            <label class="alt-editor__label" [for]="inputId">Alt text</label>
            <input #input
                   class="alt-editor__input"
                   type="text"
                   [id]="inputId"
                   [(ngModel)]="value"
                   (keydown.enter)="commit($event)"
                   (keydown.escape)="cancelEdit($event)"
                   (blur)="commit($event)"
                   placeholder="Describe this image" />
            <span class="alt-editor__hint">Enter or click away to save · Esc to cancel</span>
        </div>
    `,
    styles: [`
        :host { display: block; }
        .alt-editor {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 8px 10px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            box-shadow: var(--cms-shadow-md);
            min-width: 260px;
            max-width: 360px;
        }
        .alt-editor__label {
            font-size: .6875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .04em;
            color: var(--cms-text-muted);
            margin: 0;
        }
        .alt-editor__input {
            border: 1px solid var(--cms-btn-border);
            border-radius: var(--cms-radius-sm);
            padding: 4px 8px;
            font-size: .8125rem;
            color: var(--cms-text);
            outline: none;
            transition: border-color .1s, box-shadow .1s;

            &:focus {
                border-color: var(--cms-accent);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--cms-accent) 15%, transparent);
            }
        }
        .alt-editor__hint {
            font-size: .6875rem;
            color: var(--cms-text-muted);
        }
    `],
})
export class MediaAltEditorComponent implements OnInit, AfterViewInit {
    @Input({ required: true }) initialValue!: string;
    @Output() readonly save   = new EventEmitter<string>();
    @Output() readonly cancel = new EventEmitter<void>();

    @ViewChild('input', { static: true })
    private readonly inputRef!: ElementRef<HTMLInputElement>;

    /** Two-way bound to the input's ngModel. */
    value = '';
    /** Per-instance unique id to associate label with input for a11y. */
    readonly inputId = `alt-editor-${Math.random().toString(36).slice(2, 9)}`;

    private committed = false;

    ngOnInit(): void {
        this.value = this.initialValue;
    }

    ngAfterViewInit(): void {
        // Defer focus so the overlay is fully attached to the DOM. Selection
        // of existing alt text gives a quicker edit path for already-set values.
        queueMicrotask(() => {
            const el = this.inputRef.nativeElement;
            el.focus();
            el.select();
        });
    }

    commit(event: Event): void {
        if (this.committed) return;
        this.committed = true;
        // Stop blur/Enter from bubbling back into Tiptap and stealing the focus
        // away from the overlay before we close it ourselves.
        event.stopPropagation();
        this.save.emit(this.value);
    }

    cancelEdit(event: Event): void {
        if (this.committed) return;
        this.committed = true;
        event.stopPropagation();
        event.preventDefault();
        this.cancel.emit();
    }
}
