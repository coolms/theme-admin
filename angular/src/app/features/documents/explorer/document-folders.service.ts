import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { type DocumentFolder } from '../shared/document-explorer.types';

interface HydraCollection<T> {
    'hydra:member'?: T[];
    member?: T[];
}

/**
 * Read-only folder listing for the Library tree. Backend serves both
 * spaces from the same endpoint; the `space` query param picks the
 * root and the `path` param navigates within it.
 *
 * Create / Delete / Rename land in F.13c.
 */
@Injectable({ providedIn: 'root' })
export class DocumentFoldersService {
    private readonly http = inject(HttpClient);

    listShared(parentRelPath = ''): Observable<DocumentFolder[]> {
        return this.list('shared', parentRelPath);
    }

    listPersonal(parentRelPath = ''): Observable<DocumentFolder[]> {
        return this.list('personal', parentRelPath);
    }

    private list(space: 'shared' | 'personal', parentRelPath: string): Observable<DocumentFolder[]> {
        const params = new HttpParams()
            .set('space', space)
            .set('path', parentRelPath);

        return new Observable<DocumentFolder[]>((subscriber) => {
            this.http
                .get<HydraCollection<DocumentFolder> | DocumentFolder[]>(
                    '/api/v1/document/folders',
                    { params },
                )
                .subscribe({
                    next: (response) => {
                        const list = Array.isArray(response)
                            ? response
                            : response['hydra:member'] ?? response.member ?? [];
                        subscriber.next(list);
                        subscriber.complete();
                    },
                    error: (err) => subscriber.error(err),
                });
        });
    }
}
