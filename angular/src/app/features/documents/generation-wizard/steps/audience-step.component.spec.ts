import { TestBed } from '@angular/core/testing';
import { CmsWizardAudienceStepComponent } from './audience-step.component';
import { FilterAudienceEntity } from '../filter-audience-entity';
import type { ContextSchemaVariable } from '../../shared/document-explorer.types';

/**
 * Step 2 of the caller-fillable order: the wizard shows only the variables the template's author switched on as
 * "Filled by the caller". The entity references keep their pickers: their ids go to the audience, which the server
 * checks when the generation is submitted, and never to a value the caller types.
 */
describe('CmsWizardAudienceStepComponent -- what the caller is asked for', () => {
    const RECORD = 'Acme\\Crm\\Customer';
    const v = (path: string, extra: Partial<ContextSchemaVariable> = {}): ContextSchemaVariable =>
        ({ path, filters: [], loopAlias: null, ...extra });

    const variables: ContextSchemaVariable[] = [
        v('customer.name', { callerFillable: true }),
        v('customer.name', { callerFillable: true, filters: ['upper'] }),
        v('customer.email'),
        v('metadata.generatedAt'),
        v('item.title', { loopAlias: 'item', callerFillable: true }),
        v('@identity_user', { entityType: RECORD }),
    ];

    const step = (mode: 'single' | 'filter' = 'single') => {
        TestBed.configureTestingModule({
            providers: [{ provide: FilterAudienceEntity, useValue: { matches: () => false, value: () => RECORD } }],
        });
        const fixture = TestBed.createComponent(CmsWizardAudienceStepComponent);
        fixture.componentRef.setInput('variables', variables);
        fixture.componentRef.setInput('mode', mode);
        return fixture.componentInstance;
    };

    it('asks only for the switched-on variables, each once', () => {
        const inputs = step()['plainVariableInputs']();

        expect(inputs.map(i => i.path)).toEqual(['customer.name', 'item.title']);
    });

    it('keeps the entity reference as a picker, outside the variables the caller types', () => {
        const component = step();

        expect(component['entityRefs']().map(r => r.path)).toEqual(['@identity_user']);
        expect(component['plainVariableInputs']().map(i => i.path)).not.toContain('@identity_user');
    });
});
