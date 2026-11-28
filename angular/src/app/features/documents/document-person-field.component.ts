import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, untracked } from '@angular/core';
import { Store } from '@ngxs/store';
import { AuthState, CmsLoaderComponent, EntitySearchService } from '@coolms/core-angular';
import { CmsEntityPickerComponent } from '@coolms/ui-angular';
import { DocumentRecipientAccess } from './document-recipient-access.service';
import { DocumentRecipientSearchService } from './document-recipient-search.service';
import { FilterAudienceEntity } from './generation-wizard/filter-audience-entity';

/**
 * A document's entity field. A person is picked among the people a document may go to, by someone who may choose
 * them; someone who may not generates only for themselves: the field says so, with them chosen, and offers no search
 * (only what a person can do is shown). Any other entity is picked as everywhere else.
 */
@Component({
    selector: 'cms-document-person-field',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsEntityPickerComponent, CmsLoaderComponent],
    providers: [{ provide: EntitySearchService, useClass: DocumentRecipientSearchService }],
    template: `
        @if (forSelf()) {
            <div class="cms-person-field__self" [id]="inputId()" data-test="for-self">
                <span>This document is for you.</span>
                <span class="cms-person-field__name">{{ myName() }}</span>
            </div>
        } @else if (waiting()) {
            <cms-loader label="Loading" />
        } @else {
            <cms-entity-picker
                [entityType]="entityType()"
                [collection]="collection()"
                [inputId]="inputId()"
                [value]="value()"
                (valueChange)="valueChange.emit($event)" />
        }
    `,
    styles: [`
        :host { display: block; }
        .cms-person-field__self { display: flex; flex-direction: column; gap: 2px; }
        .cms-person-field__name { font-weight: 600; color: var(--cms-text); }
    `],
})
export class DocumentPersonFieldComponent {
    readonly entityType = input.required<string>();
    readonly collection = input<boolean>(false);
    readonly inputId = input<string>('');
    readonly value = input<string | string[] | null>(null);
    readonly valueChange = output<string | string[] | null>();

    private readonly access = inject(DocumentRecipientAccess);
    private readonly person = inject(FilterAudienceEntity);
    private readonly store = inject(Store);

    private readonly isPerson = computed(() => this.person.matches(this.entityType()));
    /** A person field, for someone who may not choose others: they are the recipient. */
    protected readonly forSelf = computed(() => this.isPerson() && this.access.choice() === 'self');
    /** A person field before the server has said who may be chosen: nothing is offered yet. */
    protected readonly waiting = computed(() => this.isPerson() && this.access.choice() === 'unknown');
    private readonly me = computed(() => this.store.selectSnapshot(AuthState.currentUser));
    /** Their name, or "No name": a login or an email is never shown as a name. */
    protected readonly myName = computed(() => (this.me()?.fullName ?? '').trim() || 'No name');

    constructor() {
        this.access.load();
        // Chosen for them: the field's value is their own id.
        effect(() => {
            if (!this.forSelf()) return;
            const id = this.me()?.id;
            if (!id) return;
            const want: string | string[] = this.collection() ? [id] : id;
            const now = untracked(() => this.value());
            if (JSON.stringify(now) !== JSON.stringify(want)) untracked(() => this.valueChange.emit(want));
        });
    }
}
