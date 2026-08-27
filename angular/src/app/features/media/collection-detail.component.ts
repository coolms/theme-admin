import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngxs/store';
import { CoolmsEditorComponent } from '@coolms/editor-angular';
import { MediaService } from './media.service';
import { NodeMetaDto } from './media.types';
import { LocaleSwitcherComponent } from '@coolms/ui-angular';
import { AppConfigState } from '@coolms/core-angular';
/**
 * Properties panel for a media COLLECTION (directory). Edits the directory
 * Node's localized title + description through the SAME resolve-on-read /
 * scope-on-write model as the asset panel — directories are VFS Nodes, so the
 * generic `PATCH/GET /vfs/files?path=&locale=` already resolves/scopes those
 * fields (no Media-specific backend). One panel-level locale switcher; switching
 * lazily reloads the node for that locale; save scopes the write.
 *
 * Title/description (not alt/caption) because a folder isn't an image.
 */
@Component({
    selector: 'app-collection-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ReactiveFormsModule, LocaleSwitcherComponent, CoolmsEditorComponent],
    template: `
        <div class="coll-detail p-3">
            <div class="coll-path small text-muted mb-2" [title]="path()">
                <i class="bi bi-folder2-open me-1"></i>{{ name() || path() }}
            </div>

            <app-locale-switcher
                [activeLocale]="activeLocale()"
                [dirty]="dirty()"
                [loading]="loading()"
                (localeChange)="switchLocale($event)" />

            <label class="form-label small fw-semibold mb-1">Title</label>
            <input type="text"
                   class="form-control form-control-sm"
                   [formControl]="titleControl"
                   [readonly]="!canWrite()"
                   [placeholder]="titlePlaceholder()" />

            <div class="mt-2">
                <label class="form-label small fw-semibold mb-1">Description</label>
                <!-- Rich (comment profile: bold/italic/link). The editor has no
                     read-only mode, so when the user can't write we render the
                     resolved value as static HTML instead. mountKey remounts on
                     path/locale change so it re-seeds. -->
                @if (canWrite()) {
                    <coolms-editor
                        class="cms-inline-editor"
                        profile="comment"
                        [content]="descriptionHtml()"
                        [mountKey]="descMountKey()"
                        (contentChange)="onDescriptionChange($event)" />
                } @else if (descriptionHtml()) {
                    <div class="cms-desc-readonly form-control form-control-sm bg-light"
                         [innerHTML]="descriptionHtml()"></div>
                } @else {
                    <div class="small text-muted fst-italic">No description.</div>
                }
            </div>

            @if (!canWrite()) {
                <div class="small text-muted mt-2">
                    <i class="bi bi-lock-fill me-1"></i>You don't have permission to edit this collection.
                </div>
            }

            <div class="d-flex gap-2 mt-3 justify-content-end">
                <button type="button" class="cms-btn cms-btn-primary"
                        (click)="save()" [disabled]="saving() || loading() || !canWrite()">
                    <i class="bi bi-check-lg"></i>
                    {{ saving() ? 'Saving…' : 'Save' }}
                </button>
            </div>
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .coll-detail { flex: 1; overflow-y: auto; min-height: 0; }
        .coll-path { word-break: break-all; }
    `],
})
export class CollectionDetailComponent {
    readonly path = input.required<string>();
    readonly name = input<string>('');
    /** Emitted after a successful save (parent may refresh the collections tree). */
    readonly saved = output<void>();

    readonly activeLocale = signal<string>('en');
    readonly loading      = signal(false);
    readonly saving       = signal(false);
    readonly dirty        = signal(false);
    /** Whether the current user may write this directory Node (from the load). */
    readonly canWrite     = signal(true);

    readonly titleControl       = new FormControl<string>('', { nonNullable: true });
    readonly descriptionControl = new FormControl<string>('', { nonNullable: true });

    /** Seed HTML for the rich Description editor (set on populate). */
    readonly descriptionHtml = signal<string>('');
    /** Remount key — bumps on path/locale change so the editor re-seeds. */
    readonly descMountKey = computed<string>(() => `${this.path()}:${this.activeLocale()}`);

    /** Canonical default-locale values — the fallback hint shown on non-default tabs. */
    private readonly canonical = signal<NodeMetaDto>({ title: null, description: null, canWrite: true });

    private readonly svc       = inject(MediaService);
    private readonly store     = inject(Store);
    private readonly destroyRef = inject(DestroyRef);

    readonly defaultLocale = computed((): string => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        return m?.platformDefaults?.locale ?? m?.supportedLocales?.[0]?.code ?? 'en';
    });

    readonly titlePlaceholder = computed((): string => {
        if (this.activeLocale() === this.defaultLocale()) return 'Collection title…';
        const def = this.canonical().title;
        return def ? `Falls back to ${this.defaultLocale().toUpperCase()}: “${def}”` : 'No default-locale value';
    });

    constructor() {
        // New collection selected → reset to default locale and load it.
        effect(() => {
            const p = this.path();
            if (!p) return;
            untracked(() => {
                this.activeLocale.set(this.defaultLocale());
                this.load(this.defaultLocale(), /* isCanonical */ true);
            });
        });

        for (const ctrl of [this.titleControl, this.descriptionControl]) {
            ctrl.valueChanges
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(() => this.dirty.set(true));
        }
    }

    /** Load the node meta for a locale and populate the controls. */
    private load(locale: string, isCanonical = false): void {
        this.loading.set(true);
        this.svc.getNodeMeta(this.path(), locale)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: meta => {
                    this.loading.set(false);
                    if (isCanonical) this.canonical.set(meta);
                    this.populate(meta);
                },
                error: () => this.loading.set(false),
            });
    }

    private populate(meta: NodeMetaDto): void {
        this.titleControl.setValue(meta.title ?? '', { emitEvent: false });
        this.descriptionControl.setValue(meta.description ?? '', { emitEvent: false });
        this.descriptionHtml.set(meta.description ?? '');
        this.canWrite.set(meta.canWrite);
        this.dirty.set(false);
    }

    /** Rich-editor (comment profile) wrote HTML → mirror into the save control. */
    onDescriptionChange(html: string): void {
        if (this.descriptionControl.value === html) return;
        this.descriptionControl.setValue(html); // emits → marks dirty
    }

    switchLocale(locale: string): void {
        if (locale === this.activeLocale()) return;
        if (this.dirty()
            && !confirm(`Discard unsaved changes for ${this.activeLocale().toUpperCase()}?`)) {
            return;
        }
        this.activeLocale.set(locale);
        this.load(locale, locale === this.defaultLocale());
    }

    save(): void {
        this.saving.set(true);
        this.svc.updateNodeMeta(this.path(), {
            title:       this.titleControl.value,
            description: this.descriptionControl.value,
        }, this.activeLocale()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: meta => {
                this.saving.set(false);
                if (this.activeLocale() === this.defaultLocale()) this.canonical.set(meta);
                this.populate(meta);
                this.saved.emit();
            },
            error: () => this.saving.set(false),
        });
    }
}
