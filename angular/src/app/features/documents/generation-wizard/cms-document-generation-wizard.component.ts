import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { CmsWizardComponent, CmsWizardStepDirective, ToastService, type WizardStepConfig } from '@coolms/ui-angular';
import { type DocumentTemplate } from '../shared/document-explorer.types';
import {
    ApiService,
    type CreateDocumentGenerationPayload,
} from '../../../api/api.service';
import { WizardDraftService } from './wizard-draft.service';
import {
    CmsWizardModeStepComponent,
    USER_ENTITY_FQCN,
    type WizardMode,
} from './steps/mode-step.component';
import { CmsWizardRecipientsStepComponent } from './steps/recipients-step.component';
import { CmsWizardAudienceStepComponent } from './steps/audience-step.component';
import { CmsWizardOutputStepComponent } from './steps/output-step.component';
import { CmsWizardReviewStepComponent } from './steps/review-step.component';

/** Data the CDK dialog opener passes through `DIALOG_DATA`. */
export interface CmsDocumentGenerationWizardData {
    readonly template: DocumentTemplate;
}

/** Closed-result payload. Populated on successful submit. */
export interface CmsDocumentGenerationWizardResult {
    readonly generationId: string;
}

/**
 * Document-generation wizard.
 *
 * Hosts five step components -- Mode, Recipients (Filter mode only),
 * Audience, Output, Review -- around the `CmsWizardComponent`
 * primitive. State lives in this shell as signals; each step reads
 * and writes through two-way `model()` bindings. Submit posts to
 * `apiService.createDocumentGeneration`, then closes the dialog with
 * the new generation id.
 *
 * Adaptive flow: Single mode skips the Recipients step (4 steps);
 * Filter mode includes it (5 steps).
 */
