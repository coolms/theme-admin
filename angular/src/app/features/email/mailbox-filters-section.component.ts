import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    effect,
    inject,
    input,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, filter, map, of, switchMap } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';
import { EmailService } from './email.service';
import {
    FILTER_ACTIONS,
    FILTER_FIELDS,
    type FilterAction,
    type FilterActionType,
    type FilterCondition,
    type FilterField,
    type FilterFolder,
    type FilterOperator,
    MAX_ACTIONS,
    MAX_CONDITIONS,
    MAX_FILTERS,
    type MailboxFilter,
    type MailboxFilterWrite,
    OPERATOR_LABELS,
    moved,
    newCondition,
    newFilter,
    operatorsFor,
    summarizeFilter,
    toPayload,
    toWrite,
    validateFilter,
    violationsByPath,
} from './mailbox-filters';

/** The filter being edited: `id` null for a new one. */
interface Editing {
    readonly id: string | null;
    readonly draft: MailboxFilterWrite;
    /** The draft as opened, to tell a changed one from an untouched one. */
    readonly opened: string;
}

/**
 * The Filters pane of a mailbox's settings: the filters that sort its arriving mail, in the order they are checked.
 *
 * A filter runs on mail new to the mailbox's INBOX, after the mail server's own filters, and what it does is done on
 * the server too (a move is a move there). Turning one on or off, moving it up or down, and deleting it are each a
 * write of their own; a filter's conditions and actions are edited in place below the list and saved with the pane's
 * Save, which this section drives as a {@link PaneBody}: dirty while the open filter differs from how it opened.
 *
 * Only who may manage the mailbox (its owner, or an administrator) changes them; anyone else reads the list.
 */
