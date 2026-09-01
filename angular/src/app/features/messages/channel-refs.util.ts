/**
 * `#channel` references in the internal Messages surface.
 *
 * A channel carries a stable HANDLE (`qa-public-channel`), derived from its name
 * once and never re-derived, so a reference in an old message keeps resolving
 * after a rename. These are the two pure halves of using it: spotting the
 * trigger being typed, and turning a handle in a stored body into a reference.
 *
 * Kept out of the page component because they are the parts worth testing, and
 * because the linkifier writes markup — logic that decides what reaches
 * `[innerHTML]` should be readable on its own.
 */

/** The channel fields a reference needs (a subset of `ChatChannelDto`). */
export interface ChannelRef {
    readonly id: string;
    readonly title: string | null;
    readonly slug?: string | null;
    readonly joined?: boolean;
}

/**
 * The handle being typed right before the caret, or NULL when there is no
 * trigger.
 *
 * Deliberately narrow: a handle is lowercase kebab-case, so `#Heading`, `#1`,
 * `#FF00AA` and a mid-word `a#b` are NOT references and must not pop a menu
 * over what someone is writing. An empty string (a bare `#`) IS a trigger — it
 * opens the menu listing every channel, which is how you discover handles you
 * do not know yet.
 */
export function channelTriggerAt(textBeforeCaret: string | null): string | null {
    if (null === textBeforeCaret) {
        return null;
    }
    const match = /(?:^|\s)#([a-z0-9-]{0,64})$/.exec(textBeforeCaret);

    return null === match ? null : match[1];
}

/**
 * Channels offered for a `#query` — matched on HANDLE first, then name, so
 * typing what you SEE ("Release Notes") or what you TYPE ("release-notes")
 * both find it. Only channels that have a handle can be offered: a reference
 * must resolve to exactly one room, and one without a handle has nothing to
 * cite.
 */
export function matchChannels<T extends ChannelRef>(channels: readonly T[], query: string, limit = 8): readonly T[] {
    const q = query.toLowerCase();

    return channels
        .filter(c => !!c.slug)
        .filter(c => c.slug!.includes(q) || (c.title ?? '').toLowerCase().includes(q))
        .slice(0, limit);
}

/**
 * Wrap every RESOLVABLE `#handle` in a message body with the reference span the
 * page's delegated click handler picks up.
 *
 *  A handle that matches no known channel is left as plain text. A reference
 * that looks live and goes nowhere is worse than one that was never offered —
 * and it keeps the injected markup built entirely from the channel LIST, never
 * from message content, so nothing an author writes reaches the DOM this way.
 *
 *  No `data-` attribute carries the handle: Angular's HTML sanitizer keeps
 * `class` but STRIPS `data-*`, so the obvious `data-chan="…"` arrives as null
 * and every click silently does nothing. The handle is the element's own text.
 */
export function linkifyChannelRefs(html: string, channels: readonly ChannelRef[]): string {
    const known = new Set(channels.map(c => c.slug).filter((s): s is string => !!s));
    if (known.size === 0 || !html.includes('#')) {
        return html;
    }

    return html.replace(
        /(^|[\s(>])#([a-z0-9-]{1,64})\b/g,
        (whole, lead: string, slug: string) => (known.has(slug) ? `${lead}<span class="msg__chanref">#${slug}</span>` : whole),
    );
}
