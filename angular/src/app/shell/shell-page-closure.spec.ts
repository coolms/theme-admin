import { ShellPageClosure } from './shell-page-closure';

/** The page is closed while any one state on it asks for elevation, and open once each has taken its report back. */
describe('ShellPageClosure', () => {
    it('is closed while any state reports it, once per state, and open when every state has taken it back', () => {
        const closure = new ShellPageClosure();
        const list = {};
        const panel = {};
        expect(closure.closed()).toBeFalse();

        closure.close(list);
        closure.close(list);
        closure.close(panel);
        expect(closure.closed()).toBeTrue();

        closure.open(list);
        expect(closure.closed()).withContext('the panel still asks').toBeTrue();
        closure.open(panel);
        expect(closure.closed()).toBeFalse();
    });

    it('ignores taking back a report it never had', () => {
        const closure = new ShellPageClosure();
        closure.open({});
        expect(closure.closed()).toBeFalse();
    });
});