@Component({
    selector: 'app-mailbox-filters-section',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DatePipe, FormsModule],
    template: `
        <p class="cms-field-hint">
            Filters sort mail as it arrives in the Inbox, after your mail server's own filters. What a filter does is
            done on the server too, so your phone and other mail apps show the same. Mail already here is left as it is.
        </p>

        @if (loading()) {
            <p class="flt__empty">Loading filters…</p>
        } @else if (loadError()) {
            <p class="flt__error">{{ loadError() }}</p>
        } @else {
            @if (filters().length === 0 && !editing()) {
                <p class="flt__empty">No filters yet.</p>
            } @else {
                <ol class="flt__list">
                    @for (f of filters(); track f.id; let first = $first; let last = $last) {
                        <li class="flt__row" [class.flt__row--off]="!f.enabled" [class.flt__row--open]="editing()?.id === f.id">
                            <label class="flt__toggle" [title]="f.enabled ? 'On' : 'Off'">
                                <input type="checkbox" [checked]="f.enabled" [disabled]="!canManage() || busy()"
                                       [attr.aria-label]="(f.enabled ? 'Turn off ' : 'Turn on ') + f.name"
                                       (change)="setEnabled(f, $any($event.target).checked)" />
                            </label>
                            <div class="flt__main">
                                <div class="flt__name">{{ f.name }}</div>
                                <div class="flt__summary">{{ summary(f) }}</div>
                                <div class="flt__meta">
                                    @if (f.matchCount > 0) {
                                        Matched {{ f.matchCount }} {{ f.matchCount === 1 ? 'time' : 'times' }}@if (f.lastMatchedAt) {, last {{ f.lastMatchedAt | date: 'medium' }}}
                                    } @else {
                                        Not matched yet
                                    }
                                </div>
                                @if (f.lastError) {
                                    <div class="flt__warn"><i class="bi bi-exclamation-triangle"></i> {{ f.lastError }}</div>
                                }
                            </div>
                            @if (canManage()) {
                                <div class="flt__actions">
                                    <button type="button" class="cms-btn cms-btn-sm" [disabled]="first || busy() || !!editing()"
                                            title="Check earlier" aria-label="Move up" (click)="move(f, -1)">
                                        <i class="bi bi-arrow-up"></i>
                                    </button>
                                    <button type="button" class="cms-btn cms-btn-sm" [disabled]="last || busy() || !!editing()"
                                            title="Check later" aria-label="Move down" (click)="move(f, 1)">
                                        <i class="bi bi-arrow-down"></i>
                                    </button>
                                    <button type="button" class="cms-btn cms-btn-sm" [disabled]="busy() || !!editing()" (click)="edit(f)">
                                        Edit
                                    </button>
                                    <button type="button" class="cms-btn cms-btn-sm cms-btn-danger" [disabled]="busy() || !!editing()"
                                            (click)="remove(f)">
                                        Delete
                                    </button>
                                </div>
                            }
                        </li>
                    }
                </ol>
            }

            @if (editing(); as e) {
                <section class="flt__editor" aria-label="Filter">
                    <h3 class="flt__editor-title">{{ e.id === null ? 'New filter' : 'Edit filter' }}</h3>

                    <label class="cms-label" for="flt-name">Name</label>
                    <input id="flt-name" class="cms-input" name="name" maxlength="120" [ngModel]="e.draft.name"
                           (ngModelChange)="patch({ name: $event })" />
                    @if (err('name'); as m) { <p class="flt__field-error">{{ m }}</p> }

                    <fieldset class="flt__group">
                        <legend class="cms-label">When a message arrives and</legend>
                        <label class="flt__inline">
                            <input type="radio" name="match" value="all" [checked]="e.draft.match === 'all'"
                                   (change)="patch({ match: 'all' })" /> every condition holds
                        </label>
                        <label class="flt__inline">
                            <input type="radio" name="match" value="any" [checked]="e.draft.match === 'any'"
                                   (change)="patch({ match: 'any' })" /> any condition holds
                        </label>

                        @for (c of e.draft.conditions; track $index; let i = $index) {
                            <div class="flt__line">
                                <select class="cms-input flt__field" [attr.aria-label]="'Condition ' + (i + 1) + ' field'"
                                        [ngModel]="c.field" (ngModelChange)="setField(i, $event)">
                                    @for (f of fields; track f.field) { <option [value]="f.field">{{ f.label }}</option> }
                                </select>
                                @if (c.field === 'header') {
                                    <input class="cms-input flt__header" placeholder="Header name, e.g. List-Id"
                                           [attr.aria-label]="'Condition ' + (i + 1) + ' header'"
                                           [ngModel]="c.name ?? ''" (ngModelChange)="setCondition(i, { name: $event })" />
                                }
                                <select class="cms-input flt__op" [attr.aria-label]="'Condition ' + (i + 1) + ' operator'"
                                        [ngModel]="c.operator" (ngModelChange)="setCondition(i, { operator: $event })">
                                    @for (op of operators(c.field); track op) { <option [value]="op">{{ opLabel(op) }}</option> }
                                </select>
                                @if (c.operator !== 'exists') {
                                    @if (c.field === 'hasAttachment') {
                                        <select class="cms-input flt__value" [attr.aria-label]="'Condition ' + (i + 1) + ' value'"
                                                [ngModel]="c.value === false ? 'false' : 'true'"
                                                (ngModelChange)="setCondition(i, { value: $event === 'true' })">
                                            <option value="true">yes</option>
                                            <option value="false">no</option>
                                        </select>
                                    } @else if (c.field === 'size') {
                                        <span class="flt__size">
                                            <input class="cms-input flt__value" type="number" min="0" step="1"
                                                   [attr.aria-label]="'Condition ' + (i + 1) + ' size in KB'"
                                                   [ngModel]="kb(c.value)" (ngModelChange)="setCondition(i, { value: bytes($event) })" />
                                            KB
                                        </span>
                                    } @else {
                                        <input class="cms-input flt__value" [attr.aria-label]="'Condition ' + (i + 1) + ' value'"
                                               [ngModel]="c.value ?? ''" (ngModelChange)="setCondition(i, { value: $event })" />
                                    }
                                }
                                <button type="button" class="cms-btn cms-btn-sm" [disabled]="e.draft.conditions.length === 1"
                                        [attr.aria-label]="'Remove condition ' + (i + 1)" (click)="removeCondition(i)">
                                    <i class="bi bi-x-lg"></i>
                                </button>
                            </div>
                            @for (k of ['field', 'name', 'operator', 'value']; track k) {
                                @if (err('conditions[' + i + '].' + k); as m) { <p class="flt__field-error">{{ m }}</p> }
                            }
                        }
                        @if (err('conditions'); as m) { <p class="flt__field-error">{{ m }}</p> }
                        <button type="button" class="cms-btn cms-btn-sm" [disabled]="e.draft.conditions.length >= maxConditions"
                                (click)="addCondition()">
                            <i class="bi bi-plus-lg"></i> Add a condition
                        </button>
                    </fieldset>

                    <fieldset class="flt__group">
                        <legend class="cms-label">Then</legend>
                        @for (a of e.draft.actions; track $index; let i = $index) {
                            <div class="flt__line">
                                <select class="cms-input flt__field" [attr.aria-label]="'Action ' + (i + 1)"
                                        [ngModel]="a.type" (ngModelChange)="setAction(i, { type: $event })">
                                    @for (t of actionTypes; track t.type) { <option [value]="t.type">{{ t.label }}</option> }
                                </select>
                                @if (a.type === 'move') {
                                    @if (folderOptions().length > 0) {
                                        <select class="cms-input flt__value" [attr.aria-label]="'Action ' + (i + 1) + ' folder'"
                                                [ngModel]="a.folder ?? ''" (ngModelChange)="setAction(i, { folder: $event })">
                                            <option value="">Choose a folder…</option>
                                            @for (f of folderOptions(); track f) { <option [value]="f">{{ f }}</option> }
                                            @if (a.folder && !folderOptions().includes(a.folder)) {
                                                <option [value]="a.folder">{{ a.folder }} (not on the server now)</option>
                                            }
                                        </select>
                                    } @else {
                                        <input class="cms-input flt__value" placeholder="Folder, as the server names it"
                                               [attr.aria-label]="'Action ' + (i + 1) + ' folder'"
                                               [ngModel]="a.folder ?? ''" (ngModelChange)="setAction(i, { folder: $event })" />
                                    }
                                }
                                <button type="button" class="cms-btn cms-btn-sm" [disabled]="e.draft.actions.length === 1"
                                        [attr.aria-label]="'Remove action ' + (i + 1)" (click)="removeAction(i)">
                                    <i class="bi bi-x-lg"></i>
                                </button>
                            </div>
                            @for (k of ['type', 'folder', 'label']; track k) {
                                @if (err('actions[' + i + '].' + k); as m) { <p class="flt__field-error">{{ m }}</p> }
                            }
                        }
                        @if (err('actions'); as m) { <p class="flt__field-error">{{ m }}</p> }
                        @if (foldersNote() && movesMail()) { <p class="cms-field-hint">{{ foldersNote() }}</p> }
                        <button type="button" class="cms-btn cms-btn-sm" [disabled]="e.draft.actions.length >= maxActions"
                                (click)="addAction()">
                            <i class="bi bi-plus-lg"></i> Add an action
                        </button>
                    </fieldset>

                    <label class="flt__inline">
                        <input type="checkbox" [checked]="e.draft.stopProcessing"
                               (change)="patch({ stopProcessing: $any($event.target).checked })" />
                        When this filter matches a message, don't check later filters for it
                    </label>
                    <label class="flt__inline">
                        <input type="checkbox" [checked]="e.draft.enabled"
                               (change)="patch({ enabled: $any($event.target).checked })" />
                        On
                    </label>
                    @if (err(''); as m) { <p class="flt__field-error">{{ m }}</p> }
                </section>
            } @else if (canManage()) {
                <button type="button" class="cms-btn cms-btn-sm" [disabled]="busy() || filters().length >= maxFilters"
                        (click)="add()">
                    <i class="bi bi-plus-lg"></i> Add a filter
                </button>
                @if (filters().length >= maxFilters) {
                    <p class="cms-field-hint">A mailbox holds at most {{ maxFilters }} filters.</p>
                }
            }
        }
    `,
    styles: [`
        :host { display: block; }
        .flt__empty { color: var(--cms-text-muted); }
        .flt__error, .flt__field-error { color: var(--cms-danger); }
        .flt__field-error { font-size: .8rem; margin: 2px 0 6px; }
        .flt__list { list-style: none; margin: 0 0 12px; padding: 0; border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md); }
        .flt__row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border-bottom: 1px solid var(--cms-border); }
        .flt__row:last-child { border-bottom: 0; }
        .flt__row--off .flt__main { opacity: .6; }
        .flt__row--open { background: var(--cms-selected-light); }
        .flt__toggle { padding-top: 2px; }
        .flt__main { flex: 1; min-width: 0; }
        .flt__name { font-weight: 600; }
        .flt__summary { font-size: .85rem; overflow-wrap: break-word; }
        .flt__meta { font-size: .75rem; color: var(--cms-text-muted); }
        .flt__warn { font-size: .8rem; color: var(--cms-warning-text); margin-top: 2px; }
        .flt__actions { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
        .flt__editor { border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md); padding: 12px; margin-top: 4px; }
        .flt__editor-title { font-size: 1rem; margin: 0 0 8px; }
        .flt__group { border: 0; padding: 0; margin: 12px 0 0; }
        .flt__inline { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
        .flt__line { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
        .flt__field { width: 11rem; }
        .flt__header { width: 10rem; }
        .flt__op { width: 10rem; }
        .flt__value { flex: 1; min-width: 10rem; }
        .flt__size { display: flex; align-items: center; gap: 4px; flex: 1; }
    `],
})
export class MailboxFiltersSectionComponent {
    /** The mailbox whose filters these are. */
    readonly mailboxId = input.required<string>();
    /** Whether the caller manages the mailbox (its owner, or an administrator): the server refuses anyone else. */
    readonly canManage = input<boolean>(false);

