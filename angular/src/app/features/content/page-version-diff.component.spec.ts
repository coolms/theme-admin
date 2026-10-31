import { TestBed } from '@angular/core/testing';
import { PageVersionDiffComponent, bodyLines } from './page-version-diff.component';
import { type PageVersionDiffDto } from './page-versions';

/**
 * One version's changes as shown: a version from before section ids says it was compared by place; a body's unchanged
 * lines are folded around the change; a version that could not be read says so rather than showing nothing changed.
 */
describe('PageVersionDiffComponent', () => {
    const version = { id: 'v2', seq: 2, recordedAt: '2026-10-31T14:00:00Z', author: null, message: null, changes: [] };

    function render(changes: PageVersionDiffDto['changes'], bodies: PageVersionDiffDto['bodies'] = []): HTMLElement {
        TestBed.configureTestingModule({ imports: [PageVersionDiffComponent] });
        const fixture = TestBed.createComponent(PageVersionDiffComponent);
        fixture.componentRef.setInput('diff', { path: '/p', version, previous: 1, changes, bodies });
        fixture.detectChanges();

        return fixture.nativeElement as HTMLElement;
    }

    const empty = { created: false, fields: [], records: {}, languages: [], frame: null, properties: [], other: [] };

    it('says a version from before section ids was compared by place and type', () => {
        const el = render({ ...empty, records: { blocks: {
            matchedBy: 'position', counts: { added: 1, removed: 1, moved: 0, changed: 0 },
            records: [
                { status: 'added', moved: false, id: 'x', type: 'faq', from: null, to: 0, fields: [] },
                { status: 'removed', moved: false, id: null, type: 'text', from: 0, to: null, fields: [] },
            ],
        } } });

        expect(el.querySelector('[data-test="diff-by-position"]')).not.toBeNull();
        expect(Array.from(el.querySelectorAll('[data-test="diff-section"]')).map(s => s.getAttribute('data-status')))
            .toEqual(['added', 'removed']);
    });

    it('lists the sections that changed and counts the ones that did not', () => {
        const el = render({ ...empty, records: { blocks: {
            matchedBy: 'id', counts: { added: 0, removed: 0, moved: 1, changed: 0 },
            records: [
                { status: 'unchanged', moved: false, id: 'a', type: 'hero', from: 1, to: 0, fields: [] },
                { status: 'unchanged', moved: true, id: 'b', type: 'text', from: 0, to: 1, fields: [] },
            ],
        } } });

        expect(el.querySelectorAll('[data-test="diff-section"]').length).toBe(1);
        expect(el.textContent).toContain('moved from 1');
        expect(el.textContent).toContain('1 other section(s) unchanged.');
    });

    it('says a version that could not be read was not compared', () => {
        expect(render(null).querySelector('[data-test="diff-unreadable"]')).not.toBeNull();
    });

    it('shows a language body line by line', () => {
        const el = render(
            { ...empty, languages: [{ locale: 'en', status: 'changed', body: { old: 'h1', new: 'h2' }, meta: [] }] },
            [{ locale: 'en', lines: [{ op: 'delete', text: 'old' }, { op: 'insert', text: 'new' }] }],
        );

        expect(el.querySelector('[data-test="diff-body"]')?.textContent).toContain('- old');
        expect(el.querySelector('[data-test="diff-body"]')?.textContent).toContain('+ new');
    });

    it('folds a long unchanged run between changes, keeping two lines of context each side', () => {
        const lines = bodyLines([
            { op: 'delete', text: 'a' },
            { op: 'equal', text: '1\n2\n3\n4\n5\n6\n7' },
            { op: 'insert', text: 'b' },
        ]);

        expect(lines.map(l => l.op + ':' + l.text)).toEqual([
            'delete:a', 'equal:1', 'equal:2', 'fold:… 3 unchanged line(s)', 'equal:6', 'equal:7', 'insert:b',
        ]);
    });

    it('folds what comes before the first change, keeping only the two lines next to it', () => {
        const lines = bodyLines([{ op: 'equal', text: '1\n2\n3\n4' }, { op: 'insert', text: 'x' }]);

        expect(lines.map(l => l.op + ':' + l.text))
            .toEqual(['fold:… 2 unchanged line(s)', 'equal:3', 'equal:4', 'insert:x']);
    });
});
