import { type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Store } from '@ngxs/store';
import { Observable, of, throwError } from 'rxjs';
import { KeyboardScopeService, ToastService, UnsavedChangesService } from '@coolms/ui-angular';
import { bpmnLiteModelToJson, emptyBpmnLiteModel } from '@coolms/designer/bpmn-lite';
import { emptyStateMachineModel } from '@coolms/designer/state-machine';
import { emptyDmnDrdModel, writeDrdXml } from '@coolms/designer/dmn-drd';
import { BpmnEditorPage } from './bpmn-editor.page';
import { DmnEditorPage } from './dmn-editor.page';
import { StateMachineEditorPage } from './state-machine-editor.page';
import { DecisionDrdEditorPage } from './decision-drd-editor.page';
import { DesignerService, type DraftVersion } from './designer.service';
import { DesignerI18nService } from './designer-i18n.service';

/**
 * The designer saves a draft only over the version it was read at.
 *
 * The workflow and state-machine drafts carry their version in the body (`contentHash`), the decision draft as its
 * ETag. Every save names it (If-Match); a save of a draft the read did not find sends If-None-Match: *, so it only
 * creates one. A draft saved by someone else since is refused (412), one deleted since is not made again (404): the
 * page says so, keeps the edits on the canvas, refuses Save and Deploy, and Reload reads the draft again.
 */
describe('DesignerService -- every draft save names the version it was read at', () => {
    let http: HttpTestingController;
    let designer: DesignerService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        designer = TestBed.inject(DesignerService);
    });

    afterEach(() => http.verify());

    it('a workflow save sends If-Match with the version read; one with no version read only creates', () => {
        designer.saveWorkflowDraft('claim', '{}', 'w1').subscribe();
        const named = http.expectOne('/api/v1/workflows/claim/draft');
        expect(named.request.headers.get('If-Match')).toBe('"w1"');
        expect(named.request.headers.has('If-None-Match')).toBeFalse();
        named.flush({ definitionKey: 'claim', body: '{}', lastModifiedAt: '', contentHash: 'w2' });

        designer.saveWorkflowDraft('claim', '{}', null).subscribe();
        const fresh = http.expectOne('/api/v1/workflows/claim/draft');
        expect(fresh.request.headers.get('If-None-Match')).toBe('*');
        expect(fresh.request.headers.has('If-Match')).toBeFalse();
        fresh.flush({});
    });

    it('a state-machine save sends If-Match with the version read', () => {
        designer.saveStateMachineDraft('order', '{}', 's3').subscribe();
        const req = http.expectOne('/api/v1/state-machines/order/draft');
        expect(req.request.headers.get('If-Match')).toBe('"s3"');
        req.flush({ key: 'order', body: '{}', latestVersion: 1, contentHash: 's4' });
    });

    it('a decision draft: the version is the read\'s ETag, the save names it, and answers the ETag it wrote', () => {
        let read: { xml: string; version: DraftVersion } | undefined;
        designer.getDraft('discount').subscribe(r => (read = r));
        http.expectOne('/api/v1/decisions/discount/draft').flush('<definitions/>', { headers: { ETag: '"d1"' } });
        expect(read).toEqual({ xml: '<definitions/>', version: 'd1' });

        let wrote: DraftVersion | undefined;
        designer.saveDraft('discount', '<definitions/>', 'd1').subscribe(v => (wrote = v));
        const put = http.expectOne('/api/v1/decisions/discount/draft');
        expect(put.request.headers.get('If-Match')).toBe('"d1"');
        put.flush('', { status: 204, statusText: 'No Content', headers: { ETag: '"d2"' } });
        expect(wrote).toBe('d2');
    });

    it('a decision read with no ETag names no version, and its save only creates', () => {
        let read: { xml: string; version: DraftVersion } | undefined;
        designer.getDraft('fresh').subscribe(r => (read = r));
        http.expectOne('/api/v1/decisions/fresh/draft').flush('<definitions/>');
        expect(read?.version).toBeNull();

        designer.saveDraft('fresh', '<definitions/>', null).subscribe();
        expect(http.expectOne('/api/v1/decisions/fresh/draft').request.headers.get('If-None-Match')).toBe('*');
    });
});

