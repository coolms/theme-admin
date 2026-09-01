/**
 * Avatar helpers for the internal Messages surface.
 *
 * `<app-user-avatar>` renders a colored-initials circle when no `avatarUrl` is
 * present, so chat can show avatars with ZERO backend plumbing — built from the
 * `displayName` we already have per participant. Real uploaded-photo avatars
 * (an `avatarUrl` per participant from the backend) are a clean follow-up.
 */

/** The shape `<app-user-avatar [user]>` consumes (photo, else initials + color). */
export interface ChatAvatarUser {
    /** A real uploaded photo URL — the component prefers it over initials. */
    readonly avatarUrl: string | null;
    readonly firstName: string | null;
    readonly identifier: string;
    readonly avatarColor: string;
}

/**
 * Deterministic, pleasant avatar color from a stable seed (uid or name) — so
 * the same person always gets the same hue across the list, header, bubbles,
 * and the topbar quick-panel. A fixed S/L keeps every colour legible behind
 * the white initial.
 */
export function chatAvatarColor(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 50%)`;
}

/**
 * Build the avatar `[user]` input from a display name + a stable seed, plus an
 * optional real-photo URL. When `avatarUrl` is set the component renders the
 * photo; otherwise it falls back to colored initials.
 */
export function avatarUserFor(
    name: string | null | undefined,
    seed: string | null | undefined,
    avatarUrl?: string | null,
): ChatAvatarUser {
    const label = (name && name.trim()) || '';
    const key = (seed && seed.trim()) || label || '?';
    return {
        avatarUrl: (avatarUrl && avatarUrl.trim()) || null,
        firstName: label || null,
        identifier: key,
        avatarColor: chatAvatarColor(key),
    };
}
