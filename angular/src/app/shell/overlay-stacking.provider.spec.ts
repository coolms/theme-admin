import { Dialog } from '@angular/cdk/dialog';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { provideOverlayStacking } from './overlay-stacking.provider';

@Component({ standalone: true, template: '<p>dialog</p>' })
class PlainDialogComponent {}

/**
 * A CDK dialog must open in the page's overlay container, not in the browser's top layer: a top-layer dialog covers
 * every z-index, and the admin's toasts, context menu and call overlays sit above dialogs by z-index. The case reads
 * the DOM the browser lays out -- the `popover` attribute is what puts an element in the top layer.
 */
describe('provideOverlayStacking', () => {
    let refs: Array<{ close(): void }>;

    beforeEach(() => {
        refs = [];
        TestBed.configureTestingModule({ providers: [provideOverlayStacking()] });
    });

    afterEach(() => refs.forEach(r => r.close()));

    it('opens a dialog in the overlay container, not as a top-layer popover', () => {
        refs.push(TestBed.inject(Dialog).open(PlainDialogComponent));

        expect(document.querySelectorAll('[popover]').length).toBe(0);
        expect(document.querySelector('.cdk-overlay-container .cdk-overlay-pane')).not.toBeNull();
    });

    it('opens a dialog from inside another above it', () => {
        const dialog = TestBed.inject(Dialog);
        refs.push(dialog.open(PlainDialogComponent), dialog.open(PlainDialogComponent));

        const panes = [...document.querySelectorAll('.cdk-overlay-container .cdk-overlay-pane')];
        expect(panes.length).toBe(2);
        // Same container, appended in order: the second pane's host follows the first's.
        const [first, second] = panes.map(p => p.parentElement!);
        expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