/**
 * Two sessions on one draft, against a fake that keeps it the way the server does: a save naming the current version is
 * applied and answers the next; one naming another is refused 412; one naming none (If-None-Match: *) is applied only
 * when there is no draft. The pages are built for real, the designer's canvas included.
 */
describe('Designer pages -- two sessions on one draft', () => {
    type Stored = { body: string; hash: string } | null;
    let drafts: { workflow: Stored; machine: Stored; decision: Stored };
    let saves: { [k: string]: number };
    let routeKey = '';

    const refused = (status: number) => throwError(() => new HttpErrorResponse({ status, statusText: status === 412 ? 'Precondition Failed' : 'Not Found' }));
    const next = (h: string) => h.replace(/\d+$/, n => String(Number(n) + 1));

    /** The server's rule for one draft: the version named, or none for a draft not there yet. */
    function write(kind: 'workflow' | 'machine' | 'decision', body: string, version: DraftVersion): Observable<string> {
        saves[kind] = (saves[kind] ?? 0) + 1;
        const cur = drafts[kind];
        if (version === null ? cur !== null : cur === null) return refused(cur === null ? 404 : 412);
        if (cur !== null && cur.hash !== version) return refused(412);
        const hash = cur === null ? kind[0] + '1' : next(cur.hash);
        drafts[kind] = { body, hash };
        return of(hash);
    }

    let designer: { [k: string]: jasmine.Spy };

    beforeEach(() => {
        drafts = {
            workflow: { body: bpmnLiteModelToJson(emptyBpmnLiteModel('claim')), hash: 'w1' },
            machine: { body: JSON.stringify(emptyStateMachineModel('order')), hash: 's1' },
            decision: { body: writeDrdXml(emptyDmnDrdModel('discount')), hash: 'd1' },
        };
        saves = {};
        designer = {
            getWorkflowDraft: jasmine.createSpy('getWorkflowDraft').and.callFake(() => of({
                definitionKey: 'claim', body: drafts.workflow?.body ?? '', lastModifiedAt: '', contentHash: drafts.workflow?.hash ?? null,
            })),
            saveWorkflowDraft: jasmine.createSpy('saveWorkflowDraft').and.callFake((_k: string, body: string, v: DraftVersion) =>
                new Observable(sub => write('workflow', body, v).subscribe({
                    next: hash => { sub.next({ definitionKey: 'claim', body, lastModifiedAt: '', contentHash: hash }); sub.complete(); },
                    error: e => sub.error(e),
                }))),
            deployWorkflow: jasmine.createSpy('deployWorkflow').and.returnValue(of({ version: 2 })),
            listWorkflowHandlers: jasmine.createSpy('listWorkflowHandlers').and.returnValue(of([])),
            listForms: jasmine.createSpy('listForms').and.returnValue(of([])),
            getStateMachineDraft: jasmine.createSpy('getStateMachineDraft').and.callFake(() => of({
                key: 'order', body: drafts.machine?.body ?? '{}', latestVersion: 1, contentHash: drafts.machine?.hash ?? null,
            })),
            saveStateMachineDraft: jasmine.createSpy('saveStateMachineDraft').and.callFake((_k: string, body: string, v: DraftVersion) =>
                new Observable(sub => write('machine', body, v).subscribe({
                    next: hash => { sub.next({ key: 'order', body, latestVersion: 1, contentHash: hash }); sub.complete(); },
                    error: e => sub.error(e),
                }))),
            deployStateMachine: jasmine.createSpy('deployStateMachine').and.returnValue(of({ version: 2 })),
            getDraft: jasmine.createSpy('getDraft').and.callFake(() => drafts.decision === null
                ? refused(404)
                : of({ xml: drafts.decision.body, version: drafts.decision.hash })),
            saveDraft: jasmine.createSpy('saveDraft').and.callFake((_k: string, xml: string, v: DraftVersion) => write('decision', xml, v)),
            deploy: jasmine.createSpy('deploy').and.returnValue(of({ version: 2 })),
        };
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                {
                    provide: ActivatedRoute,
                    useValue: { snapshot: { get paramMap() { return convertToParamMap({ key: routeKey }); }, queryParamMap: convertToParamMap({}) } },
                },
                { provide: DesignerService, useValue: designer },
                { provide: DesignerI18nService, useValue: { ensureLoaded: () => Promise.resolve(), translate: (k: string) => k } },
                { provide: ToastService, useValue: { success: () => undefined, error: () => undefined, info: () => undefined } },
                { provide: UnsavedChangesService, useValue: { watch: () => () => undefined } },
                { provide: KeyboardScopeService, useValue: { bind: () => () => undefined } },
            ],
        });
    });

    async function page<T extends { isLoading(): boolean }>(type: Type<T>, key: string): Promise<ComponentFixture<T>> {
        routeKey = key;
        const f = TestBed.createComponent(type);
        f.detectChanges();
        for (let i = 0; i < 200 && f.componentInstance.isLoading(); i++) {
            await new Promise(r => setTimeout(r, 5));
        }
        f.detectChanges();
        return f;
    }

    type Versioned = { conflict(): string | null; onSave(): Promise<void>; onDeploy(): Promise<void>; reloadAfterConflict(): void };
    const of$ = (f: ComponentFixture<unknown>) => f.componentInstance as unknown as Versioned;
    const banner = (f: ComponentFixture<unknown>) => { f.detectChanges(); return (f.nativeElement as HTMLElement).querySelector('app-draft-conflict') !== null; };
    const settle = () => new Promise(r => setTimeout(r, 0));

    it('workflow: the second save is refused, said, never retried; Reload reads the new version, and then saves', async () => {
        const alice = await page(BpmnEditorPage, 'claim');
        const bob = await page(BpmnEditorPage, 'claim');

        await of$(bob).onSave();
        expect(drafts.workflow?.hash).toBe('w2');

        await of$(alice).onSave().catch(() => undefined);
        expect(of$(alice).conflict()).toBe('changed');
        expect(banner(alice)).withContext('the page says so').toBeTrue();
        expect(drafts.workflow?.hash).withContext('Bob\'s save stands').toBe('w2');

        await of$(alice).onSave();
        await of$(alice).onDeploy();
        expect(saves['workflow']).withContext('one save each: the refused one is not retried, nor sent again').toBe(2);
        expect(designer['deployWorkflow']).not.toHaveBeenCalled();

        of$(alice).reloadAfterConflict();
        await settle();
        expect(of$(alice).conflict()).toBeNull();
        await of$(alice).onSave();
        expect(drafts.workflow?.hash).withContext('saved over the version reloaded').toBe('w3');
    });

    it('one decision file, two editors: the requirements diagram saves; the table, read before it, is refused', async () => {
        const table = await page(DmnEditorPage, 'discount');
        const diagram = await page(DecisionDrdEditorPage, 'discount');

        await of$(diagram).onSave();
        expect((drafts.decision as Stored)?.hash).toBe('d2');

        await of$(table).onSave().catch(() => undefined);
        expect(of$(table).conflict()).toBe('changed');
        expect((drafts.decision as Stored)?.hash).toBe('d2');
        expect(saves['decision']).toBe(2);
    });

    it('state machine: a refused save leaves Deploy refused too; a deploy that fails after its save is no conflict', async () => {
        const alice = await page(StateMachineEditorPage, 'order');
        const bob = await page(StateMachineEditorPage, 'order');

        await of$(bob).onSave();
        await of$(alice).onDeploy();
        expect(of$(alice).conflict()).toBe('changed');
        expect(designer['deployStateMachine']).not.toHaveBeenCalled();

        designer['deployStateMachine'].and.returnValue(refused(404));
        await of$(bob).onDeploy();
        expect(of$(bob).conflict()).withContext('the save went through; the deploy failing is not a conflict').toBeNull();
    });

    it('a new decision (no draft yet): its save only creates, and one made meanwhile is never written over', async () => {
        drafts.decision = null;
        const first = await page(DecisionDrdEditorPage, 'discount');
        const second = await page(DecisionDrdEditorPage, 'discount');

        await of$(first).onSave();
        expect((drafts.decision as Stored)?.hash).withContext('created').toBe('d1');

        await of$(second).onSave();
        expect(of$(second).conflict()).withContext('a draft appeared since its read').toBe('changed');
        expect((drafts.decision as Stored)?.hash).toBe('d1');
    });
});
