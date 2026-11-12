import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { StateComponent } from '@coolms/ui-angular';

import { folderCount, folderCountTitle, folderUnread, importedFraction } from './folder-fraction.util';
import type { FolderRow } from './folder-tree.util';

/** The Bootstrap icon for each folder role the tree names; any other role, or none, draws a folder. */
const ROLE_ICONS: Readonly<Record<string, string>> = {
    inbox: 'bi-inbox',
    sent: 'bi-send',
    drafts: 'bi-file-earmark-text',
    archive: 'bi-archive',
    all: 'bi-archive',
    trash: 'bi-trash',
    flagged: 'bi-star',
    important: 'bi-bookmark',
    junk: 'bi-exclamation-octagon',
};

/** A folder's icon, by its role from the tree, never by its name. */
export function folderIcon(role: string | null | undefined): string {
    return (typeof role === 'string' ? ROLE_ICONS[role] : undefined) ?? 'bi-folder';
}

/**
 * A mailbox's folders, one row per row given, in that order and with those names. A row that cannot be selected is a
 * heading and opens nothing. A tree that could not be read shows the error with Retry, and no rows.
 */
@Component({
    selector: 'app-mail-folder-rail',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [StateComponent],
    template: `
        <nav class="mbx__folders" aria-label="Folders">
            @if (failure() !== null) {
                <cms-state kind="error" title="Could not load the folders." [error]="failure()"
                           actionLabel="Retry" (acted)="retry.emit()" />
            } @else {
                @for (row of rows(); track row.folder.folder) {
                    @if (row.selectable) {
                        <button type="button" class="mbx__folder" data-test="folder"
                                [style.padding-left.px]="9 + row.depth * 14"
                                [class.mbx__folder--active]="row.folder.folder === selected()"
                                [attr.aria-current]="row.folder.folder === selected() ? 'true' : null"
                                [title]="countTitle(row)"
                                (click)="chosen.emit(row.folder.folder)">
                            <i class="bi mbx__folder-icon" [class]="icon(row)" aria-hidden="true" data-test="folder-icon"></i>
                            <span class="mbx__folder-name">{{ row.name }}</span>
                            @if (unread(row) > 0) {
                                <span class="mbx__badge">{{ unread(row) }}</span>
                            }
                            <span class="mbx__folder-total">{{ count(row) }}</span>
                            @if (fraction(row) !== null) {
                                <span class="mbx__folder-progress" aria-hidden="true">
                                    <span class="mbx__folder-progress-bar" [style.width.%]="fraction(row)"></span>
                                </span>
                            }
                        </button>
                    } @else {
                        <div class="mbx__folder mbx__folder--holder" data-test="folder-holder"
                             [style.padding-left.px]="9 + row.depth * 14">
                            <i class="bi mbx__folder-icon" [class]="icon(row)" aria-hidden="true" data-test="folder-icon"></i>
                            <span class="mbx__folder-name">{{ row.name }}</span>
                        </div>
                    }
                }
                @if (answered() && rows().length === 0) {
                    <p class="mbx__rail-note">No folders yet.</p>
                }
            }
        </nav>
    `,
    styles: [`
        :host { display: block; }
        .mbx__folders { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
        /* The highlight reaches into the column's gutter by its own padding, so the row starts at the column's edge
           (the section header's icon), children indented from there. */
        .mbx__folder {
            position: relative; margin-left: -9px;
            display: flex; align-items: center; gap: 6px; width: calc(100% + 9px); text-align: left;
            padding: 7px 9px; border: 0; border-radius: var(--cms-radius, 6px); background: transparent; cursor: pointer;
            color: var(--cms-text); font-size: .875rem;
        }
        .mbx__folder:hover { background: var(--cms-surface-hover); }
        .mbx__folder--holder, .mbx__folder--holder:hover {
            background: transparent; cursor: default; color: var(--cms-text-muted);
        }
        .mbx__folder--active { background: var(--cms-selected-light); font-weight: 600; }
        /* The icon starts at the column's edge, the size of the row's text and in its colour, at one width so every
           name of a level starts at the same x. */
        .mbx__folder-icon { flex: 0 0 1em; width: 1em; font-size: 1em; line-height: 1; color: inherit; text-align: center; }
        .mbx__folder-name { flex: 1; }
        .mbx__folder-total { color: var(--cms-text-muted); font-size: .75rem; white-space: nowrap; }
        /* A half-imported folder shows how far the backfill has walked it. */
        .mbx__folder-progress {
            position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
            background: var(--cms-border); border-radius: 0 0 4px 4px; overflow: hidden;
        }
        .mbx__folder-progress-bar {
            display: block; height: 100%; background: var(--cms-text-muted); opacity: .55;
        }
        .mbx__badge {
            background: var(--cms-accent, #F5A623); color: var(--cms-accent-fg, #1a1a1a); border-radius: 999px;
            font-size: .6875rem; padding: 1px 7px; min-width: 18px; text-align: center;
        }
        .mbx__rail-note { color: var(--cms-text-muted); font-size: .8125rem; padding: 12px; }
    `],
})
export class MailFolderRailComponent {
    readonly rows = input.required<readonly FolderRow[]>();
    readonly selected = input.required<string>();
    /** Why the tree could not be read; null when it was, or is still being read. */
    readonly failure = input<unknown>(null);
    /** The tree has answered, so no rows means the mailbox has no folders. */
    readonly answered = input(false);
    readonly chosen = output<string>();
    readonly retry = output<void>();

    /** A row's icon: by its role, and a folder for one that only holds folders, whatever its role. */
    protected icon(row: FolderRow): string {
        return row.selectable ? folderIcon(row.folder.role) : 'bi-folder';
    }

    protected unread(row: FolderRow): number {
        return folderUnread(row.folder);
    }

    protected count(row: FolderRow): string {
        return folderCount(row.folder);
    }

    protected countTitle(row: FolderRow): string {
        return folderCountTitle(row.folder);
    }

    protected fraction(row: FolderRow): number | null {
        return importedFraction(row.folder);
    }
}
