import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, map } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';
import { WebhookSecretDto, WebhookTriggerDto } from './webhook.types';

/**
 * FE — thin API client for the inbound-webhook admin CRUD
 * (`/api/v1/connector/webhooks`).
 *
 * Standalone per-feature service (mirrors `CockpitService`): small + scoped, so
 * it lives beside its consumer rather than on the platform-wide `ApiService`.
 * The collection endpoint returns a Hydra envelope; we request
 * `application/ld+json` and unwrap `member` so the consumer stays Hydra-agnostic.
 * Auth is automatic (the HTTP interceptor attaches the Bearer token).
 */
@Injectable({ providedIn: 'root' })
export class WebhookService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private readonly mergePatchHeaders = new HttpHeaders({
        'Content-Type': 'application/merge-patch+json',
    });

    private get apiBase(): string {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        return manifest?.apiBase ?? '/api/v1';
    }

    /** GET /connector/webhooks — full ordered list (small admin set). */
    list(): Observable<WebhookTriggerDto[]> {
        return this.http
            .get<HydraCollection<WebhookTriggerDto>>(`${this.apiBase}/connector/webhooks`, {
                headers: new HttpHeaders({ Accept: 'application/ld+json' }),
            })
            .pipe(map(r => r['member'] ?? []));
    }

    /** POST /connector/webhooks — create; the response reveals the minted secret once. */
    create(dto: Partial<WebhookTriggerDto>): Observable<WebhookTriggerDto> {
        return this.http.post<WebhookTriggerDto>(`${this.apiBase}/connector/webhooks`, dto);
    }

    /** PATCH /connector/webhooks/{slug} — partial update (merge-patch). */
    update(slug: string, patch: Partial<WebhookTriggerDto>): Observable<WebhookTriggerDto> {
        return this.http.patch<WebhookTriggerDto>(
            `${this.apiBase}/connector/webhooks/${encodeURIComponent(slug)}`,
            patch,
            { headers: this.mergePatchHeaders },
        );
    }

    /** DELETE /connector/webhooks/{slug}. */
    delete(slug: string): Observable<void> {
        return this.http.delete<void>(`${this.apiBase}/connector/webhooks/${encodeURIComponent(slug)}`);
    }

    /** POST /connector/webhooks/{slug}/rotate-secret — mints + returns a fresh secret once. */
    rotateSecret(slug: string): Observable<WebhookSecretDto> {
        return this.http.post<WebhookSecretDto>(
            `${this.apiBase}/connector/webhooks/${encodeURIComponent(slug)}/rotate-secret`,
            {},
        );
    }
}
