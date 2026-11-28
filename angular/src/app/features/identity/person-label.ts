/** The neutral label shown for a person who gave no name. A login or an email is never shown in its place. */
export const NO_NAME = 'No name';

/** Who a person is inside a sentence when they gave no name: "Someone saved a newer version". */
export const SOMEONE = 'Someone';

/**
 * A person's name as given, or the neutral label when there is none, for a list, a header, a chip or a search
 * result. A name the viewer may not read gets the same label, so it never tells that a hidden name exists.
 */
export function personLabel(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim();
    return trimmed !== '' ? trimmed : NO_NAME;
}

/** A person's name as given, or "Someone", for a sentence about them. */
export function personInSentence(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim();
    return trimmed !== '' ? trimmed : SOMEONE;
}
