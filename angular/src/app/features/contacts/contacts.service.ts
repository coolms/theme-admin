import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';

/** C.2/C.3 — the two ownership axes of a contact. */
export type ContactVisibility = 'personal' | 'shared';

/** A labelled, repeatable value ({ value, label, primary }) — emails / phones. */
export interface ContactValueEntry {
    readonly value:    string;
    readonly label?:   string | null;
    readonly primary?: boolean;
}

/**
 * C.3 — one contact, mirroring the backend `ContactResource` read shape.
 * `ownerUserId` / `userId` / `primaryEmail` / timestamps are read-only projections.
 */
export interface ContactDto {
    readonly id?:           string;
    readonly displayName?:  string;
    readonly visibility?:   ContactVisibility;
    readonly ownerUserId?:  string | null;
    readonly userId?:       string | null;
    /** C.6 — display label of the linked platform user (resolved server-side; null when unlinked). */
    readonly userDisplayName?: string | null;
    /** C.7 — CDP subject cross-link, resolved server-side off userId (null when unlinked or no subject exists yet). */
    readonly subjectKey?:        string | null;
    readonly subjectEventCount?: number | null;
    readonly subjectSegments?:   ReadonlyArray<string> | null;
    readonly organization?: string | null;
    readonly jobTitle?:     string | null;
    readonly emails?:       ReadonlyArray<ContactValueEntry>;
    readonly phones?:       ReadonlyArray<ContactValueEntry>;
    readonly addresses?:    ReadonlyArray<unknown>;
    readonly extras?:       Record<string, unknown>;
    readonly primaryEmail?: string | null;
    readonly createdAt?:    string;
    readonly updatedAt?:    string;
}

/** The writable subset the create/edit modal sends. */
export interface ContactWritePayload {
    displayName:   string;
    visibility:    ContactVisibility;
    organization?: string | null;
    jobTitle?:     string | null;
    emails?:       ReadonlyArray<ContactValueEntry>;
    phones?:       ReadonlyArray<ContactValueEntry>;
}

/**
 * C.3 — the Contacts admin API client. Talks to the C.2 endpoints
 * (`GET|POST /contacts`, `PATCH|DELETE /contacts/{id}`) off `manifest.apiBase`.
 * Feature-local (not on the shared ApiService) — the surface is small and
 * self-contained, mirroring {@link LeadsService}.
 */
@Injectable({ providedIn: 'root' })
export class ContactsService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /** The caller's visible directory — personal contacts + the shared directory. */
    list(q?: string): Observable<ContactDto[]> {
        let params = new HttpParams();
        if (q !== undefined && q.trim() !== '') params = params.set('q', q.trim());
        return this.http
            .get<HydraCollection<ContactDto>>(`${this.apiBase}/contacts`, { params })
            .pipe(map(res => res.member));
    }

    /**
     * Server-paginated + RQL-filtered directory page for the admin grid.
     *
     * `filters` are the DataGrid's pre-built RQL expressions, sent verbatim as
     * repeated `?filter=` params — this endpoint is RQL-native and validates
     * them against the allowlist derived from the `contact:contacts` YAML.
     * `?limit=` (not `itemsPerPage`) is what the RQL parser reads. Mirrors
     * `listCallRecordsPage`.
     */
    listPage(opts: {
        page?:     number;
        pageSize?: number;
        sort?:     string | null;
        filters?:  ReadonlyArray<string>;
    } = {}): Observable<{ items: ContactDto[]; totalItems: number }> {
        const pageSize = opts.pageSize ?? 50;
        const page     = opts.page ?? 1;

        let params = new HttpParams()
            .set('page', String(page))
            .set('limit', String(pageSize));

        if (opts.sort) params = params.set('sort', opts.sort);
        for (const f of opts.filters ?? []) {
            if (f && f.trim() !== '') params = params.append('filter', f);
        }

        return this.http
            .get<HydraCollection<ContactDto>>(`${this.apiBase}/contacts`, { params })
            .pipe(map(res => ({ items: res.member, totalItems: res.totalItems })));
    }

    /** One contact by id — the detail (Person-hub) page (`GET /contacts/{id}`; 404 if absent/forbidden). */
    get(id: string): Observable<ContactDto> {
        return this.http.get<ContactDto>(`${this.apiBase}/contacts/${encodeURIComponent(id)}`);
    }

    /**
     * C.7 reverse cross-link — the one contact linked to a platform user
     * (`GET /contacts?userId=`), or null when the user has no linked contact
     * (or the caller can't view it). Backs the CDP subject explorer's
     * "Contact" back-link to the Person hub.
     */
    byUser(userId: string): Observable<ContactDto | null> {
        const params = new HttpParams().set('userId', userId);
        return this.http
            .get<HydraCollection<ContactDto>>(`${this.apiBase}/contacts`, { params })
            .pipe(map(res => res.member[0] ?? null));
    }

    create(payload: ContactWritePayload): Observable<ContactDto> {
        return this.http.post<ContactDto>(`${this.apiBase}/contacts`, payload);
    }

    /** PATCH is a merge-patch op — the Content-Type is mandatory (415 otherwise). */
    update(id: string, patch: Partial<ContactWritePayload>): Observable<ContactDto> {
        return this.http.patch<ContactDto>(
            `${this.apiBase}/contacts/${encodeURIComponent(id)}`,
            patch,
            { headers: new HttpHeaders({ 'Content-Type': 'application/merge-patch+json' }) },
        );
    }

    delete(id: string): Observable<void> {
        return this.http.delete<void>(`${this.apiBase}/contacts/${encodeURIComponent(id)}`);
    }

    /** C.6 — associate an existing platform user with the contact (sets `userId`). */
    associateUser(id: string, userId: string): Observable<ContactDto> {
        return this.http.post<ContactDto>(
            `${this.apiBase}/contacts/${encodeURIComponent(id)}/link-user`,
            { userId },
        );
    }

    /** C.6 — clear the contact's platform-user link. */
    dissociateUser(id: string): Observable<ContactDto> {
        return this.http.post<ContactDto>(
            `${this.apiBase}/contacts/${encodeURIComponent(id)}/unlink-user`,
            {},
        );
    }

    /**
     * C.6.b — mint a NEW platform user FROM the contact (email + phone become
     * identifiers) and link it, sending an activation invite. Bodyless.
     */
    convertToUser(id: string): Observable<ContactDto> {
        return this.http.post<ContactDto>(
            `${this.apiBase}/contacts/${encodeURIComponent(id)}/convert-user`,
            {},
        );
    }
}
