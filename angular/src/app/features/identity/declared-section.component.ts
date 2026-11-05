import { HttpErrorResponse } from '@angular/common/http';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppConfigState, CmsLoaderComponent } from '@coolms/core-angular';
import { Store } from '@ngxs/store';

import { type DeclaredKey, type DeclaredSection, DeclaredSettingsService } from './declared-settings.service';

interface Option {
    readonly value: string;
    readonly label: string;
}

const AUTOMATIC = 'automatic';

/** Automatic, UTC, and the zones this browser knows, once each. */
const ZONES: ReadonlyArray<Option> = [
    { value: AUTOMATIC, label: 'Automatic, from this device' },
    ...[...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])].map(zone => ({ value: zone, label: zone })),
];

/** A choice that is a plain word reads as one; a format such as `yyyy-MM-dd` is shown as it is. */
function words(value: string): string {
    return /^[a-z]+$/.test(value) ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** One declared section as a form, drawn from its declaration: a setting's server rules are not repeated here. */
@Component({
    selector: 'app-declared-section',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent],
    styles: [`
        :host { display: block; }
        .section-title { margin: 0 0 12px; font-size: 14px; font-weight: 600; color: var(--cms-text); }
        .field { margin-bottom: 16px; max-width: 480px; }
        .field-label { display: block; margin-bottom: 4px; font-size: 13px; font-weight: 500; color: var(--cms-text); }
        .field-note { display: block; margin-top: 4px; font-size: 12px; color: var(--cms-text-muted); }
        .field-row { display: flex; align-items: center; gap: 8px; }
        .field-colour { width: 48px; height: 32px; padding: 2px; }
        .field-reset {
            padding: 0;
            border: 0;
            background: none;
            font-size: 12px;
            color: var(--cms-text-muted);
            text-decoration: underline;
            cursor: pointer;
        }
        .form-error { margin: 0 0 12px; font-size: 13px; color: var(--cms-danger); }
    `],
    template: `
        @if (showTitle()) {
            <h3 class="section-title">{{ section().label }}</h3>
        }
        @for (k of drawn(); track k.key) {
            <div class="field">
                @switch (k.type) {
                    @case ('boolean') {
                        <label class="field-row">
                            <span class="cms-toggle">
                                <input type="checkbox"
                                       [checked]="current(k) === true"
                                       [disabled]="fixed(k)"
                                       (change)="setChecked(k, $event)" />
                                <span class="cms-toggle__slider"></span>
                            </span>
                            <span class="field-label">{{ k.label }}</span>
                        </label>
                    }
                    @case ('integer') {
                        <label class="field-label" [attr.for]="id(k)">{{ k.label }}</label>
                        <input class="cms-input"
                               type="number"
                               [id]="id(k)"
                               [attr.min]="k.min"
                               [attr.max]="k.max"
                               [value]="current(k)"
                               [disabled]="fixed(k)"
                               (change)="setNumber(k, $event)" />
                    }
                    @case ('colour') {
                        <label class="field-label" [attr.for]="id(k)">{{ k.label }}</label>
                        <input class="cms-input field-colour"
                               type="color"
                               [id]="id(k)"
                               [value]="current(k) ?? colourInForce()"
                               [disabled]="fixed(k)"
                               (change)="setText(k, $event)" />
                    }
                    @case ('string') {
                        <label class="field-label" [attr.for]="id(k)">{{ k.label }}</label>
                        <input class="cms-input"
                               type="text"
                               [id]="id(k)"
                               [value]="current(k) ?? ''"
                               [disabled]="fixed(k)"
                               (change)="setText(k, $event)" />
                    }
                    @default {
                        <label class="field-label" [attr.for]="id(k)">{{ k.label }}</label>
                        <select class="cms-input"
                                [id]="id(k)"
                                [disabled]="fixed(k)"
                                (change)="setText(k, $event)">
                            @for (o of options(k); track o.value) {
                                <option [value]="o.value" [selected]="o.value === current(k)">{{ o.label }}</option>
                            }
                        </select>
                    }
                }
                @if (k.locked) {
                    <span class="field-note">Set by your administrator</span>
                } @else if (k.own !== null && !k.readOnly) {
                    <button type="button" class="field-reset" [disabled]="saving()" (click)="reset(k)">
                        Use the default
                    </button>
                }
            </div>
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
    `,
})
export class DeclaredSectionComponent {
    private readonly settings = inject(DeclaredSettingsService);
    private readonly store = inject(Store);
    private readonly destroyRef = inject(DestroyRef);

