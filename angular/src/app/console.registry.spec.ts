import { assembleConsole, CONSOLE_CONTRACT } from '@coolms/core-angular';
import { CONSOLE_BUILT, CONSOLE_ENTRIES } from './console.registry';

/**
 * The registry scripts/assemble-console.mjs generated, checked the one way
 * the script cannot: with the entries evaluated. The script refuses ranges,
 * unknown modules and duplicate files from the text; collisions between
 * entries (a path, a binding name, a top-bar id, a port claimed twice) need
 * the objects, and `assembleConsole` refuses those by name -- here before the
 * bundle ships, and again at bootstrap.
 */
describe('the console registry', () => {
 it('assembles: no two modules claim one path, name, id or port, and every range meets this contract', () => {
        expect(() => assembleConsole(CONSOLE_ENTRIES)).not.toThrow();
    });

 it('was built for the contract this core-angular declares', () => {
        expect<string>(CONSOLE_BUILT.contract).toBe(CONSOLE_CONTRACT.name);
        expect<string>(CONSOLE_BUILT.version).toBe(CONSOLE_CONTRACT.version);
        expect<number>(CONSOLE_BUILT.entries).toBe(CONSOLE_ENTRIES.length);
    });
});
