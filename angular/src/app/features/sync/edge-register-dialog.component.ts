import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalComponent, ToastService } from '@coolms/ui-angular';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ApiService } from '../../api/api.service';
import { SyncEdgeDto, SyncFleetService } from './sync-fleet.service';

/** Passed when editing an existing edge; absent = register a new one. */
export interface EdgeRegisterDialogData {
    readonly edge?: SyncEdgeDto;
}

const ALL_TIERS = ['config', 'content', 'runtime'] as const;

/**
 * Register / edit a sync edge ( B.3.2) — the modal counterpart of
 * `coolms:sync:edge:register`.
 *
 * The backend upsert is DECLARED-STATE-WINS, so this dialog always submits the
 * FULL desired state: leaving "principal" empty UNBINDS the edge (it can no
 * longer ack), and unticking every scope tier while "restrict" is on means
 * "receives nothing". Both are legitimate states, so the form explains rather
 * than prevents them.
 */
@Component({
    selector: 'app-edge-register-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule],
    template: `
        <app-modal [title]="isEdit ? 'Edit edge' : 'Register edge'" [width]="560">
            <div class="field">
                <label class="cms-label" for="se-slug">Slug</label>
                <input id="se-slug" class="cms-input" [(ngModel)]="slug"
                       [disabled]="isEdit" placeholder="edge-berlin"
                       autocomplete="off">
                @if (isEdit) {
                    <p class="hint">The slug is the edge's stable handle — re-registering under a new slug creates a NEW edge.</p>
                }
            </div>
            <div class="field">
                <label class="cms-label" for="se-name">Name</label>
                <input id="se-name" class="cms-input" [(ngModel)]="name" placeholder="Berlin office" autocomplete="off">
            </div>
            <div class="field">
                <label class="cms-label" for="se-url">Base URL</label>
                <input id="se-url" class="cms-input" [(ngModel)]="url" placeholder="https://edge.example.intra" autocomplete="off">
                <p class="hint">The edge's own sync-ingest URL — where the controller sends nudges.</p>
            </div>
            <div class="field">
                <label class="cms-label" for="se-cred">Push credential reference</label>
                <input id="se-cred" class="cms-input" [(ngModel)]="credentialRef"
                       placeholder="sync.edge.berlin.token" autocomplete="off">
                <p class="hint">Secret-store NAME of the bearer the controller uses to call the edge — never the raw token. Empty = pull-only.</p>
            </div>
            <div class="field">
                <label class="cms-label" for="se-principal">Inbound principal (UUID or email)</label>
                <input id="se-principal" class="cms-input" [(ngModel)]="principal"
                       placeholder="edge-berlin@machines.local" autocomplete="off">
                <p class="hint">
                    The Identity user this edge authenticates AS when it calls in.
                    <strong>Empty = unbound: the edge cannot acknowledge feed progress, and any scope below is inert.</strong>
                </p>
            </div>
            <div class="field">
                <label class="cms-check">
                    <input type="checkbox" [(ngModel)]="restrictScope">
                    <span>Restrict synced data (selective scope)</span>
                </label>
                @if (restrictScope) {
                    <div class="tiers">
                        @for (tier of allTiers; track tier) {
                            <label class="cms-check">
                                <input type="checkbox"
                                       [ngModel]="tiers().includes(tier)"
                                       (ngModelChange)="toggleTier(tier, $event)">
                                <span>{{ tier }}</span>
                            </label>
                        }
                    </div>
                    @if (tiers().length === 0) {
                        <p class="hint warn">No tiers selected — this edge will receive NOTHING.</p>
                    }
                }
            </div>
            <div class="field">
                <label class="cms-check">
                    <input type="checkbox" [(ngModel)]="restrictSections">
                    <span>Restrict to site sections</span>
                </label>
                @if (restrictSections) {
                    <div class="tiers">
                        @for (section of allSections(); track section) {
                            <label class="cms-check">
                                <input type="checkbox"
                                       [ngModel]="sections().includes(section)"
                                       (ngModelChange)="toggleSection(section, $event)">
                                <span>{{ section }}</span>
                            </label>
                        }
                    </div>
                    <p class="hint">Only the ticked <code>/content/&lt;slug&gt;</code> subtrees sync; shared trees (media, docs, assets) always flow. Composes with the tier scope above.</p>
                    @if (sections().length === 0) {
                        <p class="hint warn">No sections selected — this edge receives shared trees only, no site content.</p>
                    }
                    <p class="hint warn">A sections-scoped edge cannot take snapshots (bundles are whole-tier): bootstrap it unscoped, then re-apply.</p>
                }
            </div>
            <div class="field">
                <label class="cms-check">
                    <input type="checkbox" [(ngModel)]="enabled">
                    <span>Enabled (receives pushes / nudges)</span>
                </label>
                <p class="hint">A disabled edge is PAUSED: it keeps its cursor and pins the change-feed's prune floor. Remove it instead if it is gone for good.</p>
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="saving() || !valid()" (click)="save()">
                    <i class="bi bi-diagram-3"></i>
                    <span>{{ saving() ? 'Saving…' : (isEdit ? 'Save edge' : 'Register edge') }}</span>
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .field { display: flex; flex-direction: column; margin-bottom: 0.7rem; }
        .hint { margin: 0.25rem 0 0; font-size: 0.78rem; color: var(--cms-text-muted, #848b96); }
        .hint.warn { color: var(--cms-danger, #dc2626); }
        .cms-check { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.86rem; }
        .tiers { display: flex; gap: 1rem; margin-top: 0.35rem; padding-left: 1.4rem; }
    `],
})
export class EdgeRegisterDialogComponent {
    private readonly api = inject(SyncFleetService);
    private readonly sectionsApi = inject(ApiService);
    private readonly toast = inject(ToastService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly data = inject<EdgeRegisterDialogData | null>(DIALOG_DATA, { optional: true });
    readonly dialogRef = inject<DialogRef<SyncEdgeDto>>(DialogRef);

    readonly allTiers = ALL_TIERS;
    readonly isEdit = !!this.data?.edge;

    slug = this.data?.edge?.slug ?? '';
    name = this.data?.edge?.name ?? '';
    url = this.data?.edge?.baseUrl ?? '';
    credentialRef = this.data?.edge?.credentialRef ?? '';
    principal = this.data?.edge?.principalRef ?? '';
    enabled = this.data?.edge?.enabled ?? true;
    // The two axes are independent: a scope may restrict tiers, sections, or both.
    restrictScope = this.data?.edge?.scope?.tiers != null;
    restrictSections = this.data?.edge?.scope?.sections != null;
    readonly tiers = signal<string[]>(this.data?.edge?.scope?.tiers ?? []);
    readonly sections = signal<string[]>(this.data?.edge?.scope?.sections ?? []);
    readonly allSections = signal<string[]>(
        // Show an already-saved (possibly stale) slug even before the live list
        // lands, so editing never silently unticks it.
        this.data?.edge?.scope?.sections ?? [],
    );
    readonly saving = signal(false);

    constructor() {
        this.sectionsApi.getSections().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: list => {
                const slugs = list.map(s => s.slug).filter((s): s is string => null !== s && '' !== s);
                this.allSections.set([...new Set([...slugs, ...this.sections()])]);
            },
            // The dialog stays usable without the list; the backend validates
            // slugs fail-loud on save anyway.
            error: () => undefined,
        });
    }

    valid(): boolean {
        return this.slug.trim() !== '' && this.name.trim() !== '' && this.url.trim() !== '';
    }

    toggleTier(tier: string, on: boolean): void {
        this.tiers.update(list => (on ? [...list.filter(t => t !== tier), tier] : list.filter(t => t !== tier)));
    }

    toggleSection(section: string, on: boolean): void {
        this.sections.update(list => (on ? [...list.filter(s => s !== section), section] : list.filter(s => s !== section)));
    }

    cancel(): void {
        this.dialogRef.close();
    }

    save(): void {
        if (this.saving() || !this.valid()) return;
        this.saving.set(true);
        this.api.registerEdge({
            slug: this.slug.trim(),
            name: this.name.trim(),
            url: this.url.trim(),
            credentialRef: this.credentialRef.trim() || null,
            enabled: this.enabled,
            principal: this.principal.trim() || null,
            scopeTiers: this.restrictScope ? this.tiers() : null,
            scopeSections: this.restrictSections ? this.sections() : null,
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: edge => { this.saving.set(false); this.dialogRef.close(edge); },
            error: e => { this.saving.set(false); this.toast.error(this.errors.humanize(e)); },
        });
    }
}
