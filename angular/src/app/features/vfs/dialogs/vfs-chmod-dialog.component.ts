import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
    computed,
} from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ModalComponent } from '@coolms/ui-angular';

export interface ChmodPayload {
    path:           string;
    mode:           string;
    recursive:      boolean;
    applyToFiles:   boolean;
    applyToFolders: boolean;
    fileMode:       string | null;
}

/** Data passed in by the opener via CDK `Dialog.open(..., { data })`. */
export interface ChmodDialogData {
    nodeName:    string;
    initialMode: string;
    isDirectory: boolean;
}

interface PermRow { label: string; r: boolean; w: boolean; x: boolean; }

function bitsToRow(bits: number): PermRow {
    return { label: '', r: !!(bits & 4), w: !!(bits & 2), x: !!(bits & 1) };
}

function rowToBits(row: PermRow): number {
    return (row.r ? 4 : 0) | (row.w ? 2 : 0) | (row.x ? 1 : 0);
}

function modeToRows(octal: string): [PermRow, PermRow, PermRow] {
    const n = parseInt(octal, 8);
    return [
        { ...bitsToRow((n >> 6) & 7), label: 'Owner' },
        { ...bitsToRow((n >> 3) & 7), label: 'Group' },
        { ...bitsToRow((n >> 0) & 7), label: 'Other' },
    ];
}

function rowsToOctal(rows: [PermRow, PermRow, PermRow], special = 0): string {
    return special.toString() +
           rowToBits(rows[0]).toString() +
           rowToBits(rows[1]).toString() +
           rowToBits(rows[2]).toString();
}

/**
 * A3 dialog convergence: VFS "Permissions" (chmod) dialog now renders the
 * platform `<app-modal>` chrome instead of a bespoke native `<dialog>`.
 * Opened via CDK `Dialog.open()` (data in via DIALOG_DATA, result out via
 * DialogRef — the `ChmodPayload` or null; the opener fills `path`). The
 * permission-matrix + special-bits + recursive-file-mode logic is unchanged;
 * `open()`'s init-from-initialMode now runs in field initializers since CDK
 * constructs the component fresh per open.
 */
