import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type ElevationChange, ElevationService } from '@coolms/core-angular';
import { ConfirmDialogService } from '@coolms/ui-angular';
import { of, Subject } from 'rxjs';
import { PageReload } from './page-reload';

/**
 * After a grant the page in the main area loads again, once no refused write still waits for its repeat; a page
 * holding unsaved work keeps it and says a reload shows everything the person can now access, and that reload asks
 * the unsaved-changes guard first.
 */
describe('PageReload after a grant', () => {
    let reload: PageReload;
    let changes: Subject<ElevationChange>;
    let settled: Subject<void>;
    let pending: ReturnType<typeof signal<number>>;
    let discard: boolean;
    let asked: number;

    const granted = (): void => changes.next({ kind: 'granted', state: {} as ElevationChange['state'] });
    const turn = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

    beforeEach(() => {
        changes = new Subject();
        settled = new Subject();
        pending = signal(0);
        discard = true;
        asked = 0;
        TestBed.configureTestingModule({
            providers: [
                PageReload,
                { provide: ElevationService, useValue: { changes$: changes, retriesSettled$: settled, retriesPending: pending } },
                { provide: ConfirmDialogService, useValue: { confirmDiscard: () => { asked++; return of(discard); } } },
            ],
        });
        reload = TestBed.inject(PageReload);
    });

    it('loads a page without unsaved work again after a grant', async () => {
        reload.shown({ dirty: () => false });
        granted();
        await turn();

        expect(reload.generation()).toBe(1);
        expect(reload.grantNotice()).toBe(false);
    });

    it('waits for the refused write\'s repeat to answer before loading the page again', async () => {
        reload.shown({});
        pending.set(1);
        granted();
        await turn();
        expect(reload.generation()).toBe(0);

        pending.set(0);
        settled.next();
        await turn();
        expect(reload.generation()).toBe(1);
    });

    it('keeps a page with unsaved work and says a reload shows what can now be accessed', async () => {
        reload.shown({ dirty: () => true });
        granted();
        await turn();

        expect(reload.generation()).toBe(0);
        expect(reload.grantNotice()).toBe(true);
    });

    it('reloads from the notice only when the unsaved-changes guard lets it', async () => {
        reload.shown({ dirty: () => true });
        granted();
        await turn();

        discard = false;
        await reload.reloadFromNotice();
        await turn();
        expect(asked).toBe(1);
        expect(reload.generation()).toBe(0);
        expect(reload.grantNotice()).toBe(true);

        discard = true;
        await reload.reloadFromNotice();
        await turn();
        expect(asked).toBe(2);
        expect(reload.generation()).toBe(1);
        expect(reload.grantNotice()).toBe(false);
    });

    it('makes reloads asked for in the same turn one reload', async () => {
        reload.shown({});
        reload.reload();
        granted();
        await turn();

        expect(reload.generation()).toBe(1);
    });

    it('does nothing on a drop or an expiry', async () => {
        reload.shown({});
        changes.next({ kind: 'dropped', state: {} as ElevationChange['state'] });
        changes.next({ kind: 'expired', state: {} as ElevationChange['state'] });
        await turn();

        expect(reload.generation()).toBe(0);
    });
});
