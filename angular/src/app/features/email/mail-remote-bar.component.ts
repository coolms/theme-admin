import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';

import { type RemoteContentDto } from './email.types';

/** The server's image-bar tree: its actions and when each is shown. */
export const REMOTE_CONTENT_TREE = 'navi.toolbar.email.remote-content';

/** The actions of the image bar the page runs; a node naming any other is not drawn. */
export type RemoteContentAction = 'allow-remote-message' | 'allow-remote-sender' | 'disallow-remote-sender';
const ACTIONS: readonly string[] = ['allow-remote-message', 'allow-remote-sender', 'disallow-remote-sender'];

/** One action as the bar draws it. */
export interface RemoteBarAction {
    readonly id: RemoteContentAction;
    readonly label: string;
    readonly shortLabel: string | null;
    readonly icon: string | null;
    /** The server's words for why it cannot be done now; null when it can. */
    readonly reason: string | null;
}

/** The facts the tree's conditions read, from the message's remoteContent and whether it names a sender. */
export function remoteContentFacts(content: RemoteContentDto, hasSender: boolean): Record<string, unknown> {
    return { _remoteContent: content.state, _remoteReason: content.reason, _remoteSender: hasSender };
}

/**
 * The bar above a message whose body names content from outside it (images), in one row: the image icon and the
 * server's sentence, as given, then the actions its tree declares for the state, the first as the main one and the rest
 * quieter. At phone width the sentence keeps one line and only the first action shows, by its short label when the node
 * gives one. A blocked action stays in sight and says the server's reason in the sentence's place when pressed. A
 * message's images allowed for it alone is a question the person may close for this view.
 */
@Component({
    selector: 'app-mail-remote-bar',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (shown()) {
            <div class="mrb" role="status" [attr.data-remote]="content().state" [attr.data-said]="said() === null ? null : ''">
                <i class="bi bi-image mrb__icon" aria-hidden="true"></i>
                <span class="mrb__text" [title]="content().sentence ?? ''">{{ content().sentence }}</span>
                @if (said() !== null) {
                    <span class="mrb__said">{{ said() }}</span>
                }
                @if (actions().length > 0) {
                    <span class="mrb__actions">
                        @for (a of actions(); track a.id; let first = $first) {
                            <button type="button" class="cms-btn cms-btn-sm" [class.cms-btn-primary]="first"
                                    [attr.data-action]="a.id" [attr.data-short]="a.shortLabel"
                                    [attr.aria-label]="a.shortLabel === null ? null : a.label"
                                    [attr.aria-disabled]="a.reason === null ? null : 'true'" [title]="a.reason ?? ''"
                                    [disabled]="busy() !== null" (click)="press(a)">
                                <span class="mrb__label">{{ a.label }}</span>
                            </button>
                        }
                    </span>
                }
                @if (closable()) {
                    <button type="button" class="cms-btn cms-btn-ghost mrb__close" aria-label="Close" title="Close" (click)="closed.set(true)">
                        <i class="bi bi-x-lg" aria-hidden="true"></i>
                    </button>
                }
            </div>
        }
    `,
    styles: [`
        :host { display: block; }
        .mrb {
            display: flex; align-items: center; gap: var(--cms-space-2) var(--cms-space-3); margin: 0 0 var(--cms-space-3);
            padding: var(--cms-space-2) var(--cms-space-4); border-radius: var(--cms-radius-control);
            background: var(--cms-surface-muted); color: var(--cms-text); font-size: var(--cms-font-size-meta);
        }
        .mrb[data-remote='blocked'] { background: var(--cms-warning-subtle); color: var(--cms-warning-text); }
        .mrb__icon { flex: none; }
        .mrb__text { flex: 1 1 0; min-width: 0; }
        .mrb__said { flex: 1 1 100%; color: var(--cms-text-muted); }
        .mrb__actions { display: flex; flex: none; gap: var(--cms-space-2); margin-inline-start: auto; }
        .mrb__close { flex: none; }
        @media (max-width: 599.98px) {
            .mrb { flex-wrap: nowrap; min-height: var(--cms-touch-target-min); padding-block: 0; border-radius: 0; }
            .mrb__text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .mrb__actions > :not(:first-child) { display: none; }
            .mrb__actions [data-short] .mrb__label { display: none; }
            .mrb__actions [data-short]::after { content: attr(data-short); }
            .mrb[data-said] .mrb__text { display: none; }
            .mrb[data-said] .mrb__said { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        }
    `],
})
export class MailRemoteBarComponent {
    private readonly naviGraph = inject(NaviGraphService);

    readonly content = input.required<RemoteContentDto>();
    readonly nodes = input<readonly NaviGraphNode[]>([]);
    readonly hasSender = input(false);
    /** The action running now, or null: while one runs, none can be pressed. */
    readonly busy = input<string | null>(null);
    readonly act = output<RemoteContentAction>();

    /** A blocked action's reason, said in the bar once it is pressed. */
    readonly said = signal<string | null>(null);
    /** Closed for this view (a message allowed for itself alone). */
    readonly closed = signal(false);

    readonly actions = computed<RemoteBarAction[]>(() => {
        const facts = remoteContentFacts(this.content(), this.hasSender());
        return this.nodes()
            .filter(n => ACTIONS.includes(String(n.meta['action'])) && this.naviGraph.isVisible(n, facts))
            .map(n => {
                const disabledWhen = n.meta['disabledWhen'] as Record<string, unknown> | undefined;
                const blocked = disabledWhen !== undefined && this.naviGraph.matchesShowWhen(disabledWhen, facts);
                const label = typeof n.meta['label'] === 'string' && n.meta['label'] !== '' ? n.meta['label'] : n.title;
                const short = n.meta['shortLabel'];
                const icon = n.meta['icon'];
                const words = n.meta['disabledReasonText'];
                return {
                    id: n.meta['action'] as RemoteContentAction,
                    label,
                    shortLabel: typeof short === 'string' && short !== '' ? short : null,
                    icon: typeof icon === 'string' ? icon : null,
                    reason: blocked ? (typeof words === 'string' && words !== '' ? words : 'Not available for this message.') : null,
                };
            });
    });

    readonly closable = computed(() => this.content().state === 'allowed' && this.content().reason === 'message');
    readonly shown = computed(() => this.content().state !== 'none' && this.content().sentence !== null && !this.closed());

    press(action: RemoteBarAction): void {
        if (this.busy() !== null) {
            return;
        }
        if (action.reason !== null) {
            this.said.set(action.reason);
            return;
        }
        this.said.set(null);
        this.act.emit(action.id);
    }
}
