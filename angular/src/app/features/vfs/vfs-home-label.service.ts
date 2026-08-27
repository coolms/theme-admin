import { computed, Injectable, signal, Signal } from '@angular/core';
import { VfsNodeDto } from '@coolms/ui-angular';

/** Matches any RFC 4122 UUID (v1–v8). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves /home/{uuid} directory names to human-readable display labels.
 *
 * When the VFS backend lists /home, each child node carries a `uname` field —
 * the owning user's primary identifier (e.g. their email address or username).
 * This service collects those uuid → uname mappings as nodes are loaded and
 * surfaces them as reactive signals so the breadcrumb, tree, and file-grid
 * can show friendly labels instead of raw UUIDs with zero extra HTTP calls.
 *
 * If a richer label (e.g. full name) is needed in the future, swap the
 * uname-based registration for a lookup against a user item endpoint
 * (e.g. GET /api/v1/auth/users/{uuid}) once that operation is available.
 */
@Injectable({ providedIn: 'root' })
export class VfsHomeLabelService {

    /** Internal reactive store: uuid → display label. */
    private readonly map = signal<ReadonlyMap<string, string>>(new Map());

    /**
     * Scans a directory listing and registers any /home/{uuid} directories.
     *
     * Safe to call for every directory load — non-home nodes are silently
     * ignored so callers do not need to filter beforehand.
     */
    register(nodes: VfsNodeDto[]): void {
        const updates = nodes.filter(n =>
            n.type === 'directory' &&
            UUID_RE.test(n.name) &&
            n.path === `/home/${n.name}` &&  // strictly under /home
            n.uname && n.uname !== n.name,   // has a resolved, non-UUID owner name
        );

        if (updates.length === 0) return;

        const next = new Map(this.map());
        for (const node of updates) {
            next.set(node.name, node.uname);
        }
        this.map.set(next);
    }

    /**
     * Returns a reactive `Signal<string>` for a UUID directory name.
     *
     * The signal starts as the raw UUID and updates to the resolved label
     * once the /home listing is loaded (or immediately if already cached).
     */
    labelFor(uuid: string): Signal<string> {
        return computed(() => this.map().get(uuid) ?? uuid);
    }

    /**
     * Returns `true` when path-`segment[index]` is a UUID that follows a
     * `home` segment — i.e. the breadcrumb slot that should show a username.
     *
     * @param segments  Path split by '/' with empty strings removed.
     * @param index     Index of the segment being evaluated.
     */
    static isHomeUuidSegment(segments: string[], index: number): boolean {
        return index === 1 && segments[0] === 'home' && UUID_RE.test(segments[index]);
    }

    /**
     * Returns `true` when a node is a direct child of /home and its name is a UUID.
     * Used by file-grid and tree to decide whether label resolution is needed.
     */
    static isHomeDir(node: VfsNodeDto): boolean {
        return (
            node.type === 'directory' &&
            UUID_RE.test(node.name) &&
            node.path === `/home/${node.name}`
        );
    }
}
