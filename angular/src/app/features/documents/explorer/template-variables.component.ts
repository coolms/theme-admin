import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { DocumentPageStateService } from './document-page-state.service';
import { variableRows, withCallerFillable } from './template-variables.helpers';
import { type DocumentTemplate } from '../shared/document-explorer.types';
import { WordTemplateService } from '../word/word-template.service';

/**
 * A template's variables, each with the author's "Filled by the caller" switch.
 *
 * A template's text says what it reads, never who may fill it. Whoever asks for a document may supply a variable's
 * value only when the author has switched it on here; the server refuses every other value a caller sends. The switch
 * is off by default, and it is not offered for two kinds of variable:
 * - a record (an entity reference), which the server checks the caller may read;
 * - a variable the server fills, such as `metadata.generatedAt`.
 *
 * One row per path: the switch belongs to the input, however many times the text uses it. Each flip saves at once,
 * as the whole schema, and the panel shows the server's answer, including a refusal.
 *
 * Shared by every format: Word embeds it in its own detail panel, and a format without one gets it from the
 * cross-format panel, so a spreadsheet's or a presentation's author can mark variables too.
 */
@Component({
    selector: 'cms-template-variables',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (rows().length > 0) {
            <h3>Variables ({{ rows().length }})</h3>
            <p class="cms-template-variables__hint">
                Switch on what whoever asks for a document may fill in. Everything else stays empty
                or is filled by the server.
            </p>
            <ul class="cms-template-variables__list">
                @for (row of rows(); track row.path) {
                    <li class="cms-template-variables__row">
                        <span class="cms-template-variables__name">
                            <code>&#123;var:{{ row.path }}&#125;</code>
                            @if (row.filters.length > 0) {
                                <span class="cms-template-variables__filters">| {{ row.filters.join(' | ') }}</span>
                            }
                            @if (row.loopAlias) {
                                <span class="cms-template-variables__loop">in {{ row.loopAlias }}</span>
                            }
                        </span>
                        @if (row.lockedReason; as reason) {
                            <span class="cms-template-variables__locked">{{ reason }}</span>
                        } @else {
                            <label class="cms-template-variables__switch">
                                <input
                                    type="checkbox"
                                    role="switch"
                                    [checked]="row.callerFillable"
                                    [disabled]="saving()"
                                    [attr.data-path]="row.path"
                                    (change)="toggle(row.path, $any($event.target))"
                                />
                                Filled by the caller
                            </label>
                        }
                    </li>
                }
            </ul>
            @if (error(); as message) {
                <p class="cms-template-variables__error" role="alert">{{ message }}</p>
            }
        }
    `,
    styles: [`
        h3 {
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--cms-text-muted);
            margin: 0 0 4px 0;
        }
        .cms-template-variables__hint {
            color: var(--cms-text-muted);
            font-size: 0.8rem;
            margin: 0 0 6px 0;
        }
        .cms-template-variables__list {
            margin: 0;
            padding-left: 0;
            list-style: none;
        }
        .cms-template-variables__row {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            justify-content: space-between;
            gap: 4px 12px;
            padding: 3px 0;
            font-size: 0.85rem;
        }
        .cms-template-variables__row code {
            background: var(--cms-border-light);
            padding: 1px 4px;
            border-radius: var(--cms-radius-sm);
        }
        .cms-template-variables__filters,
        .cms-template-variables__loop,
        .cms-template-variables__locked {
            margin-left: 6px;
            color: var(--cms-text-muted);
            font-size: 0.8rem;
        }
        .cms-template-variables__switch {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 0.8rem;
            white-space: nowrap;
        }
        .cms-template-variables__error {
            color: var(--cms-danger-text);
            font-size: 0.8rem;
            margin: 6px 0 0 0;
        }
    `],
})
export class TemplateVariablesComponent {
    readonly template = input.required<DocumentTemplate>();

    private readonly templates = inject(WordTemplateService);
    private readonly state = inject(DocumentPageStateService);
    private readonly destroyRef = inject(DestroyRef);

    protected readonly rows = computed(() => variableRows(this.template().contextSchema));
    protected readonly saving = signal(false);
    protected readonly error = signal<string | null>(null);

    protected toggle(path: string, input: HTMLInputElement): void {
        const on = input.checked;
        const template = this.template();
        const schema = template.contextSchema;
        if (null === schema || this.saving()) {
            input.checked = !on;
            return;
        }
        this.saving.set(true);
        this.error.set(null);
        this.templates
            .update(template.id, { contextSchema: withCallerFillable(schema, path, on) })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (updated) => {
                    this.saving.set(false);
                    this.state.templates.update((all) => all.map((t) => (t.id === updated.id ? updated : t)));
                },
                error: (err: HttpErrorResponse) => {
                    this.saving.set(false);
                    // The click already flipped the box; the stored mark did not change, and nothing re-renders the
                    // row, so the box is put back by hand.
                    input.checked = !on;
                    const detail: unknown = err.error?.detail ?? err.error?.['hydra:description'];
                    this.error.set(typeof detail === 'string' && '' !== detail
                        ? detail
                        : 'The switch could not be saved.');
                },
            });
    }
}
