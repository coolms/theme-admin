import { Injectable, signal } from '@angular/core';

/**
 * The page in the main area, made anew on request: each reload is a new generation, and the outlet is rendered once
 * per generation, so the routed page is destroyed and created again and every read it makes on arrival is made again.
 * What the shell provides as `RELOAD_PAGE`: a page whose load was refused for want of elevation loads again after the
 * grant without a browser reload, which would end the elevation.
 */
@Injectable()
export class PageReload {
    readonly generation = signal(0);

    reload(): void {
        this.generation.update(n => n + 1);
    }
}
