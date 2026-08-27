import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { type Subscription } from 'rxjs';

import { VfsLiveEventsService, type VfsNodeChangeEvent } from './vfs-live-events.service';

/**
 * Phase 2 VFS live -- manages the Map of concurrent Centrifugo
 * subscriptions backing `VfsTreeComponent`'s expanded-folder
 * set. Component-scoped (provided in the tree component's
 * `providers` array, NOT `providedIn: 'root'`) so the
 * subscription map is per-tree-instance and tears down with the
 * component via `DestroyRef`.
 *
 * The reconciliation entry point (`reconcile`) is the only public
 * method intended for component use: pass the desired set of
 * parent-node ids, and the service adds missing subscriptions /
 * removes excess ones. Idempotent on identical inputs.
 *
 * Per the investigation report: this is the first multi-
 * subscription pattern in the SPA. The pattern is intentionally
 * narrow (Map<channel-key, RxJS Subscription>) so any future
 * feature needing N concurrent Centrifugo channels can either
 * reuse this service (if scoped to a single tree-like surface)
 * or copy the shape.
 */
@Injectable()
export class VfsTreeLiveSubscriptionsService {
    private readonly liveEvents = inject(VfsLiveEventsService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly active = new Map<string, Subscription>();

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.active.forEach(sub => sub.unsubscribe());
            this.active.clear();
        });
    }

    /**
     * Subscribe to a parent-node channel. Handler is invoked for
     * every typed event. Idempotent: a second call for the same
     * `parentNodeId` is a no-op (the original handler stays
     * registered; we do not silently swap it).
     */
    add(parentNodeId: string, handler: (event: VfsNodeChangeEvent) => void): void {
        if (this.active.has(parentNodeId)) {
            return;
        }
        const subscription = this.liveEvents
            .watch(parentNodeId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(handler);
        this.active.set(parentNodeId, subscription);
    }

    /**
     * Unsubscribe from a parent-node channel. Idempotent on a
     * missing id.
     */
    remove(parentNodeId: string): void {
        const sub = this.active.get(parentNodeId);
        if (sub !== undefined) {
            sub.unsubscribe();
            this.active.delete(parentNodeId);
        }
    }

    /**
     * Reconcile the active subscription set to match
     * `parentNodeIds`. Subscriptions in `active` but not in the
     * desired set are dropped; ids in the desired set but not in
     * `active` are subscribed with `handler`.
     */
    reconcile(parentNodeIds: ReadonlySet<string>, handler: (event: VfsNodeChangeEvent) => void): void {
        for (const id of this.active.keys()) {
            if (!parentNodeIds.has(id)) {
                this.remove(id);
            }
        }
        for (const id of parentNodeIds) {
            this.add(id, handler);
        }
    }
}
