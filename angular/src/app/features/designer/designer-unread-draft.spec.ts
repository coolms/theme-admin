import { type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { map, of, throwError, type Observable } from 'rxjs';
import { KeyboardScopeService, ToastService, UnsavedChangesService } from '@coolms/ui-angular';
import { bpmnLiteModelToJson, emptyBpmnLiteModel } from '@coolms/designer/bpmn-lite';
import { emptyStateMachineModel } from '@coolms/designer/state-machine';
import { emptyDmnDrdModel, writeDrdXml } from '@coolms/designer/dmn-drd';
import { BpmnEditorPage } from './bpmn-editor.page';
import { DmnEditorPage } from './dmn-editor.page';
import { StateMachineEditorPage } from './state-machine-editor.page';
import { DecisionDrdEditorPage } from './decision-drd-editor.page';
import { DesignerService } from './designer.service';
import { DesignerI18nService } from './designer-i18n.service';

/**
 * The designer never saves over a draft it could not read.
 *
 * Before, a draft read that failed -- or whose body did not parse -- left a blank, editable canvas with Save and
 * Deploy on, and Save wrote the blank over the stored draft: the draft endpoints keep no version, so nothing on the
 * server could refuse it. Now the canvas and its footer are not shown, Save and Deploy refuse, and the banner's Retry
 * reads again. The pages are built for real, the designer's canvas included; only the server is stubbed.
 */
describe('Designer pages -- a draft that could not be read is never saved over', () => {
    let designer: { [k: string]: jasmine.Spy };
    /** The key the route carries: the state-machine and requirements pages read it there, having no input. */
    let routeKey = '';

    function configure(draft: Observable<unknown>, decision: Observable<string>, machine: Observable<unknown> = of(null)): void {
        designer = {
            getWorkflowDraft: jasmine.createSpy('getWorkflowDraft').and.returnValue(draft),
            saveWorkflowDraft: jasmine.createSpy('saveWorkflowDraft').and.returnValue(of({ lastModifiedAt: null })),
            deployWorkflow: jasmine.createSpy('deployWorkflow').and.returnValue(of({ version: 2 })),
            listWorkflowHandlers: jasmine.createSpy('listWorkflowHandlers').and.returnValue(of([])),
            listForms: jasmine.createSpy('listForms').and.returnValue(of([])),
            getDraft: jasmine.createSpy('getDraft').and.returnValue(decision.pipe(map(xml => ({ xml, version: 'd1' })))),
            saveDraft: jasmine.createSpy('saveDraft').and.returnValue(of('d2')),
            deploy: jasmine.createSpy('deploy').and.returnValue(of({ version: 2 })),
            getStateMachineDraft: jasmine.createSpy('getStateMachineDraft').and.returnValue(machine),
            saveStateMachineDraft: jasmine.createSpy('saveStateMachineDraft').and.returnValue(of({ key: 'order', body: '{}', latestVersion: 1 })),
            deployStateMachine: jasmine.createSpy('deployStateMachine').and.returnValue(of({ version: 2 })),
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
    }

    async function settled<T extends { isLoading(): boolean }>(f: ComponentFixture<T>): Promise<void> {
        for (let i = 0; i < 200 && f.componentInstance.isLoading(); i++) {
            await new Promise(r => setTimeout(r, 5));
        }
        f.detectChanges();
        if (f.componentInstance.isLoading()) throw new Error('the page never finished loading');
    }

    async function workflowPage(): Promise<ComponentFixture<BpmnEditorPage>> {
        const f = TestBed.createComponent(BpmnEditorPage);
        f.componentRef.setInput('key', 'claim');
        f.detectChanges();
        await settled(f);
        return f;
    }

    async function decisionPage(): Promise<ComponentFixture<DmnEditorPage>> {
        const f = TestBed.createComponent(DmnEditorPage);
        f.componentRef.setInput('key', 'discount');
        f.detectChanges();
        await settled(f);
        return f;
    }

    async function built<T extends { isLoading(): boolean }>(type: Type<T>, key: string): Promise<ComponentFixture<T>> {
        routeKey = key;
        const f = TestBed.createComponent(type);
        f.detectChanges();
        await settled(f);
        return f;
    }

    type Guarded = { draftUnread(): boolean; onSave(): Promise<void>; onDeploy(): Promise<void> };
    const failed = () => throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' }));
    const machine = (body: string) => of({ key: 'order', body, latestVersion: 1 });
    const draft = (body: string) => of({ body, lastModifiedAt: null, latestVersionSource: null, moduleLock: false });
    const hidden = (f: ComponentFixture<unknown>, chrome: string): boolean =>
        (f.nativeElement as HTMLElement).querySelector(chrome)?.classList.contains('d-none') ?? false;

    it('workflow: a failed read hides the canvas, and Save and Deploy write nothing', async () => {
        configure(failed(), of(''));
        const f = await workflowPage();
        const page = f.componentInstance as unknown as { draftUnread(): boolean; onSave(): Promise<void>; onDeploy(): Promise<void> };

        expect(page.draftUnread()).toBeTrue();
        expect(hidden(f, '.bpmn-editor-page__chrome')).withContext('no canvas, no footer').toBeTrue();
        await page.onSave();
        await page.onDeploy();
        expect(designer['saveWorkflowDraft']).not.toHaveBeenCalled();
        expect(designer['deployWorkflow']).not.toHaveBeenCalled();
    });

    it('workflow: a body that does not parse is not an empty diagram -- said in the banner, never saved over', async () => {
        configure(draft('{"this is": "not a diagram"'), of(''));
        const f = await workflowPage();
        const page = f.componentInstance as unknown as { draftUnread(): boolean; loadError(): string | null; onSave(): Promise<void> };

        expect(page.draftUnread()).toBeTrue();
        expect(page.loadError()).toContain('Failed to parse body');
        await page.onSave();
        expect(designer['saveWorkflowDraft']).not.toHaveBeenCalled();
    });

    it('workflow, the control: a draft read whole is saved', async () => {
        configure(draft(bpmnLiteModelToJson(emptyBpmnLiteModel('claim'))), of(''));
        const f = await workflowPage();
        const page = f.componentInstance as unknown as { draftUnread(): boolean; onSave(): Promise<void> };

        expect(page.draftUnread()).toBeFalse();
        expect(hidden(f, '.bpmn-editor-page__chrome')).toBeFalse();
        await page.onSave();
        expect(designer['saveWorkflowDraft']).toHaveBeenCalledTimes(1);
    });

    it('decision table: a failed read hides the table, and Save and Deploy write nothing', async () => {
        configure(draft(''), failed() as Observable<string>);
        const f = await decisionPage();
        const page = f.componentInstance as unknown as { draftUnread(): boolean; onSave(): Promise<void>; onDeploy(): Promise<void> };

        expect(page.draftUnread()).toBeTrue();
        expect(hidden(f, '.dmn-editor-page__chrome')).toBeTrue();
        await page.onSave();
        await page.onDeploy();
        expect(designer['saveDraft']).not.toHaveBeenCalled();
        expect(designer['deploy']).not.toHaveBeenCalled();
    });

    it('state machine: a failed read hides the canvas, and Save and Deploy write nothing', async () => {
        configure(draft(''), of(''), failed());
        const f = await built(StateMachineEditorPage, 'order');
        const page = f.componentInstance as unknown as Guarded;

        expect(page.draftUnread()).toBeTrue();
        expect(hidden(f, '.sm-editor-page__chrome')).toBeTrue();
        await page.onSave();
        await page.onDeploy();
        expect(designer['saveStateMachineDraft']).not.toHaveBeenCalled();
        expect(designer['deployStateMachine']).not.toHaveBeenCalled();
    });

    it('state machine: a body that is not JSON is not an empty machine -- never saved over', async () => {
        configure(draft(''), of(''), machine('{"states": ['));
        const page = (await built(StateMachineEditorPage, 'order')).componentInstance as unknown as Guarded;

        expect(page.draftUnread()).toBeTrue();
        await page.onSave();
        expect(designer['saveStateMachineDraft']).not.toHaveBeenCalled();
    });

    it('state machine, the control: a draft read whole is saved', async () => {
        configure(draft(''), of(''), machine(JSON.stringify(emptyStateMachineModel('order'))));
        const page = (await built(StateMachineEditorPage, 'order')).componentInstance as unknown as Guarded;

        expect(page.draftUnread()).toBeFalse();
        await page.onSave();
        expect(designer['saveStateMachineDraft']).toHaveBeenCalledTimes(1);
    });

    it('requirements diagram: a failed read hides the canvas, and Save and Deploy write nothing', async () => {
        configure(draft(''), failed() as Observable<string>);
        const f = await built(DecisionDrdEditorPage, 'discount');
        const page = f.componentInstance as unknown as Guarded;

        expect(page.draftUnread()).toBeTrue();
        expect(hidden(f, '.drd-editor-page__chrome')).toBeTrue();
        await page.onSave();
        await page.onDeploy();
        expect(designer['saveDraft']).not.toHaveBeenCalled();
        expect(designer['deploy']).not.toHaveBeenCalled();
    });

    it('requirements diagram: a decision file it cannot read is never saved over (its tables would go)', async () => {
        configure(draft(''), of('<definitions><decision id="d"><decisionTable'));
        const page = (await built(DecisionDrdEditorPage, 'discount')).componentInstance as unknown as Guarded;

        expect(page.draftUnread()).toBeTrue();
        await page.onSave();
        expect(designer['saveDraft']).not.toHaveBeenCalled();
    });

    it('requirements diagram, the controls: a diagram read whole is saved, and so is a new decision (404)', async () => {
        configure(draft(''), of(writeDrdXml(emptyDmnDrdModel('discount'))));
        const page = (await built(DecisionDrdEditorPage, 'discount')).componentInstance as unknown as Guarded;
        expect(page.draftUnread()).toBeFalse();
        await page.onSave();
        expect(designer['saveDraft']).toHaveBeenCalledTimes(1);

        TestBed.resetTestingModule();
        configure(draft(''), throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })));
        const fresh = (await built(DecisionDrdEditorPage, 'discount')).componentInstance as unknown as Guarded;
        expect(fresh.draftUnread()).withContext('a new decision has no draft yet: its blank is right').toBeFalse();
        await fresh.onSave();
        expect(designer['saveDraft']).toHaveBeenCalledTimes(1);
    });

    it('decision table, the control: an empty draft (a new decision) is saved', async () => {
        configure(draft(''), of(''));
        const f = await decisionPage();
        const page = f.componentInstance as unknown as { draftUnread(): boolean; onSave(): Promise<void> };

        expect(page.draftUnread()).toBeFalse();
        await page.onSave();
        expect(designer['saveDraft']).toHaveBeenCalledTimes(1);
    });
});
