import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import { CoolmsEditorComponent } from '@coolms/editor-angular';

/** One note, as the panel shows it. */
export interface FootnoteRow {
    readonly id: number;
    readonly html: string;
    /** Nothing in the document points at it any more. */
    readonly orphan: boolean;
    /** Its position among the notes the document DOES point at, or null. */
    readonly number: number | null;
}

/**
 * The document's footnotes, listed and editable — Word's notes pane.
 *
 * ## Why a panel and not the foot of the page
 *
 * Word puts a note at the bottom of the page its reference is on, and our
 * canvas draws no notes at all: the paginator lays out the body, and a note
 * belongs to a page only after the body has been laid out. Word has the same
 * problem in draft view and answers it the same way — a notes pane. So this is
 * the affordance an author already knows, not an invention.
 *
 * ## ⚠️ The number is the POSITION, the id is the KEY
 *
 * Every reader prints a footnote's position, so the panel leads with that and
 * shows the stored id only where the two differ — which is exactly when an
 * author would otherwise be confused by a marker that says one thing and a page
 * that says another. #2295 has the measurement.
 *
 * ## ⚠️ An orphan is shown, never swept up
 *
 * A note whose reference an author deleted keeps its body: the editing seam
 * drops nothing for being unreferenced, because a client that failed to
 * register the reference node would otherwise wipe every note in the document
 * on its first save. So an orphan is real, and the honest thing is to say so
 * and offer a button — a note that quietly disappeared is the failure mode the
 * rule exists to prevent, and a note nobody can see or delete is the other one.
 */
@Component({
    selector: 'app-ddoc-footnotes-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CoolmsEditorComponent],
    template: `
        <div class="ddoc-notes">
            <div class="ddoc-notes__head">
                <span class="ddoc-notes__title">
                    Footnotes
                    @if (rows().length) {
                        <span class="ddoc-notes__count">{{ rows().length }}</span>
                    }
                </span>
                @if (!rows().length) {
                    <span class="ddoc-notes__empty">
                        None yet — the toolbar's footnote button adds one at the caret.
                    </span>
                }
            </div>

            @if (rows().length) {
                <div class="ddoc-notes__list">
                    @for (row of rows(); track row.id) {
                        <button type="button"
                                class="ddoc-notes__chip"
                                [class.ddoc-notes__chip--active]="row.id === selected()"
                                [class.ddoc-notes__chip--orphan]="row.orphan"
                                [title]="row.orphan
                                    ? 'Nothing in the document points at this note any more. It is kept, not deleted.'
                                    : 'Footnote ' + row.number + ' (stored as id ' + row.id + ')'"
                                (click)="selected.set(row.id)">
                            {{ row.orphan ? '—' : row.number }}
                            <span class="ddoc-notes__preview">{{ preview(row.html) }}</span>
                        </button>
                    }
                </div>

                @if (current(); as note) {
                    <div class="ddoc-notes__editor">
                        <!-- Its own profile: a note may hold what a paragraph
                             holds, but not the things a document is BUILT from
                             — a page break inside a note is an instruction
                             about the page it is already at the bottom of. -->
                        <coolms-editor
                            profile="footnote"
                            [content]="note.html"
                            [preserveDocumentFormatting]="true"
                            [contentAdapter]="null"
                            (contentChange)="onBodyChange(note.id, $event)" />
                        <div class="ddoc-notes__actions">
                            @if (note.orphan) {
                                <span class="ddoc-notes__orphan-note">
                                    Nothing points at this note. It is kept until you delete it.
                                </span>
                            }
                            <button type="button" class="cms-btn cms-btn-sm"
                                    title="Delete this note. Its markers, if any, stay and will get an empty note back."
                                    (click)="remove.emit(note.id)">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                }
            }
        </div>
    `,
    styles: [`
        .ddoc-notes {
            border-top: 1px solid var(--cms-border);
            padding: 8px 12px;
            background: var(--cms-surface);
            font-size: .8125rem;
        }
        .ddoc-notes__head { display: flex; align-items: center; gap: 8px; }
        .ddoc-notes__title { font-weight: 600; color: var(--cms-text-body); }
        .ddoc-notes__count {
            display: inline-block;
            min-width: 1.25rem;
            padding: 0 .3rem;
            border-radius: 999px;
            background: var(--cms-border);
            color: var(--cms-text-muted);
            font-size: .6875rem;
            text-align: center;
        }
        .ddoc-notes__empty { color: var(--cms-text-muted); }
        .ddoc-notes__list {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 6px;
        }
        .ddoc-notes__chip {
            display: inline-flex;
            align-items: baseline;
            gap: 6px;
            max-width: 18rem;
            padding: 2px 8px;
            border: 1px solid var(--cms-border);
            border-radius: 4px;
            background: var(--cms-surface);
            color: var(--cms-text-body);
            font: inherit;
            cursor: pointer;
        }
        .ddoc-notes__chip--active { border-color: var(--cms-primary); }
        /* Dimmed, not hidden: an orphan is real and the author has to be able
           to reach it. NO BACKTICKS IN HERE: this is a JS template literal. */
        .ddoc-notes__chip--orphan { color: var(--cms-text-muted); font-style: italic; }
        .ddoc-notes__preview {
            overflow: hidden;
            color: var(--cms-text-muted);
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        /* A note is a sentence or two, so the pane is sized for one and scrolls
           rather than growing: the canvas above it is the document the author
           came to write, and a panel that took half the dialog to show two
           lines of a note would be the wrong way round. */
        .ddoc-notes__editor {
            max-height: 9rem;
            margin-top: 8px;
            overflow: auto;
        }
        .ddoc-notes__actions {
            display: flex;
            align-items: center;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 4px;
        }
        .ddoc-notes__orphan-note { color: var(--cms-text-muted); margin-right: auto; }
    `],
})
export class DdocFootnotesPanelComponent {
    /** Every note the document has, by id, as editor HTML. */
    readonly footnotes = input.required<Record<string, string>>();

