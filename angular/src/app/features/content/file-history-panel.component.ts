import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    DestroyRef,
    EventEmitter,
    Input,
    Output,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FileHistoryService } from './file-history.service';
import {
    FileBlame,
    FileRevisionDiff,
    FileRevisionView,
} from './file-history.types';
import { ConfirmDialogService, ToastService } from '@coolms/ui-angular';

type HistoryTab = 'revisions' | 'diff' | 'blame';

/**
 * File-history panel (ADR-132 W6.3) for the content/page editor: lists a VFS
 * file's revision timeline, previews a revision's body, diffs any two points
 * (or a revision vs. the live content), shows per-line blame, and restores a
 * past version forward (non-destructive, behind a confirm + write gate).
 *
 * Self-contained and path-addressed: bind `[path]` to the variant's VFS path
 * and listen to `(restored)` to reload the editor body. The restore gate
 * (`canWrite`) comes from the log response — the backend is the source of
 * truth — so the panel needs no permission input.
 */
@Component({
    selector: 'app-file-history-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, DatePipe],
    template: `
        <div class="fh">
            <div class="fh__tabs">
                <button type="button" class="fh__tab" [class.fh__tab--active]="tab() === 'revisions'"
                        (click)="tab.set('revisions')">
                    <i class="bi bi-clock-history"></i> Revisions
                </button>
                <!-- Diff / Blame are meaningless with nothing to compare — hide
                     them until the file has at least one recorded revision. -->
                @if (revisions().length > 0) {
                    <button type="button" class="fh__tab" [class.fh__tab--active]="tab() === 'diff'"
                            (click)="openDiff()">
                        <i class="bi bi-file-diff"></i> Diff
                    </button>
                    <button type="button" class="fh__tab" [class.fh__tab--active]="tab() === 'blame'"
                            (click)="openBlame()">
                        <i class="bi bi-people"></i> Blame
                    </button>
                }
                <button type="button" class="fh__refresh cms-btn cms-btn-sm" title="Refresh"
                        (click)="reload()">
                    <i class="bi bi-arrow-clockwise"></i>
                </button>
            </div>

            @if (loading()) {
                <div class="fh__msg">Loading…</div>
            } @else if (error()) {
                <div class="fh__msg fh__msg--error">{{ error() }}</div>
            } @else {
                @switch (tab()) {

                    <!-- ── Revisions timeline ──────────────────────────────── -->
                    @case ('revisions') {
                        @if (revisions().length === 0) {
                            <div class="fh__msg">No history yet — each save records a revision.</div>
                        } @else {
                            <ul class="fh__list">
                                @for (r of revisions(); track r.id) {
                                    <li class="fh__rev" [class.fh__rev--current]="r.isCurrent">
                                        <div class="fh__rev-main">
                                            <code class="fh__hash">{{ r.shortHash }}</code>
                                            @if (r.isCurrent) { <span class="cms-badge cms-badge--success">current</span> }
                                            <span class="fh__author">{{ r.authorName || 'system' }}</span>
                                            <span class="fh__date">{{ r.createdAt | date:'short' }}</span>
                                        </div>
                                        @if (r.message) { <div class="fh__rev-note">{{ r.message }}</div> }
                                        <div class="fh__rev-actions">
                                            <button type="button" class="cms-btn cms-btn-sm" (click)="toggleView(r)">
                                                {{ viewing() === r.id ? 'Hide' : 'View' }}
                                            </button>
                                            <button type="button" class="cms-btn cms-btn-sm" (click)="diffWithCurrent(r)">
                                                Diff vs current
                                            </button>
                                            @if (canWrite() && !r.isCurrent) {
                                                <button type="button" class="cms-btn cms-btn-sm cms-btn-primary"
                                                        [disabled]="restoring()"
                                                        (click)="restore(r)">
                                                    Restore
                                                </button>
                                            }
                                        </div>
                                        @if (viewing() === r.id) {
                                            <pre class="fh__content">{{ viewContent() }}</pre>
                                        }
                                    </li>
                                }
                            </ul>
                        }
                    }

                    <!-- ── Diff (any two, or vs current) ───────────────────── -->
                    @case ('diff') {
                        <div class="fh__diff-controls">
                            <label class="fh__field">
                                <span>From</span>
                                <select [ngModel]="diffFrom()" (ngModelChange)="diffFrom.set($event)">
                                    @for (r of revisions(); track r.id) {
                                        <option [value]="r.id">{{ r.shortHash }} · {{ r.createdAt | date:'short' }}</option>
                                    }
                                </select>
                            </label>
                            <label class="fh__field">
                                <span>To</span>
                                <select [ngModel]="diffTo()" (ngModelChange)="diffTo.set($event)">
                                    <option value="">Current</option>
                                    @for (r of revisions(); track r.id) {
                                        <option [value]="r.id">{{ r.shortHash }} · {{ r.createdAt | date:'short' }}</option>
                                    }
                                </select>
                            </label>
                            <button type="button" class="cms-btn cms-btn-sm cms-btn-primary"
                                    [disabled]="!diffFrom() || diffLoading()"
                                    (click)="runDiff()">
                                Compare
                            </button>
                        </div>

                        @if (diffLoading()) {
                            <div class="fh__msg">Comparing…</div>
                        } @else {
                            @if (diff(); as d) {
                                <div class="fh__diff-summary">
                                    <span class="fh__add">+{{ d.added }}</span>
                                    <span class="fh__del">−{{ d.removed }}</span>
                                    @if (d.added === 0 && d.removed === 0) { <span class="fh__same">identical</span> }
                                </div>
                                <div class="fh__diff">
                                    @for (l of d.lines; track $index) {
                                        <div class="fh__dline fh__dline--{{ l.op }}">
                                            <span class="fh__lno">{{ l.oldNumber ?? '' }}</span>
                                            <span class="fh__lno">{{ l.newNumber ?? '' }}</span>
                                            <span class="fh__sign">{{ sign(l.op) }}</span>
                                            <span class="fh__dtext">{{ l.content }}</span>
                                        </div>
                                    }
                                </div>
                            } @else {
                                <div class="fh__msg">Pick two points and press Compare.</div>
                            }
                        }
                    }

                    <!-- ── Blame ───────────────────────────────────────────── -->
                    @case ('blame') {
                        @if (blameLoading()) {
                            <div class="fh__msg">Computing blame…</div>
                        } @else {
                            @if (blame(); as b) {
                                @if (b.lines.length === 0) {
                                    <div class="fh__msg">No content to attribute.</div>
                                } @else {
                                    <div class="fh__blame">
                                        @for (l of b.lines; track $index) {
                                            <div class="fh__bline">
                                                <code class="fh__hash"
                                                      [title]="(l.authorName || 'system') + ' · ' + (l.createdAt | date:'medium')">{{ l.shortHash }}</code>
                                                <span class="fh__bauthor">{{ l.authorName || 'system' }}</span>
                                                <span class="fh__lno">{{ l.lineNumber }}</span>
                                                <span class="fh__dtext">{{ l.content }}</span>
                                            </div>
                                        }
                                    </div>
                                }
                            }
                        }
                    }
                }
            }
        </div>
    `,
    styles: [`
        .fh { display: flex; flex-direction: column; gap: 8px; font-size: .8125rem; }
        .fh__tabs { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--cms-border); padding-bottom: 6px; }
        .fh__tab {
            padding: 4px 10px; border-radius: var(--cms-radius-sm, 4px); border: 1px solid transparent;
            background: transparent; cursor: pointer; color: var(--cms-text-muted);
            display: flex; align-items: center; gap: 5px; font-size: .8125rem;
        }
        .fh__tab:hover { background: var(--cms-border-light); }
        .fh__tab--active { background: var(--cms-accent-light); color: var(--cms-accent-text); border-color: var(--cms-accent); }
        .fh__refresh { margin-left: auto; }

        .fh__msg { padding: 12px; color: var(--cms-text-muted); }
        .fh__msg--error { color: var(--cms-danger-text); }

        /* Revisions list */
        .fh__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; }
        .fh__rev { padding: 8px 10px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius); }
        .fh__rev--current { border-color: var(--cms-accent); }
        .fh__rev-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .fh__hash { font-family: 'Courier New', monospace; font-size: .75rem; color: var(--cms-accent-text); background: var(--cms-accent-light); padding: 1px 5px; border-radius: 3px; }
        .fh__author { font-weight: 600; }
        .fh__date { color: var(--cms-text-muted); margin-left: auto; }
        .fh__rev-note { margin-top: 4px; color: var(--cms-text-muted); font-style: italic; }
        .fh__rev-actions { display: flex; gap: 6px; margin-top: 6px; }
        .fh__content {
            margin: 8px 0 0; padding: 8px; background: var(--cms-code-bg, var(--cms-border-light));
            border-radius: var(--cms-radius-sm, 4px); max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word;
            font-family: 'Courier New', monospace; font-size: .75rem;
        }

        /* Diff */
        .fh__diff-controls { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
        .fh__field { display: flex; flex-direction: column; gap: 2px; }
        .fh__field > span { font-size: .7rem; color: var(--cms-text-muted); }
        .fh__field select { padding: 3px 6px; border-radius: var(--cms-radius-sm, 4px); border: 1px solid var(--cms-border); background: var(--cms-surface); font-size: .8125rem; }
        .fh__diff-summary { display: flex; gap: 10px; padding: 2px 0; }
        /* The diff pair moves together: --cms-success measured 3.30 in
           light, and leaving --del on the raw hue would mismatch its twin. */
        .fh__add { color: var(--cms-success-text); font-weight: 600; }
        .fh__del { color: var(--cms-danger-text); font-weight: 600; }
        .fh__same { color: var(--cms-text-muted); }
        .fh__diff {
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius);
            max-height: 320px; overflow: auto; font-family: 'Courier New', monospace; font-size: .75rem;
        }
        .fh__dline { display: flex; align-items: baseline; gap: 0; white-space: pre-wrap; word-break: break-word; }
        .fh__dline--insert { background: var(--cms-success-light, rgba(40, 167, 69, .12)); }
        .fh__dline--delete { background: var(--cms-danger-light, rgba(220, 53, 69, .10)); }
        .fh__lno { flex: 0 0 38px; text-align: right; padding: 0 6px; color: var(--cms-text-muted); user-select: none; }
        .fh__sign { flex: 0 0 14px; text-align: center; color: var(--cms-text-muted); user-select: none; }
        .fh__dtext { flex: 1; padding-right: 8px; }

        /* Blame */
        .fh__blame { border: 1px solid var(--cms-border); border-radius: var(--cms-radius); max-height: 340px; overflow: auto; font-family: 'Courier New', monospace; font-size: .75rem; }
        .fh__bline { display: flex; align-items: baseline; gap: 6px; white-space: pre-wrap; word-break: break-word; padding: 1px 0; }
        .fh__bauthor { flex: 0 0 120px; color: var(--cms-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    `],
})
export class FileHistoryPanelComponent {
    private readonly history    = inject(FileHistoryService);
    private readonly toast      = inject(ToastService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly cdr        = inject(ChangeDetectorRef);

    /** The variant's VFS path. Re-binds (e.g. locale switch) reload the log. */
    private readonly _path = signal('');
    @Input({ required: true }) set path(value: string) {
        if (value === this._path()) return;
        this._path.set(value);
        this.reload();
    }

    /** Emitted after a successful restore so the host can reload its editor body. */
    @Output() readonly restored = new EventEmitter<void>();

    readonly tab        = signal<HistoryTab>('revisions');
    readonly loading    = signal(false);
    readonly error      = signal('');
    readonly revisions  = signal<FileRevisionView[]>([]);
    readonly canWrite   = signal(false);
    readonly restoring  = signal(false);

    /** Id of the revision whose body is expanded inline, '' when none. */
    readonly viewing     = signal('');
    readonly viewContent = signal('');

    readonly diffFrom    = signal('');
    readonly diffTo      = signal(''); // '' == current
    readonly diff        = signal<FileRevisionDiff | null>(null);
    readonly diffLoading = signal(false);

    readonly blame        = signal<FileBlame | null>(null);
    readonly blameLoading = signal(false);

    // ── Log ─────────────────────────────────────────────────────────────────

    reload(): void {
        const path = this._path();
        if (!path) return;

        this.loading.set(true);
        this.error.set('');
        this.viewing.set('');
        this.history.log(path)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: log => {
                    this.applyLog(log.revisions, log.canWrite);
                    this.loading.set(false);
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.loading.set(false);
                    this.error.set('Could not load history.');
                    this.cdr.markForCheck();
                },
            });
    }

    private applyLog(revisions: FileRevisionView[], canWrite: boolean): void {
        this.revisions.set(revisions);
        this.canWrite.set(canWrite);
        // Seed diff defaults: previous version → current (the common "what
        // changed last" view). Falls back to the lone revision when there's one.
        if (!this.diffFrom()) {
            this.diffFrom.set(revisions[1]?.id ?? revisions[0]?.id ?? '');
        }
    }

    // ── Revision preview ─────────────────────────────────────────────────────

    toggleView(r: FileRevisionView): void {
        if (this.viewing() === r.id) {
            this.viewing.set('');
            return;
        }
        this.viewing.set(r.id);
        this.viewContent.set('');
        this.history.content(this._path(), r.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: res => { this.viewContent.set(res.content); this.cdr.markForCheck(); },
                error: () => { this.viewContent.set('— content unavailable —'); this.cdr.markForCheck(); },
            });
    }

    // ── Diff ─────────────────────────────────────────────────────────────────

    openDiff(): void {
        this.tab.set('diff');
        if (!this.diffFrom() && this.revisions().length > 0) {
            this.diffFrom.set(this.revisions()[1]?.id ?? this.revisions()[0].id);
        }
    }

    diffWithCurrent(r: FileRevisionView): void {
        this.diffFrom.set(r.id);
        this.diffTo.set('');
        this.tab.set('diff');
        this.runDiff();
    }

    runDiff(): void {
        const from = this.diffFrom();
        if (!from) return;
        const to = this.diffTo() || undefined;

        this.diffLoading.set(true);
        this.diff.set(null);
        this.history.diff(this._path(), from, to)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: d => { this.diff.set(d); this.diffLoading.set(false); this.cdr.markForCheck(); },
                error: () => {
                    this.diffLoading.set(false);
                    this.toast.error('Could not compute diff');
                    this.cdr.markForCheck();
                },
            });
    }

    sign(op: 'equal' | 'insert' | 'delete'): string {
        return op === 'insert' ? '+' : op === 'delete' ? '−' : ' ';
    }

    // ── Blame ────────────────────────────────────────────────────────────────

    openBlame(): void {
        this.tab.set('blame');
        if (this.blame()) return; // cached for this path
        this.blameLoading.set(true);
        this.history.blame(this._path())
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: b => { this.blame.set(b); this.blameLoading.set(false); this.cdr.markForCheck(); },
                error: () => {
                    this.blameLoading.set(false);
                    this.toast.error('Could not compute blame');
                    this.cdr.markForCheck();
                },
            });
    }

    // ── Restore ──────────────────────────────────────────────────────────────

    restore(r: FileRevisionView): void {
        if (this.restoring()) return;
        this.confirmSvc.open({
            title:        'Restore this version?',
            message:      `The content of revision ${r.shortHash} (${r.authorName || 'system'}) will be written as a new current version. `
                + `Nothing is lost — the current version stays in history and this is recorded as a new revision.`,
            confirmLabel: 'Restore',
            danger:       true,
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
            if (!confirmed) return;
            this.restoring.set(true);
            this.history.restore(this._path(), r.id)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: log => {
                        this.restoring.set(false);
                        this.applyLog(log.revisions, log.canWrite);
                        // Invalidate derived views — content changed.
                        this.blame.set(null);
                        this.diff.set(null);
                        this.viewing.set('');
                        this.tab.set('revisions');
                        this.toast.success('Version restored', r.shortHash);
                        this.restored.emit();
                        this.cdr.markForCheck();
                    },
                    error: () => {
                        this.restoring.set(false);
                        this.toast.error('Restore failed');
                        this.cdr.markForCheck();
                    },
                });
        });
    }
}
