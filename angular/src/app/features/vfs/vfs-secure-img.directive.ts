import {
    Directive,
    ElementRef,
    inject,
    input,
    OnChanges,
    OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { AuthState } from '@coolms/core-angular';
/**
 * Loads a VFS image via HttpClient (with auth header) and sets the result as
 * an Object URL on the host <img> element.
 *
 * VFS images may be private — a plain <img src="..."> cannot attach an
 * Authorization header, so we fetch the blob through Angular's HttpClient
 * (which passes through the auth interceptor) and hand the browser a local
 * Object URL instead.
 *
 * Lazy loading: an IntersectionObserver watches the element and only triggers
 * the HTTP fetch when the image is within 200 px of the viewport.  Images that
 * are never scrolled into view are never fetched, saving bandwidth in large
 * grid directories.
 *
 * Usage:
 *   <img [vfsSecureSrc]="previewUrl" alt="..." />
 *
 * Object URLs are revoked in ngOnDestroy and whenever the src changes to
 * prevent memory leaks.
 */
@Directive({
    selector: 'img[vfsSecureSrc]',
    standalone: true,
})
export class VfsSecureImgDirective implements OnChanges, OnDestroy {
    vfsSecureSrc = input.required<string>();

    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);
    private readonly el    = inject(ElementRef<HTMLImageElement>);

    private objectUrl: string | null = null;
    private observer: IntersectionObserver | null = null;

    ngOnChanges(): void {
        // Disconnect any previous observer + revoke previous Object URL
        this.disconnect();
        this.revoke();

        const url = this.vfsSecureSrc();
        if (!url) return;

        // Only load the image once it scrolls within 200 px of the viewport.
        // The observer disconnects itself after the first intersection so that
        // the image is not re-fetched if it leaves and re-enters the viewport.
        this.observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    this.load();
                    this.disconnect(); // single-fire — no further observation needed
                }
            },
            { rootMargin: '200px' }, // preload 200 px before the image becomes visible
        );
        this.observer.observe(this.el.nativeElement);
    }

    ngOnDestroy(): void {
        this.disconnect();
        this.revoke();
    }

    private disconnect(): void {
        this.observer?.disconnect();
        this.observer = null;
    }

    private load(): void {
        this.revoke();

        const url   = this.vfsSecureSrc();
        const token = this.store.selectSnapshot(AuthState.accessToken);
        if (!url) return;

        this.http.get(url, {
            responseType: 'blob',
            headers: { Authorization: `Bearer ${token ?? ''}` },
        }).subscribe({
            next: blob => {
                this.objectUrl = URL.createObjectURL(blob);
                this.el.nativeElement.src = this.objectUrl;
            },
            error: () => {
                // Hide the element so the CSS fallback icon shows through.
                this.el.nativeElement.style.display = 'none';
            },
        });
    }

    private revoke(): void {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
    }
}
