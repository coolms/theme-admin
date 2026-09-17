import { type EmailFolderDto } from './email.types';
import { folderCount, folderCountTitle, importedFraction } from './folder-fraction.util';

/**
 * The rail's number used to be the IMPORTED count alone, which read as the size
 * of the folder. With a backfill still walking the older mail that is wrong by
 * a factor of four on a real mailbox, so the count now carries what the server
 * holds beside it -- and says nothing it has not been told.
 */
describe('folder import fraction', () => {
    const folder = (over: Partial<EmailFolderDto> = {}): EmailFolderDto => ({
        folder: 'INBOX',
        total: 1314,
        unseen: 0,
        serverTotal: 5512,
        ...over,
    });

    it('reports how much of a part-imported folder is here', () => {
        expect(importedFraction(folder())).toBe(24);
        expect(folderCount(folder())).toBe(`${(1314).toLocaleString()} / ${(5512).toLocaleString()}`);
        expect(folderCountTitle(folder())).toContain('imported (24%)');
    });

    it('drops the fraction once the folder is fully imported', () => {
        const whole = folder({ total: 5512 });

        expect(importedFraction(whole)).toBeNull();
        expect(folderCount(whole)).toBe((5512).toLocaleString());
        expect(folderCountTitle(whole)).toContain('all of them imported');
    });

    it('invents nothing when no sync has recorded the server count', () => {
        for (const unmeasured of [folder({ serverTotal: null }), folder({ serverTotal: undefined })]) {
            expect(importedFraction(unmeasured)).toBeNull();
            // The imported count ALONE -- never a made-up denominator.
            expect(folderCount(unmeasured)).toBe((1314).toLocaleString());
            expect(folderCountTitle(unmeasured)).toContain('not known yet');
        }
    });

    it('does not divide by a zero or a nonsense server count', () => {
        expect(importedFraction(folder({ serverTotal: 0 }))).toBeNull();
        // A server count BELOW what we hold (a folder shrank between syncs) is not a
        // fraction over 100% -- it falls back to the plain count.
        expect(importedFraction(folder({ total: 20, serverTotal: 10 }))).toBeNull();
        expect(folderCount(folder({ total: 20, serverTotal: 10 }))).toBe('20');
    });
});
