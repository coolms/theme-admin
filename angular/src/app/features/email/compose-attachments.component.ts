import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, model, output, signal, viewChild } from '@angular/core';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable, catchError, map, throwError, type Subscription } from 'rxjs';
import { AuthState } from '@coolms/core-angular';
import {
    CmsFilesPickerService,
    FilesPickerDenied,
    FilesPickerFailure,
    VfsTreeService,
    type FilesPickerChoice,
    type FilesPickerEntry,
    type FilesPickerOptions,
    type FilesPickerPage,
    type FilesPickerSpace,
} from '@coolms/ui-angular';
import { EmailService } from './email.service';
import {
    MAX_ATTACHMENT_BYTES,
    attachmentCost,
    attachmentKey,
    driveRefusalText,
    formatBytes,
    messageBytes,
    readyAttachment,
    uploadRefusalText,
    type ComposeAttachment,
} from './compose-attachments';

/** The most nodes one attach from Drive names. */
const DRIVE_BATCH = 50;

const OVER_LIMIT = 'It would take the message over the mailbox’s size limit.';
const TOO_LARGE = 'Larger than 25 MB, the most a file can be.';

/**
 * The composer's attachments: "Attach files" offers From device (an upload) and From files (the files picker over the
 * person's spaces, which attaches by node id), a chip for each file with its size, its upload's progress, why it was
 * refused, and Remove, and the size used and left against the mailbox's limit. The size is the composer's estimate
 * (each file encoded, its part headers, and the body); the server measures the message at send, and its 413 is shown
 * here when it says the message is over.
 */
