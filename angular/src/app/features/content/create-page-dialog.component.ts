import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { PageService } from './page.service';
import { PageTypeDto } from './page.types';
import { ToastService } from '@coolms/ui-angular';
import { AppConfigState } from '@coolms/core-angular';
@Component({
    selector: 'app-create-page-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog" style="width: 420px;">
            <div class="cms-dialog-header">
                <span>New Page</span>
                <button class="cms-dialog-close" (click)="close()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            <div class="cms-dialog-body" style="display: flex; flex-direction: column; gap: 12px;">
                @if (dialogData?.spaceLabel) {
                    <!-- — say WHERE. "New Page" used to always mean the
                         site, whatever space you were looking at. -->
                    <div class="cms-field-hint">
                        Creating in <strong>{{ dialogData?.spaceLabel }}</strong>.
                    </div>
                }
                <div>
                    <label class="cms-label">Title</label>
                    <input class="cms-input" type="text" [(ngModel)]="title"
                           placeholder="e.g. About Us" />
                    <div class="cms-field-hint">The page title. The slug is derived from it when left blank.</div>
                </div>
                <div>
                    <label class="cms-label">Slug <span class="text-muted">(optional)</span></label>
                    <input class="cms-input" type="text" [(ngModel)]="slug"
                           placeholder="auto-derived from title" />
                    <div class="cms-field-hint">Used in the URL and as identifier. Leave blank to derive it from the title.</div>
                </div>
                <div>
                    <label class="cms-label">Page type</label>
                    <!-- — options come from content.page_types, never a
                         hardcoded list: the create endpoint validates against the
                         same config, so a client-side list would eventually offer
                         a choice the server 422s. -->
                    <select class="cms-input" [(ngModel)]="contentType">
                        <option value="">Default</option>
                        @for (type of pageTypes(); track type.key) {
                            <option [value]="type.key">{{ type.label }}</option>
                        }
                    </select>
                    <div class="cms-field-hint">
                        @if (contentType === '') {
                            Inherits the enclosing collection's type, or renders as a plain page.
                        } @else if (contentType === 'landing') {
                            Composed from section blocks in the editor instead of a body.
                        } @else {
                            Renders with <code>{{ selectedTemplate() }}</code>.
                        }
                    </div>
                </div>
                <div>
                    <label class="cms-label">Initial locale</label>
                    <select class="cms-input" [(ngModel)]="locale">
                        @for (l of locales(); track l.code) {
                            <option [value]="l.code">{{ l.label }} ({{ l.code }})</option>
                        }
                    </select>
                    <div class="cms-field-hint">
                        Sets the first variant's locale. Additional locales can be added in the editor.
                    </div>
                </div>
                <div>
                    <label class="cms-label">VFS Path <span class="text-muted">(optional)</span></label>
                    <input class="cms-input" type="text" [(ngModel)]="vfsPath"
                           placeholder="e.g. /about.html (auto-derived from slug)" />
                </div>

                <!-- -- Start from Markdown (optional, ------------ -->
                @if (contentType !== 'landing') {
                    <div>
                        <button type="button" class="cms-btn cms-btn-sm"
                                style="padding-left: 0; background: transparent;"
                                (click)="showMarkdown.set(!showMarkdown())">
                            <i class="bi bi-chevron-down" [class.rotated]="showMarkdown()"></i>
                            <i class="bi bi-markdown"></i> Start from Markdown
                            <span class="text-muted">(optional)</span>
                        </button>
                        @if (showMarkdown()) {
                            <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">
                                <label class="cms-btn cms-btn-sm" style="align-self: flex-start; margin: 0;">
                                    <i class="bi bi-upload"></i> Load .md
                                    <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain"
                                           hidden (change)="onMarkdownFile($event)" />
                                </label>
                                <textarea class="cms-input" rows="6" spellcheck="false"
                                          style="font-family: var(--cms-font-mono, monospace); resize: vertical;"
                                          placeholder="# Heading&#10;&#10;Paste GitHub-flavoured Markdown to seed the body…"
                                          [(ngModel)]="markdown"></textarea>
                                <div class="cms-field-hint">
                                    Converted server-side; raw HTML and unsafe links are stripped.
                                </div>
                            </div>
                        }
                    </div>
                }
            </div>
            <div class="cms-dialog-footer">
                <button class="cms-btn cms-btn-sm" (click)="close()">Cancel</button>
                <button class="cms-btn cms-btn-primary cms-btn-sm"
                        [disabled]="!(slug.trim() || title.trim()) || saving()"
                        (click)="submit()">
                    {{ saving() ? 'Creating…' : 'Create' }}
                </button>
            </div>
        </div>
    `,
    styles: [`
        .rotated { transform: rotate(180deg); transition: transform 200ms; display: inline-block; }
    `],
})
export class CreatePageDialogComponent {
    private readonly dialogRef = inject(DialogRef);
    private readonly pageSvc   = inject(PageService);
    private readonly toast     = inject(ToastService);
    private readonly store     = inject(Store);
    private readonly http      = inject(HttpClient);

    /**
     * The space to create in, handed down by the explorer.
     *
     * Optional so any other caller keeps the previous behaviour (path derived
     * from the SiteSection); the explorer always supplies it, because "New
     * Page" has to mean "here", in the space on screen.
     */
    protected readonly dialogData = inject<{ space?: string | null; spaceLabel?: string } | null>(
        DIALOG_DATA,
        { optional: true },
    );

    slug    = '';
    /**
     * Human page title. Sent to the backend, which DERIVES the slug from it
     * via the Core i18n slugger when `slug` is blank ([]/[]) and
     * stamps it on the initial variant's `Node.title`. Either title or slug
     * must be present to enable Create.
     */
    title   = '';
    vfsPath = '';
    /**
     * Page-level content type (W5.f,).
     *
     * `''` means "send nothing", which is NOT the same as picking `page`:
     * empty lets the enclosing content collection stamp its own type (a page
     * created inside a blog collection becomes a `blog_post`), while an
     * explicit choice OVERRIDES that. Two values, two meanings — hence the
     * "Default" option rather than folding it into the list.
     */
    contentType = '';

    /** Configured page kinds, loaded from `content.page_types`. */
    readonly pageTypes = signal<PageTypeDto[]>([]);

    /**
     * Theme template the picked kind renders with; '' when none is picked.
     *
     * A method rather than a `computed()`: `contentType` is a plain field
     * driven by `[(ngModel)]`, not a signal, so a computed would never see it
     * change and the hint would freeze on the first selection.
     */
    selectedTemplate(): string {
        return this.pageTypes().find(t => t.key === this.contentType)?.template ?? '';
    }
    /**
     * Optional Markdown to seed the new page's body. When non-empty
     * it's posted as `markdown`; the backend converts it to safe HTML. Hidden
     * for landing pages (they render `extras.blocks`, not a body).
     */
    markdown = '';
    readonly showMarkdown = signal(false);
    /**
     * Picked initial-variant locale. Defaults to the first entry in
     * `manifest.supportedLocales` -- which is the tenant default by
     * `coolms_i18n.yaml` ordering convention (default listed first).
     * Sent to the backend as `locale`; backend enforces it's in the
     * supported set (422 otherwise) before minting the variant file.
     */
    locale  = '';
    readonly saving = signal(false);

    /**
     * Locales THIS SITE publishes in, fetched from
     * `i18n.site_enabled_locales`; empty until it answers.
     */
    private readonly siteLocales = signal<{ code: string; label: string }[]>([]);

    /**
     * The locales offered for the first variant.
     *
     * Prefers the SITE's set over the platform manifest. The manifest is
     * structural metadata served to anonymous callers, so it lists every locale
     * the install supports -- and a site may publish in fewer. Offering one it
     * has turned off produces a page whose only URL answers 404; the backend
     * refuses that now, so without this the author would meet an error instead
     * of never being offered the choice.
     *
     * Falls back to the manifest, then to a single 'en' entry: a locale list
     * that failed to load must not block page creation, and the backend applies
     * the site's own default when the picker sends nothing it can honour.
     */
    readonly locales = computed(() => {
        const site = this.siteLocales();
        if (site.length > 0) {
            return site;
        }

        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const supported = manifest?.supportedLocales ?? [];
        if (supported.length === 0) {
            return [{ code: 'en', label: 'English' }];
        }
        return supported;
    });

    constructor() {
        // Default to the first configured locale -- tenant default.
        const first = this.locales()[0];
        if (first) this.locale = first.code;

        // The site's own set, which narrows the list above once it arrives. A
        // failure leaves the manifest list in place rather than blocking
        // creation on a config read.
        this.http.get<{ member?: { value: string; label: string }[] }>(
            '/api/v1/options/i18n.site_enabled_locales',
        )
            .pipe(takeUntilDestroyed())
            .subscribe({
                next: res => {
                    const rows = (res.member ?? []).map(o => ({ code: o.value, label: o.label }));
                    if (rows.length === 0) {
                        return;
                    }
                    this.siteLocales.set(rows);

                    //  Re-pick if what was chosen a moment ago is not on this
                    // site's list. The constructor defaults before the fetch
                    // returns, so leaving it would submit a locale the backend
                    // is about to refuse -- an error the operator never chose.
                    if (!rows.some(r => r.code === this.locale)) {
                        this.locale = rows[0].code;
                    }
                },
                error: () => { /* keep the manifest list */ },
            });

        // — the kinds this installation offers. Failure leaves the list
        // empty, which degrades to the "Default" option alone rather than
        // blocking page creation on a config read.
        this.pageSvc.listPageTypes()
            .pipe(takeUntilDestroyed())
            .subscribe({
                next: types => this.pageTypes.set(types),
                error: () => this.pageTypes.set([]),
            });
    }

    submit(): void {
        const slug = this.slug.trim();
        const title = this.title.trim();
        // Either yields a slug server-side; an explicit slug wins, else it is
        // derived from the title. Guard mirrors the button's disabled state.
        if (!slug && !title) return;
        this.saving.set(true);

        this.pageSvc.createPage({
            slug,
            title: title || undefined,
            // An explicit path still wins server-side; the space only roots the
            // DERIVED one.
            space: this.dialogData?.space || undefined,
            vfsPath: this.vfsPath.trim() || undefined,
            locale: this.locale || undefined,
            contentType: this.contentType || undefined,
            // Landing pages render blocks, not a body — never seed Markdown there.
            markdown: this.contentType !== 'landing' && this.markdown.trim()
                ? this.markdown
                : undefined,
        }).subscribe({
            next: page => {
                this.toast.success('Page created', `/${page.slug}`);
                this.dialogRef.close(page);
            },
            error: () => {
                this.saving.set(false);
                this.toast.error('Failed to create page');
            },
        });
    }

    /** Read a picked `.md` file's text into the Markdown textarea. */
    onMarkdownFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => this.markdown = String(reader.result ?? '');
        reader.onerror = () => this.toast.error('Could not read the file');
        reader.readAsText(file);
        input.value = ''; // allow re-picking the same file
    }

    close(): void {
        this.dialogRef.close(null);
    }
}