    private readonly email = inject(EmailService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly confirm = inject(ConfirmDialogService);
    private readonly toast = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);

    readonly fields = FILTER_FIELDS;
    readonly actionTypes = FILTER_ACTIONS;
    readonly maxConditions = MAX_CONDITIONS;
    readonly maxActions = MAX_ACTIONS;
    readonly maxFilters = MAX_FILTERS;

    readonly filters = signal<MailboxFilter[]>([]);
    readonly loading = signal(true);
    readonly loadError = signal<string | null>(null);
    readonly busy = signal(false);
    readonly editing = signal<Editing | null>(null);
    /** Messages keyed by the server's `propertyPath`: the client's checks, then a 422's violations. */
    readonly problems = signal<Record<string, string>>({});
    readonly folders = signal<FilterFolder[] | null>(null);
    readonly foldersNote = signal<string>('');
    private readonly saving_ = signal(false);

    readonly folderOptions = computed((): string[] =>
        (this.folders() ?? []).filter(f => f.selectable !== false).map(f => f.folder));

    constructor() {
        effect(() => {
            const id = this.mailboxId();
            untracked(() => this.load(id));
        });
    }

    // --- PaneBody: the pane's Save and Discard drive the open filter -------------------------------------------------

    dirty(): boolean {
        const e = this.editing();
        return e !== null && JSON.stringify(e.draft) !== e.opened;
    }

