import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

import { ApiService } from '../../api/api.service';
import { ErrorHandlerService } from '@coolms/core-angular';
import { MultiOptionSelectComponent, ToastService } from '@coolms/ui-angular';

export interface GroupRoleGrantsDialogData {
    readonly id: string;
    readonly name: string;
    readonly label?: string | null;
    readonly role: string;
}

/**
 * Role grants for one group (#1726) — which OTHER groups' roles are handed out
 * by holding this one's.
 *
 * ## Why the wording is laboured
 *
 * The stored edge is `parent → child` and the security hierarchy walks it as
 * "holding the parent's role also grants the child's". Said as "inherits" it
 * reads in both directions depending on who is speaking, and getting it
 * backwards here would hand out privileges rather than withhold them. So the
 * dialog states the consequence in a full sentence, with the group's own role
 * named, instead of relying on a label like "Inherits".
 *
 * ## What it does NOT try to prevent
 *
 * Selecting the group itself, or a group that already reaches back to it. The
 * picker offers every group and the SERVER refuses the cycle with a message
 * naming the group. Reimplementing the graph walk here would be a second
 * implementation of the platform's most privilege-bearing rule, kept in sync by
 * hope — and the refusal an operator needs to see is the authoritative one.
 */
@Component({
    selector: 'app-group-role-grants-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MultiOptionSelectComponent],
    template: `
        <div class="cms-dialog grg">
            <div class="cms-dialog-header">
                <i class="bi bi-diagram-3"></i>
                <span>Role grants — {{ title }}</span>
                <button type="button" class="cms-dialog-close" (click)="close()" aria-label="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="cms-dialog-body grg__body">
                @if (loading()) {
                    <div class="cms-field-hint">Loading…</div>
                } @else {
                    <p class="grg__lead">
                        Anyone holding <code>{{ data.role }}</code> also gets the roles of the
                        groups selected here.
                    </p>

                    <div>
                        <label class="cms-label">Also grants</label>
                        <app-multi-option-select
                            [values]="granted()"
                            [apiUrl]="groupsApiUrl"
                            placeholder="— Grants nothing —"
                            entityLabel="group"
                            (valuesChange)="granted.set($event)" />
                        <div class="cms-field-hint">
                            Direct grants only. A group reached through another one is not
                            listed here, but its role is still held.
                        </div>
                    </div>

                    <div class="grg__warn">
                        <i class="bi bi-exclamation-triangle-fill"></i>
                        <span>
                            This hands out privileges. Everyone in
                            <strong>{{ title }}</strong> gains everything the selected groups can do,
                            immediately.
                        </span>
                    </div>
                }
            </div>

            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn cms-btn-sm" (click)="close()">Cancel</button>
                @if (!loading()) {
                    <button type="button"
                            class="cms-btn cms-btn-primary cms-btn-sm"
                            [disabled]="saving()"
                            (click)="save()">
                        {{ saving() ? 'Saving…' : 'Save' }}
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        .grg { width: 520px; max-width: 94vw; }
        .grg__body { display: flex; flex-direction: column; gap: 14px; }

        .grg__lead { margin: 0; font-size: .8125rem; color: var(--cms-text-secondary); }
        .grg__lead code {
            padding: 0 4px;
            border-radius: 2px;
            background: var(--cms-border-light, rgba(0,0,0,.05));
        }

        .grg__warn {
            display: flex;
            gap: 6px;
            font-size: .75rem;
            color: var(--cms-warning-text, var(--cms-text-muted));
        }
        .grg__warn i { color: var(--cms-warning, #d97706); flex: none; margin-top: 1px; }
    `],
})
export class GroupRoleGrantsDialogComponent implements OnInit {
    protected readonly data = inject<GroupRoleGrantsDialogData>(DIALOG_DATA);
    private readonly ref = inject<DialogRef<boolean | null>>(DialogRef);
    private readonly api = inject(ApiService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    protected readonly groupsApiUrl = '/api/v1/options/identity.groups';

    protected readonly loading = signal(true);
    protected readonly saving = signal(false);
    protected readonly granted = signal<readonly string[]>([]);

    protected get title(): string {
        return this.data.label ?? this.data.name;
    }

    ngOnInit(): void {
        // The LIST omits `grantsGroupIds`, so the editor re-reads the ITEM
        // rather than trusting the row it was opened from — `undefined` there
        // means "not loaded", and treating it as "grants nothing" would let a
        // Save silently clear every edge.
        this.api.getGroup(this.data.id).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: group => {
                this.granted.set(group.grantsGroupIds ?? []);
                this.loading.set(false);
            },
            error: () => {
                this.toast.error('Failed to load role grants');
                this.loading.set(false);
            },
        });
    }

    protected save(): void {
        this.saving.set(true);
        this.api.setGroupRoleGrants(this.data.id, this.granted()).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.toast.success('Role grants saved', this.title);
                this.ref.close(true);
            },
            // Surface the SERVER's reason. The refusals here are specific — "that
            // would let X grant its own role", "a group cannot grant its own
            // role" — and a generic "Save failed" would hide the one sentence
            // that tells the operator what to change.
            error: err => {
                this.saving.set(false);
                this.toast.error('Could not save role grants', this.errors.humanize(err));
            },
        });
    }

    protected close(): void {
        this.ref.close(null);
    }
}
