import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** One installed face, as `GET /api/v1/document/fonts` reports it. */
export interface DocumentFontFaceDto {
    readonly id: string;
    readonly face: string;
    readonly fileName: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly installedAt: string;
}

/** A family and the faces installed for it. */
export interface DocumentFontFamilyDto {
    readonly family: string;
    readonly faces: readonly DocumentFontFaceDto[];
}

export interface InstalledFontDto {
    readonly family: string;
    readonly face: string;
    readonly fileName: string;
    readonly bytes: number;
}

/** One family the catalogue offers, as `GET /fonts/catalogue` reports it. */
export interface CatalogueFamilyDto {
    readonly family: string;
    readonly category: string;
    readonly faces: readonly string[];
    /** Already here -- installed or vendored -- so the list can say so rather than offer it. */
    readonly installed: boolean;
}

export interface CatalogueResponseDto {
    readonly available: boolean;
    readonly families: readonly CatalogueFamilyDto[];
    readonly reason?: string;
}

/**
 * The installed-fonts endpoints.
 *
 * ⚠️ The upload names NOTHING about the file. The family and the face come out
 * of the font's own `name` and `OS/2` tables on the server, so four uploads
 * assemble one family without the operator typing "bold" anywhere — and a form
 * field that DID name it would be stating something the bytes could
 * contradict.
 *
 * This is the ADMIN surface. It is not what the editor reads: the canvas asks
 * for the merged registry (`/fonts/manifest`), which also carries the families
 * the platform ships and nobody can remove.
 */
@Injectable({ providedIn: 'root' })
export class DocumentFontService {
    private readonly http = inject(HttpClient);
    private readonly base = '/api/v1/document/fonts';

    list(): Observable<{ families: DocumentFontFamilyDto[] }> {
        return this.http.get<{ families: DocumentFontFamilyDto[] }>(this.base);
    }

    install(file: File): Observable<InstalledFontDto> {
        const body = new FormData();
        body.append('file', file);

        return this.http.post<InstalledFontDto>(this.base, body);
    }

    /**
     * What the catalogue offers.
     *
     * The response says `available: false` rather than failing when the
     * catalogue cannot be reached -- an installation with no outbound network
     * still installs fonts by upload, and an error here would read as the whole
     * page being broken.
     */
    browseCatalogue(query: string): Observable<CatalogueResponseDto> {
        return this.http.get<CatalogueResponseDto>(`${this.base}/catalogue`, {
            params: query ? { q: query } : {},
        });
    }

    installFromCatalogue(family: string): Observable<{ installed: string[]; faces: number }> {
        return this.http.post<{ installed: string[]; faces: number }>(
            `${this.base}/catalogue`,
            { family },
        );
    }

    remove(family: string): Observable<{ family: string; removed: number }> {
        // The family can hold anything a font's name table can — spaces, and
        // in principle a slash — so it is encoded rather than interpolated.
        return this.http.delete<{ family: string; removed: number }>(
            `${this.base}/${encodeURIComponent(family)}`,
        );
    }
}