    readonly section = input.required<DeclaredSection>();
    readonly showTitle = input(false);
    /** Saved: the parent reads the sections again and applies them. */
    readonly saved = output<string>();
    /** Saved elsewhere since it was read: the parent reads the sections again, and nothing here was saved. */
    readonly stale = output<void>();

    private readonly edits = signal<Readonly<Record<string, unknown>>>({});
    protected readonly saving = signal(false);
    protected readonly error = signal<string | null>(null);
    /** What differs from the section as last read: an edit the server now holds is no longer one. */
    private readonly unsaved = computed<Readonly<Record<string, unknown>>>(() => {
        const edits = this.edits();
        return Object.fromEntries(this.section().keys
            .filter(k => k.key in edits && edits[k.key] !== k.value)
            .map(k => [k.key, edits[k.key]]));
    });
    protected readonly changed = computed(() => Object.keys(this.unsaved()).length > 0);
    /** A structure has no form here: it is set by the client that declared it. */
    protected readonly drawn = computed(() => this.section().keys.filter(k => 'structure' !== k.type));

    /** What a colour with no value of its own is drawn in: the page's, which a person sees as the default. */
    protected colourInForce(): string {
        return getComputedStyle(document.documentElement).getPropertyValue('--cms-accent').trim() || '#000000';
    }

    protected id(k: DeclaredKey): string {
        return `setting-${this.section().section}-${k.key}`;
    }

    protected current(k: DeclaredKey): unknown {
        const edits = this.edits();
        return k.key in edits ? edits[k.key] : k.value;
    }

    protected fixed(k: DeclaredKey): boolean {
        return k.locked || k.readOnly || this.saving();
    }

    protected options(k: DeclaredKey): ReadonlyArray<Option> {
        const held = typeof k.value === 'string' ? k.value : '';
        return this.withHeld(this.optionsOf(k), held);
    }

    protected setChecked(k: DeclaredKey, event: Event): void {
        this.edit(k, (event.target as HTMLInputElement).checked);
    }

    protected setNumber(k: DeclaredKey, event: Event): void {
        // An emptied field is no edit: as JSON its NaN would be a null, which removes the person's own value.
        const value = (event.target as HTMLInputElement).valueAsNumber;
        this.edit(k, Number.isNaN(value) ? k.value : value);
    }

    protected setText(k: DeclaredKey, event: Event): void {
        this.edit(k, (event.target as HTMLInputElement | HTMLSelectElement).value);
    }

    protected reset(k: DeclaredKey): void {
        this.send({ [k.key]: null });
    }

    protected save(): void {
        this.send(this.unsaved());
    }

    private optionsOf(k: DeclaredKey): ReadonlyArray<Option> {
        if ('language' === k.type) {
            const locales = this.store.selectSnapshot(AppConfigState.manifest)?.supportedLocales ?? [];
            return locales.map(l => ({ value: l.code, label: l.label }));
        }
        if ('timezone' === k.type) {
            return ZONES;
        }
        return (k.choices ?? []).map(choice => ({ value: choice, label: words(choice) }));
    }

    /** A value the server holds stays selectable even when the list no longer offers it. */
    private withHeld(options: ReadonlyArray<Option>, held: string): ReadonlyArray<Option> {
        return '' === held || options.some(o => o.value === held) ? options : [{ value: held, label: held }, ...options];
    }

    private edit(k: DeclaredKey, value: unknown): void {
        this.edits.update(edits => {
            const { [k.key]: _dropped, ...rest } = edits;
            return value === k.value ? rest : { ...rest, [k.key]: value };
        });
    }

    private send(changes: Readonly<Record<string, unknown>>): void {
        const section = this.section();
        this.saving.set(true);
        this.error.set(null);
        this.settings.save(section.section, changes, section.version)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.saving.set(false);
                    this.edits.update(edits => Object.fromEntries(
                        Object.entries(edits).filter(([key]) => !(key in changes)),
                    ));
                    this.saved.emit(section.section);
                },
                error: (err: unknown) => {
                    this.saving.set(false);
                    if (err instanceof HttpErrorResponse && 412 === err.status) {
                        this.error.set('These settings were changed somewhere else. The latest values are shown.');
                        this.edits.set({});
                        this.stale.emit();
                        return;
                    }
                    const detail = err instanceof HttpErrorResponse
                        ? (err.error as { detail?: unknown } | null)?.detail
                        : null;
                    this.error.set('string' === typeof detail ? detail : 'These settings could not be saved.');
                },
            });
    }
}
