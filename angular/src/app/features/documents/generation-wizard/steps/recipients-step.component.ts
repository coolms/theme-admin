import {
    ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject,
    model, signal,
} from '@angular/core';
import { Subject, Subscription, debounceTime, switchMap, of, catchError } from 'rxjs';

import { CmsFilterBuilderComponent } from '@coolms/ui-angular';
import { ApiService, type AudiencePreviewDto } from '../../../../api/api.service';
import { USER_ENTITY_FQCN } from './mode-step.component';

/**
 * X-2.6b step 2 (Filter mode only) -- pick the recipient cohort.
 *
 * Composition:
 *   - `<cms-filter-builder entityAlias="user" />` for the criterion
 *     editor. Builder is already debounced internally; this component
 *     debounces the count fetch on top so very rapid criterion edits
 *     don't burn requests.
 *   - Live count + a sample of who matches, with loading / error /
 *     zero-match states.
 *
 * Stateless w.r.t. wizard: receives + emits `rql` and `count` model
 * signals so the wizard owns the source of truth.
 *
 * ## The count comes from preview-audience, not the user list (#1757)
 *
 * This used to call `countUsers()`, which read `totalItems` off
 * `GET /auth/users` — an endpoint that returns a BARE ARRAY. The count was
 * therefore `undefined` for every filter, and the wizard's
 * `canProceed: count > 0` made `undefined > 0` false, so entering ANY filter
 * disabled Next. Filter mode could only be completed by leaving the filter
 * empty, i.e. generating for every user on the platform.
 *
 * `preview-audience` runs the same `FilterAudienceMaterializer` the submit
 * runs, so the number shown is the number that gets documents — and its
 * `sample` finally answers "which people?", which is what an operator is
 * really asking when they build a recipient filter.
 */
@Component({
    selector: 'cms-wizard-recipients-step',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsFilterBuilderComponent],
    template: `
        <div class="cms-recipients-step">
            <h3 class="cms-recipients-step__title">Filter users to send documents to</h3>

            <cms-filter-builder
                entityAlias="user"
                (rqlChange)="onRqlChange($event)">
            </cms-filter-builder>

            <p class="cms-recipients-step__status"
               [class.cms-recipients-step__status--empty]="!loading() && !error() && count() === 0"
               [class.cms-recipients-step__status--error]="!!error()">
                @if (loading()) {
                    Computing…
                } @else if (error()) {
                    Unable to compute count.
                    <button type="button"
                            class="cms-recipients-step__retry"
                            (click)="retry()">Retry</button>
                } @else if (rql() === '') {
                    Build a filter to choose who receives a document.
                } @else if (count() === 0) {
                    No users match this filter.
                } @else if (count() === 1) {
                    1 user will receive a document.
                } @else {
                    {{ count() }} users will receive documents.
                }
            </p>

            <!--
                Who, not just how many. A recipient filter is a destructive
                choice — the sample is what lets an operator notice they have
                selected the wrong cohort before the documents go out.
            -->
            @if (!loading() && !error() && sample().length > 0) {
                <ul class="cms-recipients-step__sample">
                    @for (row of sample(); track row.id) {
                        <li>{{ row.label }}</li>
                    }
                    @if ((count() ?? 0) > sample().length) {
                        <li class="cms-recipients-step__sample-more">
                            …and {{ (count() ?? 0) - sample().length }} more
                        </li>
                    }
                </ul>
            }
        </div>
    `,
    styles: [`
        :host { display: block; }

        .cms-recipients-step {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }
        .cms-recipients-step__title {
            font-size: 1rem;
            font-weight: 600;
            margin: 0;
        }
        .cms-recipients-step__status {
            font-size: .9rem;
            color: var(--cms-text-secondary);
            margin: 0;
        }
        .cms-recipients-step__status--empty {
            color: var(--cms-danger);
        }
        .cms-recipients-step__status--error {
            color: var(--cms-danger);
            display: flex;
            align-items: center;
            gap: .5rem;
        }
        .cms-recipients-step__retry {
            background: none;
            border: 1px solid var(--cms-border);
            border-radius: 4px;
            padding: 2px 8px;
            cursor: pointer;
            color: var(--cms-text);
            font-size: .8rem;
        }
        .cms-recipients-step__retry:hover {
            border-color: var(--cms-accent);
        }
        .cms-recipients-step__sample {
            margin: 0;
            padding: .5rem .75rem .5rem 1.6rem;
            border: 1px solid var(--cms-border);
            border-radius: 6px;
            /* Bounded: a sample is a spot-check, not a directory. */
            max-height: 11rem;
            overflow-y: auto;
            font-size: .85rem;
            color: var(--cms-text-secondary);
        }
        .cms-recipients-step__sample-more {
            list-style: none;
            margin-left: -1rem;
            color: var(--cms-text-muted);
            font-style: italic;
        }
    `],
})
export class CmsWizardRecipientsStepComponent implements OnDestroy {
    private readonly api = inject(ApiService);

    /** Two-way bound RQL body (e.g., `filter=isActive eq true`). */
    readonly rql = model<string>('');

    /** Two-way bound user count. `null` while loading / never fetched. */
    readonly count = model<number | null>(null);

    protected readonly loading = signal<boolean>(false);
    protected readonly error = signal<boolean>(false);

    /** Up to 10 matching recipients, for a "yes, these are the right people" check. */
    protected readonly sample = signal<readonly { id: string; label: string }[]>([]);

    private readonly rqlChanges$ = new Subject<string>();
    private readonly subscription: Subscription;

    constructor() {
        this.subscription = this.rqlChanges$
            .pipe(
                debounceTime(150),
                switchMap((rql) => {
                    this.loading.set(false);
                    this.error.set(false);
                    // Don't ask about the empty filter. The preview requires a
                    // non-empty rql because the SUBMIT does, so this would 422
                    // and paint "Unable to compute count" over the step's
                    // opening state — an error where the honest message is
                    // "you haven't chosen anyone yet".
                    if ('' === rql) {
                        return of<AudiencePreviewDto | null>(null);
                    }
                    this.loading.set(true);
                    return this.api.previewDocumentAudience(USER_ENTITY_FQCN, rql).pipe(
                        catchError(() => {
                            this.error.set(true);
                            this.loading.set(false);
                            return of<AudiencePreviewDto | null>(null);
                        }),
                    );
                }),
            )
            .subscribe((next) => {
                this.loading.set(false);
                if (this.error()) {
                    return;
                }
                // An error already set `error`; a null here means the same, so
                // clear rather than leaving a stale count the operator might
                // read as current.
                this.count.set(next?.count ?? null);
                this.sample.set(next?.sample ?? []);
            });

        // On first mount, fetch a count for the initial RQL (which is
        // `''` by default -- yields total user count). Wrapped in an
        // effect so it re-runs if the parent restores a draft RQL.
        effect(() => {
            this.rqlChanges$.next(this.rql());
        });
    }

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
        this.rqlChanges$.complete();
    }

    protected onRqlChange(rql: string): void {
        this.rql.set(rql);
    }

    protected retry(): void {
        this.error.set(false);
        this.rqlChanges$.next(this.rql());
    }
}
