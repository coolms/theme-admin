// Copied from @coolms/editor-client's own specs (src/fit-zoom.spec.ts, source commit 99d1aec), imports
// pointed at the installed package: they run in the admin's suite against what npm serves, through
// src/editor-client-specs.spec.ts. Refresh the copy when the client's spec changes.
import { ZOOM_MAX, ZOOM_MIN, fitZoomFor } from '@coolms/editor-client';

/**
 * What "Fit" means.
 *
 * The reported bug was not that the number was slightly off -- it was that fit
 * REFUSED to magnify, so the control said Fit while the page sat at actual size
 * in a pane half again as wide. These pin the direction, not just the value.
 */
describe('fitZoomFor', () => {
    /** Letter landscape, the page the report was made against. */
    const LETTER_LANDSCAPE = 1056;

    it('shrinks a page too wide for the pane', () => {
        expect(fitZoomFor(603, LETTER_LANDSCAPE)).toBeCloseTo(0.571, 3);
    });

    it('MAGNIFIES a page the pane has room for', () => {
        //  The fix. Capped at 1 this returned 1, and the page stayed at actual
        // size in a pane 80% wider than it -- with the control reading "Fit".
        expect(fitZoomFor(1900, LETTER_LANDSCAPE)).toBeCloseTo(1.799, 3);
    });

    it('fills exactly, so the page is the width of the pane', () => {
        // The property that makes it a FIT: paper x zoom === available.
        const zoom = fitZoomFor(1400, LETTER_LANDSCAPE);
        expect(LETTER_LANDSCAPE * zoom).toBeCloseTo(1400, 6);
    });

    it('stops at the editor ceiling rather than magnifying without limit', () => {
        // A business-card page on a wall-sized pane.
        expect(fitZoomFor(4000, 120)).toBe(ZOOM_MAX);
    });

    it('has NO floor, so a narrow pane still shows the whole page', () => {
        // Below the minimum an author may choose, and deliberately so: clamping
        // here would let the page overflow, which is the one thing the paged
        // canvas exists to prevent.
        const zoom = fitZoomFor(100, LETTER_LANDSCAPE);
        expect(zoom).toBeLessThan(ZOOM_MIN);
        expect(LETTER_LANDSCAPE * zoom).toBeCloseTo(100, 6);
    });

    it('renders at actual size when nothing has been measured yet', () => {
        // A pane that has not been laid out reports 0. Dividing by it, or by a
        // paper width of 0, would put Infinity or NaN into a CSS variable.
        expect(fitZoomFor(0, LETTER_LANDSCAPE)).toBe(1);
        expect(fitZoomFor(900, 0)).toBe(1);
        expect(fitZoomFor(-40, LETTER_LANDSCAPE)).toBe(1);
    });
});
