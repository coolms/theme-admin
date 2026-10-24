import {
    type MailboxFilterWrite,
    moved,
    newCondition,
    newFilter,
    operatorsFor,
    summarizeFilter,
    toPayload,
    validateFilter,
    violationsByPath,
} from './mailbox-filters';

/** A mailbox's filters: the contract's rules as the editor keeps them, before the server is asked. */
describe('mailbox filters -- the contract, kept by the editor', () => {
    const valid = (): MailboxFilterWrite => ({
        name: 'Invoices to Accounts',
        enabled: true,
        match: 'all',
        conditions: [
            { field: 'from', operator: 'contains', value: 'billing@' },
            { field: 'subject', operator: 'contains', value: 'invoice' },
        ],
        actions: [{ type: 'move', folder: 'INBOX/Accounts' }, { type: 'markRead' }],
        stopProcessing: true,
    });

    it('a filter as the contract shows it is valid', () => {
        expect(validateFilter(valid())).toEqual({});
    });

    it('each broken rule is named at the path the server would name it', () => {
        const f = valid();
        f.name = '  ';
        f.conditions = [
            { field: 'subject', operator: 'exists', value: 'x' },
            { field: 'header', operator: 'contains', name: '', value: 'y' },
            { field: 'size', operator: 'greaterThan', value: -1 },
            { field: 'to', operator: 'equals', value: '' },
        ];
        f.actions = [{ type: 'move', folder: '' }];
        expect(validateFilter(f)).toEqual({
            name: 'Name the filter.',
            'conditions[0].operator': 'Not an operator for this field.',
            'conditions[1].name': 'Name the header.',
            'conditions[2].value': 'A whole number of bytes.',
            'conditions[3].value': 'Enter what to look for.',
            'actions[0].folder': 'Choose the folder.',
        });
    });

    it('one move at most: Move to folder and Move to Trash together are refused', () => {
        const f = valid();
        f.actions = [{ type: 'move', folder: 'INBOX/A' }, { type: 'trash' }];
        expect(validateFilter(f)['actions']).toContain('moves a message once');
    });

    it('limits: no condition, no action, too many of either, a name too long', () => {
        const f = valid();
        f.conditions = [];
        f.actions = [];
        expect(Object.keys(validateFilter(f)).sort()).toEqual(['actions', 'conditions']);
        f.name = 'x'.repeat(121);
        f.conditions = Array.from({ length: 21 }, () => newCondition());
        f.actions = Array.from({ length: 6 }, () => ({ type: 'flag' as const }));
        const e = validateFilter(f);
        expect(e['name']).toContain('120');
        expect(e['conditions']).toContain('20');
        expect(e['actions']).toContain('5');
    });

    it('the payload carries only the keys each condition and action uses, trimmed', () => {
        const f = valid();
        f.name = '  Spaced  ';
        f.conditions = [
            { field: 'header', operator: 'exists', name: ' List-Id ', value: 'left over' },
            { field: 'hasAttachment', operator: 'is', value: 'false' as unknown as boolean },
            { field: 'size', operator: 'lessThan', value: '2048' as unknown as number },
            { field: 'from', operator: 'contains', value: '  a@b ', name: 'stale' },
        ];
        f.actions = [{ type: 'markRead', folder: 'stale' }, { type: 'move', folder: ' INBOX/X ' }];
        expect(toPayload(f)).toEqual({
            name: 'Spaced',
            enabled: true,
            match: 'all',
            conditions: [
                { field: 'header', operator: 'exists', name: 'List-Id' },
                { field: 'hasAttachment', operator: 'is', value: false },
                { field: 'size', operator: 'lessThan', value: 2048 },
                { field: 'from', operator: 'contains', value: 'a@b' },
            ],
            actions: [{ type: 'markRead' }, { type: 'move', folder: 'INBOX/X' }],
            stopProcessing: true,
        });
    });

    it('a new condition takes its field\'s first operator and an empty value of its kind', () => {
        expect(newCondition('body')).toEqual({ field: 'body', operator: 'contains', value: '' });
        expect(newCondition('hasAttachment')).toEqual({ field: 'hasAttachment', operator: 'is', value: true });
        expect(newCondition('size')).toEqual({ field: 'size', operator: 'greaterThan', value: 1048576 });
        expect(operatorsFor('header')).toContain('exists');
        expect(operatorsFor('body')).toEqual(['contains', 'notContains']);
        expect(validateFilter({ ...newFilter(), name: 'x', conditions: [{ ...newCondition(), value: 'y' }] })).toEqual({});
    });

    it('the list\'s one line says what a filter does', () => {
        expect(summarizeFilter(valid()))
            .toBe('If From contains "billing@" and Subject contains "invoice": move to INBOX/Accounts, mark as read; no later filter.');
        expect(summarizeFilter({
            match: 'any', stopProcessing: false,
            conditions: [{ field: 'size', operator: 'greaterThan', value: 5242880 }, { field: 'hasAttachment', operator: 'is', value: true }],
            actions: [{ type: 'trash' }],
        })).toBe('If Size is larger than 5 MB or Has an attachment: move to Trash.');
    });

    it('a 422\'s violations by property path; any other error gives none', () => {
        const err = { status: 422, error: { violations: [
            { propertyPath: 'conditions[1].operator', message: 'Not allowed.' },
            { propertyPath: 'name', message: 'Too long.' },
        ] } };
        expect(violationsByPath(err)).toEqual({ 'conditions[1].operator': 'Not allowed.', name: 'Too long.' });
        expect(violationsByPath({ status: 500, error: {} })).toEqual({});
        expect(violationsByPath(null)).toEqual({});
    });

    it('moving one place up or down swaps with the neighbour; not past either end', () => {
        expect(moved(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
        expect(moved(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
        expect(moved(['a', 'b', 'c'], 'a', -1)).toBeNull();
        expect(moved(['a', 'b', 'c'], 'c', 1)).toBeNull();
        expect(moved(['a'], 'x', 1)).toBeNull();
    });
});
