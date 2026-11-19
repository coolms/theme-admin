import { computed, Injectable, signal } from '@angular/core';
import { type PageClosure } from '@coolms/ui-angular';

/**
 * The page in the main area is closed while any state on it asks for elevation in place of its content (what the
 * shell provides as `PAGE_CLOSURE`): the shell then leaves out its own elevation banner, so the page offers one way to
 * elevate, and a list page leaves out its count.
 */
@Injectable()
export class ShellPageClosure implements PageClosure {
    private readonly closers = signal<ReadonlySet<object>>(new Set());

    readonly closed = computed(() => this.closers().size > 0);

    close(by: object): void {
        if (!this.closers().has(by)) {
            this.closers.update(was => new Set([...was, by]));
        }
    }

    open(by: object): void {
        if (this.closers().has(by)) {
            this.closers.update(was => new Set([...was].filter(one => one !== by)));
        }
    }
}
