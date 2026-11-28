import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Store } from '@ngxs/store';
import { type EntitySearchResult } from '@coolms/core-angular';

import { DocumentRecipientSearchService } from './document-recipient-search.service';
import { ContextInputFormComponent } from './explorer/context-input-form.component';
import { CmsWizardAudienceStepComponent } from './generation-wizard/steps/audience-step.component';
import { DocumentPersonFieldComponent } from './document-person-field.component';

/** The person entity as the server's boot data names it (a made-up name: the theme never spells the real one). */
const PERSON_ENTITY_TYPE = 'Acme\\Entity\\Person';
const STORE = { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1', document: { filterAudienceEntity: PERSON_ENTITY_TYPE } }) } };

/** A person in a document's picker is found among the people a document may go to. */
describe('DocumentRecipientSearchService', () => {
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                STORE,
                DocumentRecipientSearchService,
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('searches a person on the recipients endpoint, labelled by name with the address beneath', () => {
        let rows: EntitySearchResult[] = [];
        TestBed.inject(DocumentRecipientSearchService).search(PERSON_ENTITY_TYPE, 'ada', 80).subscribe((r) => (rows = r));
        const req = http.expectOne((r) => r.url === '/api/v1/document/recipients');
        expect(req.request.params.get('q')).toBe('ada');
        expect(req.request.params.get('limit')).toBe('50');
        expect(req.request.headers.get('Accept')).toBe('application/json');
        req.flush([
            { id: 'u1', name: 'Ada Lovelace', address: 'ada@example.test' },
            { id: 'u2', name: 'No name', address: null },
        ]);
        expect(rows).toEqual([
            { id: 'u1', label: 'Ada Lovelace', secondary: 'ada@example.test' },
            { id: 'u2', label: 'No name' },
        ]);
    });

    it('searches any other entity type as everywhere else', () => {
        TestBed.inject(DocumentRecipientSearchService).search('Acme\\Entity\\Page', 'home').subscribe();
        const req = http.expectOne((r) => r.url === '/api/entity-search');
        expect(req.request.params.get('type')).toBe('Acme\\Entity\\Page');
        req.flush([]);
    });
});

describe('the document forms take a person through the person field', () => {
    const person = { path: '@recipient', label: null, entityType: PERSON_ENTITY_TYPE, collection: false, fields: null };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                STORE,
            ],
        });
    });

    it('in the context form', () => {
        const fixture = TestBed.createComponent(ContextInputFormComponent);
        fixture.componentRef.setInput('variables', [person]);
        fixture.detectChanges();
        expect(fixture.debugElement.query(By.directive(DocumentPersonFieldComponent))).withContext('the form takes a person through it').not.toBeNull();
    });

    it('in the wizard', () => {
        const fixture = TestBed.createComponent(CmsWizardAudienceStepComponent);
        fixture.componentRef.setInput('variables', [{ path: '@recipient.name', filters: [], loopAlias: null, entityType: PERSON_ENTITY_TYPE }]);
        fixture.componentRef.setInput('mode', 'single');
        fixture.detectChanges();
        expect(fixture.debugElement.query(By.directive(DocumentPersonFieldComponent))).withContext('the Audience step takes a person through it').not.toBeNull();
    });
});
