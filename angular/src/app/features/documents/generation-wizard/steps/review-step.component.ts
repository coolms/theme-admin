import {
    ChangeDetectionStrategy, Component, computed, input,
} from '@angular/core';

import { type DocumentTemplate } from '../../shared/document-explorer.types';
import type { WizardMode } from './mode-step.component';

/**
 * X-2.6b step 5 -- summary card.
 *
 * Pure presentation. The Generate button lives in the wizard
 * primitive's footer; this step only renders the read-only summary
 * of every choice made earlier.
 */
@Component({
    selector: 'cms-wizard-review-step',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <dl class="cms-review-step">
            <dt>Template</dt>
            <dd>{{ template()?.name ?? '—' }}</dd>

            <dt>Output format</dt>
            <dd>{{ outputFormat() }}</dd>

            <dt>Mode</dt>
            <dd>{{ modeLabel() }}</dd>

            @if (mode() === 'filter') {
                <dt>Recipients</dt>
                <dd>
                    <div>{{ recipientsSummary() }}</div>
                    <div class="cms-review-step__sub">{{ recipientsCountLabel() }}</div>
                </dd>
            }

            @if (audienceEntries().length > 0) {
                <dt>Entity references</dt>
                <dd>
                    @for (entry of audienceEntries(); track entry.alias) {
                        <div>{{ entry.alias }} = {{ entry.uuid }}</div>
                    }
                </dd>
            }

            @if (plainVariableEntries().length > 0) {
                <dt>Variables</dt>
                <dd>
                    @for (entry of plainVariableEntries(); track entry.path) {
                        <div>{{ entry.path }} = {{ entry.display }}</div>
                    }
                </dd>
            }

            <dt>Output folder</dt>
            <dd>{{ outputBasePath() || '—' }}</dd>

            <dt>Filename</dt>
            <dd>{{ filenamePattern() || '—' }}</dd>
        </dl>
    `,
    styles: [`
        :host { display: block; }

        .cms-review-step {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: .5rem 1.25rem;
            margin: 0;
        }
        .cms-review-step dt {
            color: var(--cms-text-secondary);
            font-weight: 600;
            font-size: .85rem;
        }
        .cms-review-step dd {
            margin: 0;
            color: var(--cms-text);
            font-size: .9rem;
            word-break: break-word;
        }
        .cms-review-step__sub {
            color: var(--cms-text-secondary);
            font-size: .8rem;
            margin-top: .15rem;
        }
    `],
})
export class CmsWizardReviewStepComponent {
    readonly template = input<DocumentTemplate | null>(null);
    readonly mode = input<WizardMode>('single');
    readonly outputFormat = input<string>('docx');
    readonly recipientsRql = input<string>('');
    readonly recipientsCount = input<number | null>(null);
    readonly audience = input<Record<string, string>>({});
    readonly plainVariables = input<Record<string, unknown>>({});
    readonly outputBasePath = input<string>('');
    readonly filenamePattern = input<string>('');

    protected readonly modeLabel = computed<string>(() => {
        const m = this.mode();
        if (m === 'filter') {
            const c = this.recipientsCount();
            if (c === null) {
                return 'Filter entities';
            }
            return c === 1 ? 'Filter entities (1 document)' : 'Filter entities (' + c + ' documents)';
        }

        return 'Single recipient';
    });

    /**
     * The stored RQL is a query string (`filter[]=isActive%20eq%20true&…`),
     * which is what the backend wants but not what an operator should have to
     * read on a confirmation screen. Show the criteria themselves, decoded
     * and comma-joined.
     */
    protected readonly recipientsSummary = computed<string>(() => {
        const raw = this.recipientsRql();
        if ('' === raw) {
            return 'All users';
        }

        return raw
            .split('&')
            .map(part => decodeURIComponent(part.replace(/^filter(\[\])?=/, '')))
            .join(', ');
    });

    protected readonly recipientsCountLabel = computed<string>(() => {
        const c = this.recipientsCount();
        if (c === null) {
            return 'Count unknown';
        }
        if (c === 0) {
            return 'No users match';
        }

        return c === 1 ? '1 user matches' : c + ' users match';
    });

    protected readonly audienceEntries = computed<readonly { alias: string; uuid: string }[]>(() => {
        const out: { alias: string; uuid: string }[] = [];
        for (const [alias, uuid] of Object.entries(this.audience())) {
            out.push({ alias, uuid });
        }

        return out;
    });

    protected readonly plainVariableEntries = computed<readonly { path: string; display: string }[]>(() => {
        const out: { path: string; display: string }[] = [];
        this.collect('', this.plainVariables(), out);

        return out;
    });

    /**
     * Flatten a nested plain-variable record into `path = value` rows
     * for the summary. Mirrors the dotted-path encoding the form uses
     * on the way in.
     */
    private collect(
        prefix: string,
        value: unknown,
        out: { path: string; display: string }[],
    ): void {
        if (value === null || value === undefined) {
            return;
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
            for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
                const path = prefix === '' ? key : prefix + '.' + key;
                this.collect(path, child, out);
            }
            return;
        }
        if (prefix === '') {
            return;
        }
        out.push({ path: prefix, display: String(value) });
    }
}
