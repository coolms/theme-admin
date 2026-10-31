import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import { PageVersionsDto } from './page-versions';

/** A page's or a directory's versions, newest first: `GET /web/page-versions`. */
@Injectable({ providedIn: 'root' })
export class PageVersionsService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    /** The versions of the node at `path` (a language file's path answers its page's); older ones by `before`. */
    list(path: string, before: number | null = null): Observable<PageVersionsDto> {
        let params = new HttpParams().set('path', path);
        if (before !== null) {
            params = params.set('before', String(before));
        }
        const base = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';

        return this.http.get<PageVersionsDto>(`${base}/web/page-versions`, { params });
    }
}
