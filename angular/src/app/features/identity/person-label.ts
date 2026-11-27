/** The neutral label shown for a person who gave no name. A login or an email is never shown in its place. */
export const NO_NAME = 'No name';

/** A person's name as given, or the neutral label when there is none. */
export function personLabel(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim();
    return trimmed !== '' ? trimmed : NO_NAME;
}
