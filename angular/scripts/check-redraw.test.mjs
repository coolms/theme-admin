// The redraw check on small components, one case and its control per class.
// Run: npm run test:scripts
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { analyzeSource } from './check-redraw.mjs';

const component = (strategy, template, body) => `
import { ChangeDetectionStrategy, Component, computed, signal, inject } from '@angular/core';
@Component({
    selector: 'x-case',
    ${strategy === null ? '' : `changeDetection: ChangeDetectionStrategy.${strategy},`}
    template: \`${template}\`,
})
export class CaseComponent {
${body}
}`;
const analyze = (src) => analyzeSource(ts, src, 'case.component.ts');

test('a shown plain field written in a subscription, nothing marking the view, is found', () => {
    const r = analyze(component('OnPush', '<p>{{ answer }}</p>', `
    answer = '';
    load(): void { this.api.get().subscribe(v => { this.answer = v; }); }`));
    assert.deepEqual(r.asyncWrites.map((w) => w.field), ['answer']);
});

test('naming no strategy is OnPush: the same write is found', () => {
    const r = analyze(component(null, '<p>{{ answer }}</p>', `
    answer = '';
    load(): void { this.api.get().subscribe({ next: v => { this.answer = v; } }); }`));
    assert.deepEqual(r.asyncWrites.map((w) => w.field), ['answer']);
});

test('after an await is asynchronous too', () => {
    const r = analyze(component('OnPush', '<p>{{ answer }}</p>', `
    answer = '';
    async load(): Promise<void> { const v = await this.api.get(); this.answer = v; }`));
    assert.deepEqual(r.asyncWrites.map((w) => w.field), ['answer']);
});

test('the control: marking the view, or setting a shown signal beside it, draws it', () => {
    const marked = analyze(component('OnPush', '<p>{{ answer }}</p>', `
    answer = '';
    load(): void { this.api.get().subscribe(v => { this.answer = v; this.cdr.markForCheck(); }); }`));
    const beside = analyze(component('OnPush', '<p>{{ answer }} {{ user() }}</p>', `
    answer = '';
    readonly user = signal(null);
    load(): void { this.api.get().subscribe(v => { this.user.set(v); this.answer = v.name; }); }`));
    assert.deepEqual(marked.asyncWrites, []);
    assert.deepEqual(beside.asyncWrites, []);
});

test('the control: an Eager component is checked on every tick', () => {
    const r = analyze(component('Eager', '<p>{{ answer }}</p>', `
    answer = '';
    load(): void { this.api.get().subscribe(v => { this.answer = v; }); }`));
    assert.deepEqual(r.asyncWrites, []);
});

test('the control: a field used only by an event handler is not shown', () => {
    const r = analyze(component('OnPush', '<button (click)="save(answer)">Save</button>', `
    answer = '';
    load(): void { this.api.get().subscribe(v => { this.answer = v; }); }`));
    assert.deepEqual(r.asyncWrites, []);
});

test('a computed over a two-way bound plain field is found, under any strategy', () => {
    for (const strategy of ['OnPush', 'Eager']) {
        const r = analyze(component(strategy, '<input [(ngModel)]="query" /> {{ filtered() }}', `
    readonly all = signal<string[]>([]);
    query = '';
    readonly filtered = computed(() => this.all().filter(x => x.includes(this.query)));`));
        assert.deepEqual(r.staleComputeds.map((c) => [c.member, c.fields]), [['filtered', ['query']]], strategy);
    }
});

test('a computed over a field an event handler writes is found', () => {
    const r = analyze(component('OnPush', '<x-pick (valueChange)="handler = $event" /> {{ hint() }}', `
    handler = '';
    readonly hint = computed(() => this.handler === '' ? '' : 'picked');`));
    assert.deepEqual(r.staleComputeds.map((c) => c.member), ['hint']);
});

test('the control: a computed over a signal, a constant or an injected service is not stale', () => {
    const r = analyze(component('OnPush', '<input [(ngModel)]="query" /> {{ filtered() }}', `
    private readonly svc = inject(Svc);
    readonly limit = 10;
    readonly query = signal('');
    readonly filtered = computed(() => this.svc.items().slice(0, this.limit).filter(x => x.includes(this.query())));
    pickFrom(): void { this.svc.set(1); }`));
    assert.deepEqual(r.staleComputeds, []);
});
