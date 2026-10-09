import { callerFillablePaths, onlyCallerFillable } from './caller-fillable.helpers';
import type { ContextSchemaVariable } from '../shared/document-explorer.types';

/**
 * The wizard asks only for the variables the template's author switched on as "Filled by the caller", and sends
 * only those: the server refuses a value at any other path (400).
 */
describe('callerFillablePaths', () => {
    const RECORD = 'Acme\\Crm\\Customer';
    const v = (path: string, extra: Partial<ContextSchemaVariable> = {}): ContextSchemaVariable =>
        ({ path, filters: [], loopAlias: null, ...extra });

    it('lists the switched-on paths, each once, in order, and nothing else', () => {
        const variables = [
            v('customer.name', { callerFillable: true }),
            v('customer.email'),
            v('customer.name', { callerFillable: true, filters: ['upper'] }),
            v('item.title', { loopAlias: 'item', callerFillable: true }),
            v('metadata.generatedAt'),
        ];

        expect(callerFillablePaths(variables)).toEqual(['customer.name', 'item.title']);
    });

    it('never lists an entity reference, whatever its entry says', () => {
        const variables = [v('@identity_user', { entityType: RECORD, callerFillable: true })];

        expect(callerFillablePaths(variables)).toEqual([]);
    });

    it('never lists a path another entry declares a reference, or a path under one, as the server reads them', () => {
        const variables = [
            v('@identity_user', { entityType: RECORD }),
            v('@identity_user', { callerFillable: true }),
            v('@identity_user.email', { callerFillable: true }),
            v('@identity_username', { callerFillable: true }),
        ];

        expect(callerFillablePaths(variables)).toEqual(['@identity_username']);
    });

    it('never lists a path under a root the server fills, even when a stored entry marks it', () => {
        const variables = [
            v('metadata.generatedAt', { callerFillable: true }),
            v('audienceEntityId', { callerFillable: true }),
            v('_const.x', { callerFillable: true }),
            v('metadataNote', { callerFillable: true }),
        ];

        expect(callerFillablePaths(variables)).toEqual(['metadataNote']);
    });
});

describe('onlyCallerFillable', () => {
    const paths = ['customer.name', 'item.title'];

    it('keeps the values at fillable paths and drops the rest, an emptied object included', () => {
        const draft = {
            customer: { name: 'Ada', email: 'ada@example.test' },
            item: { title: 'Invoice' },
            metadata: { generatedAt: '2001-01-01' },
            note: 'x',
        };

        expect(onlyCallerFillable(draft, paths)).toEqual({ customer: { name: 'Ada' }, item: { title: 'Invoice' } });
    });

    it('drops a list, and an object where a fillable path ends', () => {
        expect(onlyCallerFillable({ customer: { name: { first: 'Ada' } } }, paths)).toEqual({});
        expect(onlyCallerFillable({ customer: ['Ada'] }, paths)).toEqual({});
    });

    it('sends nothing when nothing is switched on', () => {
        expect(onlyCallerFillable({ customer: { name: 'Ada' } }, [])).toEqual({});
    });
});
