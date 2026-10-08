import { variableRows, withCallerFillable } from './template-variables.helpers';
import { type ContextSchema } from '../shared/document-explorer.types';

/**
 * The variables panel's two decisions: which rows it shows and which of them offer the "Filled by the caller"
 * switch, and what a flip writes back.
 */
describe('template variables helpers', () => {
    const CUSTOMER = 'Acme\\Shop\\Customer';

    const schema: ContextSchema = {
        variables: [
            { path: 'customer.name', filters: [], loopAlias: null, callerFillable: true },
            { path: 'customer.name', filters: ['upper'], loopAlias: null },
            { path: 'item.title', filters: [], loopAlias: 'item' },
            { path: '@customer', filters: [], loopAlias: null, entityType: CUSTOMER },
            { path: 'metadata.generatedAt', filters: ['date'], loopAlias: null },
            { path: 'metadataNote', filters: [], loopAlias: null },
        ],
        constants: [{ name: 'siteName' }],
        loops: [{ path: 'items', alias: 'item' }],
        conditionals: [],
    };

    it('shows one row per path, marked when any of its entries is', () => {
        const rows = variableRows(schema);

        expect(rows.map((r) => r.path)).toEqual([
            'customer.name',
            'item.title',
            '@customer',
            'metadata.generatedAt',
            'metadataNote',
        ]);
        expect(rows[0].filters).toEqual(['upper']);
        expect(rows[0].callerFillable).toBeTrue();
        expect(rows[1].callerFillable).toBeFalse();
        expect(rows[1].loopAlias).toBe('item');
    });

    it('offers the switch for plain values and loop items only', () => {
        const locked = Object.fromEntries(variableRows(schema).map((r) => [r.path, r.lockedReason]));

        expect(locked['customer.name']).toBeNull();
        expect(locked['item.title']).toBeNull();
        expect(locked['metadataNote']).withContext('a root is a whole segment').toBeNull();
        expect(locked['@customer']).toContain('record');
        expect(locked['metadata.generatedAt']).toBe('Filled by the server.');
    });

    it('switches every entry of a path together, and leaves no key when off', () => {
        const on = withCallerFillable(schema, 'customer.name', false);
        expect(on.variables.filter((v) => v.path === 'customer.name').map((v) => 'callerFillable' in v))
            .toEqual([false, false]);

        const again = withCallerFillable(on, 'customer.name', true);
        expect(again.variables.filter((v) => v.path === 'customer.name').map((v) => v.callerFillable))
            .toEqual([true, true]);
        expect(again.variables.find((v) => v.path === 'item.title')).toEqual(schema.variables[2]);
        expect(again.constants).toBe(schema.constants);
        expect(again.loops).toBe(schema.loops);
    });

    it('shows nothing for a template without a schema', () => {
        expect(variableRows(null)).toEqual([]);
    });
});
