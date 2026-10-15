// Copied from @coolms/editor-client's own specs (src/extensions/footnote/footnote-ids.spec.ts, source commit 99d1aec), imports
// pointed at the installed package: they run in the admin's suite against what npm serves, through
// src/editor-client-specs.spec.ts. Refresh the copy when the client's spec changes.
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';

import {
    FootnoteReferenceNode,
    footnoteIdsInDocument,
    nextFootnoteId,
} from '@coolms/editor-client';

/**
 * Which note a new marker points at.
 *
 * The handler cannot see the note BODIES -- they live in the `.ddoc` the dialog
 * holds -- so it allocates from the references it can see. Every case below is a
 * way that allocation could hand out an id somebody is already using.
 */
describe('footnote ids in a document', () => {
    let element: HTMLElement;

    const editor = (html: string): Editor => new Editor({
        element,
        extensions: [Document, Paragraph, Text, FootnoteReferenceNode],
        content: html,
    });

    beforeEach(() => {
        element = document.createElement('div');
        document.body.appendChild(element);
    });

    afterEach(() => element.remove());

    it('reads the ids in document order', () => {
        const found = footnoteIdsInDocument(
            editor('<p>a<sup data-footnote="7">7</sup></p><p>b<sup data-footnote="2">2</sup></p>').state.doc,
        );

        expect(found).toEqual([7, 2]);
    });

    it('reports an id once however many markers point at it', () => {
        const found = footnoteIdsInDocument(
            editor('<p><sup data-footnote="3">3</sup><sup data-footnote="3">3</sup></p>').state.doc,
        );

        expect(found).toEqual([3]);
    });

    it('starts at one in a document with no notes', () => {
        expect(nextFootnoteId(editor('<p>plain</p>').state.doc)).toBe(1);
    });

    /**
     *  One more than the HIGHEST, not one more than the count. Deleting the
     * second of three markers would make a count-based rule hand out 3 again,
     * and the new marker would land on a note that is still there -- the seam
     * keeps a body whose reference has gone.
     */
    it('takes one more than the highest id, not one more than the count', () => {
        const doc = editor(
            '<p><sup data-footnote="1">1</sup><sup data-footnote="3">3</sup></p>',
        ).state.doc;

        expect(nextFootnoteId(doc)).toBe(4);
    });

    /**
     * A marker naming a reserved id is not a reference: OOXML keeps -1 and 0
     * for the two separator notes, so one of those points at a horizontal rule.
     */
    it('ignores an id below one in parsed markup', () => {
        const doc = editor('<p><sup data-footnote="0">0</sup></p>').state.doc;

        expect(footnoteIdsInDocument(doc)).toEqual([]);
        expect(nextFootnoteId(doc)).toBe(1);
    });

    /**
     *  And the same for a node built PROGRAMMATICALLY, which is the only way
     * the reader's own guard can be reached -- and the reason it is not dead
     * code. `parseHTML` already refuses a reserved id, so a test that went
     * through markup could not tell whether this reader checks at all: found by
     * mutation, where gutting the check left the markup-driven test green.
     *
     * Attributes are not validated by ProseMirror, so `insertContent` -- which
     * is how the toolbar's own handler inserts -- can carry anything a caller
     * passes it.
     */
    it('ignores an id below one on a node that was not parsed', () => {
        const instance = editor('<p>a</p>');
        const reference = instance.schema.nodes['footnoteReference']!.create({ id: 0 });
        const doc = instance.state.doc.copy(
            instance.state.doc.content.addToStart(
                instance.schema.nodes['paragraph']!.create(null, reference),
            ),
        );

        expect(footnoteIdsInDocument(doc)).toEqual([]);
    });
});
