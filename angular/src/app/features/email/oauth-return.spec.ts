import { sayOAuthReturn } from './oauth-return';

describe('sayOAuthReturn -- the outcome of a sign-in at the provider', () => {
    it('connected is said as done; every other outcome as not connected', () => {
        const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
        sayOAuthReturn('connected', toast);
        expect(toast.success).toHaveBeenCalledOnceWith('Mailbox connected.');
        expect(toast.error).not.toHaveBeenCalled();

        for (const outcome of ['denied', 'error', 'auth_failed', 'unreachable', 'anything else']) {
            sayOAuthReturn(outcome, toast);
            expect(toast.error.calls.mostRecent().args).withContext(outcome)
                .toEqual(['The account was not connected — nothing was saved. Please try again.']);
        }
        expect(toast.error).toHaveBeenCalledTimes(5);
        expect(toast.success).toHaveBeenCalledTimes(1);
    });
});
