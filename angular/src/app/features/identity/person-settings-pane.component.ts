import { HttpErrorResponse } from '@angular/common/http';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    input,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppConfigState, CmsLoaderComponent, ErrorHandlerService } from '@coolms/core-angular';
import { Store } from '@ngxs/store';
import { forkJoin } from 'rxjs';

import { type ModuleSettingsBlockDto } from '../settings/module-settings.types';
import { ModuleSettingsService } from '../settings/module-settings.service';
import { colourInForce, optionsFor } from './declared-options';
import { type DeclaredKey, type DeclaredSection, DeclaredSettingsService } from './declared-settings.service';

interface Row {
    readonly section: DeclaredSection;
    readonly key: DeclaredKey;
    /** The block's key for the installation's value; null when the setting has no installation default. */
    readonly valueKey: string | null;
    /** The block's key for the lock; null when the setting cannot be locked. */
    readonly lockKey: string | null;
}

/**
 * What people may set, for the whole installation: each setting's default for people who have chosen nothing, and
 * whether it is locked. Identity's guest in the settings pane, drawn from what the server declares.
 *
 * The block is saved whole, so every key the server holds is sent back, changed or not.
 */
@Component({
    selector: 'app-person-settings-pane',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent],
    styles: [`
        :host { display: block; }
        .section-title { margin: 16px 0 8px; font-size: 14px; font-weight: 600; color: var(--cms-text); }
        .row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px 16px;
            align-items: end;
            max-width: 560px;
            margin-bottom: 12px;
        }
        .row-label { display: block; margin-bottom: 4px; font-size: 13px; font-weight: 500; color: var(--cms-text); }
        .row-colour { width: 48px; height: 32px; padding: 2px; }
        .row-lock { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--cms-text); }
        .note { margin: 0 0 12px; font-size: 13px; color: var(--cms-text-muted); }
        .form-error { margin: 0 0 12px; font-size: 13px; color: var(--cms-danger); }
    `],
    template: `
        @if (loading()) {
            <cms-loader [inline]="true" />
        } @else if (0 === groups().length && error(); as message) {
            <p class="form-error" role="alert">{{ message }}</p>
        } @else {
            <p class="note">
                The default applies to people who have chosen nothing. A locked setting applies to everyone, and they
                see "Set by your administrator".
            </p>
            @for (group of groups(); track group.section) {
                <h3 class="section-title">{{ group.label }}</h3>
                @for (row of group.rows; track row.key.key) {
                    <div class="row">
                        <div>
                            @if (row.valueKey; as valueKey) {
                                <label class="row-label" [attr.for]="valueKey">{{ row.key.label }}</label>
                                @switch (row.key.type) {
                                    @case ('colour') {
                                        <input class="cms-input row-colour"
                                               type="color"
                                               [id]="valueKey"
                                               [value]="value(valueKey) ?? colourInForce()"
                                               (change)="setText(valueKey, $event)" />
                                    }
                                    @default {
                                        <select class="cms-input" [id]="valueKey" (change)="setText(valueKey, $event)">
                                            @for (o of options(row, valueKey); track o.value) {
                                                <option [value]="o.value" [selected]="o.value === value(valueKey)">{{ o.label }}</option>
                                            }
                                        </select>
                                    }
                                }
                            } @else {
                                <span class="row-label">{{ row.key.label }}</span>
                            }
                        </div>
                        @if (row.lockKey; as lockKey) {
                            <label class="row-lock">
                                <span class="cms-toggle">
                                    <input type="checkbox"
                                           [checked]="value(lockKey) === true"
                                           (change)="setChecked(lockKey, $event)" />
                                    <span class="cms-toggle__slider"></span>
                                </span>
                                Locked
                            </label>
                        }
                    </div>
                }
            }
            @if (error(); as message) {
                <p class="form-error" role="alert">{{ message }}</p>
            }
            <button type="button"
                    class="cms-btn cms-btn-primary"
                    [disabled]="saving() || !changed()"
                    (click)="save()">
                @if (saving()) {
                    <cms-loader [inline]="true" />
                }
                Save changes
            </button>
        }
    `,
})
export class PersonSettingsPaneComponent {
    private readonly declared = inject(DeclaredSettingsService);
    private readonly blocks = inject(ModuleSettingsService);
    private readonly store = inject(Store);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    /** Which block this pane edits, as the settings pane hands every guest. */
    readonly settingKey = input.required<string>();
    /** Moves when the block is saved or reset around this pane, so it reads again. */
    readonly revision = input(0);

