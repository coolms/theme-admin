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
import { ErrorHandlerService } from '@coolms/core-angular';
import { ModalComponent } from '@coolms/ui-angular';
import { PersonalizationRulesService } from './personalization-rules.service';
import { PersonalizationRuleDto } from './personalization-rules.types';

export interface RuleEditorDialogData {
    /** When present the dialog edits this rule (PATCH); otherwise it creates (POST). */
    readonly rule?: PersonalizationRuleDto;
}

/**
 * Track E Phase 4 (CDP personalization, P4.admin.c) — create / edit modal for a
 * content-personalization rule.
 *
 * A plain platform modal (`app-modal` + `cms-btn`/`cms-btn-primary`), simpler than
 * the Segment editor — the three fields are low-cardinality tokens, not an EL rule,
 * so there is no live "validate" step. Closes with the saved {@link
 * PersonalizationRuleDto} on success, `null` on cancel.
 */
@Component({
    selector: 'app-rule-editor-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule],
    template: `
        <app-modal [title]="isEdit ? 'Edit rule' : 'New rule'" [width]="560">
            <div class="fields">
                <div>
                    <label class="cms-label">Segment</label>
                    <input class="cms-input" type="text" [(ngModel)]="segment"
                           placeholder="enterprise" autofocus />
                    <div class="cms-field-hint">
                        The CDP segment key this rule targets (the membership token on subjects).
                    </div>
                </div>

                <div>
                    <label class="cms-label">Slot</label>
                    <input class="cms-input" type="text" [(ngModel)]="slot"
                           placeholder="hero-cta" />
                    <div class="cms-field-hint">
                        Theme placeholder id — a <code>data-perso-slot</code> on the rendered page.
                    </div>
                </div>

                <div>
                    <label class="cms-label">Variant</label>
                    <input class="cms-input" type="text" [(ngModel)]="variant"
                           placeholder="enterprise-cta" />
                    <div class="cms-field-hint">
                        Treatment applied to the slot as <code>data-perso-variant</code>.
                    </div>
                </div>

                <div>
                    <label class="cms-label">Order</label>
                    <input class="cms-input" type="number" [(ngModel)]="sortOrder"
                           placeholder="0" />
                    <div class="cms-field-hint">
                        Lower runs first — the client applies the first matching rule per slot.
                    </div>
                </div>

                <label class="cms-check">
                    <input type="checkbox" [(ngModel)]="enabled" />
                    <span>Enabled — published to the page and applied for matching visitors</span>
                </label>

                @if (error()) {
                    <p class="error">{{ error() }}</p>
                }
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="saving()"
                        (click)="save()">
                    {{ saving() ? 'Saving…' : (isEdit ? 'Save' : 'Create') }}
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .fields { display: flex; flex-direction: column; gap: 14px; }
        .error { color: var(--cms-danger-text, #991b1b); margin: 0; font-size: .8125rem; }
        .cms-check { display: flex; align-items: center; gap: 8px; font-size: .875rem; cursor: pointer; }
        code { word-break: break-all; }
    `],
})
export class RuleEditorDialogComponent implements OnInit {
    private readonly api        = inject(PersonalizationRulesService);
    private readonly errors     = inject(ErrorHandlerService);
    readonly dialogRef          = inject<DialogRef<PersonalizationRuleDto | null>>(DialogRef);
    private readonly destroyRef = inject(DestroyRef);
    private readonly data       = inject<RuleEditorDialogData | null>(DIALOG_DATA, { optional: true });

    readonly isEdit = this.data?.rule != null;

    segment   = '';
    slot      = '';
    variant   = '';
    enabled   = true;
    sortOrder = 0;

    readonly saving = signal(false);
    readonly error  = signal<string | null>(null);

    ngOnInit(): void {
        const r = this.data?.rule;
        if (!r) {
            return;
        }
        this.segment   = r.segment;
        this.slot      = r.slot;
        this.variant   = r.variant;
        this.enabled   = r.enabled;
        this.sortOrder = r.sortOrder;
    }

    cancel(): void {
        this.dialogRef.close(null);
    }

    save(): void {
        if (this.saving()) {
            return;
        }
        const segment = this.segment.trim();
        const slot    = this.slot.trim();
        const variant = this.variant.trim();
        if (segment === '' || slot === '' || variant === '') {
            this.error.set('Segment, slot and variant are all required.');
            return;
        }
        this.error.set(null);
        this.saving.set(true);

        const dto = {
            segment,
            slot,
            variant,
            enabled: this.enabled,
            sortOrder: Number(this.sortOrder) || 0,
        };

        const request$ = this.isEdit
            ? this.api.updateRule(this.data!.rule!.id, dto)
            : this.api.createRule(dto);

        request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: saved => {
                this.saving.set(false);
                this.dialogRef.close(saved);
            },
            error: (e: unknown) => {
                this.saving.set(false);
                this.error.set(this.errors.humanize(e));
            },
        });
    }
}
