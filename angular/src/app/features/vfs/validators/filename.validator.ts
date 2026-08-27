import { type AbstractControl, type ValidationErrors, type ValidatorFn } from '@angular/forms';

const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/;

/**
 * Validate a raw filename string.
 * Returns an error message or null — usable both in dialog validators and reactive forms.
 */
export function validateFilename(val: string): string | null {
    if (!val) return null;

    const match = val.match(INVALID_CHARS);
    if (match) {
        return `Invalid character: "${match[0]}"`;
    }

    if (val === '.') {
        return 'Name cannot be just a dot';
    }

    return null;
}

/**
 * Angular reactive forms ValidatorFn wrapper.
 * Use with FormControl: new FormControl('', filenameValidator())
 */
export function filenameValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
        const error = validateFilename(control.value as string);
        return error ? { invalidFilename: error } : null;
    };
}
