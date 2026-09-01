import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { forkJoin, of } from 'rxjs';
import { catchError, concatMap } from 'rxjs/operators';

import { ChannelConfigField, CollectionService, OutboundChannelDto } from './collection.service';
import { PageService } from './page.service';
import { PageTypeDto } from './page.types';
import { ErrorHandlerService } from '@coolms/core-angular';
import { MultiOptionSelectComponent, ToastService } from '@coolms/ui-angular';

/** Mirrors `ChannelConfigField::TYPE_SECRET_REF`. */
const SECRET_REF = 'secretRef';

export interface SectionPropertiesDialogData {
    /** Absolute VFS path of the section directory. */
    readonly path: string;
    /** Display name for the header (falls back to the path). */
    readonly label?: string;
}

/**
 * Section properties — everything a section declares about the posts
 * inside it, and where a published one goes.
 *
 * ## Why this exists at all
 *
 * The per-section distribution config has been implemented since M6.a, but its
 * only door was a row action on a DIRECTORY row in the Pages grid — and
 * moved folders out of that grid, so the action could no longer fire. The
 * capability was intact and unreachable. This is the door, in the place a
 * section now lives: the left-panel tree.
 *
 * ## Three groups, in the order a person asks about them
 *
 *  1. **Feed** — is this section a content collection? Only a collection has
 *     `/{section}/feed.xml`, so a plain directory shows the reason and a button
 *     that promotes it. The feed itself needs no configuring: it renders on
 *     demand from the live published posts, so it is never stale.
 *  2. **Posts** — the section's DEFAULT PAGE TEMPLATE (`postContentType`, the
 *     `extras.contentType` stamped on each new post, which the resolver maps to
 *     `pages/{type}.html.dtmpl`) and whether they need editorial review.
 *  3. **Distribution** — which outbound channels a published post fans out to,
 *     and each selected channel's settings. The list comes from the
 *     `core.outbound_channels` OptionSource and the settings from
 *     `GET /outbound-channels`, both served off the same gated registry,
 *     so installing a channel module extends both with no change here. Nothing
 *     in this file names a channel: the first version hard-coded one "Webhook
 *     URL" input, which made every other channel tickable but unconfigurable.
 *
 * Two endpoints back it (`…/settings` and `…/distribution`) because they
 * validate different things; the dialog saves both and reports once.
 */
