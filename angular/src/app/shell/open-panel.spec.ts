import { of } from 'rxjs';
import { type ElevationService } from '@coolms/core-angular';
import { togglePanelByRule } from './open-panel';

/**
 * The panel's toggle and its keyboard shortcut, by the navigation rule (2026-10-13): nothing where the menu has no
 * item that opens it, elevation first where that item is locked, at once where it is allowed.
 */
describe('togglePanelByRule', () => {
    let asks: number;
    let granted: boolean;
    let elevated: boolean;
    let toggled: number;
    let elevation: ElevationService;
    const toggle = (): void => { toggled++; };

    beforeEach(() => {
        asks = 0;
        granted = true;
        elevated = false;
        toggled = 0;
        elevation = {
            offerFor: () => { asks++; if (granted) { elevated = true; } return of(granted); },
            elevated: () => elevated,
        } as unknown as ElevationService;
    });

    it('does nothing, and does not claim the key, where the account has no item that opens the panel', () => {
        expect(togglePanelByRule(null, false, elevation, toggle)).toBeFalse();
        expect([toggled, asks]).toEqual([0, 0]);
    });

    it('opens an allowed panel at once', () => {
        expect(togglePanelByRule('allowed', false, elevation, toggle)).toBeTrue();
        expect([toggled, asks]).toEqual([1, 0]);
    });

    it('asks for elevation before it opens a locked panel, and opens it on the grant', () => {
        expect(togglePanelByRule('elevate', false, elevation, toggle)).toBeTrue();
        expect([toggled, asks]).toEqual([1, 1]);
    });

    it('opens nothing when the person declines', () => {
        granted = false;
        togglePanelByRule('elevate', false, elevation, toggle);
        expect([toggled, asks]).toEqual([0, 1]);
    });

    it('closes an open locked panel without asking: closing needs nothing', () => {
        togglePanelByRule('elevate', true, elevation, toggle);
        expect([toggled, asks]).toEqual([1, 0]);
    });
});
