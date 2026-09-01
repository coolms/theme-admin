import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ContextInputFormComponent } from './context-input-form.component';
import type { ContextFormValue } from './context-form.helpers';
import { type FormVariableInput } from '../shared/document-explorer.types';

/**
 * Phase 2 ext regression guard — exercises the value-emission
 * pipeline that the Generate dialog depends on. Earlier shape of the
 * constructor effect read `this.formData()` inside the same effect
 * that called `formData.set(...)`. Angular's signal tracking
 * registered `formData` as a dependency, so every user-driven
 * `writeField()` retriggered the effect, which reset `formData`
 * back to `structuredClone(initialValue())` (i.e. `{}` when no
 * parent passed an initial value) and emitted `{}` upward —
 * clobbering the picker's emitted selection before Generate fired.
 * The dialog therefore POSTed `explicitVariables: {}` no matter
 * what the user picked.
 *
 * The spec asserts three invariants:
 *   1. A `writeField` call propagates the value to subscribers.
 *   2. The `@`-prefixed entity-alias path (Phase 2 ext) survives
 *      the round-trip — `getNestedValue` / `setNestedValue` do
 *      not strip or transform it.
 *   3. The most recent emit is the user's value, not a stale `{}`
 *      from the seed effect — i.e. the effect doesn't re-fire on
 *      `formData` changes after the user types.
 */
describe('ContextInputFormComponent — Phase 2 ext value emission', () => {
    let component: ContextInputFormComponent;
    let emitted: ContextFormValue[];

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [ContextInputFormComponent],
 // The component injects EntitySearchService, which injects
 // HttpClient. Nothing here issues a request, but the injector
 // still has to be able to construct the chain.
            providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
        });
        const fixture = TestBed.createComponent(ContextInputFormComponent);
        component = fixture.componentInstance;

 // Schema must include the variable so `writeField` is
 // semantically meaningful from the form's perspective; the
 // test doesn't render the template — we drive the public
 // signal/method surface directly.
        const variables: readonly FormVariableInput[] = [
            {
                path:       '@identity_user',
                label:      null,
                entityType: 'App\\Identity\\Domain\\Entity\\User',
                collection: false,
                fields:     null,
            },
            { path: 'metadata.generatedAt', label: null },
        ];
        fixture.componentRef.setInput('variables', variables);

        emitted = [];
        component.valueChange.subscribe((v: ContextFormValue) => emitted.push(v));

 // Run the constructor effect once so the initial-seed emit
 // (`{}`) reaches our spy.
        fixture.detectChanges();
    });

 it('emits the user value verbatim after writeField (no clobber by the seed effect)', () => {
 // Picker emission would call writeField('@identity_user', '<uuid>')
 // from the template's (valueChange) binding. The form must
 // emit that value upward; the dialog's `onVariablesChange`
 // is bound to this output and stores the snapshot in its
 // `variables` signal.
        (component as unknown as {
            writeField(p: string, v: string | string[] | null): void;
        }).writeField('@identity_user', '01HX-test-uuid');

        const latest = emitted[emitted.length - 1];
        expect(latest).toEqual({ '@identity_user': '01HX-test-uuid' });
    });

 it('preserves `@`-prefixed key through nested-JSON round-trip', () => {
        const writer = component as unknown as {
            writeField(p: string, v: string | string[] | null): void;
        };
        writer.writeField('@identity_user', 'uuid-a');
        writer.writeField('metadata.generatedAt', '2026-05-13T10:00:00Z');

        const latest = emitted[emitted.length - 1];
        expect(Object.keys(latest).sort()).toEqual(['@identity_user', 'metadata']);
        expect(latest['@identity_user']).toBe('uuid-a');
        expect((latest['metadata'] as Record<string, unknown>)['generatedAt'])
            .toBe('2026-05-13T10:00:00Z');
    });

 it('does not regress to `{}` on subsequent writes (effect cycle)', () => {
        const writer = component as unknown as {
            writeField(p: string, v: string | string[] | null): void;
        };
        writer.writeField('@identity_user', 'uuid-1');
        writer.writeField('@identity_user', 'uuid-2');
        writer.writeField('@identity_user', 'uuid-3');

 // If the effect re-fired on every formData change, the last
 // emit would be `{}` (or some stale state). It must instead
 // be the most recent user value.
        const latest = emitted[emitted.length - 1];
        expect(latest).toEqual({ '@identity_user': 'uuid-3' });
    });

 it('supports collection-mode emission (string[] preserved)', () => {
        const writer = component as unknown as {
            writeField(p: string, v: string | string[] | null): void;
        };
        writer.writeField('@identity_user', ['uuid-a', 'uuid-b']);

        const latest = emitted[emitted.length - 1];
        expect(latest['@identity_user']).toEqual(['uuid-a', 'uuid-b']);
    });

 it('supports null clear (explicit picker deselect)', () => {
        const writer = component as unknown as {
            writeField(p: string, v: string | string[] | null): void;
        };
        writer.writeField('@identity_user', 'uuid-a');
        writer.writeField('@identity_user', null);

        const latest = emitted[emitted.length - 1];
        expect(latest['@identity_user']).toBeNull();
    });
});
