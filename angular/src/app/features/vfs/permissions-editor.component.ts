import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';

import { FormsModule } from '@angular/forms';

interface PermBit {
    label: string;
    bit:   number;
}

const OWNER_BITS: PermBit[] = [
    { label: 'Read',    bit: 0o400 },
    { label: 'Write',   bit: 0o200 },
    { label: 'Execute', bit: 0o100 },
];
const GROUP_BITS: PermBit[] = [
    { label: 'Read',    bit: 0o040 },
    { label: 'Write',   bit: 0o020 },
    { label: 'Execute', bit: 0o010 },
];
const OTHERS_BITS: PermBit[] = [
    { label: 'Read',    bit: 0o004 },
    { label: 'Write',   bit: 0o002 },
    { label: 'Execute', bit: 0o001 },
];

/**
 * Inline permissions matrix.
 *
 * Input  — mode octal string (e.g. '0644', '2755')
 * Output — modeChange emits new octal string whenever a bit is toggled
 *
 * Example:
 *   <app-permissions-editor [mode]="node.mode" (modeChange)="onModeChange($event)" />
 */
@Component({
    selector: 'app-permissions-editor',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
        <table class="table table-sm table-bordered mb-0 permissions-table">
          <thead class="table-light">
            <tr>
              <th style="width:7rem">Level</th>
              <th class="text-center">Read</th>
              <th class="text-center">Write</th>
              <th class="text-center">Execute</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="fw-semibold text-muted small">Owner</td>
              @for (b of ownerBits; track b) {
                <td class="text-center">
                  <input type="checkbox"
                    class="form-check-input"
                    [checked]="hasBit(b.bit)"
                    (change)="toggleBit(b.bit, $any($event.target).checked)"
                    [disabled]="disabled" />
                </td>
              }
            </tr>
            <tr>
              <td class="fw-semibold text-muted small">Group</td>
              @for (b of groupBits; track b) {
                <td class="text-center">
                  <input type="checkbox"
                    class="form-check-input"
                    [checked]="hasBit(b.bit)"
                    (change)="toggleBit(b.bit, $any($event.target).checked)"
                    [disabled]="disabled" />
                </td>
              }
            </tr>
            <tr>
              <td class="fw-semibold text-muted small">Others</td>
              @for (b of othersBits; track b) {
                <td class="text-center">
                  <input type="checkbox"
                    class="form-check-input"
                    [checked]="hasBit(b.bit)"
                    (change)="toggleBit(b.bit, $any($event.target).checked)"
                    [disabled]="disabled" />
                </td>
              }
            </tr>
          </tbody>
        </table>
        <div class="mt-2 d-flex gap-3 small text-muted">
          <label class="d-flex align-items-center gap-1 user-select-none">
            <input type="checkbox"
              class="form-check-input m-0"
              [checked]="setgid"
              (change)="toggleSpecial(BIT_SETGID, $any($event.target).checked)"
              [disabled]="disabled" />
            Setgid
          </label>
          <label class="d-flex align-items-center gap-1 user-select-none">
            <input type="checkbox"
              class="form-check-input m-0"
              [checked]="sticky"
              (change)="toggleSpecial(BIT_STICKY, $any($event.target).checked)"
              [disabled]="disabled" />
            Sticky
          </label>
        </div>
        <div class="mt-1 text-muted small">
          Octal: <code>{{ mode }}</code>&nbsp;·&nbsp;String:
          <code>{{ modeString }}</code>
        </div>
        `,
})
export class PermissionsEditorComponent implements OnChanges {
    /** Octal string from the server (e.g. '0644', '2755'). */
    @Input() mode: string = '0644';
    /** Disable all checkboxes while saving. */
    @Input() disabled = false;
    /** Emits the new octal string (e.g. '0755', '2755') after any toggle. */
    @Output() modeChange = new EventEmitter<string>();

    readonly ownerBits  = OWNER_BITS;
    readonly groupBits  = GROUP_BITS;
    readonly othersBits = OTHERS_BITS;

    readonly BIT_SETGID = 0o2000; // 1024
    readonly BIT_STICKY = 0o1000; // 512

    private modeInt = 0;

    get setgid(): boolean { return (this.modeInt & 0o2000) !== 0; }
    get sticky(): boolean { return (this.modeInt & 0o1000) !== 0; }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['mode']) {
            this.modeInt = parseInt(this.mode, 8);
        }
    }

    hasBit(bit: number): boolean {
        return (this.modeInt & bit) !== 0;
    }

    toggleBit(bit: number, checked: boolean): void {
        this.modeInt = checked ? this.modeInt | bit : this.modeInt & ~bit;
        this.emit();
    }

    toggleSpecial(bit: number, checked: boolean): void {
        this.modeInt = checked ? this.modeInt | bit : this.modeInt & ~bit;
        this.emit();
    }

    private emit(): void {
        this.mode = this.modeInt.toString(8).padStart(4, '0');
        this.modeChange.emit(this.mode);
    }

    get modeString(): string {
        const p = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
        const m = this.modeInt;
        let group  = p[(m >> 3) & 7];
        let others = p[m & 7];
        if (m & 0o2000) group  = group.slice(0, 2)  + ((m & 0o010) ? 's' : 'S');
        if (m & 0o1000) others = others.slice(0, 2) + ((m & 0o001) ? 't' : 'T');
        return p[(m >> 6) & 7] + group + others;
    }
}
