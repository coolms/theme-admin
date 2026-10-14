import { TestBed } from '@angular/core/testing';
import { CentrifugoClientService } from '@coolms/ui-angular';
import { VfsLiveEventsService } from './vfs-live-events.service';

/**
 * A folder's channel is shared by everything watching it -- the listing, and an editor open on one of its files -- so
 * it is left only when its LAST watcher goes (2026-10-14: an editor closing used to unsubscribe the folder for the
 * listing too, which then stopped hearing of changes).
 */
describe('VfsLiveEventsService -- a shared folder channel', () => {
    let subscribe: jasmine.Spy;
    let unsubscribe: jasmine.Spy;
    let live: VfsLiveEventsService;

    beforeEach(() => {
        subscribe = jasmine.createSpy('subscribe');
        unsubscribe = jasmine.createSpy('unsubscribe');
        const sub = { state: 'unsubscribed', on: (): void => undefined, off: (): void => undefined, subscribe, unsubscribe };
        TestBed.configureTestingModule({
            providers: [{
                provide: CentrifugoClientService,
                useValue: { connect: () => Promise.resolve(), getOrCreateSubscription: () => sub },
            }],
        });
        live = TestBed.inject(VfsLiveEventsService);
    });

    async function settled(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
    }

    it('keeps the channel while another watcher is still on it, and leaves it with the last', async () => {
        const listing = live.watch('folder-1').subscribe();
        const editor = live.watch('folder-1').subscribe();
        await settled();

        editor.unsubscribe();
        expect(unsubscribe).withContext('the listing still watches the folder').not.toHaveBeenCalled();

        listing.unsubscribe();
        expect(unsubscribe).withContext('the last watcher left').toHaveBeenCalledTimes(1);
    });

    it('leaves a channel with a single watcher when it goes, as before', async () => {
        const only = live.watch('folder-2').subscribe();
        await settled();
        only.unsubscribe();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