    protected readonly loading = signal(true);
    protected readonly saving = signal(false);
    protected readonly error = signal<string | null>(null);
    private readonly sections = signal<ReadonlyArray<DeclaredSection>>([]);
    private readonly held = signal<Readonly<Record<string, unknown>>>({});
    private readonly edits = signal<Readonly<Record<string, unknown>>>({});

    protected readonly changed = computed(() => Object.keys(this.edits()).length > 0);
    /** Only what the block holds a key for: a setting with neither a default nor a lock has nothing to set here. */
    protected readonly groups = computed(() => {
        const held = this.held();
        return this.sections()
            .map(section => ({
                section: section.section,
                label: section.label,
                rows: section.keys
                    .map((key): Row => {
                        const name = `${section.section}.${key.key}`;
                        return {
                            section,
                            key,
                            valueKey: name in held ? name : null,
                            lockKey: `${name}.locked` in held ? `${name}.locked` : null,
                        };
                    })
                    .filter(row => null !== row.valueKey || null !== row.lockKey),
            }))
            .filter(group => group.rows.length > 0);
    });

    constructor() {
        effect(() => {
            this.settingKey();
            this.revision();
            untracked(() => this.read());
        });
    }

    protected readonly colourInForce = colourInForce;

    protected value(blockKey: string): unknown {
        const edits = this.edits();
        return blockKey in edits ? edits[blockKey] : this.held()[blockKey];
    }

    protected options(row: Row, valueKey: string): ReadonlyArray<{ readonly value: string; readonly label: string }> {
        const locales = this.store.selectSnapshot(AppConfigState.manifest)?.supportedLocales ?? [];
        // A default is for people who chose nothing, and there is no device to follow on an installation's behalf.
        const options = optionsFor(row.key, locales, this.held()[valueKey]);
        return 'timezone' === row.key.type ? options.filter(o => 'automatic' !== o.value) : options;
    }

    protected setText(blockKey: string, event: Event): void {
        this.edit(blockKey, (event.target as HTMLInputElement | HTMLSelectElement).value);
    }

    protected setChecked(blockKey: string, event: Event): void {
        this.edit(blockKey, (event.target as HTMLInputElement).checked);
    }

    protected save(): void {
        this.saving.set(true);
        this.error.set(null);
        this.blocks.save(this.settingKey(), { ...this.held(), ...this.edits() })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: block => {
                    this.adopt(block);
                    this.saving.set(false);
                },
                error: (err: unknown) => {
                    this.saving.set(false);
                    const detail = err instanceof HttpErrorResponse
                        ? (err.error as { detail?: unknown } | null)?.detail
                        : null;
                    this.error.set('string' === typeof detail ? detail : 'These settings could not be saved.');
                },
            });
    }

    private read(): void {
        forkJoin([this.declared.read(), this.blocks.get(this.settingKey())])
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: ([sections, block]) => {
                    this.sections.set(sections);
                    this.adopt(block);
                    this.loading.set(false);
                },
                error: (err: unknown) => {
                    this.loading.set(false);
                    this.error.set(this.errors.humanize(err));
                },
            });
    }

    private adopt(block: ModuleSettingsBlockDto): void {
        this.held.set(block.effective);
        this.edits.set({});
    }

    private edit(blockKey: string, value: unknown): void {
        this.edits.update(edits => {
            const { [blockKey]: _dropped, ...rest } = edits;
            return value === this.held()[blockKey] ? rest : { ...rest, [blockKey]: value };
        });
    }
}
