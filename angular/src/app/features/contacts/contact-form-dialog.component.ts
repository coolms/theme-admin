import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    inject,
    signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalComponent, TagInputComponent } from '@coolms/ui-angular';
import { ErrorHandlerService } from '@coolms/core-angular';
import {
    type ContactDto,
    type ContactValueEntry,
    type ContactVisibility,
    type ContactWritePayload,
    ContactsService,
} from './contacts.service';

/** Passed via CDK DIALOG_DATA. Absent (create) vs `{contact}` (edit). */
export interface ContactFormDialogData {
    readonly contact?: ContactDto;
}

/**
 * C.3 (ADR-143) — the create/edit Contact modal. One component, both modes
 * (branch on DIALOG_DATA, mirroring `UserEditDialogComponent`). Style-1
 * `app-modal` + `.cms-*` controls + `app-tag-input` for the repeatable emails /
 * phones (a `string[]` in the UI; mapped to `[{value, primary}]` on save, first =
 * primary). Closes with the saved `ContactDto` (or null on cancel); the list page
 * re-loads on a non-null close.
 */
@Component({
    selector: 'app-contact-form-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule, TagInputComponent],
    template: `
        <app-modal [title]="isEdit ? 'Edit Contact' : 'New Contact'">
            <div class="fields">
                <div>
                    <label class="cms-label">Name</label>
                    <input class="cms-input" type="text"
                           [(ngModel)]="displayName"
                           placeholder="Ada Lovelace"
                           autofocus />
                </div>

                <div>
                    <label class="cms-label">Visibility</label>
                    <select class="cms-select" [(ngModel)]="visibility">
                        <option value="personal">Personal — only you</option>
                        <option value="shared">Shared — company directory</option>
                    </select>
                    <div class="cms-field-hint">
                        Shared contacts are visible to everyone; only administrators can create or edit them.
                    </div>
                </div>

                <div>
                    <label class="cms-label">Organization</label>
                    <input class="cms-input" type="text"
                           [(ngModel)]="organization"
                           placeholder="Acme Inc." />
                </div>

                <div>
                    <label class="cms-label">Job title</label>
                    <input class="cms-input" type="text"
                           [(ngModel)]="jobTitle"
                           placeholder="Senior Engineer" />
                </div>

                <div>
                    <label class="cms-label">Emails</label>
                    <app-tag-input [(ngModel)]="emails" placeholder="name@example.com — press Enter" />
                    <div class="cms-field-hint">The first email is treated as the primary.</div>
                </div>

                <div>
                    <label class="cms-label">Phones</label>
                    <app-tag-input [(ngModel)]="phones" placeholder="+1 555 0100 — press Enter" />
                </div>

                @if (error()) {
                    <p class="error">{{ error() }}</p>
                }
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="submitting()"
                        (click)="submit()">
                    {{ submitting() ? 'Saving…' : (isEdit ? 'Save' : 'Create') }}
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .fields { display: flex; flex-direction: column; gap: 14px; }
        .error { color: var(--cms-danger, #dc2626); margin: 0; font-size: .8125rem; }
    `],
})
export class ContactFormDialogComponent implements OnInit {
    private readonly api        = inject(ContactsService);
    private readonly errors     = inject(ErrorHandlerService);
    readonly dialogRef          = inject<DialogRef<ContactDto | null>>(DialogRef);
    private readonly data        = inject<ContactFormDialogData | null>(DIALOG_DATA, { optional: true });
    private readonly destroyRef = inject(DestroyRef);

    readonly isEdit = !!this.data?.contact;

    displayName  = '';
    visibility: ContactVisibility = 'personal';
    organization = '';
    jobTitle     = '';
    emails: string[] = [];
    phones: string[] = [];

    readonly submitting = signal(false);
    readonly error      = signal<string | null>(null);

    ngOnInit(): void {
        const c = this.data?.contact;
        if (!c) return;
        this.displayName  = c.displayName ?? '';
        this.visibility   = c.visibility ?? 'personal';
        this.organization = c.organization ?? '';
        this.jobTitle     = c.jobTitle ?? '';
        this.emails       = this.valuesOf(c.emails);
        this.phones       = this.valuesOf(c.phones);
    }

    cancel(): void {
        this.dialogRef.close(null);
    }

    submit(): void {
        if (this.displayName.trim() === '') {
            this.error.set('Name is required.');
            return;
        }
        this.submitting.set(true);
        this.error.set(null);

        const payload: ContactWritePayload = {
            displayName:  this.displayName.trim(),
            visibility:   this.visibility,
            organization: this.organization.trim() || null,
            jobTitle:     this.jobTitle.trim() || null,
            emails:       this.toEntries(this.emails),
            phones:       this.toEntries(this.phones),
        };

        const editId = this.isEdit ? this.data?.contact?.id : undefined;
        const call = editId !== undefined && editId !== ''
            ? this.api.update(editId, payload)
            : this.api.create(payload);

        call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next:  dto => { this.submitting.set(false); this.dialogRef.close(dto); },
            error: (e: unknown) => { this.submitting.set(false); this.error.set(this.errors.humanize(e)); },
        });
    }

    /** Extract the plain string values from `[{value, ...}]` entries for the tag inputs. */
    private valuesOf(entries: ReadonlyArray<ContactValueEntry> | undefined): string[] {
        return (entries ?? [])
            .map(e => e.value)
            .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    }

    /** Map the tag-input `string[]` back to `[{value, primary}]`; first = primary. */
    private toEntries(values: string[]): ReadonlyArray<ContactValueEntry> {
        return values.map((value, i) => ({ value, primary: i === 0 }));
    }
}
