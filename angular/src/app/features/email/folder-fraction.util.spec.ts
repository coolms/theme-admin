import { type EmailFolderDto } from './email.types';
import {
    applyUnreadDelta,
    folderCount,
    folderCountTitle,
    folderStored,
    folderTotal,
    folderUnread,
    importedFraction,
} from './folder-fraction.util';

/**
 * The rail's number used to be the IMPORTED count alone, which read as the size
 * of the folder. With a backfill still walking the older mail that is wrong by
 * a factor of four on a real mailbox, so the row now shows the server's one total
 * and the tooltip says how much of it is stored -- and nothing it has not been told.
 */
describe('folder import fraction', () => {
    const folder = (over: Partial<EmailFolderDto> = {}): EmailFolderDto => ({
        folder: 'INBOX',
        total: 1714,
        unseen: 1507,
        serverTotal: 5512,
        serverUnseen: 2549,
        ...over,
    });

    it('a part-stored folder shows the server\'s one total, and says how much is stored in the tooltip', () => {
        expect(importedFraction(folder())).toBe(31);
        expect(folderTotal(folder())).toBe(5512);
        expect(folderCount(folder())).toBe((5512).toLocaleString());
        expect(folderStored(folder())).toBe(`${(1714).toLocaleString()} of ${(5512).toLocaleString()} stored`);
        expect(folderCountTitle(folder())).toContain(`${(1714).toLocaleString()} of ${(5512).toLocaleString()} stored (31%)`);
    });

    it('says nothing of storing once the folder is fully stored', () => {
        const whole = folder({ total: 5512 });

        expect(importedFraction(whole)).toBeNull();
        expect(folderCount(whole)).toBe((5512).toLocaleString());
        expect(folderStored(whole)).toBeNull();
        expect(folderCountTitle(whole)).not.toContain('stored');
        expect(folderCountTitle(whole)).toContain(`${(5512).toLocaleString()} messages.`);
    });

    it('shows the platform\'s own count until a sync has read the server\'s, and invents no denominator', () => {
        for (const unmeasured of [folder({ serverTotal: null }), folder({ serverTotal: undefined })]) {
            expect(importedFraction(unmeasured)).toBeNull();
            expect(folderTotal(unmeasured)).toBe(1714);
            expect(folderCount(unmeasured)).toBe((1714).toLocaleString());
            expect(folderStored(unmeasured)).toBeNull();
            expect(folderCountTitle(unmeasured)).toContain('not known yet');
            expect(folderCountTitle(unmeasured)).not.toContain(' of ');
        }
    });

    it('does not divide by a zero or a nonsense server count, and the server\'s count is the total once read', () => {
        expect(importedFraction(folder({ serverTotal: 0 }))).toBeNull();
        expect(folderCount(folder({ total: 0, serverTotal: 0 }))).toBe('0');
        // A server count BELOW what we hold (a folder shrank between syncs) is not a
        // fraction over 100%: nothing is missing, so nothing is said of storing.
        expect(importedFraction(folder({ total: 20, serverTotal: 10 }))).toBeNull();
        expect(folderStored(folder({ total: 20, serverTotal: 10 }))).toBeNull();
        expect(folderCount(folder({ total: 20, serverTotal: 10 }))).toBe('10');
    });

    it('says which unit it counts, so a conversation view is not read as a defect', () => {
        expect(folderCountTitle(folder())).toContain('messages, not conversations');
    });

    describe('the unread badge', () => {
        it("prefers the server's unread count over the imported one", () => {
            // The whole point: 1,507 of the imported messages are unread, but 2,549 of
            // the FOLDER is. Showing the former understates it by a thousand.
            expect(folderUnread(folder())).toBe(2549);
            expect(folderCountTitle(folder())).toContain('2,549 unread on the server');
        });

        it('falls back to the imported count when the server did not say', () => {
            expect(folderUnread(folder({ serverUnseen: null }))).toBe(1507);
            expect(folderUnread(folder({ serverUnseen: undefined }))).toBe(1507);
            expect(folderCountTitle(folder({ serverUnseen: null }))).not.toContain('unread on the server');
        });

        it('still moves when a message is read, because marking read reaches the server', () => {
            // If only the local count moved, the badge (which shows the server's) would
            // sit still while the reader watched their unread messages disappear.
            const after = applyUnreadDelta(folder(), -1);

            expect(folderUnread(after)).toBe(2548);
            expect(after.unseen).toBe(1506);
        });

        it('never drives either count below zero', () => {
            const after = applyUnreadDelta(folder({ unseen: 0, serverUnseen: 0 }), -5);

            expect(after.unseen).toBe(0);
            expect(after.serverUnseen).toBe(0);
        });

        it('leaves an unknown server count unknown rather than inventing one', () => {
            expect(applyUnreadDelta(folder({ serverUnseen: null }), -1).serverUnseen).toBeNull();
        });
    });
});
