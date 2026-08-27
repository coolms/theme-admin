import { inject, Injectable } from '@angular/core';
import { Store } from '@ngxs/store';
import { AuthState } from '@coolms/core-angular';
import type { LinkTargetType } from '../types/link-widget.types';
import type { RecentLink } from '../types/link-picker.types';

const LS_PREFIX = 'coolms.linkPicker.recent.';
const MAX_ENTRIES = 20;

/**
 * Per-user LRU of recently-used link targets, persisted in localStorage.
 *
 * Storage key: `coolms.linkPicker.recent.{userId}`. Entries are stored as
 * a JSON array; on read we sort by `lastUsedAt` descending. On `record()`
 * we prepend / dedupe by `(type, identifier)` and truncate to MAX_ENTRIES.
 *
 * Failures (private mode, quota, malformed JSON) are swallowed so the
 * picker stays functional even when localStorage misbehaves.
 */
@Injectable({ providedIn: 'root' })
export class LinkPickerRecentService {
    private readonly store = inject(Store);

    list(): RecentLink[] {
        try {
            const raw = localStorage.getItem(this.key());
            if (!raw) return [];
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((e): e is RecentLink => this.isRecentLink(e))
                .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
        } catch {
            return [];
        }
    }

    record(entry: { type: LinkTargetType; identifier: string; label: string }): void {
        try {
            const now = new Date().toISOString();
            const existing = this.list();
            const deduped = existing.filter(e =>
                !(e.type === entry.type && e.identifier === entry.identifier),
            );
            const next: RecentLink[] = [
                { ...entry, lastUsedAt: now },
                ...deduped,
            ].slice(0, MAX_ENTRIES);
            localStorage.setItem(this.key(), JSON.stringify(next));
        } catch {
            // ignore quota / private mode
        }
    }

    private isRecentLink(value: unknown): value is RecentLink {
        if (!value || typeof value !== 'object') return false;
        const v = value as Record<string, unknown>;
        const type = v['type'];
        return typeof v['identifier'] === 'string'
            && typeof v['label'] === 'string'
            && typeof v['lastUsedAt'] === 'string'
            && (type === 'page' || type === 'section' || type === 'vfs' || type === 'url' || type === 'route');
    }

    private key(): string {
        const user = this.store.selectSnapshot(AuthState.currentUser);
        const id = user?.id ?? user?.identifier ?? 'anon';
        return LS_PREFIX + id;
    }
}
