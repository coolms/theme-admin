import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
    signal,
    ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DateTimeFormatService, DynamicFormComponent, ToastService } from '@coolms/ui-angular';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { forkJoin } from 'rxjs';
import { ApiService, CreateUserDto, IdentityUserDto } from '../../api/api.service';
import { AppConfigState, CmsLoaderComponent, ErrorHandlerService } from '@coolms/core-angular';

interface UserEditDialogData {
    readonly userId?:       string;
    readonly triggerIcon?:  string;
    readonly triggerLabel?: string;
}

@Component({
    selector: 'app-user-edit-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, DynamicFormComponent],
    template: `
        <div class="cms-dialog ued-dialog">
            <div class="cms-dialog-header">
                <span>
                    <i class="bi bi-{{ triggerIcon }} me-1"></i>
                    {{ triggerLabel }}
                    @if (user()) {
                        <span class="text-muted fw-normal"> &mdash; {{ user()!.fullName || user()!.identifier }}</span>
                    }
                </span>
                <button class="cms-dialog-close" (click)="close()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            @if (loadingUser()) {
                <div class="ued-loading-user">
                    <cms-loader [inline]="true" />
                </div>
            } @else {
                <div class="cms-dialog-body ued-body">
                    <app-dynamic-form
                        #dynamicForm
                        [formId]="formId"
                        [context]="isCreateMode ? 'create' : 'edit'"
                        [initialValue]="isCreateMode ? createInitialValue : editInitialValue()"
                        [submitLabel]="isCreateMode ? 'Create' : 'Save'"
                        (submitted)="onSubmit($event)"
                        (cancelled)="close()" />
                </div>
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .ued-dialog { width: 520px; max-height: 90vh; display: flex; flex-direction: column; }
        .ued-loading-user { display: flex; justify-content: center; align-items: center; padding: 60px; }
        .ued-body { overflow-y: auto; flex: 1; padding: 20px; }
    `],
})
export class UserEditDialogComponent implements OnInit {
    @ViewChild('dynamicForm') dynamicForm!: DynamicFormComponent;

    private readonly dialogRef  = inject(DialogRef);
    private readonly dialogData = inject(DIALOG_DATA) as UserEditDialogData;
    private readonly api        = inject(ApiService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly store      = inject(Store);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dtf        = inject(DateTimeFormatService);

    readonly isCreateMode = !this.dialogData.userId;

    readonly triggerIcon  = this.dialogData.triggerIcon  ?? (this.isCreateMode ? 'person-plus-fill' : 'person-fill');
    readonly triggerLabel = this.dialogData.triggerLabel ?? (this.isCreateMode ? 'New User'         : 'Edit User');

    readonly user        = signal<IdentityUserDto | null>(null);
    readonly loadingUser = signal(true);
    readonly saving      = signal(false);

    readonly formId = this.store.selectSnapshot(AppConfigState.manifest)
        ?.auth?.userFormId ?? 'identity:user';

    readonly createInitialValue = {
        identifier: '',
        password:   '',
        firstName:  '',
        lastName:   '',
        isActive:   true,
    };

    readonly editInitialValue = computed(() => {
        const u = this.user();
        if (!u) return {};
        return {
            identifiersDisplay: u.identifiers
                .map(i => `${i.type}: ${i.value}${i.isPrimary ? ' (primary)' : ''}`)
                .join(', '),
            firstName:        u.firstName ?? '',
            lastName:         u.lastName  ?? '',
            rolesDisplay:     u.roles.join(', '),
            isActive:         u.isActive,
            lastLoginDisplay: u.lastLoginAt
                ? this.dtf.dateTime(u.lastLoginAt)
                : 'Never',
            createdAtDisplay: u.createdAt
                ? this.dtf.date(u.createdAt)
                : '',
            groups:           u.groups.map(g => g.id),
        };
    });

    ngOnInit(): void {
        if (this.isCreateMode) {
            this.loadingUser.set(false);
            return;
        }

        this.api.getUser(this.dialogData.userId!)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: fullUser => {
                    this.user.set(fullUser);
                    this.loadingUser.set(false);
                },
                error: () => {
                    this.loadingUser.set(false);
                    this.toast.error('Failed to load user');
                },
            });
    }

    onSubmit(value: Record<string, unknown>): void {
        if (this.isCreateMode) {
            this.onCreateSubmit(value);
        } else {
            this.onEditSubmit(value);
        }
    }

    private onCreateSubmit(value: Record<string, unknown>): void {
        this.saving.set(true);
        const dto: CreateUserDto = {
            identifier: ((value['identifier'] as string) ?? '').trim(),
            password:   (value['password']  as string) ?? '',
            firstName:  (value['firstName'] as string) || null,
            lastName:   (value['lastName']  as string) || null,
            isActive:   (value['isActive']  as boolean) ?? true,
        };

        this.api.createUser(dto).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: created => {
                this.toast.success(`User "${created.identifier}" created`);
                this.dialogRef.close(true);
            },
            error: err => {
                this.saving.set(false);
                this.dynamicForm.setServerError(this.errors.humanize(err));
            },
        });
    }

    private onEditSubmit(value: Record<string, unknown>): void {
        const u = this.user();
        if (!u) return;
        this.saving.set(true);

        const nextFirstName = (value['firstName'] as string | null | undefined) ?? '';
        const nextLastName  = (value['lastName']  as string | null | undefined) ?? '';
        const nextIsActive  = value['isActive'] as boolean;
        const submittedGroupIds = (value['groups'] as string[] | undefined) ?? [];

        const profileChanged =
            nextFirstName !== (u.firstName ?? '') ||
            nextLastName  !== (u.lastName  ?? '');
        const activeChanged  = nextIsActive !== u.isActive;
        const groupsChanged  = this.groupsListChangedFromValue(u, submittedGroupIds);

        const ops: Array<ReturnType<typeof this.api.updateUser | typeof this.api.assignUserGroups>> = [];

        if (profileChanged || activeChanged) {
            ops.push(this.api.updateUser(u.id, {
                firstName: nextFirstName || null,
                lastName:  nextLastName  || null,
                isActive:  nextIsActive,
            }));
        }

        if (groupsChanged) {
            ops.push(this.api.assignUserGroups(u.id, submittedGroupIds));
        }

        if (ops.length === 0) {
            this.dialogRef.close(true);
            return;
        }

        forkJoin(ops).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.toast.success('User updated');
                this.dialogRef.close(true);
            },
            error: err => {
                this.saving.set(false);
                this.dynamicForm.setServerError(this.errors.humanize(err));
            },
        });
    }

    close(): void { this.dialogRef.close(null); }

    private groupsListChangedFromValue(u: IdentityUserDto, submitted: string[]): boolean {
        const original = new Set(u.groups.map(g => g.id));
        if (original.size !== submitted.length) return true;
        for (const id of submitted) {
            if (!original.has(id)) return true;
        }
        return false;
    }
}