@Component({
    selector: 'app-section-properties-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, MultiOptionSelectComponent],
    template: `
        <div class="cms-dialog spd">
            <div class="cms-dialog-header">
                <i class="bi bi-folder2-open"></i>
                <span>Section — {{ label }}</span>
                <button type="button" class="cms-dialog-close" (click)="close()" aria-label="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="cms-dialog-body spd__body">
                @if (loading()) {
                    <div class="cms-field-hint">Loading…</div>
                } @else {
                    <p class="spd__path">{{ data.path }}</p>

                    <!-- 1. FEED -->
                    <section class="spd__group">
                        <div class="spd__group-title">Syndication</div>
                        @if (isCollection()) {
                            <div class="cms-field-hint">
                                This section publishes a feed, rendered on demand from its live
                                published posts — a new post appears on the next fetch.
                            </div>
                            <div class="spd__feeds">
                                <a [href]="rssUrl()" target="_blank" rel="noopener">
                                    <i class="bi bi-rss-fill"></i> {{ rssUrl() }}
                                </a>
                                <a [href]="atomUrl()" target="_blank" rel="noopener">
                                    <i class="bi bi-rss"></i> {{ atomUrl() }}
                                </a>
                            </div>
                        } @else {
                            <div class="cms-field-hint">
                                This is a plain directory, so it has <strong>no feed</strong> and its
                                posts get no default type. Declaring it a content collection turns
                                both on.
                            </div>
                            <button type="button"
                                    class="cms-btn cms-btn-sm"
                                    [disabled]="saving()"
                                    (click)="promote()">
                                <i class="bi bi-rss"></i>
                                <span>Make this a content collection</span>
                            </button>
                        }
                    </section>

                    @if (isCollection()) {
                        <!-- 2. POSTS -->
                        <section class="spd__group">
                            <div class="spd__group-title">Posts in this section</div>
                            <div>
                                <label class="cms-label">Default page template</label>
                                <select class="cms-select" [(ngModel)]="postContentType">
                                    @for (t of pageTypes(); track t.key) {
                                        <option [value]="t.key">{{ t.label }}</option>
                                    }
                                </select>
                                <div class="cms-field-hint">
                                    Stamped on every new post here and used to pick its template.
                                    Existing posts keep the type they were created with.
                                </div>
                            </div>
                            <label class="spd__check">
                                <input type="checkbox" class="form-check-input" [(ngModel)]="requiresReview" />
                                <span>Posts need editorial review before publishing</span>
                            </label>
                            <label class="spd__check">
                                <input type="checkbox" class="form-check-input" [(ngModel)]="sidebarNav" />
                                <span>Reading layout — ordered siblings with prev/next, not a feed</span>
                            </label>
                        </section>

                        <!-- 3. DISTRIBUTION -->
                        <section class="spd__group">
                            <div class="spd__group-title">Distribution</div>
                            <app-multi-option-select
                                [values]="enabledChannels()"
                                [apiUrl]="channelsApiUrl"
                                placeholder="— No distribution —"
                                entityLabel="channel"
                                (valuesChange)="onChannelsChange($event)" />
                            <div class="cms-field-hint">
                                Publishing a post here fans out to the selected channels. Empty =
                                off. The list grows as channel modules are installed.
                            </div>

                            @for (channel of channelsNeedingConfig(); track channel.id) {
                                <div class="spd__channel">
                                    <div class="spd__channel-title">{{ channel.label }}</div>
                                    @for (field of channel.fields; track field.key) {
                                        <div>
                                            <label class="cms-label">
                                                {{ field.label }}
                                                @if (field.required) { <span class="spd__req">*</span> }
                                            </label>
                                            <input class="cms-input"
                                                   [type]="inputType(field)"
                                                   [placeholder]="field.placeholder"
                                                   [ngModel]="fieldValue(channel.id, field.key)"
                                                   [ngModelOptions]="{ standalone: true }"
                                                   (ngModelChange)="setFieldValue(channel.id, field.key, $event)" />
                                            @if (isSecretRef(field)) {
                                                <div class="cms-field-hint spd__secret">
                                                    <i class="bi bi-key-fill"></i>
                                                    <span>
                                                        Stored secret <strong>name</strong> — the value never leaves the
                                                        secret store. Add it with
                                                        <code>coolms:secret:set</code> or your configured backend.
                                                    </span>
                                                </div>
                                            }
                                            @if ('' !== field.help) {
                                                <div class="cms-field-hint">{{ field.help }}</div>
                                            }
                                        </div>
                                    }
                                    @if (missing(channel).length > 0) {
                                        <div class="spd__warn">
                                            <i class="bi bi-exclamation-triangle-fill"></i>
                                            <span>
                                                Not configured — {{ channel.label }} is selected but will be
                                                skipped until {{ missing(channel).join(' and ') }} is filled in.
                                            </span>
                                        </div>
                                    }
                                </div>
                            }
                        </section>
                    }
                }
            </div>

            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn cms-btn-sm" (click)="close()">Cancel</button>
                @if (!loading() && isCollection()) {
                    <button type="button"
                            class="cms-btn cms-btn-primary cms-btn-sm"
                            [disabled]="saving()"
                            (click)="save()">
                        {{ saving() ? 'Saving…' : 'Save' }}
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        .spd { width: 560px; max-width: 94vw; }
        .spd__body { display: flex; flex-direction: column; gap: 14px; max-height: 72vh; overflow-y: auto; }

        .spd__path {
            margin: 0;
            font-family: var(--cms-font-mono, ui-monospace, SFMono-Regular, monospace);
            font-size: .75rem;
            color: var(--cms-text-muted);
            word-break: break-all;
        }

        .spd__group { display: flex; flex-direction: column; gap: 8px; }
        .spd__group-title {
            font-size: .6875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .04em;
            color: var(--cms-text-muted);
        }

        .spd__feeds { display: flex; flex-direction: column; gap: 2px; }
        .spd__feeds a {
            font-family: var(--cms-font-mono, ui-monospace, SFMono-Regular, monospace);
            font-size: .75rem;
            word-break: break-all;
        }
        .spd__feeds i { color: var(--cms-accent); margin-right: 4px; }

        .spd__check { display: flex; align-items: center; gap: 8px; font-size: .8125rem; }

        /* One box per channel, so "which settings belong to what" is visible
           rather than inferred from field order. */
        .spd__channel {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px 12px;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm, 4px);
            background: var(--cms-surface-muted, #f3f4f6);
        }
        .spd__channel-title { font-size: .8125rem; font-weight: 600; }

        .spd__req { color: var(--cms-danger, #dc2626); }

        .spd__warn {
            display: flex;
            gap: 6px;
            font-size: .75rem;
            color: var(--cms-warning-text, var(--cms-text-muted));
        }
        .spd__warn i { color: var(--cms-warning, #d97706); flex: none; margin-top: 1px; }

        .spd__secret { display: flex; gap: 6px; align-items: flex-start; }
        .spd__secret i { color: var(--cms-accent); flex: none; margin-top: 2px; }
        .spd__secret code {
            font-size: .95em;
            padding: 0 3px;
            border-radius: 2px;
            background: var(--cms-border-light, rgba(0,0,0,.05));
        }
    `],
})
export class SectionPropertiesDialogComponent implements OnInit {
    protected readonly data = inject<SectionPropertiesDialogData>(DIALOG_DATA);
    private readonly ref = inject<DialogRef<boolean | null>>(DialogRef);
    private readonly collections = inject(CollectionService);
    private readonly pages = inject(PageService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    protected readonly channelsApiUrl = '/api/v1/options/core.outbound_channels';

    protected readonly loading = signal(true);
    protected readonly saving = signal(false);
    protected readonly isCollection = signal(false);
    protected readonly pageTypes = signal<readonly PageTypeDto[]>([]);
    protected readonly enabledChannels = signal<readonly string[]>([]);

    /** Every enabled channel with its declared settings — `GET /outbound-channels`. */
    private readonly channels = signal<readonly OutboundChannelDto[]>([]);

    /**
     * The selected channels that actually ASK for something. A channel needing
     * no settings (rss derives everything from the section) contributes no box,
     * so selecting it stays a one-click decision.
     */
    protected readonly channelsNeedingConfig = computed<readonly OutboundChannelDto[]>(() => {
        const selected = this.enabledChannels();

        return this.channels().filter(c => selected.includes(c.id) && c.fields.length > 0);
    });

    /**
     * Field values, flattened to `channelId.fieldKey`.
     *
     * Flat because the template binds one input per (channel, field) pair and a
     * nested record would need each channel's object to exist before ngModel
     * could write into it — an initialisation step that silently does nothing
     * when a channel is selected after load.
     */
    private readonly fieldValues = signal<Record<string, string>>({});

    /**
     * The config as LOADED, kept so a save preserves keys no channel declares.
     *
     * Declaring a field controls what the dialog OFFERS, not what the channel
     * accepts: `email` reads `from`/`cc`/`bcc` and `websub` reads a caller-
     * supplied `topicUrl`, none of which appear here. Rebuilding `channelConfig`
     * from the declared fields alone would drop them on every save — the same
     * class of silent loss as the `forkJoin` bug below, one layer down.
     */
    private loadedConfig: Record<string, Record<string, unknown>> = {};

    protected postContentType = '';
    protected requiresReview = false;
    protected sidebarNav = false;

    protected get label(): string {
        return this.data.label ?? this.data.path;
    }

    /**
     * Public feed URLs, derived by stripping the content root — the same
     * mirror-the-path rule the pages themselves follow, so these are
     * the real addresses rather than a guess.
     */
    protected readonly publicPath = computed<string>(() => {
        const match = /^\/content\/[^/]+(\/.*)$/.exec(this.data.path);

        return null === match ? '' : match[1];
    });

    protected readonly rssUrl = computed(() => `${this.publicPath()}/feed.xml`);
    protected readonly atomUrl = computed(() => `${this.publicPath()}/atom.xml`);

    ngOnInit(): void {
        // Both reads project out of the same node-meta response and the page
        // types are a small static catalogue; one forkJoin so the dialog paints
        // once rather than in three stages.
        forkJoin({
            settings: this.collections.getSettings(this.data.path),
            distribution: this.collections.getDistribution(this.data.path),
            types: this.pages.listPageTypes().pipe(catchError(() => of([] as PageTypeDto[]))),
            channels: this.collections.listChannels().pipe(catchError(() => of([] as OutboundChannelDto[]))),
        })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: ({ settings, distribution, types, channels }) => {
                    this.isCollection.set(settings.isCollection);
                    this.postContentType = settings.postContentType;
                    this.requiresReview = settings.requiresReview;
                    this.sidebarNav = settings.sidebarNav;
                    this.enabledChannels.set(distribution.enabledChannels);
                    this.channels.set(channels);
                    this.loadedConfig = distribution.channelConfig;
                    this.fieldValues.set(this.flatten(distribution.channelConfig, channels));
                    this.pageTypes.set(types);
                    this.loading.set(false);
                },
                error: () => {
                    this.toast.error('Failed to load section properties');
                    this.loading.set(false);
                },
            });
    }

    protected onChannelsChange(values: readonly string[]): void {
        this.enabledChannels.set(values);
    }

    protected fieldValue(channelId: string, key: string): string {
        return this.fieldValues()[`${channelId}.${key}`] ?? '';
    }

    protected setFieldValue(channelId: string, key: string, value: string): void {
        this.fieldValues.update(map => ({ ...map, [`${channelId}.${key}`]: value }));
    }

    protected isSecretRef(field: ChannelConfigField): boolean {
        return SECRET_REF === field.type;
    }

    /**
     * Nothing is ever masked, because nothing sensitive is ever held here: a
     * `secretRef` field carries the NAME of a stored secret, which the
     * operator needs to read back to check. Masking it would be theatre that
     * makes a typo harder to spot.
     */
    protected inputType(field: ChannelConfigField): string {
        return 'url' === field.type || 'email' === field.type || 'number' === field.type ? field.type : 'text';
    }

    /**
     * Required fields still blank for a SELECTED channel.
     *
     * Not a save blocker: a channel with no config soft-skips at publish time
     * rather than failing the post, so blocking would be a stricter rule than
     * the backend's. But leaving it silent is what made the old dialog
     * misleading — a channel could be ticked and never fire, with nothing on
     * screen saying so.
     */
    protected missing(channel: OutboundChannelDto): readonly string[] {
        return channel.fields
            .filter(f => f.required && '' === this.fieldValue(channel.id, f.key).trim())
            .map(f => f.label);
    }

    /**
     * Loaded config -> the flat `channelId.fieldKey` map the inputs bind to.
     *
     * Only DECLARED keys are lifted: an undeclared key has no input, and
     * carrying it here would let a save write back a value nobody could see or
     * edit. Undeclared keys survive through {@see loadedConfig} instead.
     */
    private flatten(
        config: Record<string, Record<string, unknown>>,
        channels: readonly OutboundChannelDto[],
    ): Record<string, string> {
        const flat: Record<string, string> = {};
        for (const channel of channels) {
            const stored = config[channel.id];
            if (undefined === stored || null === stored) {
                continue;
            }
            for (const field of channel.fields) {
                const value = stored[field.key];
                if ('string' === typeof value) {
                    flat[`${channel.id}.${field.key}`] = value;
                } else if ('number' === typeof value || 'boolean' === typeof value) {
                    flat[`${channel.id}.${field.key}`] = String(value);
                }
            }
        }

        return flat;
    }

    /**
     * Assemble what to persist: the loaded config for each still-selected
     * channel, with the declared fields overlaid.
     *
     * Config for a DESELECTED channel is dropped — leaving it behind would mean
     * re-ticking the channel silently resurrects settings the operator last saw
     * being removed.
     */
    private buildChannelConfig(): Record<string, unknown> {
        const out: Record<string, unknown> = {};

        for (const id of this.enabledChannels()) {
            const declared = this.channels().find(c => c.id === id);
            const entry: Record<string, unknown> = { ...(this.loadedConfig[id] ?? {}) };

            for (const field of declared?.fields ?? []) {
                // Every field round-trips, so blank always means CLEAR.
                //
                // needed a "blank secret means unchanged" exception,
                // because a masked credential could not be read back and saving
                // the dialog would have erased it. removed the credential
                // rather than the exception: what a `secretRef` holds is a NAME,
                // which reads back like anything else, so the special case — and
                // the surprise of a field that ignores being emptied — is gone.
                const value = this.fieldValue(id, field.key).trim();
                if ('' === value) {
                    delete entry[field.key];
                    continue;
                }
                entry[field.key] = value;
            }

            if (Object.keys(entry).length > 0) {
                out[id] = entry;
            }
        }

        return out;
    }

    /**
     * Declare a plain directory a content collection.
     *
     * `collectionType` is the folder name, matching what `CreateCollection`
     * defaults to for a new one; the backend derives `{type}_post` for the post
     * type, so the promoted section is shaped like a created one.
     */
    protected promote(): void {
        const name = this.data.path.split('/').filter(Boolean).pop() ?? '';
        if ('' === name) {
            return;
        }
        this.saving.set(true);
        this.collections.setSettings({ path: this.data.path, collectionType: name })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.saving.set(false);
                    this.toast.success('Section is now a content collection', this.label);
                    // Closed rather than re-read in place: the feed, the post
                    // type and the whole Posts group appear at once, and the
                    // caller reloads the listing anyway.
                    this.ref.close(true);
                },
                // Surface the SERVER's reason. The write is gated on
                // `VfsPermission::WRITE`, so the common failure is a 403 whose
                // detail names the path — and "Failed to declare the
                // collection" would hide the one fact that lets an operator
                // act (the directory is not writable by their group).
                error: err => {
                    this.saving.set(false);
                    this.toast.error('Could not declare the collection', this.errors.humanize(err));
                },
            });
    }

    protected save(): void {
        this.saving.set(true);

        const channelConfig = this.buildChannelConfig();

        // Two writes, one save button — STRICTLY SEQUENTIAL.
        //
        // The first version ran them through `forkJoin` on the reasoning that
        // they touch disjoint extras keys. That reasoning is wrong and cost a
        // silent lost update: both endpoints load the SAME Node and each
        // persists the WHOLE `extras` JSON column, so whichever committed
        // second wrote back its own stale copy of the other's keys. Saving the
        // dialog reported success and quietly discarded the settings.
        //
        // `concatMap` makes the second request start only after the first has
        // committed, so it reads the updated row. Disjoint KEYS are not
        // disjoint WRITES when the storage is one JSON document.
        this.collections.setSettings({
            path: this.data.path,
            postContentType: '' === this.postContentType ? undefined : this.postContentType,
            requiresReview: this.requiresReview,
            sidebarNav: this.sidebarNav,
        })
            .pipe(
                concatMap(() => this.collections.setDistribution({
                    path: this.data.path,
                    enabledChannels: [...this.enabledChannels()],
                    channelConfig,
                })),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: () => {
                    this.toast.success('Section properties saved', this.label);
                    this.ref.close(true);
                },
                error: err => {
                    this.saving.set(false);
                    this.toast.error('Could not save section properties', this.errors.humanize(err));
                },
            });
    }

    protected close(): void {
        this.ref.close(null);
    }
}
