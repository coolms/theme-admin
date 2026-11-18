import { DestroyRef, inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ElevationService } from '@coolms/core-angular';
import { type HasUnsavedChanges, unsavedChangesGuard } from '@coolms/ui-angular';
import { filter, firstValueFrom, isObservable, of, switchMap, take } from 'rxjs';

/**
 * The page in the main area, made anew on request: each reload is a new generation, and the outlet is rendered once
 * per generation, so the routed page is destroyed and created again and every read it makes on arrival is made again.
 * What the shell provides as `RELOAD_PAGE`: a page whose load was refused for want of elevation loads again after the
 * grant without a browser reload, which would end the elevation.
 *
 * After every grant the page loads again too, since what it read before may have been cut by rights: once no refused
 * write still waits for its repeat, so the reload never cancels one. A page holding unsaved work is not made anew; it
 * says that a reload shows everything the person can now access, and that reload asks the shared unsaved-changes
 * guard first. Reloads asked for in the same turn are one reload.
 */
@Injectable()
export class PageReload {
    private readonly injector   = inject(Injector);
    private readonly elevation  = inject(ElevationService);

    readonly generation = signal(0);

    /** A grant came while the page held unsaved work. */
    readonly grantNotice = signal(false);

    private page: unknown = null;
    private scheduled = false;

    constructor() {
        this.elevation.changes$.pipe(
            filter(change => change.kind === 'granted'),
            switchMap(() => this.elevation.retriesPending() === 0
                ? of(undefined)
                : this.elevation.retriesSettled$.pipe(take(1))),
            takeUntilDestroyed(inject(DestroyRef)),
        ).subscribe(() => this.afterGrant());
    }

    /** The page the outlet shows now. */
    shown(page: unknown): void {
        this.page = page;
        this.grantNotice.set(false);
    }

    reload(): void {
        if (this.scheduled) return;
        this.scheduled = true;
        queueMicrotask(() => {
            this.scheduled = false;
            this.generation.update(n => n + 1);
        });
    }

    /** After a grant: the page again, or, over unsaved work, the notice. */
    afterGrant(): void {
        if ((this.page as Partial<HasUnsavedChanges> | null)?.dirty?.() === true) {
            this.grantNotice.set(true);
            return;
        }
        this.reload();
    }

    /** The notice's Reload: through the unsaved-changes guard, as leaving the page would be. */
    async reloadFromNotice(): Promise<void> {
        const page = this.page as HasUnsavedChanges;
        const asked = runInInjectionContext(this.injector, () => unsavedChangesGuard(page, null!, null!, null!));
        const answer = isObservable(asked) ? await firstValueFrom(asked.pipe(take(1)), { defaultValue: false }) : await asked;
        if (answer !== true) return;
        this.grantNotice.set(false);
        this.reload();
    }
}
