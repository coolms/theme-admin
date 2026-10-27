import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { SectionsApiService } from './sections-api.service';
import { SectionHostDto, SiteSectionDto } from './sections.types';

/** One row being edited: the status is kept as text for its select, and read back as a number on save. */
interface HostRow {
    host:   string;
    mode:   'serve' | 'redirect';
    status: string;
}

/**
 * A site's other hosts: each one either serves the site as its host does, or redirects to it (301 or 302). Edited as
 * a list and saved whole; the server refuses a host that is another section's, a redirect chain that goes round, and
 * anything that is not a host name, and the page shows its words.
 *
 * A host the server's trusted hosts do not name is answered 400 until the deployment adds it, and only the server
 * knows that list, so the section's read names such hosts and this card says so after a save. A host also needs the
 * nginx changes applied, and a certificate on the TLS terminator, before it answers: the card says that once.
 */
@Component({
    selector: 'app-section-hosts-card',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="card">
            <header class="card__head">
                <h2 class="card__title"><i class="bi bi-globe2"></i> Other hosts</h2>
                <span class="card__count">{{ rows().length }}</span>
            </header>
            <div class="card__body">
                @if (redirect(); as r) {
                    <p class="hosts__redirect">
                        This section is a redirect: every request goes to <strong>{{ r.target }}</strong>
                        ({{ r.status === 302 ? 'temporary, 302' : 'permanent, 301' }}{{ r.keepPath ? ', path kept' : '' }}).
                    </p>
                }
                @if (rows().length === 0) {
                    <p class="hosts__empty">This site answers under its own host only.</p>
                }
                @for (row of rows(); track $index) {
                    <div class="hosts__row">
                        <input class="cms-input hosts__host" type="text" [(ngModel)]="row.host"
                               [attr.aria-label]="'Host ' + ($index + 1)" placeholder="www.example.com" />
                        <select class="cms-select" [(ngModel)]="row.mode" [attr.aria-label]="'What host ' + ($index + 1) + ' does'">
                            <option value="serve">Serves the site</option>
                            <option value="redirect">Redirects to the site's host</option>
                        </select>
                        @if (row.mode === 'redirect') {
                            <select class="cms-select" [(ngModel)]="row.status" [attr.aria-label]="'Kind of redirect for host ' + ($index + 1)">
                                <option value="301">Permanent (301)</option>
                                <option value="302">Temporary (302)</option>
                            </select>
                        }
                        <button type="button" class="cms-btn cms-btn-link cms-btn-sm" (click)="remove($index)"
                                [attr.aria-label]="'Remove host ' + ($index + 1)">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                }
                <p class="hosts__hint">
                    An international name is written in its ASCII form (xn--...). A new host answers once the nginx
                    changes are applied and the TLS terminator has a certificate for it.
                </p>
                @if (untrusted().length > 0) {
                    <p class="hosts__warning" role="alert">
                        This server does not trust {{ untrusted().join(', ') }} yet, so a request for it is answered
                        400 until the deployment's trusted hosts name it.
                    </p>
                }
                @if (error(); as e) {
                    <p class="hosts__error" role="alert">{{ e }}</p>
                }
                <div class="hosts__actions">
                    <button type="button" class="cms-btn cms-btn-secondary cms-btn-sm" (click)="add()">
                        <i class="bi bi-plus-lg"></i> Add a host
                    </button>
                    <button type="button" class="cms-btn cms-btn-primary cms-btn-sm" (click)="save()" [disabled]="saving()">
                        Save hosts
                    </button>
                </div>
            </div>
        </section>
    `,
    styles: [`
        .hosts__row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        .hosts__host { flex: 1; min-width: 0; }
        .hosts__hint, .hosts__empty { color: var(--cms-text-muted); font-size: .85rem; }
        .hosts__warning { color: var(--cms-warning-text); }
        .hosts__error { color: var(--cms-danger-text); }
        .hosts__actions { display: flex; gap: 8px; }
    `],
})
export class SectionHostsCardComponent {
    readonly sectionId = input.required<string>();
    /** Raised by the page after the section was edited elsewhere (its form): the card reads the section again. */
    readonly revision  = input(0);

    private readonly api        = inject(SectionsApiService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly toast      = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);

    readonly rows      = signal<HostRow[]>([]);
    readonly untrusted = signal<string[]>([]);
    readonly redirect  = signal<{ target: string; status: number; keepPath: boolean } | null>(null);
    readonly error     = signal<string | null>(null);
    readonly saving    = signal(false);

    constructor() {
        effect(() => {
            this.revision();
            this.load(this.sectionId());
        });
    }

    private load(sectionId: string): void {
        this.api.getSection(sectionId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next:  section => this.show(section),
            error: (err: unknown) => this.error.set(this.errors.humanize(err)),
        });
    }

    add(): void {
        this.rows.update(rows => [...rows, { host: '', mode: 'redirect', status: '301' }]);
    }

    remove(index: number): void {
        this.rows.update(rows => rows.filter((_, i) => i !== index));
    }

    /** The whole list, as the server takes it: a row with no host is dropped, a serving one carries no status. */
    hostsToSave(): SectionHostDto[] {
        return this.rows()
            .filter(row => row.host.trim() !== '')
            .map(row => row.mode === 'redirect'
                ? { host: row.host.trim(), mode: 'redirect' as const, status: Number(row.status) }
                : { host: row.host.trim(), mode: 'serve' as const });
    }

    save(): void {
        this.saving.set(true);
        this.error.set(null);
        this.api.updateSection(this.sectionId(), { hosts: this.hostsToSave() })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: section => {
                    this.saving.set(false);
                    this.show(section);
                    this.toast.success('Hosts saved. Apply the nginx changes for them to answer.');
                },
                error: (err: unknown) => {
                    this.saving.set(false);
                    this.error.set(this.errors.humanize(err));
                },
            });
    }

    private show(section: SiteSectionDto): void {
        this.rows.set((section.hosts ?? []).map(h => ({ host: h.host, mode: h.mode, status: String(h.status ?? 301) })));
        this.untrusted.set(section.untrustedHosts ?? []);
        this.redirect.set(section.redirectTarget
            ? { target: section.redirectTarget, status: section.redirectStatus ?? 301, keepPath: section.redirectKeepPath === true }
            : null);
    }
}
