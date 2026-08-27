import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

import { ContentFieldPanelsComponent } from './content-field-panels.component';
import { PageDto, PageVariantSummaryDto } from './page.types';

export interface PageMetadataDialogData {
    readonly page: PageDto;
}

/**
 * Per-locale metadata for a page — meta tags, Open Graph, canonical, robots
 * (#1715).
 *
 * ## Why this hosts a component instead of a form
 *
 * The SEO field set is DECLARED, not coded: `GET /content/field-panels?path=`
 * returns whichever groups apply to a node, and `ContentFieldPanelsComponent`
 * renders and saves them through the field-widget registry. So this dialog
 * owns no field list at all — adding `og:video` tomorrow is one YAML in
 * `config/modules/content/fields/vfs_node/`, and it appears here AND in the
 * page editor's Meta panel with no code change in either. A hand-written form
 * would have been a second list to keep in step, and the first one to drift.
 *
 * ## Why it is per-LOCALE
 *
 * SEO lives on the variant, not the page: `/about.html` in English and Russian
 * are different documents to a crawler and want different titles. The locale
 * strip is therefore the primary control, and each tab points the panels at
 * that variant's own VFS path.
 *
 * ## What it is NOT
 *
 * Not a second page editor. Body content, publishing and placement all stay
 * where they are; this is the metadata that describes the page to machines,
 * reachable without loading the editor to get at it.
 */
@Component({
    selector: 'app-page-metadata-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ContentFieldPanelsComponent],
    template: `
        <div class="cms-dialog pmd">
            <!-- The house header: icon, plain text, close button (#1716).
                 It was an h2 carrying cms-dialog-title — a class defined
                 NOWHERE, so the heading fell back to the browser's 2em default
                 while cms-dialog-header (1rem / 600) already styles its own
                 text. It also had no way out but the footer. -->
            <div class="cms-dialog-header">
                <i class="bi bi-tags"></i>
                <span>Metadata — {{ data.page.slug }}</span>
                <button type="button" class="cms-dialog-close" (click)="close()" aria-label="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="cms-dialog-body pmd__body">
                @if (variants().length === 0) {
                    <p class="cms-field-hint">
                        This page has no content in any locale yet, so there is nothing to
                        describe. Create a variant in the editor first.
                    </p>
                } @else {
                    <!-- Locale strip. Shown even for a single locale: it names
                         WHICH document is being described, which is the whole
                         reason these fields live on the variant. -->
                    <div class="pmd__locales" role="tablist">
                        @for (v of variants(); track v.locale) {
                            <button type="button"
                                    role="tab"
                                    class="pmd__locale"
                                    [class.pmd__locale--active]="v.locale === activeLocale()"
                                    [attr.aria-selected]="v.locale === activeLocale()"
                                    (click)="selectLocale(v.locale)">
                                {{ v.locale }}
                                <span class="pmd__locale-status"
                                      [class.pmd__locale-status--published]="'published' === v.status">
                                    {{ v.status.replace('_', ' ') }}
                                </span>
                            </button>
                        }
                    </div>

                    <p class="cms-field-hint pmd__path">{{ variantPath() }}</p>

                    <!-- embedded: this dialog owns the Save button in its
                         footer, so the panels must not render a second one. -->
                    <app-content-field-panels
                        [path]="variantPath()"
                        [embedded]="true"
                        (saved)="onSaved()" />
                }
            </div>

            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn" (click)="close()">Close</button>
                @if (variants().length > 0) {
                    <button type="button"
                            class="cms-btn cms-btn-primary"
                            [disabled]="!panels()?.dirty() || !!panels()?.saving()"
                            (click)="save()">
                        {{ panels()?.saving() ? 'Saving…' : 'Save' }}
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        .pmd { width: 620px; max-width: 94vw; }
        .pmd__body { display: flex; flex-direction: column; gap: 12px; max-height: 70vh; overflow-y: auto; }

        .pmd__locales { display: flex; flex-wrap: wrap; gap: 4px; }
        .pmd__locale {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border: 1px solid var(--cms-btn-border);
            border-radius: var(--cms-radius);
            background: var(--cms-btn-bg);
            color: var(--cms-btn-text);
            font: inherit;
            font-size: .8125rem;
            text-transform: uppercase;
            letter-spacing: .02em;
            cursor: pointer;
        }
        .pmd__locale:hover { background: var(--cms-btn-hover-bg); }
        .pmd__locale--active {
            background: var(--cms-accent-light);
            border-color: var(--cms-accent);
            color: var(--cms-accent-text);
        }
        .pmd__locale-status {
            font-size: .6875rem;
            text-transform: none;
            color: var(--cms-text-muted);
        }
        .pmd__locale-status--published { color: var(--cms-success, #198754); }

        .pmd__path {
            font-family: var(--cms-font-mono, ui-monospace, SFMono-Regular, monospace);
            font-size: .75rem;
            margin: 0;
            word-break: break-all;
        }
    `],
})
export class PageMetadataDialogComponent {
    protected readonly data = inject<PageMetadataDialogData>(DIALOG_DATA);
    private readonly ref = inject<DialogRef<boolean>>(DialogRef);

    /** The embedded panels — the dialog drives their dirty/save from the footer. */
    protected readonly panels = viewChild(ContentFieldPanelsComponent);

    protected readonly variants = computed<readonly PageVariantSummaryDto[]>(
        () => this.data.page.variants,
    );

    /**
     * Opens on the PUBLISHED locale when there is one.
     *
     * That is the document a crawler actually sees, so it is the one whose
     * metadata is worth checking first; falling back to the first variant
     * keeps a draft-only page usable.
     */
    protected readonly activeLocale = signal<string>(
        this.data.page.variants.find(v => 'published' === v.status)?.locale
            ?? this.data.page.variants[0]?.locale
            ?? '',
    );

    /**
     * VFS path of the active variant.
     *
     * Derived from the page path rather than carried on the DTO: a variant is
     * a `{locale}.dtmpl` child of the page Package, which is the naming
     * contract the whole content model is built on (ADR-153), and
     * `PageVariantSummaryDto` deliberately stays a summary.
     */
    protected readonly variantPath = computed<string>(() => {
        const base = this.data.page.vfsPath ?? '';
        const locale = this.activeLocale();

        return '' === base || '' === locale ? '' : `${base}/${locale}.dtmpl`;
    });

    protected selectLocale(locale: string): void {
        this.activeLocale.set(locale);
    }

    protected save(): void {
        this.panels()?.save();
    }

    /**
     * A save closes the dialog with `true` so the caller can refresh — the
     * listing shows `ogImage` on its rows, so metadata edits are visible there.
     */
    protected onSaved(): void {
        this.ref.close(true);
    }

    protected close(): void {
        this.ref.close(false);
    }
}
