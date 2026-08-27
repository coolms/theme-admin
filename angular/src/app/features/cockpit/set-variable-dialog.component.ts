import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@coolms/ui-angular';

/** Resolved value when the operator submits a variable to set. */
export interface SetVariableResult {
    name:  string;
    value: string;
}

/**
 * M4.c — "Set variable" dialog for the Process Cockpit detail page.
 *
 * A minimal two-field form (variable name + value, both text inputs). The
 * value is sent as a plain string — the backend stores it on the instance's
 * variable map. Resolves the dialog with a {@link SetVariableResult} on
 * submit, or `null` on cancel.
 *
 * The actual API call (and its success/error toast + detail re-fetch) is the
 * caller's responsibility — mirrors how the platform's other small dialogs
 * keep the network side on the host page so the dialog stays a pure input
 * surface. An empty name is blocked inline (the backend also returns 400).
 */
@Component({
    selector: 'app-set-variable-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModalComponent, FormsModule],
    template: `
        <app-modal title="Set variable" [width]="460">
            <div class="fields">
                <div>
                    <label class="cms-label" for="var-name">Name</label>
                    <input id="var-name" class="cms-input" type="text"
                           [(ngModel)]="name" (ngModelChange)="error.set(null)"
                           placeholder="e.g. approved" autofocus />
                    <div class="cms-field-hint">
                        The process-variable key. Setting an existing key overwrites it.
                    </div>
                </div>

                <div>
                    <label class="cms-label" for="var-value">Value</label>
                    <input id="var-value" class="cms-input" type="text"
                           [(ngModel)]="value" (ngModelChange)="error.set(null)"
                           placeholder="e.g. true" />
                    <div class="cms-field-hint">
                        Stored as a string.
                    </div>
                </div>

                @if (error()) { <p class="error">{{ error() }}</p> }
            </div>

            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary" (click)="submit()">
                    Set variable
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .fields { display: flex; flex-direction: column; gap: 14px; }
        .error {
            color: var(--cms-danger, #b91c1c);
            margin: 0;
            font-size: 0.8125rem;
        }
    `],
})
export class SetVariableDialogComponent {
    readonly dialogRef = inject<DialogRef<SetVariableResult | null>>(DialogRef);

    name  = '';
    value = '';

    readonly error = signal<string | null>(null);

    cancel(): void {
        this.dialogRef.close(null);
    }

    submit(): void {
        const name = this.name.trim();
        if (name === '') {
            this.error.set('Name is required.');
            return;
        }
        this.dialogRef.close({ name, value: this.value });
    }
}