@Component({
    selector: 'cms-document-generation-wizard',
    standalone: true,
    imports: [
    CmsWizardComponent,
    CmsWizardStepDirective,
    CmsWizardModeStepComponent,
    CmsWizardRecipientsStepComponent,
    CmsWizardAudienceStepComponent,
    CmsWizardOutputStepComponent,
    CmsWizardReviewStepComponent
],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="cms-doc-wizard">
            <header class="cms-doc-wizard__head">
                <h2 class="cms-doc-wizard__title">Generate document</h2>
                <p class="cms-doc-wizard__sub">Template <code>{{ template.name }}</code></p>
            </header>

            <cms-wizard
                [steps]="steps()"
                [currentStepId]="currentStepId()"
                ariaLabel="Document generation wizard"
                (stepChange)="onStepChange($event)"
                (cancelled)="onCancel()"
                (completed)="onSubmit()"
            >
                <ng-container *cmsWizardStep="'mode'">
                    <cms-wizard-mode-step
                        [variables]="schemaVariables()"
                        [(mode)]="mode" />
                </ng-container>

                <ng-container *cmsWizardStep="'recipients'">
                    <cms-wizard-recipients-step
                        [(rql)]="recipientsRql"
                        [(count)]="recipientsCount" />
                </ng-container>

                <ng-container *cmsWizardStep="'audience'">
                    <cms-wizard-audience-step
                        [variables]="schemaVariables()"
                        [mode]="mode()"
                        [(audience)]="audience"
                        [(plainVariables)]="plainVariables" />
                </ng-container>

                <ng-container *cmsWizardStep="'output'">
                    <cms-wizard-output-step
                        [variables]="schemaVariables()"
                        [(basePath)]="outputBasePath"
                        [(filenamePattern)]="filenamePattern" />
                </ng-container>

                <ng-container *cmsWizardStep="'review'">
                    <cms-wizard-review-step
                        [template]="template"
                        [mode]="mode()"
                        [outputFormat]="outputFormat()"
                        [recipientsRql]="recipientsRql()"
                        [recipientsCount]="recipientsCount()"
                        [audience]="audience()"
                        [plainVariables]="plainVariables()"
                        [outputBasePath]="outputBasePath()"
                        [filenamePattern]="filenamePattern()" />
                    @if (submitError()) {
                        <p class="cms-doc-wizard__error">{{ submitError() }}</p>
                    }
                </ng-container>
            </cms-wizard>
        </div>
    `,
    styles: [
        `
            :host {
                display: block;
                width: 720px;
                max-width: 95vw;
                max-height: 90vh;
                background: var(--cms-surface);
                color: var(--cms-text);
                border-radius: 6px;
                box-shadow: 0 12px 36px rgba(0, 0, 0, .25);
                overflow: hidden;
            }
            .cms-doc-wizard {
                display: flex;
                flex-direction: column;
                height: 100%;
                max-height: 90vh;
            }
            .cms-doc-wizard__head {
                padding: 1rem 1.25rem;
                border-bottom: 1px solid var(--cms-border);
                background: var(--cms-bg);
            }
            .cms-doc-wizard__title {
                margin: 0;
                font-size: 1.05rem;
            }
            .cms-doc-wizard__sub {
                margin: .25rem 0 0;
                color: var(--cms-text-secondary);
                font-size: .85rem;
            }
            .cms-doc-wizard__error {
                margin: 1rem 0 0;
                color: var(--cms-danger);
                font-size: .9rem;
            }
        `,
    ],
})
export class CmsDocumentGenerationWizardComponent implements OnInit {
    private readonly draft = inject(WizardDraftService);
    private readonly api = inject(ApiService);
    private readonly toast = inject(ToastService);

    private readonly dialogData = inject<CmsDocumentGenerationWizardData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<CmsDocumentGenerationWizardResult | null>>(DialogRef);

    protected readonly template = this.dialogData.template;

    protected readonly schemaVariables = computed(() =>
        this.template.contextSchema?.variables ?? [],
    );

    // ─── Wizard state ──────────────────────────────────────────────────
    protected readonly currentStepId = signal<string>('mode');
    protected readonly mode = signal<WizardMode>('single');

    // Filter-mode-only signals.
    protected readonly recipientsRql = signal<string>('');
    protected readonly recipientsCount = signal<number | null>(null);

    protected readonly audience = signal<Record<string, string>>({});
    protected readonly plainVariables = signal<Record<string, unknown>>({});
    protected readonly outputBasePath = signal<string>('');
    protected readonly filenamePattern = signal<string>('');

    /**
     * Output format defaults to the template's preferred output.
     *
     * Passed through as the template declares it (#1777). This used to coerce
     * anything that was not `pdf` into `docx`, which was invisible while Word
     * was the only format and actively wrong once a second one existed: a
     * spreadsheet template declares `xlsx`, the wizard would have asked for
     * `docx`, and no renderer supports that pairing — the generation failed
     * with nothing on screen to explain it.
     */
    protected readonly outputFormat = computed<string>(() => {
        const fmt = this.template.defaultOutputFormat;
        return 'string' === typeof fmt && '' !== fmt ? fmt : 'docx';
    });

    protected readonly submitting = signal<boolean>(false);
    protected readonly submitError = signal<string | null>(null);

    /**
     * Adaptive step list. Recipients is hidden in Single mode so the
     * wizard primitive skips it in nav. Step gating reflects each
     * step's completion contract.
     */
    protected readonly steps = computed<readonly WizardStepConfig[]>(() => {
        const isFilter = this.mode() === 'filter';
        return [
            { id: 'mode',       label: 'Mode',       canProceed: () => true },
            {
                id: 'recipients',
                label: 'Recipients',
                hidden: !isFilter,
                canProceed: () => {
                    // An empty RQL used to pass here, commented as "backend
                    // generates for all users". It does not (#1757):
                    // `FilterAudienceMaterializer` throws
                    // "Filter-mode audience criteria must contain a non-empty
                    // `rql` query string". So the wizard walked the operator to
                    // Review and let them submit a run that could only fail —
                    // which is what the FAILED / total-0 rows in the
                    // generations list are.
                    if ('' === this.recipientsRql()) {
                        return false;
                    }
                    const count = this.recipientsCount();

                    return null !== count && count > 0;
                },
            },
            { id: 'audience', label: 'Audience',  canProceed: () => true },
            {
                id: 'output',
                label: 'Output',
                canProceed: () =>
                    this.outputBasePath().trim() !== '' && this.filenamePattern().trim() !== '',
            },
            { id: 'review', label: 'Review', canProceed: () => !this.submitting() },
        ];
    });

    constructor() {
        // Persist a draft on any state mutation. Reading every signal
        // inside the effect lets Angular track them all.
        effect(() => {
            const payload = {
                currentStepId: this.currentStepId(),
                mode: this.mode(),
                recipientsRql: this.recipientsRql(),
                recipientsCount: this.recipientsCount(),
                audience: this.audience(),
                plainVariables: this.plainVariables(),
                outputBasePath: this.outputBasePath(),
                filenamePattern: this.filenamePattern(),
            };
            this.draft.save(this.template.id, payload);
        });

        // Seed a sensible default output base path when none is set.
        // Filter mode with a `@user` schema variable goes to personal
        // inbox; everything else lands in the shared folder.
        effect(() => {
            if (this.outputBasePath() !== '') {
                return;
            }
            const isFilter = this.mode() === 'filter';
            const hasUser = this.schemaVariables().some((v) => v.path === '@user');
            this.outputBasePath.set(
                isFilter && hasUser ? '/home/{var:@user.id}/docs/inbox/' : '/docs/',
            );
        }, { allowSignalWrites: true });

        // Seed a sensible filename pattern when blank.
        effect(() => {
            if (this.filenamePattern() !== '') {
                return;
            }
            const slug = '{const:templateSlug}';
            // The template's own format, so the suggested filename ends in the
            // extension the artifact will actually have.
            const ext = '.' + this.outputFormat();
            const hasUser = this.schemaVariables().some((v) => v.path === '@user');
            if (this.mode() === 'filter' && hasUser) {
                this.filenamePattern.set(slug + '-{var:@user.id}' + ext);
            } else {
                this.filenamePattern.set(slug + '-{const:batchId}' + ext);
            }
        }, { allowSignalWrites: true });
    }

    ngOnInit(): void {
        this.draft.maybeRestore(this.template.id, (d) => {
            this.currentStepId.set(d.currentStepId);
            this.mode.set(d.mode ?? 'single');
            this.recipientsRql.set(d.recipientsRql);
            this.recipientsCount.set(d.recipientsCount);
            this.audience.set(d.audience);
            this.plainVariables.set(d.plainVariables);
            this.outputBasePath.set(d.outputBasePath);
            this.filenamePattern.set(d.filenamePattern);
        });
    }

    onStepChange(id: string): void {
        this.currentStepId.set(id);
    }

    onCancel(): void {
        this.draft.clear(this.template.id);
        this.dialogRef.close(null);
    }

    async onSubmit(): Promise<void> {
        if (this.submitting()) {
            return;
        }
        this.submitting.set(true);
        this.submitError.set(null);
        try {
            const payload = this.buildPayload();
            const generation = await firstValueFrom(this.api.createDocumentGeneration(payload));
            this.toast.success('Document generation started (id: ' + generation.id + ')');
            this.draft.clear(this.template.id);
            this.dialogRef.close({ generationId: generation.id });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'unknown error';
            this.submitError.set('Generation failed: ' + message);
            this.toast.error('Generation failed: ' + message);
            this.submitting.set(false);
        }
    }

    private buildPayload(): CreateDocumentGenerationPayload {
        const mode = this.mode();
        const audienceCriteria: Record<string, unknown> = { ...this.audience() };
        if (mode === 'filter') {
            // `rql` + `entityType` are the keys `FilterAudienceMaterializer`
            // actually reads. This used to send the filter under `rqlFilter`
            // and omit `entityType` entirely (#1670), so EVERY Filter-mode
            // generation died on "Filter-mode audience criteria must contain
            // a non-empty `entityType`" — the mode had never completed once.
            // Only the preview call worked, which is why the wizard looked
            // healthy right up to Submit.
            audienceCriteria['rql'] = this.recipientsRql();
            audienceCriteria['entityType'] = USER_ENTITY_FQCN;
        }

        return {
            templateId:       this.template.id,
            outputFormat:     this.outputFormat(),
            mode,
            audienceCriteria,
            plainVariables:   this.plainVariables(),
            outputBasePath:   this.outputBasePath(),
            filenamePattern:  this.filenamePattern(),
        };
    }
}
