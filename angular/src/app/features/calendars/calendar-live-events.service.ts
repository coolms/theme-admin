import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';

/**
 * Calendar realtime ship — typed wrapper over `CentrifugoClientService`
 * for the `calendar.items.{calendarUuid}` channel. Mirror of
 * `DataGridLiveEventsService`: the FullCalendar `events-card` and
 * the topbar quick-panel subscribe per mount and call
 * `fc.refetchEvents()` whenever a publication arrives.
 *
 * The returned Observable disconnects the centrifuge subscription
 * when the last RxJS subscriber goes away — same pattern as the
 * sibling DataGrid stream. Payload shape mirrors the backend
 * `CalendarLivePublisher` (`{type: 'check'}`); the FE doesn't read
 * it, the arrival itself is the signal.
 */
@Injectable({ providedIn: 'root' })
export class CalendarLiveEventsService {
    private readonly client = inject(CentrifugoClientService);

    /**
     * Subscribe to the items channel for a calendar. Emits a void
     * value on every publication so consumers can call
     * `fc?.refetchEvents()` without inspecting any payload.
     *
     * `calendarId` is the calendar's UUID (rfc4122), matching the
     * backend `CalendarChannelNameBuilder::itemsChannel()` output.
     * The channel survives a slug rename and avoids a DB hop in
     * the backend listener — notes on UUID-keyed
     * channels.
     */
    watchItems(calendarId: string): Observable<void> {
        const channel = `calendar.items.${calendarId}`;

        return new Observable<void>(subscriber => {
            let unsubscribed = false;
            let publicationHandler: ((ctx: { data: unknown }) => void) | null = null;

            this.client.connect()
                .then(() => {
                    if (unsubscribed) {
                        return;
                    }
                    const sub = this.client.getOrCreateSubscription(channel);

                    publicationHandler = (): void => subscriber.next();
                    sub.on('publication', publicationHandler);
                    if (sub.state !== 'subscribed') {
                        sub.subscribe();
                    }
                })
                .catch((err: unknown) => subscriber.error(err));

            return () => {
                unsubscribed = true;
                const sub = this.tryGetSubscription(channel);
                if (sub !== null) {
                    if (publicationHandler !== null) {
                        sub.off('publication', publicationHandler);
                    }
                    sub.unsubscribe();
                }
            };
        });
    }

    private tryGetSubscription(channel: string): ReturnType<CentrifugoClientService['getOrCreateSubscription']> | null {
        try {
            return this.client.getOrCreateSubscription(channel);
        } catch {
            return null;
        }
    }
}
