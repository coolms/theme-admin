import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import { VfsActionsService } from './vfs-actions.service';
import { VfsIconService } from './vfs-icon.service';
import { VfsSecureImgDirective } from './vfs-secure-img.directive';
import { VfsNodeDto } from '@coolms/ui-angular';

/**
 * File / directory detail panel shown in the right drawer.
 *
 * Open via:
 *   drawerService.open(VfsFileDetailComponent, { node })
 */
@Component({
    selector: 'app-vfs-file-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DatePipe, VfsSecureImgDirective],
    template: `
        <div class="d-flex flex-column gap-3">

            <!-- Image preview -->
            @if (isImage()) {
                <div class="detail-preview">
                    <img [vfsSecureSrc]="previewUrl()"
                         alt="{{ node().name }}"
                         style="max-width:100%; max-height:200px;
                                object-fit:contain; display:block; margin:auto" />
                </div>
            }

            <!-- Icon + name -->
            <div class="d-flex align-items-center gap-2">
                <i class="bi {{ icons.nodeIcon(node()) }} {{ icons.nodeIconClass(node()) }}"
                   style="font-size: 2rem"></i>
                <div>
                    <div class="fw-semibold" style="word-break:break-all">
                        {{ node().name }}
                    </div>
                    <div class="detail-muted">{{ node().mimeType ?? node().type }}</div>
                </div>
            </div>

            <!-- Metadata rows (no Bootstrap table — avoids --bs-table-bg white injection) -->
            <dl class="detail-meta">
                <div class="detail-row">
                    <dt>Path</dt>
                    <dd style="word-break:break-all">{{ node().path }}</dd>
                </div>
                <div class="detail-row">
                    <dt>Size</dt>
                    <dd>{{ (node().type === 'file' || node().type === 'resource') ? node().humanSize : '—' }}</dd>
                </div>
                <div class="detail-row">
                    <dt>Type</dt>
                    <dd>{{ node().type }}</dd>
                </div>
                <div class="detail-row">
                    <dt>Permissions</dt>
                    <dd>
                        <code style="font-size:.8125rem">{{ node().modeString }}</code>
                        <span class="ms-2 badge"
                              [class.bg-success]="isPublic()"
                              [class.bg-secondary]="!isPublic()">
                            {{ isPublic() ? 'public' : 'private' }}
                        </span>
                    </dd>
                </div>
                <div class="detail-row">
                    <dt>Owner</dt>
                    <dd [title]="node().uid">{{ node().uname || node().uid }}</dd>
                </div>
                <div class="detail-row">
                    <dt>Group</dt>
                    <dd [title]="node().gid">{{ node().gname || node().gid }}</dd>
                </div>
                <div class="detail-row">
                    <dt>Modified</dt>
                    <dd>{{ node().updatedAt | date:'dd MMM yyyy HH:mm' }}</dd>
                </div>
                <div class="detail-row">
                    <dt>Created</dt>
                    <dd>{{ node().createdAt | date:'dd MMM yyyy HH:mm' }}</dd>
                </div>
                @if (node().isRendered) {
                    <div class="detail-row">
                        <dt>Rendered</dt>
                        <dd><span class="badge bg-info" style="font-size:.75rem">SSR page</span></dd>
                    </div>
                }
            </dl>

            <!-- Permission matrix -->
            <div>
                <div class="small fw-semibold text-muted mb-2">Permission Matrix</div>
                <div class="d-flex gap-2">
                    @for (grp of permMatrix(); track grp.label) {
                        <div class="flex-grow-1 text-center p-2 rounded"
                             style="border: 1px solid var(--cms-border, #e5e7eb); font-size: .75rem">
                            <div class="text-muted mb-1">{{ grp.label }}</div>
                            <div class="d-flex justify-content-center gap-1">
                                @for (bit of grp.bits; track bit.label) {
                                    <span class="badge"
                                          [class.bg-success]="bit.active"
                                          [class.bg-light]="!bit.active"
                                          [class.text-muted]="!bit.active">
                                        {{ bit.label }}
                                    </span>
                                }
                            </div>
                        </div>
                    }
                </div>
            </div>

            <!-- Actions -->
            <div class="d-flex gap-2 flex-wrap mt-1 justify-content-end">
                @if (node().type === 'file') {
                    <button class="cms-btn cms-btn-sm" (click)="download()">
                        <i class="bi bi-download"></i> Download
                    </button>
                }
                @if (!node().isSystem) {
                    <button class="cms-btn cms-btn-sm" (click)="rename()">
                        <i class="bi bi-pencil"></i> Rename
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        /*
         * Right-panel padding regression fix: mirror the body-padding
         * other module detail components own (Word + Instance details
         * have padding on their outer container; Media's form uses
         * Bootstrap p-3). Without this the VFS panel content sat
         * flush against the panel edges after the shared chrome
         * migration.
         */
        :host {
            display: block;
            padding: var(--cms-panel-padding);
        }

        .detail-preview {
            text-align: center;
            border-radius: var(--cms-radius, 6px);
            border: 1px solid var(--cms-border, #e5e7eb);
            overflow: hidden;
            max-height: 200px;
        }

        .detail-muted {
            font-size: .8125rem;
            color: var(--cms-text-muted, #6b7280);
        }

        /* Metadata definition list — no background, clean two-column rows */
        .detail-meta {
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 0;
        }
        .detail-row {
            display: grid;
            grid-template-columns: 40% 1fr;
            gap: 4px 8px;
            padding: 5px 0;
            border-bottom: 1px solid var(--cms-border-light, #f3f4f6);
            align-items: baseline;
        }
        .detail-row:last-child { border-bottom: none; }
        dt {
            font-size: .8125rem;
            color: var(--cms-text-muted, #6b7280);
            font-weight: 400;
            margin: 0;
        }
        dd {
            font-size: .8125rem;
            margin: 0;
            color: var(--cms-text, #111827);
        }
    `],
})
export class VfsFileDetailComponent {
    node = input.required<VfsNodeDto>();

    private readonly store      = inject(Store);
    private readonly vfsActions = inject(VfsActionsService);
    protected readonly icons    = inject(VfsIconService);

    isImage = computed(() => !!this.node().mimeType?.startsWith('image/'));

    previewUrl = computed(() => {
        const base = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '';
        return `${base}/vfs/files/preview?path=${encodeURIComponent(this.node().path)}`;
    });

    // A file is "public" if the others-read bit (o+r = 0o004) is set.
    // mode is a 4-char octal string like '0644'; parseInt(x, 8) gives the
    // numeric value for bitwise operations.
    isPublic = computed(() =>
        (parseInt(this.node().mode || '0000', 8) & 0o004) !== 0,
    );

    permMatrix = computed(() => {
        const mode  = parseInt(this.node().mode || '0644', 8);
        const parse = (shift: number) => [
            { label: 'r', active: !!(mode & (0o4 << shift)) },
            { label: 'w', active: !!(mode & (0o2 << shift)) },
            { label: 'x', active: !!(mode & (0o1 << shift)) },
        ];
        return [
            { label: 'Owner',  bits: parse(6) },
            { label: 'Group',  bits: parse(3) },
            { label: 'Others', bits: parse(0) },
        ];
    });

    download(): void { this.vfsActions.download(this.node()); }
    rename():   void { void this.vfsActions.rename(this.node()); }
}
