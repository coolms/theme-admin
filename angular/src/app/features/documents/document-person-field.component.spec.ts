import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Store } from '@ngxs/store';
import { AuthState, EntitySearchService } from '@coolms/core-angular';
import { CmsEntityPickerComponent } from '@coolms/ui-angular';

import { DocumentPersonFieldComponent } from './document-person-field.component';
import { DocumentRecipientAccess } from './document-recipient-access.service';
import { DocumentRecipientSearchService } from './document-recipient-search.service';

/** The person entity as the server's boot data names it (a made-up name: the theme never spells the real one). */
const PERSON = 'Acme\\Entity\\Person';
const ME = { id: 'u-me', fullName: 'Ada Lovelace', roles: [], email: '' };

/** Only what a person can do is shown: someone who may not choose others generates for themselves. */
describe('DocumentPersonFieldComponent', () => {
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: (sel: unknown) => (sel === AuthState.currentUser ? ME : { apiBase: '/api/v1', document: { filterAudienceEntity: PERSON } }),
                    },
                },
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });

    const render = (entityType = PERSON, collection = false) => {
        const fixture = TestBed.createComponent(DocumentPersonFieldComponent);
        const emitted: unknown[] = [];
        fixture.componentRef.setInput('entityType', entityType);
        fixture.componentRef.setInput('collection', collection);
        fixture.componentRef.setInput('inputId', 'f-1');
        fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
        fixture.detectChanges();
        return { fixture, emitted };
    };
    const answer = (status: number): void => {
        const req = http.expectOne((r) => r.url === '/api/v1/document/recipients');
        expect(req.request.params.get('limit')).toBe('1');
        if (status === 200) req.flush([]);
        else req.flush('refused', { status, statusText: 'Refused' });
    };

    it('for someone who may not choose others: "This document is for you", their name, them chosen, and no search', () => {
        const { fixture, emitted } = render();
        answer(403);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.textContent).toContain('This document is for you.');
        expect(el.textContent).toContain('Ada Lovelace');
        expect(el.querySelector('input')).withContext('no search field').toBeNull();
        expect(fixture.debugElement.query(By.directive(CmsEntityPickerComponent))).toBeNull();
        expect(emitted).toEqual(['u-me']);
    });

    it('a list of persons is them alone', () => {
        const { fixture, emitted } = render(PERSON, true);
        answer(403);
        fixture.detectChanges();
        expect(emitted).toEqual([['u-me']]);
    });

    it('for someone who may choose: the picker, searching the people a document may go to', () => {
        const { fixture, emitted } = render();
        answer(200);
        fixture.detectChanges();
        const picker = fixture.debugElement.query(By.directive(CmsEntityPickerComponent));
        expect(picker).not.toBeNull();
        expect(picker.injector.get(EntitySearchService)).toBeInstanceOf(DocumentRecipientSearchService);
        expect(emitted).withContext('nothing chosen for them').toEqual([]);
    });

    it('another entity is picked as everywhere else, whoever asks', () => {
        const { fixture } = render('Acme\\Entity\\Page');
        answer(403);
        fixture.detectChanges();
        expect(fixture.debugElement.query(By.directive(CmsEntityPickerComponent))).not.toBeNull();
    });

    it('asks the server once, and leaves any failure but a refusal to the server', () => {
        const access = TestBed.inject(DocumentRecipientAccess);
        access.load();
        access.load();
        answer(500);
        http.verify();
        expect(access.choice()).toBe('others');
    });
});
