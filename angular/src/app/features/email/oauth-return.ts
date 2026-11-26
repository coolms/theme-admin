import type { ToastService } from '@coolms/ui-angular';

/** The outcome a provider's consent returns with when the account was connected; any other is a failure. */
export const OAUTH_CONNECTED = 'connected';

/** Says the outcome a provider's consent returned with (`?oauth=`). */
export function sayOAuthReturn(outcome: string, toast: Pick<ToastService, 'success' | 'error'>): void {
    if (outcome === OAUTH_CONNECTED) {
        toast.success('Mailbox connected.');
    } else {
        toast.error('The account was not connected — nothing was saved. Please try again.');
    }
}
