import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { UserAvatarComponent } from '@coolms/ui-angular';
import { EditorPeer } from './editor-collab.service';

/**
 * Live presence strip for the page editor: the avatars of
 * other users currently in this document. Presentational only — fed the
 * deduped peer list from {@see EditorCollabService}; renders nothing when
 * nobody else is here. Avatars overlap; past `maxInline` they fold into a
 * "+N" chip (the locale-switcher overflow idiom). Names surface via native
 * `title` tooltips, matching the rest of the admin (no Material/CDK).
 */
@Component({
    selector: 'app-editor-presence-bar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UserAvatarComponent],
    template: `
        @if (peers().length > 0) {
            <div class="epb" [title]="summaryTitle()">
                <i class="bi bi-people-fill epb__icon"></i>
                <div class="epb__avatars">
                    @for (p of inline(); track p.userId) {
                        <span class="epb__avatar" [title]="p.name">
                            <app-user-avatar size="sm" [user]="{ identifier: p.name }" />
                        </span>
                    }
                    @if (overflow() > 0) {
                        <span class="epb__more" [title]="overflowTitle()">+{{ overflow() }}</span>
                    }
                </div>
            </div>
        }
    `,
    styles: [`
        .epb { display: flex; align-items: center; gap: 6px; }
        .epb__icon { font-size: .8125rem; color: var(--cms-text-muted); }
        .epb__avatars { display: flex; align-items: center; }
        /* Overlap with a ring in the header surface colour so stacked
           avatars read as a cluster, not a smear. */
        .epb__avatar {
            display: inline-flex; border-radius: 50%;
            box-shadow: 0 0 0 2px var(--cms-surface);
        }
        .epb__avatar:not(:first-child) { margin-left: -8px; }
        .epb__more {
            display: inline-flex; align-items: center; justify-content: center;
            min-width: 24px; height: 24px; padding: 0 5px; margin-left: -8px;
            border-radius: 12px; font-size: .6875rem; font-weight: 600;
            background: var(--cms-border-light); color: var(--cms-text-muted);
            box-shadow: 0 0 0 2px var(--cms-surface);
        }
    `],
})
export class EditorPresenceBarComponent {
    readonly peers = input<readonly EditorPeer[]>([]);
    /** Avatars rendered before collapsing the rest into the "+N" chip. */
    readonly maxInline = input(4);

    readonly inline = computed(() => this.peers().slice(0, this.maxInline()));
    readonly overflow = computed(() => Math.max(0, this.peers().length - this.maxInline()));

    readonly summaryTitle = computed(() => {
        const names = this.peers().map(p => p.name);
        if (names.length === 0) {
            return '';
        }
        const list = names.join(', ');
        return names.length === 1 ? `${list} is also editing` : `${list} are also editing`;
    });

    readonly overflowTitle = computed(() =>
        this.peers().slice(this.maxInline()).map(p => p.name).join(', '),
    );
}
