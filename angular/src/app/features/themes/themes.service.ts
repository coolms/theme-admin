import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';

/** The `theme.json` a theme package ships, as returned under `manifest`. */
export interface ThemeManifest {
    readonly slug:        string;
    readonly name:        string;
    readonly description: string | null;
    readonly author:      string | null;
    readonly version:     string | null;
    readonly license:     string | null;
    /** `ssr` for DTMPL themes; the SPA/hybrid fields are reserved for future stacks. */
    readonly feStack:     string | null;
    readonly requires:    readonly string[];
}

/** Where the theme's files live. `vfsPath` is set only once a theme is published. */
export interface ThemeSource {
    readonly fsPath:    string;
    readonly assetsUrl: string | null;
    readonly vfsPath:   string | null;
}

export interface ThemeDto {
    readonly id:          string;
    readonly manifest:    ThemeManifest;
    readonly source:      ThemeSource;
    /** SiteSection slugs served by this theme. Empty = the global fallback. */
    readonly sections:    readonly string[];
    readonly isActive:    boolean;
    readonly isPublished: boolean;
    readonly installedAt: string | null;
}

/**
 * A site section, as far as themes are concerned.
 *
 * `themeSlug` is THE theme binding, and it is a live setting: the
 * vhost carries no theme placeholder at all, so changing it needs neither a
 * regenerate nor an nginx reload. Set it on the Sections page.
 */
export interface SiteSectionDto {
    readonly slug:      string;
    readonly themeSlug: string | null;
}

/** One `*.dtmpl` a theme ships, as listed by `/themes/{slug}/templates`. */
export interface ThemeTemplateDto {
    /** Relative to the theme's templates dir, e.g. `emails/default.html.dtmpl`. */
    readonly path:      string;
    readonly themeSlug: string;
    /** Basename, for a compact primary label. */
    readonly label:     string;
}

/** One template's source, from `/themes/{slug}/template-source?path=…`. */
export interface ThemeTemplateSourceDto {
    readonly slug:    string;
    readonly path:    string;
    readonly content: string;
    readonly bytes:   number;
    /**
     * Which layer this content came from, and therefore which one RENDERS
     *: `override` is the theme's VFS copy, `package` the shipped file.
     */
    readonly origin:  'package' | 'override';
    /** Server's verdict on whether Override is offerable; do not re-derive it. */
    readonly canOverride: boolean;
}

/** Result of creating an override. */
export interface ThemeTemplateOverrideDto {
    readonly slug:    string;
    readonly path:    string;
    /** Where the editable copy now lives, e.g. `/themes/coolms-default/templates/…`. */
    readonly vfsPath: string;
}

/**
 * Themes admin surface.
 *
 * Read + activate + browse source, which is the whole of what the backend
 * exposes: there is deliberately **no POST** — themes are installed only via
 * `php bin/console coolms:theme:install <slug>`.
 *
 * `PATCH` accepts exactly one writable field (`isActive`); `null` means
 * "leave unchanged".
 */
@Injectable({ providedIn: 'root' })
export class ThemesService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    listThemes(): Observable<ThemeDto[]> {
        return this.http
            .get<HydraCollection<ThemeDto>>(`${this.apiBase}/themes`)
            .pipe(map(res => res.member ?? []));
    }

    /**
     * Site sections, read here for their `themeSlug` — the ONE
     * theme binding.
     *
     * `ThemeSubscriber` fast-paths on it: a section naming a theme never
     * consults `Theme.isActive` at all. That is why this page leads with
     * "Serves" and withholds Activate when every section names its own theme.
     */
    listSections(): Observable<SiteSectionDto[]> {
        return this.http
            .get<HydraCollection<SiteSectionDto>>(`${this.apiBase}/sections`)
            .pipe(map(res => res.member ?? []));
    }

    /**
     * A theme's templates, keyed by SLUG rather than id — that is what the
     * endpoint takes, and it is the handle `SiteSection.themeSlug` stores.
     */
    listTemplates(slug: string): Observable<ThemeTemplateDto[]> {
        return this.http
            .get<HydraCollection<ThemeTemplateDto>>(`${this.apiBase}/themes/${encodeURIComponent(slug)}/templates`)
            .pipe(map(res => res.member ?? []));
    }

    /**
     * One template's source.
     *
     * The path travels as a query parameter, not a path segment: it contains
     * slashes, and a `.+` uriVariable would swallow the sibling `/templates`
     * collection route. `encodeURIComponent` is therefore load-bearing.
     */
    templateSource(slug: string, path: string): Observable<ThemeTemplateSourceDto> {
        const url = `${this.apiBase}/themes/${encodeURIComponent(slug)}/template-source`;

        return this.http.get<ThemeTemplateSourceDto>(url, { params: { path } });
    }

    /**
     * Copy a packaged template into the theme's VFS so it can be edited and
     * outranks the package at render time.
     */
    createOverride(slug: string, path: string): Observable<ThemeTemplateOverrideDto> {
        return this.http.post<ThemeTemplateOverrideDto>(
            `${this.apiBase}/themes/${encodeURIComponent(slug)}/template-overrides`,
            { path },
        );
    }

    /**
     * Drop the VFS copy so the packaged template serves again.
     *
     * The path goes in the query string, not a body: DELETE bodies are not
     * reliably forwarded, and the server reads `?path=` for both operations.
     */
    revertOverride(slug: string, path: string): Observable<void> {
        return this.http.delete<void>(
            `${this.apiBase}/themes/${encodeURIComponent(slug)}/template-overrides`,
            { params: { path } },
        );
    }

    /**
     * Activating re-skins the public site, so it is ROLE_ADMIN server-side.
     *
     * It only affects sections that name NO theme of their own — a section's
     * own `themeSlug` always wins (`ThemeSubscriber` fast-path). The page
     * withholds the button when there are no such sections rather than letting
     * an operator click something that would change nothing.
     */
    setActive(id: string, isActive: boolean): Observable<ThemeDto> {
        return this.patch(id, { isActive });
    }

    /*
     * There is deliberately NO setSections().
     *
     * `Theme.sections[]` was retired in — read path gone, write group
     * gone, data folded into `SiteSection.themeSlug`. Assignment lives on the
     * section, which is the only place it ever really lived.
     */

    uninstall(id: string): Observable<void> {
        return this.http.delete<void>(`${this.apiBase}/themes/${id}`);
    }

    /**
     * API-Platform PATCH is merge-patch — the wrong content type is a 415, not a
     * validation error, so it is set here rather than at each call site.
     */
    private patch(id: string, body: Record<string, unknown>): Observable<ThemeDto> {
        return this.http.patch<ThemeDto>(`${this.apiBase}/themes/${id}`, body, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        });
    }
}
