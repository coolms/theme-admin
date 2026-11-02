import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, type OnInit, signal } from '@angular/core';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';

/** The installation's state as the server answers it. */
interface InstallationState {
    readonly production: boolean;
    readonly answered: boolean;
}

/**
 * Says, across the top of the admin, that this installation is not marked as production: every site is then kept out
 * of search results, whatever its own indexing setting. Shown to those who may read the configuration (the server
 * answers no one else, and a refusal shows nothing); gone once the installation is marked.
 */
@Component({
    selector: 'app-installation-banner',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (state(); as s) {
            @if (!s.production) {
                <div class="ib-banner" role="status">
                    <i class="bi bi-eye-slash" aria-hidden="true"></i>
                    <span>
                        @if (s.answered) {
                            This installation is not marked as production:
                        } @else {
                            This installation has not been marked as production:
                        }
                        every site is kept out of search results. Mark it with
                        <code>coolms:application:production on</code>.
                    </span>
                </div>
            }
        }
    `,
    styles: [`
        .ib-banner {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            background: var(--cms-warning-subtle);
            color: var(--cms-warning-text);
            border-bottom: 1px solid var(--cms-warning-subtle-border);
            font-size: .875rem;
        }
        .ib-banner code { color: inherit; }
    `],
})
export class InstallationBannerComponent implements OnInit {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    /** Null until answered, and for anyone the server does not answer. */
    protected readonly state = signal<InstallationState | null>(null);

    ngOnInit(): void {
        const apiBase = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
        this.http.get<InstallationState>(`${apiBase}/application/installation`).subscribe({
            next: (answer) => this.state.set({ production: answer.production === true, answered: answer.answered === true }),
            error: () => this.state.set(null),
        });
    }
}