@Component({
    selector: 'app-compose-attachments',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="cma">
            <div class="cma__bar">
                <div class="cma__menu-wrap" (focusout)="onMenuFocusOut($event)" (keydown.escape)="closeMenu($event)">
                    <button type="button" class="mbx__btn mbx__btn--sm" data-test="attach-menu" aria-haspopup="menu"
                            [attr.aria-expanded]="menuOpen()" (click)="menuOpen.set(!menuOpen())">
                        <i class="bi bi-paperclip" aria-hidden="true"></i> Attach files
                        <i class="bi bi-chevron-down" aria-hidden="true"></i>
                    </button>
                    @if (menuOpen()) {
                        <div class="cma__menu" role="menu" data-test="attach-menu-list">
                            <button type="button" role="menuitem" class="cma__menu-item" data-test="attach-device"
                                    (click)="chooseFromDevice()">
                                <i class="bi bi-upload" aria-hidden="true"></i> From device
                            </button>
                            <button type="button" role="menuitem" class="cma__menu-item" data-test="attach-files"
                                    (click)="chooseFromFiles()">
                                <i class="bi bi-folder2-open" aria-hidden="true"></i> From files
                            </button>
                        </div>
                    }
                    <input #fileInput type="file" multiple hidden data-test="attach-input" (change)="onFilesChosen($event)" />
                </div>
                <span class="cma__size" data-test="attachment-size" [class.cma__size--over]="over()">{{ sizeLine() }}</span>
            </div>
            @if (sendRefused(); as r) {
                <p class="cma__refused-send" data-test="attachment-send-refused">
                    The server measured the message at {{ fmt(r.sizeBytes) }}, over this mailbox’s limit of
                    {{ fmt(r.limitBytes) }}. Remove a file and send again.
                </p>
            }
            @if (attachments().length > 0) {
                <ul class="cma__chips" aria-label="Attachments">
                    @for (a of attachments(); track a.key) {
                        <li class="cma__chip" data-test="attachment-chip" [attr.data-status]="a.status"
                            [class.cma__chip--refused]="a.status === 'refused'">
                            <i class="bi" aria-hidden="true" [class.bi-paperclip]="a.source === 'upload'"
                               [class.bi-hdd-stack]="a.source === 'drive'"></i>
                            <span class="cma__chip-text">
                                <span class="cma__chip-name" data-test="attachment-name" [title]="a.filename">{{ a.filename }}</span>
                                <span class="cma__chip-meta">
                                    {{ fmt(a.sizeBytes) }}
                                    @if (a.status === 'attaching') { · Attaching… }
                                </span>
                                @if (a.status === 'uploading') {
                                    <span class="cma__progress" role="progressbar" data-test="attachment-progress"
                                          aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="a.progress"
                                          [attr.aria-label]="'Uploading ' + a.filename">
                                        <span class="cma__progress-bar" [style.width.%]="a.progress"></span>
                                    </span>
                                }
                                @if (a.refusal) {
                                    <span class="cma__refusal" data-test="attachment-refusal">{{ a.refusal }}</span>
                                }
                            </span>
                            <button type="button" class="cma__remove" data-test="attachment-remove"
                                    [attr.aria-label]="'Remove ' + a.filename" (click)="remove(a)">
                                <i class="bi bi-x-lg" aria-hidden="true"></i>
                            </button>
                        </li>
                    }
                </ul>
            }
        </div>
    `,
    styles: [`
        /* Its full height in the composer's column: the body scrolls as one, the files never shrink under the bar. */
        :host { display: block; flex-shrink: 0; }
        .cma { display: flex; flex-direction: column; gap: 6px; }
        .cma__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
        .cma__menu-wrap { position: relative; }
        .cma__menu {
            position: absolute;
            left: 0;
            bottom: calc(100% + 4px);
            z-index: 5;
            display: flex;
            flex-direction: column;
            min-width: 12rem;
            padding: 4px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            box-shadow: var(--cms-shadow-md);
        }
        .cma__menu-item {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 2.25rem;
            padding: 4px 10px;
            border: 0;
            border-radius: var(--cms-radius-sm);
            background: none;
            color: var(--cms-text);
            text-align: start;
        }
        .cma__menu-item:hover, .cma__menu-item:focus-visible { background: var(--cms-bg-hover); }
        .cma__size { font-size: var(--cms-font-size-meta, 13px); color: var(--cms-text-muted); }
        .cma__size--over { color: var(--cms-danger-text); font-weight: 600; }
        .cma__refused-send { margin: 0; font-size: var(--cms-font-size-meta, 13px); color: var(--cms-danger-text); }
        .cma__chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
        .cma__chip {
            display: flex;
            align-items: flex-start;
            gap: 6px;
            max-width: 100%;
            width: 15rem;
            padding: 6px 4px 6px 8px;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
            background: var(--cms-surface-muted);
        }
        .cma__chip > .bi { margin-top: 2px; color: var(--cms-text-muted); }
        .cma__chip--refused { border-color: var(--cms-danger); background: var(--cms-danger-light); }
        .cma__chip-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .cma__chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .875rem; }
        .cma__chip-meta { font-size: var(--cms-font-size-meta, 13px); color: var(--cms-text-muted); }
        .cma__refusal { font-size: var(--cms-font-size-meta, 13px); color: var(--cms-danger-text); }
        .cma__progress { display: block; height: 4px; border-radius: 2px; background: var(--cms-border-light); overflow: hidden; }
        .cma__progress-bar { display: block; height: 100%; background: var(--cms-accent); transition: width .2s; }
        .cma__remove {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 1.75rem;
            min-height: 1.75rem;
            border: 0;
            border-radius: var(--cms-radius-sm);
            background: none;
            color: var(--cms-text-secondary);
        }
        .cma__remove:hover { background: var(--cms-bg-hover); color: var(--cms-text); }
        @media (max-width: 767.98px) {
            .cma__chip { width: 100%; }
            .cma__remove, .cma__menu-item, .cma__bar .mbx__btn { min-width: var(--cms-touch-target-min, 44px); min-height: var(--cms-touch-target-min, 44px); }
        }
    `],
})
export class ComposeAttachmentsComponent {
    readonly mailboxId = input.required<string>();
    /** The mailbox's limit; null when it is not known, and then only the size used is shown. */
    readonly limitBytes = input<number | null>(null);
    /** The body's bytes, counted with the files. */
    readonly bodyBytes = input<number>(0);
    /** A send refused as too large: the server's measure and the limit. */
    readonly sendRefused = input<{ readonly limitBytes: number; readonly sizeBytes: number } | null>(null);
    readonly attachments = model<ComposeAttachment[]>([]);
    /** A file was attached or taken out: the draft is saved again. */
    readonly changed = output<void>();

    private readonly email = inject(EmailService);
    private readonly vfs = inject(VfsTreeService);
    private readonly picker = inject(CmsFilesPickerService);
    private readonly store = inject(Store);
    private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
    private readonly running = new Map<string, Subscription>();
    /** Chips taken out while their Drive batch was still attaching: their ids are removed when the answer comes. */
    private readonly removedInFlight = new Set<string>();
    /** Why a listed file cannot be chosen, by node id, from the listing that showed it. */
    private readonly reasons = new Map<string, string>();

    readonly menuOpen = signal(false);

    readonly used = computed(() => messageBytes(this.attachments(), this.bodyBytes()));
    readonly over = computed(() => {
        const limit = this.limitBytes();

        return limit !== null && this.used() > limit;
    });
    readonly sizeLine = computed(() => {
        const used = this.used();
        const limit = this.limitBytes();
        if (limit === null) return this.fmt(used) + ' used';
        if (used > limit) return this.fmt(used) + ' of ' + this.fmt(limit) + ': over the limit by ' + this.fmt(used - limit);

        return this.fmt(used) + ' of ' + this.fmt(limit) + ' used, ' + this.fmt(limit - used) + ' left';
    });

    readonly fmt = formatBytes;

    constructor() {
        inject(DestroyRef).onDestroy(() => this.running.forEach((s) => s.unsubscribe()));
    }

    onMenuFocusOut(event: FocusEvent): void {
        const next = event.relatedTarget as Node | null;
        if (!next || !(event.currentTarget as HTMLElement).contains(next)) this.menuOpen.set(false);
    }

    closeMenu(event: Event): void {
        if (!this.menuOpen()) return;
        event.stopPropagation();
        this.menuOpen.set(false);
    }

    chooseFromDevice(): void {
        this.menuOpen.set(false);
        this.fileInput()?.nativeElement.click();
    }

    onFilesChosen(event: Event): void {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = '';
        this.uploadFiles(files);
    }

    /** Each file becomes a chip: refused at once when it is too large or would go over the limit, else uploaded. */
    uploadFiles(files: readonly File[]): void {
        for (const file of files) {
            const key = attachmentKey();
            const limit = this.limitBytes();
            const refusal = file.size > MAX_ATTACHMENT_BYTES ? TOO_LARGE
                : limit !== null && this.used() + attachmentCost(file.size) > limit ? OVER_LIMIT
                : null;
            this.attachments.update((list) => [...list, {
                key,
                id: null,
                filename: file.name,
                sizeBytes: file.size,
                encodedBytes: null,
                mimeType: file.type || null,
                source: 'upload',
                status: refusal ? 'refused' : 'uploading',
                progress: 0,
                refusal,
            }]);
            if (refusal) continue;
            const sub = this.email.uploadAttachment(this.mailboxId(), file).subscribe({
                next: (ev) => {
                    if (ev.type === HttpEventType.UploadProgress) {
                        const progress = ev.total ? Math.min(99, Math.round((ev.loaded / ev.total) * 100)) : 0;
                        this.patch(key, { progress });
                    } else if (ev.type === HttpEventType.Response && ev.body) {
                        this.replace(key, readyAttachment(ev.body, 'upload', key));
                        this.running.delete(key);
                        this.changed.emit();
                    }
                },
                error: (e: unknown) => {
                    this.running.delete(key);
                    this.patch(key, { status: 'refused', refusal: uploadRefusalText(e) });
                },
            });
            this.running.set(key, sub);
        }
    }

    async chooseFromFiles(): Promise<void> {
        this.menuOpen.set(false);
        const limit = this.limitBytes();
        const options: FilesPickerOptions = {
            title: 'Attach from files',
            spaces: this.spaces(),
            list: (space, path, cursor) => this.list(space, path, cursor),
            disabledReason: (entry) => this.reasons.get(entry.id) ?? null,
            budget: limit === null ? null : {
                usedBytes: this.used(),
                limitBytes: limit,
                cost: (entry) => attachmentCost(entry.size ?? 0),
            },
            confirmLabel: (n) => (n === 0 ? 'Attach files' : n === 1 ? 'Attach 1 file' : 'Attach ' + n + ' files'),
            formatSize: formatBytes,
        };
        const chosen = await this.picker.open(options);
        if (chosen && chosen.length > 0) this.attachFromFiles(chosen);
    }

    /** The chosen files become chips at once, then attach by node id, fifty at a time; a refusal is shown by name. */
    attachFromFiles(chosen: readonly FilesPickerChoice[]): void {
        const keyed = chosen.map((c) => ({ choice: c, key: attachmentKey() }));
        this.attachments.update((list) => [...list, ...keyed.map(({ choice, key }): ComposeAttachment => ({
            key,
            id: null,
            filename: choice.label || choice.name,
            sizeBytes: choice.size ?? 0,
            encodedBytes: null,
            mimeType: choice.mimeType ?? null,
            source: 'drive',
            status: 'attaching',
            progress: 0,
            refusal: null,
        }))]);
        for (let i = 0; i < keyed.length; i += DRIVE_BATCH) {
            const batch = keyed.slice(i, i + DRIVE_BATCH);
            // The batch's own key: removing one of its chips never stops the others' answer.
            const runKey = 'batch-' + attachmentKey();
            const sub = this.email.attachFromDrive(this.mailboxId(), batch.map((b) => b.choice.id)).subscribe({
                next: (res) => {
                    this.running.delete(runKey);
                    batch.forEach(({ choice, key }, n) => {
                        const row = res.attachments.find((r) => r.node === choice.id) ?? res.attachments[n];
                        if (this.removedInFlight.delete(key)) {
                            // Taken out before the answer: what the server attached for it is removed, not shown.
                            if (row && row.refused === undefined) {
                                this.email.removeAttachment(this.mailboxId(), row.id).subscribe({ error: () => undefined });
                            }

                            return;
                        }
                        if (!row) {
                            this.patch(key, { status: 'refused', refusal: driveRefusalText('not-found') });
                        } else if (row.refused !== undefined) {
                            this.patch(key, { status: 'refused', refusal: driveRefusalText(row.refused) });
                        } else {
                            this.replace(key, readyAttachment(row, 'drive', key));
                        }
                    });
                    this.changed.emit();
                },
                error: () => {
                    this.running.delete(runKey);
                    batch.forEach(({ key }) => {
                        this.removedInFlight.delete(key);
                        this.patch(key, { status: 'refused', refusal: 'Not attached: the server could not take it.' });
                    });
                },
            });
            this.running.set(runKey, sub);
        }
    }

    /** Take a file out: an upload in flight is stopped; an attached one is removed on the server, a Drive file staying in Drive. */
    remove(a: ComposeAttachment): void {
        if (a.status === 'attaching') this.removedInFlight.add(a.key);
        this.running.get(a.key)?.unsubscribe();
        this.running.delete(a.key);
        this.attachments.update((list) => list.filter((x) => x.key !== a.key));
        if (a.id !== null) {
            this.email.removeAttachment(this.mailboxId(), a.id).subscribe({ error: () => undefined });
        }
        this.changed.emit();
    }

    /** The person's own files first, then everything they may read. */
    private spaces(): FilesPickerSpace[] {
        const uid = this.store.selectSnapshot(AuthState.currentUser)?.id;
        const all: FilesPickerSpace = { id: 'all', name: 'All files' };

        return uid ? [{ id: 'home', name: 'My files' }, all] : [all];
    }

    private rootOf(space: string): string {
        const uid = this.store.selectSnapshot(AuthState.currentUser)?.id;

        return space === 'home' && uid ? '/home/' + uid : '';
    }

    private list(space: string, path: string, cursor?: string): Observable<FilesPickerPage> {
        const full = (this.rootOf(space) + (path === '' ? '' : '/' + path)) || '/';

        return this.vfs.listChildren(full, { limit: 100, cursor }).pipe(
            map((page): FilesPickerPage => {
                const entries = page.member.map((n): FilesPickerEntry => {
                    const folder = n.isContainer;
                    if (!folder) {
                        const reason = n.permissions && !n.permissions.read ? 'You may not read this file.'
                            : n.size > MAX_ATTACHMENT_BYTES ? TOO_LARGE
                            : null;
                        if (reason) this.reasons.set(n.id, reason);
                        else this.reasons.delete(n.id);
                    }

                    return { id: n.id, name: n.name, label: n.title, kind: folder ? 'folder' : 'file', size: n.size, mimeType: n.mimeType };
                });
                // Folders first, each group in the server's order.
                const sorted = [...entries.filter((e) => e.kind === 'folder'), ...entries.filter((e) => e.kind === 'file')];

                return { entries: sorted, next: page.hasMore ? page.nextCursor : null };
            }),
            catchError((e: unknown) => throwError(() => (e instanceof HttpErrorResponse && (e.status === 403 || e.status === 404)
                ? new FilesPickerDenied()
                : new FilesPickerFailure('The folder could not be read.')))),
        );
    }

    private patch(key: string, change: Partial<ComposeAttachment>): void {
        this.attachments.update((list) => list.map((a) => (a.key === key ? { ...a, ...change } : a)));
    }

    private replace(key: string, next: ComposeAttachment): void {
        this.attachments.update((list) => list.map((a) => (a.key === key ? next : a)));
    }
}
