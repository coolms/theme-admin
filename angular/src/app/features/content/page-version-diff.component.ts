import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FieldChangeDto, PageVersionDiffDto, RecordChangeDto, RecordListChangesDto, TextRunDto } from './page-versions';

/** One line of a language body's diff as shown: a line taken out, put in, or a run of unchanged ones folded. */
export interface BodyLine {
    readonly op: 'equal' | 'insert' | 'delete' | 'fold';
    readonly text: string;
}

/** Unchanged lines kept around a change; a longer unchanged run between changes is folded to one line. */
export const BODY_CONTEXT = 2;

/**
 * What changed in one version of a page since the one before it: the page's fields as old and new, its sections one
 * by one (added, removed, moved, changed, and in a changed one each field, a text word by word), each language's body
 * line by line and its meta, the frame and the property sets.
 *
 * A version from before sections carried ids is compared by position and type, and says so: a moved section can show
 * as one removed and another added.
 */
@Component({
    selector: 'app-page-version-diff',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @let changes = diff().changes;
        <div class="vd">
            @if (changes === null) {
                <p class="vd__msg" data-test="diff-unreadable">This version could not be read, so what changed in it is not shown.</p>
            } @else {
                @if (changes.created) {
                    <p class="vd__msg">The first version: everything below was there from the start.</p>
                }
                @if (changes.fields.length > 0) {
                    <section class="vd__part">
                        <h4 class="vd__title">Page</h4>
                        @for (field of changes.fields; track field.name) {
                            <div class="vd__field" data-test="diff-field">
                                <span class="vd__name">{{ field.name }}</span>
                                <span class="vd__change">
                                    @if (field.words) {
                                        @for (run of field.words; track $index) {
                                            <span [class]="'vd__run vd__run--' + run.op">{{ run.text }}</span>
                                        }
                                    } @else {
                                        <del class="vd__old">{{ show(field.old) }}</del> → <ins class="vd__new">{{ show(field.new) }}</ins>
                                    }
                                </span>
                            </div>
                        }
                    </section>
                }
                @for (list of recordLists(); track list.key) {
                    <section class="vd__part" data-test="diff-sections">
                        <h4 class="vd__title">Sections</h4>
                        @if (list.changes.matchedBy === 'position') {
                            <p class="vd__note" data-test="diff-by-position">
                                This version is from before sections had ids, so they are compared by place and type:
                                a moved section can show as one removed and another added.
                            </p>
                        }
                        @for (record of shownRecords(list.changes); track $index) {
                            <div class="vd__record" [attr.data-status]="record.status" data-test="diff-section">
                                <div class="vd__record-head">
                                    <span [class]="'vd__chip vd__chip--' + record.status">{{ record.status }}</span>
                                    @if (record.moved) {
                                        <span class="vd__chip vd__chip--moved">moved from {{ (record.from ?? 0) + 1 }}</span>
                                    }
                                    <span class="vd__name">{{ typeLabel(record.type) }}</span>
                                    <span class="vd__where">section {{ placeOf(record) }}</span>
                                </div>
                                @for (field of record.fields; track field.name) {
                                    <div class="vd__field">
                                        <span class="vd__name">{{ field.name }}</span>
                                        <span class="vd__change">
                                            @switch (field.kind) {
                                                @case ('text') {
                                                    @for (run of field.words ?? []; track $index) {
                                                        <span [class]="'vd__run vd__run--' + run.op">{{ run.text }}</span>
                                                    }
                                                }
                                                @case ('items') {
                                                    {{ itemsSummary(field) }}
                                                }
                                                @default {
                                                    <del class="vd__old">{{ show(field.old) }}</del> → <ins class="vd__new">{{ show(field.new) }}</ins>
                                                }
                                            }
                                        </span>
                                    </div>
                                }
                            </div>
                        }
                        @if (unchangedCount(list.changes) > 0) {
                            <p class="vd__note">{{ unchangedCount(list.changes) }} other section(s) unchanged.</p>
                        }
                    </section>
                }
                @for (language of changes.languages; track language.locale) {
                    <section class="vd__part" data-test="diff-language">
                        <h4 class="vd__title">{{ language.locale }} · {{ language.status }}</h4>
                        @for (field of language.meta; track field.name) {
                            <div class="vd__field">
                                <span class="vd__name">{{ field.name }}</span>
                                <span class="vd__change">
                                    <del class="vd__old">{{ show(field.old) }}</del> → <ins class="vd__new">{{ show(field.new) }}</ins>
                                </span>
                            </div>
                        }
                        @if (language.body !== null) {
                            @let lines = bodyOf(language.locale);
                            @if (lines === null) {
                                <p class="vd__note">The body changed; it could not be read to show how.</p>
                            } @else {
                                <pre class="vd__body" data-test="diff-body">@for (line of lines; track $index) {<span [class]="'vd__line vd__line--' + line.op">{{ prefix(line.op) }}{{ line.text }}
</span>}</pre>
                            }
                        }
                    </section>
                }
                @if (changes.frame !== null) {
                    <section class="vd__part">
                        <h4 class="vd__title">Frame</h4>
                        <div class="vd__field">
                            <span class="vd__change">
                                <del class="vd__old">{{ show(changes.frame.old) }}</del> → <ins class="vd__new">{{ show(changes.frame.new) }}</ins>
                            </span>
                        </div>
                    </section>
                }
                @if (changes.properties.length > 0) {
                    <section class="vd__part">
                        <h4 class="vd__title">Page properties</h4>
                        @for (p of changes.properties; track p.scope + p.property) {
                            <div class="vd__field" data-test="diff-property">
                                <span class="vd__name">{{ p.scope === '*' ? p.property : p.property + ' (' + p.scope + ')' }}</span>
                                <span class="vd__change">{{ p.old === null ? 'set' : p.new === null ? 'removed' : 'changed' }}</span>
                            </div>
                        }
                    </section>
                }
                @for (name of changes.other; track name) {
                    <p class="vd__note">{{ name }} changed.</p>
                }
            }
        </div>
    `,
    styles: [`
        .vd { display: flex; flex-direction: column; gap: 8px; padding: 8px; font-size: .8125rem;
              border: 1px solid var(--cms-border); border-radius: var(--cms-radius-sm, 4px); background: var(--cms-surface); }
        .vd__msg, .vd__note { margin: 0; color: var(--cms-text-muted); }
        .vd__part { display: flex; flex-direction: column; gap: 4px; }
        .vd__title { margin: 0; font-size: .75rem; font-weight: 600; text-transform: uppercase; color: var(--cms-text-muted); }
        .vd__field { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
        .vd__name { font-weight: 600; }
        .vd__where { color: var(--cms-text-muted); }
        .vd__change { overflow-wrap: anywhere; }
        .vd__record { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; border-bottom: 1px solid var(--cms-border); }
        .vd__record-head { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
        .vd__chip { padding: 0 6px; border-radius: 999px; background: var(--cms-surface-alt); font-size: .75rem; }
        .vd__chip--added { background: var(--cms-success-subtle); }
        .vd__chip--removed { background: var(--cms-danger-subtle); }
        .vd__old, .vd__run--delete, .vd__line--delete { color: var(--cms-danger-text); text-decoration: line-through; }
        .vd__new, .vd__run--insert, .vd__line--insert { color: var(--cms-success-text); text-decoration: none; }
        .vd__line--delete { text-decoration: none; }
        .vd__line--fold { color: var(--cms-text-muted); }
        .vd__body { margin: 0; max-height: 320px; overflow: auto; font-family: var(--cms-font-mono, monospace);
                    font-size: .75rem; white-space: pre-wrap; }
    `],
})
export class PageVersionDiffComponent {
    readonly diff = input.required<PageVersionDiffDto>();

    /** The records lists of the version (a page's sections), by their key. */
    readonly recordLists = computed(() => {
        const records = this.diff().changes?.records ?? {};
        return Object.keys(records).map(key => ({ key, changes: records[key] }));
    });

    /** A list's sections that changed, in the page's order; the unchanged ones are counted, not listed. */
    shownRecords(changes: RecordListChangesDto): readonly RecordChangeDto[] {
        return changes.records.filter(r => r.status !== 'unchanged' || r.moved);
    }

    unchangedCount(changes: RecordListChangesDto): number {
        return changes.records.length - this.shownRecords(changes).length;
    }

    /** Where a section is (counted from 1): where it is now, or where it was for one removed. */
    placeOf(record: RecordChangeDto): number {
        return (record.to ?? record.from ?? 0) + 1;
    }

    /** A block type's id as words: "faq_list" -> "Faq list". */
    typeLabel(type: string | null): string {
        if (type === null || type === '') {
            return 'Section';
        }
        const words = type.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
        return words.charAt(0).toUpperCase() + words.slice(1);
    }

    itemsSummary(field: FieldChangeDto): string {
        const items = field.items ?? [];
        const count = (status: string): number => items.filter(i => i.status === status).length;
        const parts = [['added', count('added')], ['removed', count('removed')], ['changed', count('changed')]]
            .filter(([, n]) => (n as number) > 0)
            .map(([what, n]) => `${n} ${what}`);
        return parts.length === 0 ? 'changed' : parts.join(', ');
    }

    /** A value as one short line: text as it is, anything else as JSON, cut at 120 characters; nothing as "(none)". */
    show(value: unknown): string {
        if (value === null || value === undefined || value === '') {
            return '(none)';
        }
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        return text.length > 120 ? text.slice(0, 119) + '…' : text;
    }

    prefix(op: BodyLine['op']): string {
        return op === 'insert' ? '+ ' : op === 'delete' ? '- ' : op === 'fold' ? '' : '  ';
    }

    /** A language's body diff as lines, unchanged runs folded; null when the body could not be read. */
    bodyOf(locale: string): readonly BodyLine[] | null {
        const body = this.diff().bodies.find(b => b.locale === locale);
        return body?.lines ? bodyLines(body.lines) : null;
    }
}

/**
 * Runs as lines: each changed line kept; of an unchanged run, {@link BODY_CONTEXT} lines next to a change on either
 * side, and the rest folded to one line saying how many.
 */
export function bodyLines(runs: readonly TextRunDto[], context = BODY_CONTEXT): BodyLine[] {
    const lines: BodyLine[] = [];
    runs.forEach((run, i) => {
        const texts = run.text.split('\n');
        if (run.op !== 'equal') {
            texts.forEach(text => lines.push({ op: run.op, text }));
            return;
        }
        const head = i === 0 ? 0 : context;
        const tail = i === runs.length - 1 ? 0 : context;
        if (texts.length <= head + tail + 1) {
            texts.forEach(text => lines.push({ op: 'equal', text }));
            return;
        }
        texts.slice(0, head).forEach(text => lines.push({ op: 'equal', text }));
        lines.push({ op: 'fold', text: `… ${texts.length - head - tail} unchanged line(s)` });
        texts.slice(texts.length - tail).forEach(text => lines.push({ op: 'equal', text }));
    });
    return lines;
}
