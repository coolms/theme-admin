/** The names of the sign-in providers the platform offers, by their key, as their owners write them. */
const KNOWN: Readonly<Record<string, string>> = {
    google: 'Google',
    microsoft: 'Microsoft',
};

/**
 * A sign-in provider's name for a person to read: the name its owner writes for a known key ("Microsoft" for
 * `microsoft`), another key with its first letter capitalised, and null for none.
 */
export function oauthProviderName(key: string | null | undefined): string | null {
    const k = (key ?? '').trim();
    if (k === '') {
        return null;
    }
    return KNOWN[k.toLowerCase()] ?? k.charAt(0).toUpperCase() + k.slice(1);
}
