import { type EmailMessageDto } from './email.types';

/** A row taken out of the list at once, and where it was. */
export interface TakenRow<T extends EmailMessageDto = EmailMessageDto> {
    readonly row: T;
    readonly index: number;
}

/** The rows `ids` names taken out of the list, each with its place; and the list without them. */
export function takeRows<T extends EmailMessageDto>(list: readonly T[], ids: ReadonlySet<string>): { list: T[]; taken: TakenRow<T>[] } {
    const taken: TakenRow<T>[] = [];
    list.forEach((row, index) => {
        if (ids.has(row.id)) {
            taken.push({ row, index });
        }
    });

    return { list: list.filter(m => !ids.has(m.id)), taken };
}

/** The list with these rows back in their places, the first place first; a row already listed is not doubled. */
export function putRowsBack<T extends EmailMessageDto>(list: readonly T[], back: readonly TakenRow<T>[]): T[] {
    const next = [...list];
    const listed = new Set(list.map(m => m.id));
    for (const { row, index } of [...back].sort((a, b) => a.index - b.index)) {
        if (!listed.has(row.id)) {
            next.splice(Math.min(index, next.length), 0, row);
        }
    }

    return next;
}

/**
 * Whether the messages an action is on stay in the list as it shows, decided before the server answers: the list
 * shown is the all-mail role folder (Gmail's All Mail) and the action is Archive, or a Move into a label -- any folder
 * but Trash and Spam, the two that take a message out of All Mail. Then the open message stays open and nothing else
 * opens; otherwise the rows leave at once and the next message opens.
 */
export function staysShown(shownRole: string | null | undefined, action: 'archive' | 'delete' | 'move', targetRole?: string | null): boolean {
    if (shownRole !== 'all') {
        return false;
    }
    if (action === 'archive') {
        return true;
    }
    return action === 'move' && targetRole !== 'trash' && targetRole !== 'junk';
}

const messages = (n: number): string => (n === 1 ? '1 message' : `${n} messages`);

/** What a Move did, in the folder's own name. */
export function movedText(n: number, folderName: string): string {
    return n === 1 ? `Moved to ${folderName}.` : `Moved ${messages(n)} to ${folderName}.`;
}

/** Why a Move changed nothing for these: the server's sentence for the first, as given, with how many when several. */
export function moveRefusalText(sentence: string, n: number): string {
    return n === 1 ? sentence : `${messages(n)} were not moved. ${sentence}`;
}

