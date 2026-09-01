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
import { ApiService } from '../../api/api.service';
import { CdpService } from './cdp.service';
import { SegmentDto, SegmentRuleCheckDto } from './cdp.types';

/** A pickable deployed workflow definition for the activation-journey dropdown. */
interface WorkflowChoice {
    readonly key: string;
    readonly name: string;
}

export interface SegmentEditorDialogData {
    /** When present the dialog edits this segment (PATCH); otherwise it creates (POST). */
    readonly segment?: SegmentDto;
}

/**
 *Phase 3 (CDP core, ; datagrid retrofit) — create / edit modal for
 * an audience Segment.
 *
 * A specialized modal (mirrors {@link
 * ../connector/webhook-form-dialog.component.WebhookFormDialogComponent}), NOT a
 * FormConfig form: the EL `rule` carries a bespoke live "Validate rule" action
 * (POSTs to `/analytics/segments/validate`, the same lint the save path
 * enforces) that the generic form pipeline can't host — the same specialized-
 * modal precedent as Newsletter Compose. Still platform-styled (`app-modal` +
 * `cms-btn`/`cms-btn-primary`), so it reads as a sibling of the other dialogs.
 *
 * Closes with the saved {@link SegmentDto} on success; closes with `null` on
 * cancel. The `key` is immutable once created (it is the membership token stored
 * on subjects).
 */
@Component({
    selector: 'app-segment-editor-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule],
    template: `
        <app-modal [title]="isEdit ? 'Edit segment' : 'New segment'" [width]="560">
            <div class="fields">
                <div>
                    <label class="cms-label">Name</label>
                    <input class="cms-input" type="text" [(ngModel)]="name"
                           placeholder="Engaged visitors" autofocus />
                </div>

                <div>
                    <label class="cms-label">Key</label>
                    <input class="cms-input" type="text" [(ngModel)]="key"
                           [disabled]="isEdit"
                           placeholder="engaged-visitors" />
                    <div class="cms-field-hint">
                        {{ isEdit
                            ? 'The key is immutable — it is the membership token stored on subjects.'
                            : 'Lowercase kebab slug (a-z, 0-9, hyphen). Durable membership token.' }}
                    </div>
                </div>

                <div>
                    <label class="cms-label">Rule</label>
                    <textarea class="cms-input" rows="4" [(ngModel)]="rule"
                              (ngModelChange)="onRuleChange()"
                              placeholder="eventCount('pageview') >= 3 and subject['known']"></textarea>
                    <div class="cms-field-hint">
                        Boolean Expression-Language over <code>subject</code>. Sugar:
                        <code>eventCount('type')</code>, <code>attr('name')</code>, <code>daysSinceSeen()</code>.
                    </div>
                </div>

                <div class="validate-row">
                    <button type="button" class="cms-btn"
                            [disabled]="validating() || !rule.trim()"
                            (click)="validate()">
                        <i class="bi bi-check2-circle"></i>
                        {{ validating() ? 'Validating…' : 'Validate rule' }}
                    </button>
                    @if (check(); as c) {
                        @if (c.valid) {
                            <span class="ok"><i class="bi bi-check-circle-fill"></i> Rule is valid</span>
                        } @else {
                            <span class="bad"><i class="bi bi-x-circle-fill"></i> {{ c.message }}</span>
                        }
                    }
                </div>

                <label class="cms-check">
                    <input type="checkbox" [(ngModel)]="enabled" />
                    <span>Enabled — evaluated on the next membership recompute</span>
                </label>

                <div>
                    <label class="cms-label">Activation journey <em>(optional)</em></label>
                    <select class="cms-input" [(ngModel)]="activationWorkflow">
                        <option value="">— None (passive membership) —</option>
                        @for (w of workflows(); track w.key) {
                            <option [value]="w.key">{{ w.name }}</option>
                        }
                    </select>
                    <div class="cms-field-hint">
                        Start this workflow for a subject the moment they ENTER the segment.
                        Only deployed workflows are listed.
                    </div>
                </div>

                <div>
                    <label class="cms-label">Description <em>(optional)</em></label>
                    <textarea class="cms-input" rows="2" [(ngModel)]="description"
                              placeholder="What this audience captures and why."></textarea>
                </div>

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
        .cms-label em { color: var(--cms-text-muted, #848b96); font-weight: 400; }
        .cms-check { display: flex; align-items: center; gap: 8px; font-size: .875rem; cursor: pointer; }
        textarea.cms-input { resize: vertical; font-family: var(--cms-font-mono, monospace); }
        .validate-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .validate-row .ok  { color: var(--cms-success, #16a34a); font-size: .8125rem; }
        .validate-row .bad { color: var(--cms-danger, #dc2626); font-size: .8125rem; }
        code { word-break: break-all; }
    `],
})
export class SegmentEditorDialogComponent implements OnInit {
    private readonly api        = inject(CdpService);
    private readonly definitions = inject(ApiService);
    private readonly errors     = inject(ErrorHandlerService);
    readonly dialogRef          = inject<DialogRef<SegmentDto | null>>(DialogRef);
    private readonly destroyRef = inject(DestroyRef);
    private readonly data       = inject<SegmentEditorDialogData | null>(DIALOG_DATA, { optional: true });

