import { type EmailFolderDto } from './email.types';

/**
 * A folder's rail count used to be one number: how many messages had been
 * IMPORTED. That read as the size of the folder, which it is not -- the first
 * sync copies a recent window and a backfill walks the rest, so for a large
 * mailbox the imported count can be a quarter of what the server holds.
 *
 * The server now reports both, so the rail can say "1,314 / 5,512" and mean it.
 * These are pure functions over the DTO so the wording and the progress bar are
 * decided in one place and cannot drift apart.
 */

/**
 * How much of the folder is here, as a whole percentage, or null when the
 * question does not arise: no sync has recorded the server's own count, or
 * everything it holds is already imported.
 */
export function importedFraction(f: EmailFolderDto): number | null {
    const server = f.serverTotal;
    if (typeof server !== 'number' || server <= 0 || f.total >= server) {
        return null;
    }

    return Math.round((f.total / server) * 100);
}

/** `1,314 / 5,512` while a folder is part-imported, otherwise just the count. */
export function folderCount(f: EmailFolderDto): string {
    const imported = f.total.toLocaleString();
    if (importedFraction(f) === null) {
        return imported;
    }

    return `${imported} / ${(f.serverTotal as number).toLocaleString()}`;
}

/** The rail is tight, so the sentence the fraction stands for lives in the tooltip. */
export function folderCountTitle(f: EmailFolderDto): string {
    const percent = importedFraction(f);
    const imported = f.total.toLocaleString();

    if (percent === null) {
        return typeof f.serverTotal === 'number'
            ? `${imported} messages, all of them imported`
            : `${imported} messages imported (the server's own count is not known yet)`;
    }

    return `${imported} of ${(f.serverTotal as number).toLocaleString()} imported (${percent}%) -- the rest is still being copied`;
}
