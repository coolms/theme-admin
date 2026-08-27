import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';
import {
    CreateFormRequest,
    FormDefinitionDto,
    FormFieldTypeDto,
    UpdateFormRequest,
} from './form.types';

/**
 * Data layer for the Form Builder admin (Track D.3). Wraps the Form module's
 * existing API surface:
 *
 *   - list / get   -> `GET /forms`, `GET /forms/{id}` (each row carries the
 *                     read-only `source` discriminator: shipped / db / file).
 *   - create       -> `POST /forms` (the create processor decodes the raw body,
 *                     so the client-supplied `id` is allowed despite API
 *                     Platform's usual id-on-POST rejection).
 *   - update       -> `PATCH /forms/{id}` (merge-patch; routes through the
 *                     Track D.2 chained writer — file-when-writable else DB,
 *                     shipped-form edits always land as a DB override).
 *   - delete       -> `DELETE /forms/{id}` (drops the user override; a
 *                     pure-shipped form cannot be hard-deleted -> 422).
 *   - field types  -> `GET /form-field-types` (builder palette + inspector).
 *
 * All write ops require ROLE_ADMIN (enforced server-side).
 */
@Injectable({ providedIn: 'root' })
export class FormService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    listForms(): Observable<FormDefinitionDto[]> {
        return this.http
            .get<HydraCollection<FormDefinitionDto>>(`${this.apiBase}/forms`)
            .pipe(map(r => r.member));
    }

    getForm(id: string): Observable<FormDefinitionDto> {
        return this.http.get<FormDefinitionDto>(`${this.apiBase}/forms/${encodeURIComponent(id)}`);
    }

    createForm(data: CreateFormRequest): Observable<FormDefinitionDto> {
        return this.http.post<FormDefinitionDto>(`${this.apiBase}/forms`, data, {
            headers: { 'Content-Type': 'application/ld+json' },
        });
    }

    updateForm(id: string, patch: UpdateFormRequest): Observable<FormDefinitionDto> {
        return this.http.patch<FormDefinitionDto>(
            `${this.apiBase}/forms/${encodeURIComponent(id)}`,
            patch,
            { headers: { 'Content-Type': 'application/merge-patch+json' } },
        );
    }

    deleteForm(id: string): Observable<void> {
        return this.http.delete<void>(`${this.apiBase}/forms/${encodeURIComponent(id)}`);
    }

    getFieldTypes(): Observable<FormFieldTypeDto[]> {
        return this.http
            .get<HydraCollection<FormFieldTypeDto>>(`${this.apiBase}/form-field-types`)
            .pipe(map(r => r.member));
    }
}
