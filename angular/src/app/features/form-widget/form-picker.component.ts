import { Component, computed, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DialogRef } from '@angular/cdk/dialog';
import { FormService } from '../forms/form.service';
import type { FormDefinitionDto } from '../forms/form.types';

/**
 * CDK dialog that lists the available forms (`GET /forms`) and returns the
 * chosen form id to the caller (the OpenFormPickerHandler), which inserts a
 * `formWidget` node. Filterable by id; shows the storage-source badge so an
 * author can tell a shipped form from a DB/file override.
 */
@Component({
    selector: 'app-form-picker',
    standalone: true,
    imports: [FormsModule],
    template: `
        <div class="fp">
            <header class="fp__head">
                <h3>Insert form</h3>
                <button type="button" class="fp__x" (click)="cancel()" aria-label="Close">×</button>
            </header>

            <input class="fp__search" type="text" placeholder="Filter forms…"
                   [(ngModel)]="query" autocomplete="off" autofocus />

            @if (loading()) {
                <div class="fp__msg">Loading forms…</div>
            } @else if (error()) {
                <div class="fp__msg fp__msg--err">{{ error() }}</div>
            } @else if (filtered().length === 0) {
                <div class="fp__msg">No forms match.</div>
            } @else {
                <ul class="fp__list">
                    @for (f of filtered(); track f.id) {
                        <li>
                            <button type="button" class="fp__item" (click)="pick(f)">
                                <span class="fp__id">{{ f.id }}</span>
                                @if (f.source) { <span class="fp__src">{{ f.source }}</span> }
                            </button>
                        </li>
                    }
                </ul>
            }

            <footer class="fp__foot">
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
            </footer>
        </div>
    `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [`
        .fp { width: 460px; max-width: 92vw; background:var(--cms-surface); border-radius:8px;
              box-shadow:0 12px 40px rgba(0,0,0,.25); overflow:hidden; display:flex; flex-direction:column; }
        .fp__head { display:flex; align-items:center; justify-content:space-between;
                    padding:12px 16px; border-bottom:1px solid var(--cms-border); }
        .fp__head h3 { margin:0; font-size:15px; color:#15324a; }
        .fp__x { border:none; background:none; font-size:22px; line-height:1; cursor:pointer; color:#64748b; }
        .fp__search { margin:12px 16px 6px; padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; }
        .fp__list { list-style:none; margin:0; padding:4px 8px; max-height:46vh; overflow:auto; }
        .fp__item { display:flex; align-items:center; gap:10px; width:100%; text-align:left;
                    border:none; background:none; padding:8px 10px; border-radius:6px; cursor:pointer; font-size:13px; }
        .fp__item:hover { background:#eef3f6; }
        .fp__id { color:#15324a; font-weight:600; }
        .fp__src { font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:#64748b;
                   background:#eef3f6; border-radius:20px; padding:2px 8px; }
        .fp__msg { padding:18px 16px; color:#64748b; font-size:13px; }
        .fp__msg--err { color:#c0392b; }
        .fp__foot { padding:10px 16px; border-top:1px solid var(--cms-border); text-align:right; }
    `],
})
export class FormPickerComponent implements OnInit {
    private readonly forms = inject(FormService);
    private readonly ref   = inject<DialogRef<string | null>>(DialogRef);

    readonly loading = signal(true);
    readonly error   = signal<string | null>(null);
    readonly all     = signal<FormDefinitionDto[]>([]);
    query = '';

    readonly filtered = computed(() => {
        const q = this.query.trim().toLowerCase();
        const list = [...this.all()].sort((a, b) => a.id.localeCompare(b.id));
        return q === '' ? list : list.filter(f => f.id.toLowerCase().includes(q));
    });

    ngOnInit(): void {
        this.forms.listForms().subscribe({
            next: list => { this.all.set(list); this.loading.set(false); },
            error: () => { this.error.set('Could not load forms.'); this.loading.set(false); },
        });
    }

    pick(f: FormDefinitionDto): void { this.ref.close(f.id); }
    cancel(): void { this.ref.close(null); }
}