@Component({
    selector: 'app-vfs-chmod-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent],
    template: `
        <app-modal [title]="'Permissions — ' + data.nodeName">

            <!-- Permission matrix -->
            <table class="perm-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>Read</th>
                        <th>Write</th>
                        <th>Execute</th>
                    </tr>
                </thead>
                <tbody>
                    @for (row of rows(); track row.label) {
                        <tr>
                            <td class="perm-label">{{ row.label }}</td>
                            <td>
                                <span class="cms-checkbox"
                                      [class.cms-checkbox--checked]="row.r"
                                      (click)="row.r = !row.r; touchRows()">
                                    <i class="bi bi-check"></i>
                                </span>
                            </td>
                            <td>
                                <span class="cms-checkbox"
                                      [class.cms-checkbox--checked]="row.w"
                                      (click)="row.w = !row.w; touchRows()">
                                    <i class="bi bi-check"></i>
                                </span>
                            </td>
                            <td>
                                <span class="cms-checkbox"
                                      [class.cms-checkbox--checked]="row.x"
                                      (click)="row.x = !row.x; touchRows()">
                                    <i class="bi bi-check"></i>
                                </span>
                            </td>
                        </tr>
                    }
                </tbody>
            </table>

            <div class="octal-preview">Octal: <code>{{ octalMode() }}</code></div>

            <!-- Special bits ─────────────────────────────────────── -->
            <hr class="dlg-sep">
            @if (data.isDirectory) {
                <label class="chk-row" (click)="setgid.set(!setgid())">
                    <span class="cms-checkbox"
                          [class.cms-checkbox--checked]="setgid()">
                        <i class="bi bi-check"></i>
                    </span>
                    <span>
                        <b>Setgid</b> (g+s)
                        <span class="bit-desc">— new files inherit group from this directory</span>
                    </span>
                </label>
            }
            <label class="chk-row" (click)="sticky.set(!sticky())">
                <span class="cms-checkbox"
                      [class.cms-checkbox--checked]="sticky()">
                    <i class="bi bi-check"></i>
                </span>
                <span>
                    <b>Sticky</b> (+t)
                    <span class="bit-desc">— only owner can delete files inside</span>
                </span>
            </label>

            <!-- Recursive section — only for directories -->
            @if (data.isDirectory) {
                <hr class="dlg-sep">
                <label class="chk-row"
                       (click)="recursive = !recursive">
                    <span class="cms-checkbox"
                          [class.cms-checkbox--checked]="recursive">
                        <i class="bi bi-check"></i>
                    </span>
                    Apply recursively to all contents
                </label>

                @if (recursive) {
                    <div class="recursive-opts">
                        <label class="chk-row"
                               (click)="applyToFiles = !applyToFiles">
                            <span class="cms-checkbox"
                                  [class.cms-checkbox--checked]="applyToFiles">
                                <i class="bi bi-check"></i>
                            </span>
                            Apply to files
                        </label>
                        <label class="chk-row"
                               (click)="applyToFolders = !applyToFolders">
                            <span class="cms-checkbox"
                                  [class.cms-checkbox--checked]="applyToFolders">
                                <i class="bi bi-check"></i>
                            </span>
                            Apply to sub-folders
                        </label>

                        <!-- Separate file-mode matrix -->
                        @if (applyToFiles) {
                            <div class="mb-1 text-muted">File permissions (leave equal for same as folder):</div>
                            <table class="perm-table perm-table--sm">
                                <thead>
                                    <tr>
                                        <th></th>
                                        <th>Read</th>
                                        <th>Write</th>
                                        <th>Execute</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @for (row of fileRows(); track row.label) {
                                        <tr>
                                            <td class="perm-label">{{ row.label }}</td>
                                            <td>
                                                <span class="cms-checkbox"
                                                      [class.cms-checkbox--checked]="row.r"
                                                      (click)="row.r = !row.r; touchFileRows()">
                                                    <i class="bi bi-check"></i>
                                                </span>
                                            </td>
                                            <td>
                                                <span class="cms-checkbox"
                                                      [class.cms-checkbox--checked]="row.w"
                                                      (click)="row.w = !row.w; touchFileRows()">
                                                    <i class="bi bi-check"></i>
                                                </span>
                                            </td>
                                            <td>
                                                <span class="cms-checkbox"
                                                      [class.cms-checkbox--checked]="row.x"
                                                      (click)="row.x = !row.x; touchFileRows()">
                                                    <i class="bi bi-check"></i>
                                                </span>
                                            </td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                            <div class="octal-preview">Octal: <code>{{ octalFileMode() }}</code></div>
                        }
                    </div>
                }
            }

            <div footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary" (click)="confirm()">Apply</button>
            </div>
        </app-modal>
    `,
    styles: [`
        .perm-table           { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
        .perm-table th        { font-size: .78rem; font-weight: 600; color: var(--cms-text-secondary, #6b7280); padding: 2px 8px; text-align: center; }
        .perm-table td        { padding: 4px 8px; text-align: center; }
        .perm-label           { text-align: left !important; font-size: .875rem; color: var(--cms-text, #374151); min-width: 60px; }
        .perm-table--sm       { font-size: .8rem; }
        .perm-table--sm .perm-label { font-size: .8rem; }
        .octal-preview        { font-size: .8rem; color: var(--cms-text-secondary, #6b7280); margin-bottom: 4px; }
        .dlg-sep              { margin: 12px 0; border: none; border-top: 1px solid var(--cms-border, #f1f5f9); }
        /* Checkbox row: wrapper flex label + text */
        .chk-row {
            display: flex; align-items: center; gap: 8px;
            font-size: .875rem; color: var(--cms-text, #374151);
            cursor: pointer; user-select: none;
            margin-bottom: 6px;
        }
        .recursive-opts       { padding-left: 24px; display: flex; flex-direction: column; }
        .text-muted           { color: var(--cms-text-secondary, #6b7280); font-size: .8rem; margin-bottom: 6px; }
        .bit-desc             { color: var(--cms-text-muted, #9ca3af); font-size: .78rem; margin-left: 2px; }
    `],
})
export class VfsChmodDialogComponent {
    private readonly dialogRef = inject<DialogRef<ChmodPayload | null>>(DialogRef);
    readonly data = inject<ChmodDialogData>(DIALOG_DATA);

    /** Permission matrices seeded from the incoming mode. */
    rows     = signal<[PermRow, PermRow, PermRow]>(modeToRows(this.data.initialMode));
    fileRows = signal<[PermRow, PermRow, PermRow]>(modeToRows(this.data.initialMode));

    /** Special bits parsed from initialMode. */
    setgid = signal((parseInt(this.data.initialMode, 8) & 0o2000) !== 0);
    sticky = signal((parseInt(this.data.initialMode, 8) & 0o1000) !== 0);

    /** Full 4-digit octal including the special-bits digit (e.g. '2755', '1777'). */
    octalMode = computed(() => {
        const special = (this.setgid() ? 2 : 0) + (this.sticky() ? 1 : 0);
        return rowsToOctal(this.rows(), special);
    });
    /** File-mode octal never carries special bits. */
    octalFileMode = computed(() => rowsToOctal(this.fileRows()));

    recursive      = false;
    applyToFiles   = true;
    applyToFolders = false;

    /** Force signal update after checkbox change (needed for OnPush). */
    touchRows(): void     { this.rows.update(r => [...r] as [PermRow, PermRow, PermRow]); }
    touchFileRows(): void { this.fileRows.update(r => [...r] as [PermRow, PermRow, PermRow]); }

    confirm(): void {
        this.dialogRef.close({
            path:           '',          // filled by caller (VfsActionsService)
            mode:           this.octalMode(),
            recursive:      this.recursive,
            applyToFiles:   this.applyToFiles,
            applyToFolders: this.applyToFolders,
            fileMode:       (this.recursive && this.applyToFiles && this.octalFileMode() !== this.octalMode())
                                ? this.octalFileMode()
                                : null,
        });
    }

    cancel(): void {
        this.dialogRef.close(null);
    }
}
