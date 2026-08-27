import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import type { HydraCollection } from '../../api/api.service';

/**
 * Notification Sub-phase E -- Angular client wrapping the seven
 * Sub-phase B backend endpoints. Collection responses arrive as
 * API Platform 4.x JSON-LD (`member` key, compact IRIs); the
 * `list` method coerces both the JSON-LD shape and a bare array
 * fallback so the caller always receives `NotificationDto[]`.
 */
export interface NotificationLink {
    kind: 'route' | 'external';
    href: string;
    target: '_blank' | '_self' | null;
}

export interface NotificationDto {
    id: string;
    type: string;
    extras: Record<string, unknown>;
    authorUserId: string | null;
    createdAt: string;
    expiresAt: string | null;
    readAt: string | null;
    dismissedAt: string | null;
    isRead: boolean;
    link: NotificationLink | null;
}

export interface UnreadCountDto {
    count: number;
}

export interface ReadAllResultDto {
    markedCount: number;
}

export interface DismissAllResultDto {
    dismissedCount: number;
}

export interface BulkActionResult {
    id: string;
    status: 'ok' | 'not_found' | 'forbidden';
}

export interface BulkActionResponse {
    results: BulkActionResult[];
}

/**
 * Ship Q -- RQL-native list parameters. The backend's RQL parser
 * accepts space-delimited `field op value` expressions (multiple
 * `filter=` segments AND'd together), a comma-separated `sort`
 * (prefix `-` for DESC), `page`, and `limit`.
 *
 * Sample expressions the drawer uses:
 *   filter: `createdAt lt 2026-05-18T08:00:00Z`   -- backward pagination
 *   filter: `createdAt gt 2026-05-18T08:00:00Z`   -- polling backfill
 *   sort:   `-createdAt`                          -- backend default
 *
 * The interface intentionally does not carry convenience fields
 * (`since` / `before`) so the contract stays unambiguous; callers
 * build the RQL expression themselves.
 */
export interface NotificationListParams {
    readonly filter?: string;
    readonly sort?: string;
    readonly limit?: number;
    readonly page?: number;
}

export interface NotificationType {
    value: string;
    label: string;
}

export interface NotificationTypesResponse {
    types: NotificationType[];
}

export interface NotificationBodyFormat {
    value: string;
    label: string;
}

export interface NotificationBodyFormatsResponse {
    formats: NotificationBodyFormat[];
}

export interface SendTestRequest {
    type?: string;
    title?: string;
    body?: string;
    bodyFormat?: string;
    link?: NotificationLink | null;
}

@Injectable({ providedIn: 'root' })
export class NotificationApiService {
    private readonly http = inject(HttpClient);

    list(input: NotificationListParams = {}): Observable<NotificationDto[]> {
        let params = new HttpParams().set('limit', String(input.limit ?? 20));
        if (input.filter !== undefined) {
            params = params.set('filter', input.filter);
        }
        if (input.sort !== undefined) {
            params = params.set('sort', input.sort);
        }
        if (input.page !== undefined) {
            params = params.set('page', String(input.page));
        }

        return new Observable<NotificationDto[]>((subscriber) => {
            this.http
                .get<HydraCollection<NotificationDto> | NotificationDto[]>(
                    '/api/v1/notifications',
                    { params },
                )
                .subscribe({
                    next: (response) => {
                        const list = Array.isArray(response)
                            ? response
                            : response.member ?? [];
                        subscriber.next(list);
                        subscriber.complete();
                    },
                    error: (err) => subscriber.error(err),
                });
        });
    }

    unreadCount(): Observable<UnreadCountDto> {
        return this.http.get<UnreadCountDto>('/api/v1/notifications/unread-count');
    }

    markRead(id: string): Observable<NotificationDto> {
        return this.http.post<NotificationDto>(`/api/v1/notifications/${id}/read`, {});
    }

    markUnread(id: string): Observable<NotificationDto> {
        return this.http.post<NotificationDto>(`/api/v1/notifications/${id}/unread`, {});
    }

    dismiss(id: string): Observable<NotificationDto> {
        return this.http.post<NotificationDto>(`/api/v1/notifications/${id}/dismiss`, {});
    }

    undismiss(id: string): Observable<NotificationDto> {
        return this.http.post<NotificationDto>(`/api/v1/notifications/${id}/undismiss`, {});
    }

    dismissAll(): Observable<DismissAllResultDto> {
        return this.http.post<DismissAllResultDto>('/api/v1/notifications/_bulk/dismiss-all', {});
    }

    readAll(): Observable<ReadAllResultDto> {
        return this.http.post<ReadAllResultDto>('/api/v1/notifications/read-all', {});
    }

    markReadBulk(ids: string[]): Observable<BulkActionResponse> {
        return this.http.post<BulkActionResponse>(
            '/api/v1/notifications/_bulk/read',
            { ids },
        );
    }

    markUnreadBulk(ids: string[]): Observable<BulkActionResponse> {
        return this.http.post<BulkActionResponse>(
            '/api/v1/notifications/_bulk/unread',
            { ids },
        );
    }

    dismissBulk(ids: string[]): Observable<BulkActionResponse> {
        return this.http.post<BulkActionResponse>(
            '/api/v1/notifications/_bulk/dismiss',
            { ids },
        );
    }

    listTypes(): Observable<NotificationType[]> {
        return this.http
            .get<NotificationTypesResponse>('/api/v1/notifications/types')
            .pipe(map((r) => r.types));
    }

    listBodyFormats(): Observable<NotificationBodyFormat[]> {
        return this.http
            .get<NotificationBodyFormatsResponse>('/api/v1/notifications/body-formats')
            .pipe(map((r) => r.formats));
    }

    sendTest(payload: SendTestRequest): Observable<unknown> {
        return this.http.post('/api/v1/notifications/test', payload);
    }
}
