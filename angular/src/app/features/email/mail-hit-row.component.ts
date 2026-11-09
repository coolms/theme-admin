import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DateTimePipe } from '@coolms/ui-angular';

/**
 * One search hit as a row, the same for the stored results and the server's: sender and date on the first line, the
 * subject on the second, then the folder (or labels) chips, the size, whether the platform keeps it, and a snippet.
 */
@Component({
    selector: 'app-mail-hit-row',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DateTimePipe],
    template: `
        <button type="button" class="mhr" [attr.data-test]="testId()"
                [class.mhr--unread]="unread()" [class.mhr--active]="active()" (click)="chosen.emit()">
            <span class="mhr__top">
                <span class="mhr__from">{{ from() || '(unknown)' }}</span>
                <span class="mhr__date">{{ date() | appDateTime }}</span>
            </span>
            <span class="mhr__subject">{{ subject() || '(no subject)' }}</span>
            <span class="mhr__meta">
                @for (c of chips(); track c) {
                    <span class="mhr__chip">{{ c }}</span>
                }
                @if (size() !== '') {
                    <span class="mhr__aside">{{ size() }}</span>
                }
                @if (kept()) {
                    <span class="mhr__aside">Kept here</span>
                }
                @if (snippet()) {
                    <span class="mhr__snippet">{{ snippet() }}</span>
                }
            </span>
        </button>
    `,
    styles: [`
        :host { display: block; }
        .mhr {
            display: flex; flex-direction: column; gap: 2px; width: 100%; min-width: 0; padding: 8px 12px; margin: 0;
            text-align: left; border: 0; border-bottom: 1px solid var(--cms-border); border-radius: 0;
            background: transparent; color: var(--cms-text); font: inherit; cursor: pointer;
        }
        .mhr:hover { background: var(--cms-surface-hover); }
        .mhr--active { background: var(--cms-selected-light); }
        .mhr__top { display: flex; justify-content: space-between; gap: 8px; min-width: 0; }
        .mhr__from { font-size: .875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mhr__date { color: var(--cms-text-muted); font-size: .75rem; flex: 0 0 auto; }
        .mhr__subject { font-size: .8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mhr--unread .mhr__from, .mhr--unread .mhr__subject { font-weight: 700; }
        .mhr__meta { display: flex; align-items: center; gap: 4px 6px; min-width: 0; }
        .mhr__meta:empty { display: none; }
        .mhr__chip {
            flex: 0 0 auto; font-size: .6875rem; background: var(--cms-surface-alt); color: var(--cms-text-secondary);
            border-radius: var(--cms-radius-sm); padding: 0 5px; max-width: 45%;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mhr__aside { flex: 0 0 auto; font-size: .6875rem; color: var(--cms-text-muted); }
        .mhr__snippet {
            flex: 1 1 auto; min-width: 0; font-size: .75rem; color: var(--cms-text-muted);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
    `],
})
export class MailHitRowComponent {
    readonly from = input<string | null | undefined>(null);
    /** ISO 8601. */
    readonly date = input<string | null | undefined>(null);
    readonly subject = input<string | null | undefined>(null);
    readonly chips = input<readonly string[]>([]);
    readonly size = input('');
    readonly kept = input(false);
    readonly snippet = input<string | null | undefined>(null);
    readonly unread = input(false);
    readonly active = input(false);
    readonly testId = input<string | null>(null);
    readonly chosen = output();
}
