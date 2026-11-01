import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import { PageBlameDto, PageRestoreDto, PageVersionDiffDto, PageVersionsDto } from './page-versions';

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
        return this.http.get<PageVersionsDto>(`${this.base()}/web/page-versions`, { params });
    }

    /** What changed in the version `seq` since the one before it. */
    diff(path: string, seq: number): Observable<PageVersionDiffDto> {
        const params = new HttpParams().set('path', path).set('seq', String(seq));

        return this.http.get<PageVersionDiffDto>(`${this.base()}/web/page-version-diff`, { params });
    }

    /** Who last changed each of the page's sections, and each of their fields. */
    blame(path: string): Observable<PageBlameDto> {
        return this.http.get<PageBlameDto>(`${this.base()}/web/page-blame`, { params: new HttpParams().set('path', path) });
    }

    /** Restores the page or folder to the version `seq`: one transaction, recorded as a new version. */
    restore(path: string, seq: number): Observable<PageRestoreDto> {
        return this.http.post<PageRestoreDto>(`${this.base()}/web/page-restores`, { path, seq });
    }

    private base(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }
}
