import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CentrifugoClientService } from '@coolms/ui-angular';

/**
 * Phase 2 VFS live -- typed wrapper over
 * `CentrifugoClientService.getOrCreateSubscription` for the
 * `vfs.parent.{parentNodeId}` channel. Payload-aware sibling to
 * `DataGridLiveEventsService` and `CentrifugoNotificationStreamService`
 * (the void-only variant); both layer over the same singleton
 * `CentrifugoClientService` connection.
 *
 * Returned Observable disconnects the centrifuge listener when
 * the last RxJS subscriber goes away. Payload shape mirrors the
 * backend `VfsNodeChangeEvent` value object (Sub-phase A).
 *
 * Callers normally consume this via
 * `VfsTreeLiveSubscriptionsService`, which manages N concurrent
 * channel subscriptions for the expanded-folder set.
 */
@Injectable({ providedIn: 'root' })
export class VfsLiveEventsService {
    private readonly client = inject(CentrifugoClientService);

    watch(parentNodeId: string): Observable<VfsNodeChangeEvent> {
        const channel = `vfs.parent.${parentNodeId}`;

        return new Observable<VfsNodeChangeEvent>(subscriber => {
            let unsubscribed = false;
            let publicationHandler: ((ctx: { data: unknown }) => void) | null = null;

            this.client.connect()
                .then(() => {
                    if (unsubscribed) {
                        return;
                    }
                    const sub = this.client.getOrCreateSubscription(channel);

                    publicationHandler = (ctx: { data: unknown }): void => {
                        const event = this.coerce(ctx.data);
                        if (event !== null) {
                            subscriber.next(event);
                        }
                    };
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

    private coerce(raw: unknown): VfsNodeChangeEvent | null {
        if (typeof raw !== 'object' || raw === null) {
            return null;
        }
        const obj = raw as Record<string, unknown>;
        const type = obj['type'];
        const parentNodeId = obj['parentNodeId'];
        const nodeId = obj['nodeId'];
        const previousParentNodeId = obj['previousParentNodeId'];
        if (typeof type !== 'string' || typeof parentNodeId !== 'string' || typeof nodeId !== 'string') {
            return null;
        }
        if (!(type === 'node.created'
            || type === 'node.deleted'
            || type === 'node.moved'
            || type === 'node.renamed'
            || type === 'node.metadata_changed'
            || type === 'node.content_updated'
        )) {
            return null;
        }
        const prev = typeof previousParentNodeId === 'string' ? previousParentNodeId : null;

        return { type, parentNodeId, nodeId, previousParentNodeId: prev };
    }

    private tryGetSubscription(channel: string): ReturnType<CentrifugoClientService['getOrCreateSubscription']> | null {
        try {
            return this.client.getOrCreateSubscription(channel);
        } catch {
            return null;
        }
    }
}

export type VfsEventType =
    | 'node.created'
    | 'node.deleted'
    | 'node.moved'
    | 'node.renamed'
    | 'node.metadata_changed'
    | 'node.content_updated';

export interface VfsNodeChangeEvent {
    readonly type: VfsEventType;
    readonly parentNodeId: string;
    readonly nodeId: string;
    readonly previousParentNodeId: string | null;
}