    /** The ids the body points at, in document order — the panel's numbering. */
    readonly referenced = input.required<readonly number[]>();

    /** One note's body was edited. */
    readonly bodyChange = output<{ id: number; html: string }>();

    /** One note should go. */
    readonly remove = output<number>();

    readonly selected = signal<number | null>(null);

    readonly rows = computed<readonly FootnoteRow[]>(() => {
        const referenced = this.referenced();
        const footnotes = this.footnotes();

        // Referenced notes first, in DOCUMENT order — the order they print in.
        const rows: FootnoteRow[] = referenced.map((id, index) => ({
            id,
            html: footnotes[String(id)] ?? '',
            orphan: false,
            number: index + 1,
        }));

        // Then whatever the file still holds that nothing points at, by id, so
        // the list is stable rather than in whatever order the map arrived in.
        const orphans = Object.keys(footnotes)
            .map(key => Number.parseInt(key, 10))
            .filter(id => Number.isInteger(id) && !referenced.includes(id))
            .sort((a, b) => a - b);

        for (const id of orphans) {
            rows.push({ id, html: footnotes[String(id)] ?? '', orphan: true, number: null });
        }

        return rows;
    });

    readonly current = computed<FootnoteRow | null>(() => {
        const id = this.selected();
        const rows = this.rows();

        // Falls back to the first note rather than showing nothing: opening the
        // panel with a list and an empty editor reads as broken.
        return rows.find(row => row.id === id) ?? rows[0] ?? null;
    });

    onBodyChange(id: number, html: string): void {
        this.bodyChange.emit({ id, html });
    }

    /**
     * The note's text, for the chip.
     *
     * ⚠️ Parsed, never stripped with a regex: the body is HTML, and a pattern
     * that mangled an entity or an attribute containing `>` would put markup in
     * front of the author.
     *
     * ⚠️ And through `DOMParser`, not a detached `div.innerHTML`. A detached
     * div is not inert — an `<img>` assigned into one still loads, so an
     * `onerror` in a `.ddoc` from somewhere else would run while we were only
     * trying to read the text. `DOMParser` builds a document that loads nothing
     * and executes nothing.
     */
    preview(html: string): string {
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const text = (parsed.body.textContent ?? '').trim();

        return '' === text ? '(empty)' : text;
    }
}
