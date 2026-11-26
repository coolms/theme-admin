import { type UrlMatchResult, type UrlSegment } from '@angular/router';

/** The chat page's address: `/admin/chat` is the list alone, `/admin/chat/<id>` that conversation open. */
export const CHAT_PATH = '/chat';

/** The route parameter naming the open conversation. */
export const CONVERSATION_PARAM = 'conversationId';

/** The router commands for the chat page with this conversation open, or the list alone for null. */
export function chatCommands(conversationId: string | null): string[] {
    return conversationId === null ? [CHAT_PATH] : [CHAT_PATH, conversationId];
}

/**
 * Matches `/admin/chat` and `/admin/chat/<id>` with one route, so the page stays drawn while a conversation opens or
 * closes.
 */
export function chatPageMatcher(segments: UrlSegment[]): UrlMatchResult | null {
    if (segments.length === 0) {
        return { consumed: [] };
    }
    if (segments.length === 1) {
        return { consumed: segments, posParams: { [CONVERSATION_PARAM]: segments[0] } };
    }
    return null;
}
