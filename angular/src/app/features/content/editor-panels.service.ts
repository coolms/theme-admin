import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
/**
 * One side-panel the editor should offer for a node, as declared by an
 * installed module. Mirrors the backend `EditorPanel` VO
 * (`EditorPanel`).
 */
export interface EditorPanelDto {
    readonly id: string;
    readonly title: string;
    /** Bootstrap-icon suffix (rendered as `bi bi-{icon}`). */
    readonly icon: string;
    readonly priority: number;
    /** Coarse render kind (`metadata` | `schedule` | `history` | `fields` …). */
    readonly kind: string;
}

/** Response of `GET /api/v1/editor/panels?path=`. */
interface EditorPanelsResponse {
    readonly path: string;
    readonly panels: readonly EditorPanelDto[];
}

/**
 * Data layer for the editor-panel contribution registry.
 *
 * The host (page editor's rail) asks "which panels apply to this node?" and
 * renders exactly what the installed modules contribute — so a panel like
 * **Schedule** appears only when the Scheduler module is installed, with the
 * host never referencing that module. Low coupling: install/uninstall a module
 * and its editor surface appears/vanishes with zero host changes.
 */
@Injectable({ providedIn: 'root' })
export class EditorPanelsService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /** Panels the installed modules contribute for the node at `path`. */
    getPanels(path: string): Observable<readonly EditorPanelDto[]> {
        const url = `${this.apiBase}/editor/panels?path=${encodeURIComponent(path)}`;
        return this.http.get<EditorPanelsResponse>(url).pipe(map(r => r.panels ?? []));
    }
}
