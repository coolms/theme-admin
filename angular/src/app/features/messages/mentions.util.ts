import { ChatMessageDto } from './messages.types';

/**
 * Does this message `@`-mention the given user (#2124)?
 *
 * The predicate behind the highlighted bubble. It was four lines inside the
 * page component with no test — and the CSS that made its answer VISIBLE was
 * missing entirely, so for a while it could have returned anything at all and
 * nobody would have seen a difference. Now the styling exists, this is the rule
 * that decides which message gets it.
 *
 * ⚠️ Matches on `userId`, never on the `label`. A mention snapshots the name as
 * it was typed, so two people called "Alex" share a label and a renamed user
 * keeps the old one; the id is the only thing that identifies who was meant.
 */
export function mentionsUser(message: Pick<ChatMessageDto, 'mentions'>, userId: string | null): boolean {
    if (userId === null || userId === '') {
        return false;
    }

    return (message.mentions ?? []).some(ref => ref.userId === userId);
}
