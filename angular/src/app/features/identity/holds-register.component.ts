import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { IdentityApiService } from './identity-api.service';
import { FootprintDto } from './identity.types';

/**
 * Level one of "Legal holds": every category a module declared
 * about a person's data, what happens to it on deletion, and -- for the
 * categories that can hold -- the operator's obligation and duration in
 * force, from the holds register. The values are edited in the settings
 * tier; this reads them, and links there. The platform ships no duration:
 * a zero is "no period decided", shown as such.
 */
@Component({
    selector: 'app-holds-register',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink],
    template: `
        <div class="hr">
            <p class="hr-intro">
                What each module declares it does with a person's data when the account is deleted, read from the declarations
                themselves. A category that <strong>can hold</strong> keeps its data under an obligation the operator states;
                @if (settingsLink(); as link) {
                    the obligations and their durations are edited in <a [routerLink]="link">Settings &rsaquo; Identity &rsaquo; Legal holds</a>.
                } @else {
                    the obligations and their durations live in the settings tier.
                }
            </p>

            @if (loading()) {
                <p class="text-muted small">Loading&hellip;</p>
            } @else {
                <h6 class="hr-heading">Categories that can hold <span class="text-muted">({{ holdable().length }})</span></h6>
                <table class="table table-sm hr-table">
                    <thead>
                        <tr><th>Category</th><th>Module</th><th>What</th><th>On deletion</th><th>Obligation</th><th class="text-end">Days after deletion</th></tr>
                    </thead>
                    <tbody>
                        @for (f of holdable(); track f.category) {
                            <tr>
                                <td><code>{{ f.category }}</code></td>
                                <td>{{ f.module }}</td>
                                <td class="hr-label">{{ f.label }}</td>
                                <td><span class="badge" [class]="'badge text-bg-' + actionVariant(f.action)">{{ f.action }}</span></td>
                                <td class="hr-obligation">
                                    @if (f.obligation) { {{ f.obligation }} } @else { <span class="text-muted">not stated</span> }
                                </td>
                                <td class="text-end">
                                    @if (f.durationDays) { {{ f.durationDays }} } @else { <span class="text-muted">no period decided</span> }
                                </td>
                            </tr>
                        } @empty {
                            <tr><td colspan="6" class="text-muted">No module declares a category that can hold.</td></tr>
                        }
                    </tbody>
                </table>

                <h6 class="hr-heading mt-3">Every other category <span class="text-muted">({{ others().length }})</span></h6>
                <table class="table table-sm hr-table">
                    <thead>
                        <tr><th>Category</th><th>Module</th><th>What</th><th>Tables</th><th>On deletion</th></tr>
                    </thead>
                    <tbody>
                        @for (f of others(); track f.category) {
                            <tr>
                                <td><code>{{ f.category }}</code></td>
                                <td>{{ f.module }}</td>
                                <td class="hr-label">{{ f.label }}</td>
                                <td class="hr-tables">@for (t of f.tables; track t) { <code>{{ t }}</code> }</td>
                                <td><span [class]="'badge text-bg-' + actionVariant(f.action)">{{ f.action }}</span></td>
                            </tr>
                        }
                    </tbody>
                </table>
            }
        </div>
    `,
    styles: [`
        :host { display: block; overflow: auto; flex: 1; min-height: 0; }
        .hr { padding: 12px 16px; font-size: 0.9rem; }
        .hr-intro { max-width: 70ch; }
        .hr-heading { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--cms-text-muted, #848b96); margin: 0 0 6px; }
        .hr-table td, .hr-table th { vertical-align: top; }
        .hr-label { max-width: 34ch; }
        .hr-obligation { max-width: 30ch; white-space: pre-wrap; }
        .hr-tables code { display: block; font-size: 0.78rem; }
    `],
})
export class HoldsRegisterComponent implements OnInit {
    private readonly identityApi = inject(IdentityApiService);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly destroyRef = inject(DestroyRef);

    readonly loading    = signal(true);
    readonly footprints = signal<FootprintDto[]>([]);
    readonly holdable   = computed(() => this.footprints().filter(f => f.canHold));
    readonly others     = computed(() => this.footprints().filter(f => !f.canHold));

    /** `/settings/{module}/{block}` -- the path IS the tree; the block key comes from the manifest. */
    readonly settingsLink = computed((): string[] | null => {
        const block = this.identityApi.holdsSettingsBlock;
        return block ? ['/settings', 'identity', block] : null;
    });

    ngOnInit(): void {
        this.identityApi.listFootprints().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: rows => { this.footprints.set(rows); this.loading.set(false); },
            error: err => { this.loading.set(false); this.toast.error(this.errors.humanize(err)); },
        });
    }

    actionVariant(action: FootprintDto['action']): string {
        return action === 'delete' ? 'danger' : action === 'minimise' ? 'warning' : 'secondary';
    }
}