    saving(): boolean {
        return this.saving_();
    }

    /** The pane's Save and Discard show only while a filter is open, for a caller who may change it. */
    editable(): boolean {
        return this.canManage() && this.editing() !== null;
    }

    discard(): void {
        this.editing.set(null);
        this.problems.set({});
    }

    save(): void {
        const e = this.editing();
        if (e === null || !this.canManage()) return;
        this.saveTried = true;
        const problems = validateFilter(e.draft);
        this.problems.set(problems);
        if (Object.keys(problems).length > 0) return;
        const payload = toPayload(e.draft);
        this.saving_.set(true);
        const write = e.id === null
            ? this.email.createFilter(this.mailboxId(), payload)
            : this.email.updateFilter(this.mailboxId(), e.id, payload);
        write.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.saving_.set(false);
                this.editing.set(null);
                this.problems.set({});
                this.toast.success(e.id === null ? 'Filter added' : 'Filter saved');
                this.load(this.mailboxId());
            },
            error: (err: unknown) => {
                this.saving_.set(false);
                const violations = violationsByPath(err);
                if (Object.keys(violations).length > 0) {
                    this.problems.set(violations);
                } else {
                    this.toast.error(this.errors.humanize(err));
                }
            },
        });
    }

    // --- The list ------------------------------------------------------------------------------------------------------

    load(mailboxId: string): void {
        this.loading.set(true);
        this.loadError.set(null);
        this.email.listFilters(mailboxId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: rows => {
                this.filters.set([...rows].sort((a, b) => a.position - b.position));
                this.loading.set(false);
            },
            error: (err: unknown) => {
                this.loading.set(false);
                this.loadError.set(this.errors.humanize(err));
            },
        });
    }

    summary(f: MailboxFilter): string {
        return summarizeFilter(f);
    }

    setEnabled(f: MailboxFilter, enabled: boolean): void {
        if (!this.canManage()) return;
        this.busy.set(true);
        this.email.updateFilter(this.mailboxId(), f.id, { enabled }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: saved => {
                this.busy.set(false);
                this.filters.update(list => list.map(x => (x.id === saved.id ? saved : x)));
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
                this.load(this.mailboxId());
            },
        });
    }

    move(f: MailboxFilter, step: -1 | 1): void {
        const ids = moved(this.filters().map(x => x.id), f.id, step);
        if (ids === null || !this.canManage()) return;
        this.busy.set(true);
        this.email.reorderFilters(this.mailboxId(), ids).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: rows => {
                this.busy.set(false);
                this.filters.set(rows);
            },
            error: (err: unknown) => {
                this.busy.set(false);
                // 409: the list changed elsewhere; read it again rather than guess.
                this.toast.error(this.errors.humanize(err));
                this.load(this.mailboxId());
            },
        });
    }

    remove(f: MailboxFilter): void {
        if (!this.canManage()) return;
        this.confirm.open({
            title: 'Delete this filter?',
            message: `"${f.name}" stops sorting this mailbox's mail. Mail it already moved stays where it is.`,
            confirmLabel: 'Delete',
            danger: true,
        }).pipe(
            filter(Boolean),
            switchMap(() => {
                this.busy.set(true);
                return this.email.deleteFilter(this.mailboxId(), f.id);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.busy.set(false);
                this.toast.success('Filter deleted');
                this.load(this.mailboxId());
            },
            error: (err: unknown) => {
                this.busy.set(false);
                this.toast.error(this.errors.humanize(err));
            },
        });
    }

    // --- The editor ----------------------------------------------------------------------------------------------------

    add(): void {
        this.open(null, newFilter());
    }

    edit(f: MailboxFilter): void {
        this.open(f.id, toWrite(f));
    }

    private open(id: string | null, draft: MailboxFilterWrite): void {
        this.editing.set({ id, draft, opened: JSON.stringify(draft) });
        this.saveTried = false;
        this.problems.set({});
        if (this.folders() === null) this.loadFolders();
    }

    /**
     * The folders a Move may name: every folder on the server (`.../rules/folders`). Until that answers, the rail's
     * list, which names only folders holding imported mail; failing both, the folder is typed.
     */
    private loadFolders(): void {
        const id = this.mailboxId();
        this.email.listFilterFolders(id).pipe(
            map(rows => ({ rows, note: '' })),
            catchError(() => this.email.listFolders(id).pipe(
                map(rows => ({
                    rows: rows.map(r => ({ folder: r.folder }) as FilterFolder),
                    note: 'Only folders that already hold mail here are listed.',
                })),
                catchError(() => of({ rows: [] as FilterFolder[], note: 'The folders could not be read: type the folder as the server names it.' })),
            )),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(({ rows, note }) => {
            this.folders.set(rows);
            this.foldersNote.set(note);
        });
    }

    patch(change: Partial<MailboxFilterWrite>): void {
        this.editing.update(e => (e === null ? e : { ...e, draft: { ...e.draft, ...change } }));
        this.recheck();
    }

    /** Whether the open filter moves mail: only then is the folder list's note said. */
    movesMail(): boolean {
        return this.editing()?.draft.actions.some(a => a.type === 'move') ?? false;
    }

    /**
     * Once a save has shown problems, each edit checks the filter again, so a field put right stops being marked at
     * once instead of at the next Save. A server's violation gives way to the client's check here; the server checks
     * again on the next save.
     */
    private recheck(): void {
        const e = this.editing();
        if (e !== null && this.saveTried) this.problems.set(validateFilter(e.draft));
    }

    /** A Save was pressed on the open filter: from then on it is checked on every edit, until it is closed. */
    private saveTried = false;

    operators(field: FilterField): readonly FilterOperator[] {
        return operatorsFor(field);
    }

    opLabel(op: FilterOperator): string {
        return OPERATOR_LABELS[op];
    }

    setField(i: number, field: FilterField): void {
        this.updateConditions(list => list.map((c, j) => (j === i ? newCondition(field) : c)));
    }

    setCondition(i: number, change: Partial<FilterCondition>): void {
        this.updateConditions(list => list.map((c, j) => (j === i ? { ...c, ...change } : c)));
    }

    addCondition(): void {
        this.updateConditions(list => [...list, newCondition()]);
    }

    removeCondition(i: number): void {
        this.updateConditions(list => list.filter((_, j) => j !== i));
    }

    setAction(i: number, change: Partial<FilterAction>): void {
        this.updateActions(list => list.map((a, j) => {
            if (j !== i) return a;
            const next = { ...a, ...change };
            return change.type !== undefined && change.type !== 'move' ? { type: change.type as FilterActionType } : next;
        }));
    }

    addAction(): void {
        const used = new Set(this.editing()?.draft.actions.map(a => a.type) ?? []);
        const type = FILTER_ACTIONS.find(t => !used.has(t.type))?.type ?? 'flag';
        this.updateActions(list => [...list, { type }]);
    }

    removeAction(i: number): void {
        this.updateActions(list => list.filter((_, j) => j !== i));
    }

    /** A size in bytes shown in KB; an empty field stays empty. */
    kb(value: unknown): number | null {
        const n = Number(value);
        return value === '' || value === undefined || !Number.isFinite(n) ? null : Math.round(n / 1024);
    }

    bytes(kb: unknown): number | string {
        const n = Number(kb);
        return kb === '' || kb === null || !Number.isFinite(n) ? '' : Math.round(n * 1024);
    }

    err(path: string): string | null {
        return this.problems()[path] ?? null;
    }

    private updateConditions(f: (list: FilterCondition[]) => FilterCondition[]): void {
        this.editing.update(e => (e === null ? e : { ...e, draft: { ...e.draft, conditions: f(e.draft.conditions) } }));
        this.recheck();
    }

    private updateActions(f: (list: FilterAction[]) => FilterAction[]): void {
        this.editing.update(e => (e === null ? e : { ...e, draft: { ...e.draft, actions: f(e.draft.actions) } }));
        this.recheck();
    }
}
