import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';

import { DocumentPageStateService } from './document-page-state.service';
import { TemplateVariablesComponent } from './template-variables.component';
import { type DocumentTemplate } from '../shared/document-explorer.types';

/**
 * The "Filled by the caller" switch: a flip saves the whole schema with every entry of that path switched, the page's
 * copy of the template takes the server's answer, and a refusal is shown as the server worded it.
 */
describe('TemplateVariablesComponent', () => {
    let fixture: ComponentFixture<TemplateVariablesComponent>;
    let http: HttpTestingController;
    // The page state needs the store, the navigation graph and the preferences; the panel needs one signal of it.
    let state: { templates: WritableSignal<DocumentTemplate[]> };

    const template: DocumentTemplate = {
        id: '019e0000-0000-7000-8000-000000000001',
        name: 'Invoice',
        slug: 'invoice',
        description: null,
        native: true,
        contextSchema: {
            variables: [
                { path: 'customer.name', filters: [], loopAlias: null },
                { path: 'customer.name', filters: ['upper'], loopAlias: null },
                { path: 'metadata.generatedAt', filters: [], loopAlias: null },
            ],
            constants: [],
            loops: [],
            conditionals: [],
        },
        defaultOutputFormat: 'pdf',
        format: 'word',
    } as unknown as DocumentTemplate;

    beforeEach(() => {
        state = { templates: signal<DocumentTemplate[]>([template]) };
        TestBed.configureTestingModule({
            imports: [TemplateVariablesComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: DocumentPageStateService, useValue: state },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        fixture = TestBed.createComponent(TemplateVariablesComponent);
        fixture.componentRef.setInput('template', template);
        fixture.detectChanges();
    });

    afterEach(() => http.verify());

    function switchFor(path: string): HTMLInputElement | null {
        return (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(`input[data-path="${path}"]`);
    }

    it('offers the switch, off, for a plain value and none for a server-filled one', () => {
        expect(switchFor('customer.name')?.checked).toBeFalse();
        expect(switchFor('metadata.generatedAt')).toBeNull();
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('Filled by the server.');
    });

    it('saves the schema with every entry of the path switched on, and keeps the answer', () => {
        const input = switchFor('customer.name')!;
        input.checked = true;
        input.dispatchEvent(new Event('change'));

        const req = http.expectOne(`/api/v1/document/templates/${template.id}`);
        expect(req.request.method).toBe('PATCH');
        const sent = req.request.body.contextSchema.variables as { path: string; callerFillable?: boolean }[];
        expect(sent.map((v) => `${v.path}=${v.callerFillable === true}`)).toEqual([
            'customer.name=true',
            'customer.name=true',
            'metadata.generatedAt=false',
        ]);

        const answered = { ...template, contextSchema: req.request.body.contextSchema } as DocumentTemplate;
        req.flush(answered);

        expect(state.templates()[0]).toBe(answered);
    });

    it('shows a refusal as the server words it and leaves the page state alone', () => {
        const input = switchFor('customer.name')!;
        input.checked = true;
        input.dispatchEvent(new Event('change'));

        http.expectOne(`/api/v1/document/templates/${template.id}`).flush(
            { detail: 'A caller can never fill these variables: customer.name.' },
            { status: 422, statusText: 'Unprocessable Entity' },
        );
        fixture.detectChanges();

        expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent)
            .toContain('A caller can never fill these variables: customer.name.');
        expect(state.templates()[0]).toBe(template);
    });
});
