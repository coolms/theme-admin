import { deleteMenuItems, messageFacts, moveMenuItems, rowTargetIds } from './message-actions';

/**
 * The rules behind the message bars and a message row's menu: which messages an
 * action targets, and the facts the server's toolbar tree decides its actions on.
 */
describe('message actions', () => {
    describe('rowTargetIds', () => {
        it('acts on every checked message when the row is one of them', () => {
            expect(rowTargetIds(new Set(['a', 'b', 'c']), 'b').sort()).toEqual(['a', 'b', 'c']);
        });

        it('acts on the row alone when it is not checked, whatever else is', () => {
            expect(rowTargetIds(new Set(['a', 'b']), 'z')).toEqual(['z']);
            expect(rowTargetIds(new Set<string>(), 'z')).toEqual(['z']);
        });
    });

    describe('messageFacts', () => {
        it('says one message, and what it can still become', () => {
            expect(messageFacts([{ seen: false, flagged: true }])).toEqual({
                _single: true, _anyUnread: true, _anyRead: false, _anyUnflagged: false, _anyFlagged: true,
            });
        });

        it('says several, and offers each change any of them can take', () => {
            expect(messageFacts([{ seen: true, flagged: false }, { seen: false, flagged: false }])).toEqual({
                _single: false, _anyUnread: true, _anyRead: true, _anyUnflagged: true, _anyFlagged: false,
            });
        });

        it('reads a missing seen or flagged as false', () => {
            const facts = messageFacts([{}]);
            expect(facts['_anyUnread']).toBeTrue();
            expect(facts['_anyFlagged']).toBeFalse();
        });
    });

    it('offers the folders the messages are not in, or says there are none', () => {
        expect(moveMenuItems(['INBOX', 'Archive', 'Trash'], 'INBOX').map(i => i.label)).toEqual(['Archive', 'Trash']);
        expect(moveMenuItems(['INBOX'], 'INBOX')).toEqual([{ id: 'none', label: 'No other folders', disabled: true }]);
    });

    it('offers Trash outside Trash only, and permanent deletion as the danger item', () => {
        expect(deleteMenuItems(1, false).map(i => i.id)).toEqual(['delete:trash', 'delete:permanent']);
        expect(deleteMenuItems(3, true).map(i => i.id)).toEqual(['delete:permanent']);
        expect(deleteMenuItems(3, false)[1]).toEqual(jasmine.objectContaining({ danger: true, label: "Delete 3 messages permanently -- can't be undone" }));
    });
});
