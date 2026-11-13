import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@coolms/ui-angular';
import { type Observable } from 'rxjs';

import { type FolderChangeDto } from './email.types';

/** A place a folder may go: a folder path, or null for the top level. */
export interface FolderPlace {
    readonly parent: string | null;
    readonly label: string;
}

export interface FolderNameDialogData {
    readonly title: string;
    readonly confirmLabel: string;
    readonly name: string;
    /** Where the folder may go (`parent` is where it is now); fewer than two: it stays where it is. */
    readonly places: readonly FolderPlace[];
    readonly parent: string | null;
    /** The server call: the dialog closes with its answer, or shows its refusal in place. */
    readonly save: (name: string, parent: string | null) => Observable<FolderChangeDto>;
    /** A refusal in a sentence. */
    readonly refusal: (err: unknown) => string;
}

/**
 * A folder's name, and for a rename where it goes, asked in one dialog. Saving asks the server; a refusal is said in
 * place under the name, with no retry: Save is offered again only once the name or the place changes.
 */
@Component({
    selector: 'app-folder-name-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ModalComponent],
    template: `
        <app-modal [title]="data.title">
            <label class="fnd__label" for="folder-name-dialog-name">Name</label>
            <input #nameEl id="folder-name-dialog-name" type="text" class="cms-input" data-test="folder-name-input"
                   autocomplete="off" [attr.aria-invalid]="refusal() !== null ? 'true' : null"
                   [attr.aria-describedby]="refusal() !== null ? 'folder-name-dialog-refusal' : null"
                   [ngModel]="name()" (ngModelChange)="changed($event, parent())" (keydown.enter)="save()" />
            @if (data.places.length > 1) {
                <label class="fnd__label fnd__label--next" for="folder-name-dialog-place">Inside</label>
                <select id="folder-name-dialog-place" class="cms-select" data-test="folder-place"
                        [ngModel]="parent()" (ngModelChange)="changed(name(), $event)">
                    @for (place of data.places; track place.parent) {
                        <option [ngValue]="place.parent">{{ place.label }}</option>
                    }
                </select>
            }
            @if (refusal(); as said) {
                <p id="folder-name-dialog-refusal" class="fnd__refusal" role="alert" data-test="folder-refusal">{{ said }}</p>
            }
            <div footer>
                <button type="button" class="cms-btn" (click)="ref.close()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary" data-test="folder-save"
                        [disabled]="!canSave()" [attr.aria-busy]="saving() ? 'true' : null" (click)="save()">
                    {{ data.confirmLabel }}
                </button>
            </div>
        </app-modal>
    `,
    styles: [`
        .fnd__label { display: block; font-size: .8rem; font-weight: 600; color: var(--cms-text); margin-bottom: 5px; }
        .fnd__label--next { margin-top: 12px; }
        .cms-input, .cms-select { display: block; width: 100%; }
        .fnd__refusal { margin: 8px 0 0; font-size: .8125rem; color: var(--cms-danger-text); }
    `],
})
export class FolderNameDialogComponent {
    readonly data = inject<FolderNameDialogData>(DIALOG_DATA);
    readonly ref = inject<DialogRef<FolderChangeDto>>(DialogRef);

    readonly name = signal(this.data.name);
    readonly parent = signal<string | null>(this.data.parent);
    readonly refusal = signal<string | null>(null);
    readonly saving = signal(false);
    /** What the last refusal was for: the same name and place are not asked again. */
    private refused: string | null = null;

    private readonly nameEl = viewChild<ElementRef<HTMLInputElement>>('nameEl');

    constructor() {
        afterNextRender(() => {
            const el = this.nameEl()?.nativeElement;
            el?.focus();
            el?.select();
        });
    }

    changed(name: string, parent: string | null): void {
        this.name.set(name);
        this.parent.set(parent);
    }

    canSave(): boolean {
        return !this.saving() && this.name().trim() !== '' && this.refused !== this.asked();
    }

    save(): void {
        if (!this.canSave()) {
            return;
        }
        const asked = this.asked();
        this.saving.set(true);
        this.data.save(this.name().trim(), this.parent()).subscribe({
            next: answer => this.ref.close(answer),
            error: (err: unknown) => {
                this.refused = asked;
                this.refusal.set(this.data.refusal(err));
                this.saving.set(false);
            },
        });
    }

    private asked(): string {
        return JSON.stringify([this.name().trim(), this.parent()]);
    }
}

/** Opens the dialog; it closes with the server's answer, or with nothing when cancelled. */
export function openFolderNameDialog(dialog: Dialog, data: FolderNameDialogData): DialogRef<FolderChangeDto, FolderNameDialogComponent> {
    return dialog.open<FolderChangeDto, FolderNameDialogData, FolderNameDialogComponent>(FolderNameDialogComponent, {
        data,
        ariaLabel: data.title,
        ariaModal: true,
        hasBackdrop: true,
        restoreFocus: true,
    });
}
