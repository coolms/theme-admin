import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';

import { DocumentPageStateService } from '../explorer/document-page-state.service';
import { type ContextSchemaConditional, type DocumentTemplate } from '../shared/document-explorer.types';

/**
 * F.14c-1 — Word-specific detail panel. Surfaces the template's
 * metadata + the F.13a extracted DTMPL schema. The cross-format
 * `DocumentDetailComponent` dispatches to this component via
 * `ComponentRegistry` keyed by `'document-detail-word'`; future
 * formats register their own under
 * `'document-detail-{format}'` and the explorer never has to
 * change.
 *
 * F.14c-2 will add the variable-input form + generate flow; F.14c-3
 * will add the edit form for `name` / `instanceNameSuffix` / suffix
 * preview. F.14c-1 keeps the panel read-only with a Generate button
 * that emits an alert (real flow in the next sub-phase).
 *
 * Receives the template via the `@Input` projected through
 * `NgComponentOutlet`'s `inputs` map — the dispatcher passes the
 * currently-selected template; this component never reads the
 * page-state service directly so it's reusable from any context
 * (e.g. a future "show this template inline somewhere" surface).
 */
@Component({
    selector: 'cms-word-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    template: `
        @if (templateValue(); as t) {
            <div class="cms-document-detail">
                <header class="cms-document-detail__header">
                    <h2>{{ t.name }}</h2>
                    <p class="cms-document-detail__slug"><code>{{ t.slug }}</code></p>
                </header>

                    <section class="cms-document-detail__meta">
                        <dl>
                            <dt>Source</dt>
                            <dd>{{ t.native ? 'Native (Tiptap)' : 'DOCX upload' }}</dd>
                            <dt>Format</dt>
                            <dd>{{ t.format | uppercase }}</dd>
                            <dt>Default output</dt>
                            <dd>{{ t.defaultOutputFormat | uppercase }}</dd>
                            @if (t.createdAt) {
                                <dt>Created</dt>
                                <dd>{{ t.createdAt | date:'medium' }}</dd>
                            }
                            @if (t.updatedAt) {
                                <dt>Updated</dt>
                                <dd>{{ t.updatedAt | date:'medium' }}</dd>
                            }
                        </dl>
                    </section>

                    <section class="cms-document-detail__naming">
                        <h3>Instance naming</h3>
                        <p class="cms-document-detail__naming-preview">
                            Display: <strong>{{ t.name }}{{ t.instanceNameSuffix ?? '' }}</strong>
                        </p>
                        @if (!t.instanceNameSuffix) {
                            <p class="cms-document-detail__naming-hint">
                                No suffix configured — generated instances inherit the template
                                name. Set a DTMPL suffix (e.g. <code>{{ '{var:counter|pad:4,\`0\`}' }}</code>)
                                to append a unique segment to each instance.
                            </p>
                        }
                    </section>

                    @if (schema()) {
                        <section class="cms-document-detail__schema">
                            @if (variables().length > 0) {
                                <h3>Variables ({{ variables().length }})</h3>
                                <ul class="cms-document-detail__list">
                                    @for (v of variables(); track v.path) {
                                        <li>
                                            <code>&#123;var:{{ v.path }}&#125;</code>
                                            @if (v.filters.length > 0) {
                                                <span class="cms-document-detail__filters">| {{ v.filters.join(' | ') }}</span>
                                            }
                                            @if (v.loopAlias) {
                                                <span class="cms-document-detail__loop">in {{ v.loopAlias }}</span>
                                            }
                                        </li>
                                    }
                                </ul>
                            }

                            @if (constants().length > 0) {
                                <h3>Constants ({{ constants().length }})</h3>
                                <ul class="cms-document-detail__list">
                                    @for (c of constants(); track c.name) {
                                        <li><code>&#123;const:{{ c.name }}&#125;</code></li>
                                    }
                                </ul>
                            }

                            @if (loops().length > 0) {
                                <h3>Loops</h3>
                                <ul class="cms-document-detail__list">
                                    @for (l of loops(); track l.alias) {
                                        <li><code>&#123;loop:{{ l.path }}:{{ l.alias }}&#125;</code></li>
                                    }
                                </ul>
                            }

                            @if (conditionals().length > 0) {
                                <h3>Conditionals</h3>
                                <ul class="cms-document-detail__list">
                                    @for (c of conditionals(); track $index) {
                                        <li><code>{{ formatConditional(c) }}</code></li>
                                    }
                                </ul>
                            }
                        </section>
                    } @else {
                        <p class="cms-document-detail__no-schema">
                            No DTMPL schema extracted yet — re-upload the source to populate it.
                        </p>
                    }

                <section class="cms-document-detail__actions">
                    <button
                        type="button"
                        class="cms-btn cms-btn-primary"
                        (click)="generate()"
                    >Generate</button>
                </section>
            </div>
        } @else {
            <div class="cms-document-detail__empty">
                <p>Select a Word template to see its details.</p>
            </div>
        }
    `,
    styles: [`
        :host {
            display: block;
            height: 100%;
            overflow: auto;
            padding: var(--cms-panel-padding);
        }
        .cms-document-detail__header h2 {
            margin: 0 0 4px 0;
            font-size: 1.1rem;
        }
        .cms-document-detail__slug code {
            background: var(--cms-border-light);
            padding: 1px 4px;
            border-radius: var(--cms-radius-sm);
            font-size: 0.85rem;
        }
        .cms-document-detail__meta dl {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: 4px 12px;
            margin: 0 0 var(--cms-content-padding) 0;
        }
        .cms-document-detail__meta dt {
            color: var(--cms-text-muted);
            font-size: 0.85rem;
        }
        .cms-document-detail__meta dd {
            margin: 0;
        }
        .cms-document-detail__naming,
        .cms-document-detail__schema {
            border-top: 1px solid var(--cms-border-light);
            padding-top: var(--cms-panel-padding);
            margin-top: var(--cms-panel-padding);
        }
        .cms-document-detail__naming h3,
        .cms-document-detail__schema h3 {
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--cms-text-muted);
            margin: 0 0 4px 0;
        }
        .cms-document-detail__naming-preview {
            margin: 0 0 4px 0;
        }
        .cms-document-detail__naming-hint {
            color: var(--cms-text-muted);
            font-size: 0.8rem;
            margin: 0;
        }
        .cms-document-detail__naming-hint code {
            background: var(--cms-border-light);
            padding: 1px 4px;
            border-radius: var(--cms-radius-sm);
        }
        .cms-document-detail__list {
            margin: 0;
            padding-left: 0;
            list-style: none;
        }
        .cms-document-detail__list li {
            padding: 3px 0;
            font-size: 0.85rem;
        }
        .cms-document-detail__list code {
            background: var(--cms-border-light);
            padding: 1px 4px;
            border-radius: var(--cms-radius-sm);
        }
        .cms-document-detail__filters,
        .cms-document-detail__loop {
            margin-left: 6px;
            color: var(--cms-text-muted);
            font-size: 0.8rem;
        }
        .cms-document-detail__no-schema {
            color: var(--cms-text-muted);
            font-style: italic;
        }
        .cms-document-detail__actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: var(--cms-content-padding);
            padding-top: var(--cms-panel-padding);
            border-top: 1px solid var(--cms-border-light);
        }
        .cms-document-detail__empty {
            padding: 2rem;
            text-align: center;
            color: var(--cms-text-muted);
        }
    `],
})
export class WordDetailComponent {
    /**
     * Backing signal for the `@Input` setter. Setter writes to the
     * signal so OnPush change-detection picks the new value up; the
     * template binds to `templateValue()` (not `template`) because
     * the public field name has to match the `@Input()` setter and
     * Angular forbids double-declaration of a member.
     */
    private readonly templateSignal = signal<DocumentTemplate | null>(null);
    private readonly state = inject(DocumentPageStateService);

    @Input()
    set template(value: DocumentTemplate | null) {
        this.templateSignal.set(value);
    }

    protected readonly templateValue = this.templateSignal.asReadonly();
    protected readonly schema = computed(() => this.templateValue()?.contextSchema ?? null);
    protected readonly variables = computed(() => this.schema()?.variables ?? []);
    protected readonly constants = computed(() => this.schema()?.constants ?? []);
    protected readonly loops = computed(() => this.schema()?.loops ?? []);
    protected readonly conditionals = computed(() => this.schema()?.conditionals ?? []);

    protected generate(): void {
        const t = this.templateValue();
        if (t) {
            this.state.selectTemplate(t.id);
            this.state.actionDispatched$.next('generate');
        }
    }

    protected formatConditional(c: ContextSchemaConditional): string {
        return `{${c.negate ? 'unless' : 'if'}:${c.path}}`;
    }
}
