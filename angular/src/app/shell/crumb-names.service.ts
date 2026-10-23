import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * The names a page resolves for its breadcrumb (see breadcrumbs.ts): an object's display name for the path that
 * carries its id, and one crumb after the page for what is selected inside it. This service clears both when a
 * navigation starts, so a name never outlives its page.
 */
@Injectable({ providedIn: 'root' })
export class CrumbNamesService {
    readonly names = signal<ReadonlyMap<string, { label: string; link?: readonly unknown[] }>>(new Map());
    readonly tail = signal<{ label: string; link?: readonly unknown[] } | null>(null);

    constructor() {
        inject(Router).events.pipe(filter(e => e instanceof NavigationStart), takeUntilDestroyed(inject(DestroyRef)))
            .subscribe(() => this.clear());
    }

    /** Names the crumb for `path` (e.g. `/email/mailboxes/<id>` -> the mailbox's name), optionally leading elsewhere. */
    name(path: string, label: string, link?: readonly unknown[]): void {
        const next = new Map(this.names());
        next.set(path, { label, ...(link ? { link } : {}) });
        this.names.set(next);
    }

    /** One crumb after the page's own, for what is selected inside it; null removes it. */
    setTail(label: string | null, link?: readonly unknown[]): void {
        this.tail.set(label ? { label, ...(link ? { link } : {}) } : null);
    }

    clear(): void {
        this.names.set(new Map());
        this.tail.set(null);
    }
}
