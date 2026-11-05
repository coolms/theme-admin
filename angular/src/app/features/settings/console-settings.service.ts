import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AppConfigState, SidebarStateService } from '@coolms/core-angular';
import { type ExplorerViewMode, type VfsViewMode } from '@coolms/ui-angular';
import { Store } from '@ngxs/store';
import { catchError, map, type Observable, of, tap, timeout } from 'rxjs';

/** Rows per request when the section cannot be read; what the lists asked for before it was declared. */
const FALLBACK_PAGE_SIZE = 50;

/** How long entering the console, or the next sidebar save, waits on a call that does not answer. */
const NO_ANSWER_MS = 5000;

interface ConsoleKey {
    readonly key: string;
    readonly value: unknown;
    readonly own: unknown;
    readonly locked: boolean;
}

interface DeclaredSection {
    readonly section: string;
    readonly version: string | null;
    readonly keys: ReadonlyArray<ConsoleKey>;
}

function versionOf(etag: string | null): string | null {
    const v = (etag ?? '').replace(/^W\//, '').replace(/"/g, '').trim();
    return v === '' ? null : v;
}

/**
 * The person's `console` settings, which theme-admin's theme.yaml declares, read once on entering the console.
 *
 * A page reads `pageSize()` and the view modes as it is built, so the layout route resolves {@link load} first; a read
 * that fails or does not answer leaves the pages as they would be with nothing chosen. What an earlier read held is
 * forgotten first: it may have been another person's.
 *
 * The sidebar's state also stays on the device, so a reload draws it at once. A value the server holds wins over the
 * device's; with none held, the device's differing state is saved once as the first value. A locked key is applied
 * and never written.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleSettingsService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);
    private readonly sidebar = inject(SidebarStateService);

    private readonly keys = signal<ReadonlyArray<ConsoleKey>>([]);
    private readonly saving = signal(false);
    private version: string | null = null;

    constructor() {
        effect(() => {
            const collapsed = this.sidebar.collapsed();
            const key = this.keys().find(k => 'sidebarCollapsed' === k.key);
            if (undefined === key || key.locked || this.saving() || collapsed === key.value) {
                return;
            }
            untracked(() => this.saveSidebar(collapsed));
        });
    }

    /** Rows per request on a list that pages from the server. */
    pageSize(): number {
        const value = this.valueOf('pageSize');
        return 'number' === typeof value ? value : FALLBACK_PAGE_SIZE;
    }

    /** The person's default on an explorer page; null leaves it to the page's own. */
    explorerView(): ExplorerViewMode | null {
        const value = this.valueOf('viewMode');
        return 'list' === value ? 'details' : 'tiles' === value ? 'large' : null;
    }

    /** The person's default in the file manager; null leaves it to the page's own. */
    vfsView(): VfsViewMode | null {
        const value = this.valueOf('viewMode');
        return 'list' === value ? 'list' : 'tiles' === value ? 'grid' : null;
    }

    /** Never fails: a route waits on it, and a console with no settings still opens. */
    load(): Observable<void> {
        this.keys.set([]);
        this.version = null;
        return this.http.get<ReadonlyArray<DeclaredSection>>(`${this.base}/declared?host=console`, {
            headers: new HttpHeaders({ Accept: 'application/json' }),
        }).pipe(
            timeout(NO_ANSWER_MS),
            tap(sections => this.adopt(sections.find(s => 'console' === s.section))),
            map(() => undefined),
            catchError(() => of(undefined)),
        );
    }

    private get base(): string {
        const api = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
        return `${api}/auth/me/settings`;
    }

    private valueOf(key: string): unknown {
        return this.keys().find(k => key === k.key)?.value;
    }

    private adopt(section: DeclaredSection | undefined): void {
        this.version = section?.version ?? null;
        const keys = section?.keys ?? [];
        const key = keys.find(k => 'sidebarCollapsed' === k.key);
        const serverWins = undefined !== key && (key.locked || null !== key.own);
        if (serverWins && this.sidebar.collapsed() !== key.value) {
            this.sidebar.toggle();
        }
        this.keys.set(keys);
    }

    private saveSidebar(collapsed: boolean): void {
        if (null === this.version) {
            this.heldOnThisDevice(collapsed);
            return;
        }
        this.saving.set(true);
        this.http.patch<unknown>(`${this.base}/console`, { sidebarCollapsed: collapsed }, {
            observe: 'response',
            headers: new HttpHeaders({
                'Content-Type': 'application/merge-patch+json',
                Accept: 'application/json',
                'If-Match': `"${this.version}"`,
            }),
        }).pipe(timeout(NO_ANSWER_MS)).subscribe({
            next: response => {
                this.version = versionOf(response.headers.get('ETag'));
                this.heldOnThisDevice(collapsed);
                this.saving.set(false);
            },
            error: (err: unknown) => {
                if (err instanceof HttpErrorResponse && 412 === err.status) {
                    // Saved on another device since this one read it: that value stands.
                    this.load().subscribe(() => this.saving.set(false));
                    return;
                }
                this.heldOnThisDevice(collapsed);
                this.saving.set(false);
            },
        });
    }

    /** What the next comparison is made against: a save that failed is not tried again until the next change. */
    private heldOnThisDevice(collapsed: boolean): void {
        this.keys.update(keys => keys.map(k => 'sidebarCollapsed' === k.key ? { ...k, value: collapsed } : k));
    }
}