    readonly isEdit = this.data?.segment != null;

    name               = '';
    key                = '';
    rule               = '';
    enabled            = true;
    description        = '';
    activationWorkflow = '';

    readonly saving     = signal(false);
    readonly validating = signal(false);
    readonly check      = signal<SegmentRuleCheckDto | null>(null);
    readonly error      = signal<string | null>(null);
    /** Deployed workflows for the activation-journey dropdown. */
    readonly workflows  = signal<WorkflowChoice[]>([]);

    ngOnInit(): void {
        const s = this.data?.segment;
        if (s) {
            this.name               = s.name;
            this.key                = s.key;
            this.rule               = s.rule;
            this.enabled            = s.enabled;
            this.description        = s.description ?? '';
            this.activationWorkflow = s.activationWorkflow ?? '';
        }
        this.loadWorkflows();
    }

    /**
     * Populate the activation-journey dropdown with DEPLOYED workflow definitions
     * (a workflow with no live version can't be started). Best-effort — a fetch
     * failure just leaves the dropdown with "None". If the segment already names
     * a workflow that isn't in the deployed set (undeployed since, or set via the
     * API), it is preserved as its own option so saving doesn't silently drop it.
     */
    private loadWorkflows(): void {
        this.definitions.listDefinitions({ itemsPerPage: 200 }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => {
                const choices: WorkflowChoice[] = result.items
                    .filter(r => r.module === 'workflow' && r.latestVersion != null && !!r.definitionKey)
                    .map(r => ({ key: r.definitionKey as string, name: r.displayName || (r.definitionKey as string) }))
                    .sort((a, b) => a.name.localeCompare(b.name));

                const current = this.activationWorkflow;
                if (current && !choices.some(c => c.key === current)) {
                    choices.unshift({ key: current, name: `${current} (not deployed)` });
                }
                this.workflows.set(choices);
            },
            error: () => { /* best-effort — dropdown stays "None"-only */ },
        });
    }

    /** A rule edit invalidates the last validate verdict. */
    onRuleChange(): void {
        this.check.set(null);
    }

    validate(): void {
        const rule = this.rule.trim();
        if (!rule) {
            return;
        }
        this.validating.set(true);
        this.api.validateRule(rule).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => { this.check.set(result); this.validating.set(false); },
            error: () => {
                this.validating.set(false);
                this.error.set('Could not validate the rule.');
            },
        });
    }

    cancel(): void {
        this.dialogRef.close(null);
    }

    save(): void {
        if (this.saving()) {
            return;
        }
        const name = this.name.trim();
        if (name === '') {
            this.error.set('Name is required.');
            return;
        }
        this.error.set(null);
        this.saving.set(true);

        const dto = {
            name,
            rule: this.rule,
            enabled: this.enabled,
            description: this.description.trim() || null,
            activationWorkflow: this.activationWorkflow || null,
        };

        const request$ = this.isEdit
            ? this.api.updateSegment(this.data!.segment!.key, dto)
            : this.api.createSegment({ ...dto, key: this.key.trim() });

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
