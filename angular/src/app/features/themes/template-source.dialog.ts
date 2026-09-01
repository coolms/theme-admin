import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    ViewChild,
    inject,
    signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { ModalComponent, ToastService } from '@coolms/ui-angular';
import { ThemesService } from './themes.service';

export interface TemplateSourceData {
    readonly slug: string;
    readonly path: string;
}

/**
 * Read-only source view for one theme template.
 *
 * ## Why not reuse `CodeEditorComponent`
 *
 * That component is the VFS file editor: it takes a `VfsNodeDto`, saves back
 * through the VFS API and owns dirty/save state. A theme template is a file
 * inside an installed PACKAGE — there is no node, and nothing here may be
 * written (editing a package in place is what slice 3's override-to-VFS
 * exists to avoid). Threading a second source-and-save contract through a
 * working editor to get a read-only pane would make both harder to follow, so
 * this is a viewer, and it says so.
 *
 * ## Fixed body height, on purpose
 *
 * Templates range from a two-line partial to several hundred lines. A dialog
 * sized to its content jumps every time you open a different one — the same
 * complaint the VFS picker drew. The body is pinned so the frame never moves
 * and the editor scrolls inside it. `min-height: 0` on the flex child is what
 * actually lets CodeMirror scroll rather than push the dialog taller.
 */
@Component({
    selector: 'app-template-source',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent],
    template: `
        <app-modal [title]="data.slug + ' — ' + data.path" [width]="900">
            <div class="src">
                @if (error()) {
                    <p class="src__state src__state--error">{{ error() }}</p>
                } @else {
                    <!-- Host stays mounted while loading so CodeMirror has a
                         node to attach to the moment the source lands. -->
                    <div class="src__editor" #host></div>
                    @if (loading()) {
                        <p class="src__state">Loading source…</p>
                    }
                }
            </div>

            <div footer class="src__footer">
                <span class="src__meta">
                    @if (bytes() !== null) {
                        {{ bytes() }} bytes ·
                        @if (origin() === 'override') {
                            <strong class="src__badge">overridden</strong> — this VFS copy is what renders
                        } @else {
                            shipped by the theme package · read-only
                        }
                    }
                </span>
                <div class="src__actions">
                    @if (origin() === 'override') {
                        <button type="button" class="cms-btn cms-btn-danger"
                                [disabled]="busy()"
                                title="Delete the VFS copy; the packaged template serves again"
                                (click)="revert()">Revert to package</button>
                    } @else if (canOverride()) {
                        <button type="button" class="cms-btn cms-btn-primary"
                                [disabled]="busy()"
                                title="Copy this template into the VFS, where it can be edited and outranks the package"
                                (click)="override()">Override…</button>
                    }
                    <button type="button" class="cms-btn" (click)="close()">Close</button>
                </div>
            </div>
        </app-modal>
    `,
    styles: [`
        :host { display: contents; }

        .src {
            display: flex;
            flex-direction: column;
            /* Pinned: min == max so the frame cannot resize between templates. */
            height: 60vh;
            min-height: 0;
        }
        /* Without min-height:0 the flex child refuses to shrink and CodeMirror
           grows the dialog instead of scrolling. */
        .src__editor { flex: 1 1 auto; min-height: 0; overflow: hidden; border-radius: var(--cms-radius, 6px); }
        /* CodeMirror builds .cm-editor imperatively, so it carries no emulated-
           encapsulation attribute — pierce with :host ::ng-deep, which MUST
           lead with :host (same rule as the VFS code editor). */
        :host ::ng-deep .cm-editor { height: 100%; }

        .src__state { margin: 0; padding: 12px 2px; color: var(--cms-text-secondary, #6b7280); font-size: 13px; }
        .src__state--error { color: var(--cms-danger, #dc2626); }

        .src__footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; }
        .src__meta { color: var(--cms-text-secondary, #6b7280); font-size: 12px; }
        .src__badge { color: var(--cms-primary, #2563eb); }
        .src__actions { display: flex; gap: 8px; flex-shrink: 0; }
    `],
})
export class TemplateSourceDialog implements AfterViewInit, OnDestroy {
    readonly data = inject<TemplateSourceData>(DIALOG_DATA);

    private readonly ref   = inject<DialogRef<void>>(DialogRef);
    private readonly svc   = inject(ThemesService);
    private readonly toast = inject(ToastService);

    @ViewChild('host') private hostRef?: ElementRef<HTMLElement>;

    readonly loading     = signal(true);
    readonly busy        = signal(false);
    readonly error       = signal<string | null>(null);
    readonly bytes       = signal<number | null>(null);
    readonly origin      = signal<'package' | 'override'>('package');
    readonly canOverride = signal(false);

    private view?: EditorView;

    ngAfterViewInit(): void {
        this.load();
    }

    /**
     * Copy the packaged template into VFS, then re-read.
     *
     * Re-reading rather than assuming: the source view must keep showing what
     * RENDERS, and only the server knows whether the copy actually landed.
     */
    override(): void {
        this.busy.set(true);
        this.svc.createOverride(this.data.slug, this.data.path).subscribe({
            next: res => {
                this.busy.set(false);
                this.toast.success(`Override created at ${res.vfsPath}. Edit it in the File System.`);
                this.load();
            },
            error: err => this.fail(err, 'Could not create the override.'),
        });
    }

    revert(): void {
        this.busy.set(true);
        this.svc.revertOverride(this.data.slug, this.data.path).subscribe({
            next: () => {
                this.busy.set(false);
                this.toast.success('Reverted — the packaged template serves again.');
                this.load();
            },
            error: err => this.fail(err, 'Could not revert the override.'),
        });
    }

    private load(): void {
        this.loading.set(true);
        this.svc.templateSource(this.data.slug, this.data.path).subscribe({
            next: src => {
                this.bytes.set(src.bytes);
                this.origin.set(src.origin);
                this.canOverride.set(src.canOverride);
                this.loading.set(false);
                this.mount(src.content);
            },
            error: err => {
                this.loading.set(false);
                // `detail` or the toast is generic — the API sends the reason
                // there, and "Template not found in this theme." is the whole
                // point of asking.
                this.error.set(err?.error?.detail ?? 'Could not read this template.');
            },
        });
    }

    /** Actions report through the toast; the banner is for load failures. */
    private fail(err: unknown, fallback: string): void {
        this.busy.set(false);
        const detail = (err as { error?: { detail?: string } })?.error?.detail;
        this.toast.error(detail ?? fallback);
    }

    ngOnDestroy(): void {
        this.view?.destroy();
    }

    close(): void {
        this.ref.close();
    }

    private mount(content: string): void {
        const parent = this.hostRef?.nativeElement;
        if (!parent) return;

        // Re-mounting after an override/revert: drop the previous instance
        // rather than stacking a second editor inside the same host.
        this.view?.destroy();

        this.view = new EditorView({
            parent,
            state: EditorState.create({
                doc: content,
                extensions: [
                    lineNumbers(),
                    highlightActiveLine(),
                    // DTMPL is HTML with `{...}` tags — HTML highlighting is
                    // the closest honest fit, and beats none at all.
                    html(),
                    oneDark,
                    // The dialog is a viewer: readOnly blocks the document,
                    // editable:false also drops the caret and edit affordances,
                    // so it doesn't LOOK writable either.
                    EditorState.readOnly.of(true),
                    EditorView.editable.of(false),
                    EditorView.lineWrapping,
                ],
            }),
        });
    }
}
