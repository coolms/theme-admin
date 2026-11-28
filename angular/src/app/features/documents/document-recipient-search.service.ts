import { Injectable, inject } from '@angular/core';
import { type Observable, map } from 'rxjs';
import { EntitySearchService, type EntitySearchResult } from '@coolms/core-angular';
import { DocumentsApiService } from './documents-api.service';
import { FilterAudienceEntity } from './generation-wizard/filter-audience-entity';

/**
 * The entity search the document pickers use: a person (the entity the server names as a document's recipient) is
 * searched among the people a document may go to (the recipients endpoint, open to document operators), labelled by
 * name with the address beneath; any other entity type is searched as everywhere else. Provided by the components
 * that hold the pickers.
 */
@Injectable()
export class DocumentRecipientSearchService extends EntitySearchService {
    private readonly documents = inject(DocumentsApiService);
    private readonly person = inject(FilterAudienceEntity);

    override search(entityType: string, query: string, limit = 20): Observable<EntitySearchResult[]> {
        if (!this.person.matches(entityType)) {
            return super.search(entityType, query, limit);
        }
        return this.documents.searchDocumentRecipients(query, limit).pipe(
            map((rows) => rows.map((r) => ({ id: r.id, label: r.name, ...(r.address ? { secondary: r.address } : {}) }))),
        );
    }
}
