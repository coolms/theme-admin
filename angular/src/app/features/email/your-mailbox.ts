import type { EmailMailboxDto } from './email.types';
import { oauthProviderName } from './oauth-provider-name';

/** The mailboxes a sign-in provider gives, where its owner names them otherwise than itself. */
const MAILBOX_NAMES: Readonly<Partial<Record<string, string>>> = {
    google: 'Gmail',
};

/** A mailbox as a sentence to its person names it: "your Gmail mailbox"; "your mailbox" when no provider is known. */
export function yourMailbox(mailbox: Pick<EmailMailboxDto, 'oauthProvider'> | null | undefined): string {
    const key = (mailbox?.oauthProvider ?? '').trim().toLowerCase();
    const name = MAILBOX_NAMES[key] ?? oauthProviderName(key);

    return name === null ? 'your mailbox' : `your ${name} mailbox`;
}

/** What is said of a message that is gone at the provider; `mailboxWords` as `yourMailbox` gives them. */
export function deletedText(mailboxWords: string): string {
    return `This message was deleted in ${mailboxWords}.`;
}
