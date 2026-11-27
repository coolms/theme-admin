import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ToastService } from '@coolms/ui-angular';
import { CmsDocumentGenerationWizardComponent } from './cms-document-generation-wizard.component';
import { DocumentsApiService } from '../documents-api.service';
import { FilterAudienceEntity } from './filter-audience-entity';
import { WizardDraftService, type WizardDraft } from './wizard-draft.service';
import type { CreateDocumentGenerationPayload } from '../documents.types';
import type { DocumentTemplate } from '../shared/document-explorer.types';

/**
 * A generation sends only the values at a path the template's author switched on as "Filled by the caller". The
 * server refuses the whole request for any other (400), so a draft saved before the author switched a variable off
 * must not carry its value along.
 */
describe('CmsDocumentGenerationWizardComponent -- what a generation sends', () => {
    const template = {
        id: 't1',
        contextSchema: {
            variables: [
                { path: 'customer.name', filters: [], loopAlias: null, callerFillable: true },
                { path: 'customer.email', filters: [], loopAlias: null },
                { path: 'metadata.generatedAt', filters: [], loopAlias: null, callerFillable: true },
            ],
        },
    } as unknown as DocumentTemplate;

    const draft: WizardDraft = {
        version: 2,
        timestamp: Date.now(),
        templateId: 't1',
        currentStepId: 'review',
        mode: 'single',
        recipientsRql: '',
        recipientsCount: null,
        audience: {},
        plainVariables: {
            customer: { name: 'Ada', email: 'ada@example.test' },
            metadata: { generatedAt: '2001-01-01' },
        },
        outputBasePath: '/docs/',
        filenamePattern: 'letter.docx',
    };

    it('sends only the switched-on values from a restored draft, a server-filled root never', async () => {
        const sent: CreateDocumentGenerationPayload[] = [];
        TestBed.configureTestingModule({
            providers: [
                { provide: DIALOG_DATA, useValue: { template } },
                { provide: DialogRef, useValue: { close: () => undefined } },
                {
                    provide: DocumentsApiService,
                    useValue: {
                        createDocumentGeneration: (payload: CreateDocumentGenerationPayload) => {
                            sent.push(payload);
                            return of({ id: 'g1' });
                        },
                    },
                },
                { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
                {
                    provide: WizardDraftService,
                    useValue: {
                        maybeRestore: (_id: string, apply: (d: WizardDraft) => void) => apply(draft),
                        save: () => undefined,
                        clear: () => undefined,
                    },
                },
                { provide: FilterAudienceEntity, useValue: { matches: () => false, value: () => '' } },
            ],
        });
        const wizard = TestBed.createComponent(CmsDocumentGenerationWizardComponent).componentInstance;

        wizard.ngOnInit();
        await wizard.onSubmit();

        expect(sent.map(payload => payload.plainVariables)).toEqual([{ customer: { name: 'Ada' } }]);
    });
});

/** The wizard's subtitle names the template: its own name, or its id when it was never named. */
describe('CmsDocumentGenerationWizardComponent -- the template it names', () => {
    function subtitle(name: string, slug: string): string {
        TestBed.configureTestingModule({
            providers: [
                { provide: DIALOG_DATA, useValue: { template: { id: 't1', name, slug, contextSchema: { variables: [] } } as unknown as DocumentTemplate } },
                { provide: DialogRef, useValue: { close: () => undefined } },
                { provide: DocumentsApiService, useValue: { createDocumentGeneration: () => of({ id: 'g1' }) } },
                { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
                { provide: WizardDraftService, useValue: { maybeRestore: () => undefined, save: () => undefined, clear: () => undefined } },
                { provide: FilterAudienceEntity, useValue: { matches: () => false, value: () => '' } },
            ],
        });
        const fixture = TestBed.createComponent(CmsDocumentGenerationWizardComponent);
        fixture.detectChanges();
        const sub = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-test="template-name"]');
        return sub ? sub.textContent!.replace(/\s+/g, ' ').trim() + (sub.querySelector('code') ? ' [code]' : '') : '';
    }

    it('shows the template\'s name, in plain text, when it has one', () => {
        expect(subtitle('Welcome letter', 'welcome-letter')).toBe('Welcome letter');
    });

    it('shows the id when the template was never named (its name is its id)', () => {
        expect(subtitle('table-verify-1800', 'table-verify-1800')).toBe('Template table-verify-1800 [code]');
    });
});
