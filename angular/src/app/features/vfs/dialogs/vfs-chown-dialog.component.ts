import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { Store } from '@ngxs/store';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { AppConfigState } from '@coolms/core-angular';
import { ModalComponent, UserSearchSelectComponent } from '@coolms/ui-angular';

export interface ChownPayload {
    path:           string;
    uid:            string;
    gid:            string;
    recursive:      boolean;
    applyToFiles:   boolean;
    applyToFolders: boolean;
}

/** Data passed in by the opener via CDK `Dialog.open(..., { data })`. */
export interface ChownDialogData {
    nodeName:    string;
    initialUid:  string;
    initialGid:  string;
    isDirectory: boolean;
}

/**
 * A3 dialog convergence: VFS "Ownership" dialog now renders the platform
 * `<app-modal>` chrome instead of a bespoke native `<dialog>`. Opened via
 * CDK `Dialog.open()` (data in via DIALOG_DATA, result out via DialogRef —
 * the `ChownPayload` or null; the opener fills `path`).
 */
@Component({
    selector: 'app-vfs-chown-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UserSearchSelectComponent, ModalComponent],
    template: `
        <app-modal [title]="'Ownership — ' + data.nodeName">

            <div class="field-group">
                <label class="field-label">Owner (user)</label>
                <app-user-search-select
                    [apiUrl]="usersApiUrl()"
                    [value]="selectedUid"
                    entityLabel="user"
                    placeholder="— Select owner —"
                    (valueChange)="selectedUid = $event" />
            </div>

            <div class="field-group">
                <label class="field-label">Group</label>
                <app-user-search-select
                    [apiUrl]="groupsApiUrl()"
                    [value]="selectedGid"
                    entityLabel="group"
                    placeholder="— Select group —"
                    (valueChange)="selectedGid = $event" />
            </div>

            @if (data.isDirectory) {
                <hr class="dlg-sep">
                <label class="chk-row" (click)="recursive = !recursive">
                    <span class="cms-checkbox" [class.cms-checkbox--checked]="recursive">
                        <i class="bi bi-check"></i>
                    </span>
                    Apply recursively to all contents
                </label>

                @if (recursive) {
                    <div class="recursive-opts">
                        <label class="chk-row" (click)="applyToFiles = !applyToFiles">
                            <span class="cms-checkbox" [class.cms-checkbox--checked]="applyToFiles">
                                <i class="bi bi-check"></i>
                            </span>
                            Apply to files
                        </label>
                        <label class="chk-row" (click)="applyToFolders = !applyToFolders">
                            <span class="cms-checkbox" [class.cms-checkbox--checked]="applyToFolders">
                                <i class="bi bi-check"></i>
                            </span>
                            Apply to sub-folders
                        </label>
                    </div>
                }
            }

            <div footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="!selectedUid || !selectedGid"
                        (click)="confirm()">
                    Apply
                </button>
            </div>
        </app-modal>
    `,
    styles: [`
        .field-group    { margin-bottom: 14px; }
        .field-label    { display: block; font-size: .8rem; font-weight: 600; color: var(--cms-text, #111827); margin-bottom: 5px; }
        .dlg-sep        { margin: 12px 0; border: none; border-top: 1px solid var(--cms-border, #e5e7eb); }
        .chk-row        { display: flex; align-items: center; gap: 8px; font-size: .875rem; color: var(--cms-text, #111827); cursor: pointer; user-select: none; margin-bottom: 6px; }
        .recursive-opts { padding-left: 24px; display: flex; flex-direction: column; }
    `],
})
export class VfsChownDialogComponent {
    private readonly dialogRef = inject<DialogRef<ChownPayload | null>>(DialogRef);
    readonly data  = inject<ChownDialogData>(DIALOG_DATA);
    private readonly store = inject(Store);

    usersApiUrl = computed(() => {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        return manifest?.auth?.usersApi ?? '';
    });

    groupsApiUrl = computed(() => {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        return manifest?.auth?.groupsApi ?? '';
    });

    selectedUid    = this.data.initialUid;
    selectedGid    = this.data.initialGid;
    recursive      = false;
    applyToFiles   = true;
    applyToFolders = true;

    confirm(): void {
        this.dialogRef.close({
            path:           '',          // filled by caller
            uid:            this.selectedUid,
            gid:            this.selectedGid,
            recursive:      this.recursive,
            applyToFiles:   this.applyToFiles,
            applyToFolders: this.applyToFolders,
        });
    }

    cancel(): void {
        this.dialogRef.close(null);
    }
}
