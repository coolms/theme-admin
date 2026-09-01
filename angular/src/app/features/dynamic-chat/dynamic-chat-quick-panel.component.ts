import {
    ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { EMPTY, catchError, filter, interval, merge, startWith, switchMap } from 'rxjs';

import { UserAvatarComponent } from '@coolms/ui-angular';
import { avatarUserFor, ChatAvatarUser } from '../messages/chat-avatar.util';
import { sortQueue } from './agent-queue.util';
import { DynamicChatService } from './dynamic-chat.service';
import { DynamicChatLiveEventsService } from './dynamic-chat-live-events.service';
import { AgentConversationDto, QueueAgentDto } from './dynamic-chat.types';

/**
 * DynamicChat quick-panel, Slice C) — the right-drawer content for
 * the topbar agent-queue launcher ({@link DynamicChatQuickAccessComponent}),
 * mirroring the Messages quick-panel pattern ([]). A compact PREVIEW of the
 * visitor queue, **New-first** (the ones waiting for a reply on top), each row
 * showing the [] triage status, an unclaimed hint, and the [] handling-
 * agent avatars so a manager sees at a glance "who needs answering / who's on it".
 *
 * Tapping a row jumps to the full agent workspace at `/dynamic-chat?c=<id>`
 * (the rich two-pane queue + thread + composer live there; the page reads `?c=`
 * and selects = claims it). The {@link DrawerService} auto-closes on
 * `NavigationEnd`, so the jump closes the drawer for free. A footer link opens
 * the workspace without preselecting.
 *
 * The queue has no realtime channel, so it's loaded on open + re-polled on a
 * slow cadence while the drawer is open (best-effort; a blip keeps the last list).
 */
@Component({
    selector: 'app-dynamic-chat-quick-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UserAvatarComponent],
    template: `
        <div class="dcqp">
            @if (loading() && conversations().length === 0) {
                <p class="dcqp__hint">Loading the visitor queue…</p>
            } @else if (conversations().length === 0) {
                <div class="dcqp__empty">
                    <i class="bi bi-inbox"></i>
                    <span>No open conversations</span>
                </div>
            } @else {
                <div class="dcqp__list">
                    @for (conv of sorted(); track conv.id) {
                        <button type="button" class="dcqp__row" (click)="open(conv)">
                            <div class="dcqp__row-top">
                                <span class="dcqp__title">{{ conv.title || 'Visitor' }}</span>
                                @if (conv.agentStatus === 'answered') {
                                    <span class="dcqp__badge dcqp__badge--answered">Answered</span>
                                } @else {
                                    <span class="dcqp__badge dcqp__badge--new">New</span>
                                }
                            </div>
                            <div class="dcqp__row-meta">
                                @if (conv.agents?.length) {
                                    <span class="dcqp__agents" [title]="agentsTitle(conv)">
                                        @for (a of displayedAgents(conv); track a.userId) {
                                            <app-user-avatar size="sm" [user]="avatarFor(a)" [status]="a.presenceStatus ?? null" />
                                        }
                                        @if (extraAgentCount(conv); as extra) {
                                            <span class="dcqp__more">+{{ extra }}</span>
                                        }
                                    </span>
                                } @else {
                                    <span class="dcqp__unclaimed"><i class="bi bi-person-dash"></i> Unclaimed</span>
                                }
                                @if (conv.assignedToMe) {
                                    <span class="dcqp__mine"><i class="bi bi-person-check"></i> Mine</span>
                                }
                            </div>
                        </button>
                    }
                </div>
            }

            <button type="button" class="dcqp__open" (click)="openWorkspace()">
                <i class="bi bi-box-arrow-up-right"></i> Open Dynamic Chat
            </button>
        </div>
    `,
    styles: [`
        .dcqp { display: flex; flex-direction: column; height: 100%; min-height: 0; }
        .dcqp__hint { padding: 16px; color: var(--cms-text-muted); font-size: .875rem; }
        .dcqp__empty {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 8px; padding: 32px 16px; color: var(--cms-text-muted); text-align: center;
        }
        .dcqp__empty .bi { font-size: 1.75rem; opacity: .7; }

        .dcqp__list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
        .dcqp__row {
            display: flex; flex-direction: column; gap: 6px; width: 100%;
            text-align: left; padding: 10px 14px; border: 0;
            border-bottom: 1px solid var(--cms-border-light); background: transparent;
            cursor: pointer; font: inherit; color: var(--cms-text);
        }
        .dcqp__row:hover { background: var(--cms-bg); }
        .dcqp__row-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .dcqp__title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dcqp__row-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

        .dcqp__badge {
            font-size: .6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: .02em;
            padding: 1px 7px; border-radius: 999px; flex-shrink: 0;
        }
        .dcqp__badge--new      { background: var(--cms-warning-light); color: var(--cms-warning-text); }
        .dcqp__badge--answered { background: var(--cms-border-light);  color: var(--cms-text-secondary); }

        .dcqp__agents { display: inline-flex; align-items: center; }
        .dcqp__agents app-user-avatar:not(:first-child) { margin-left: -6px; }
        .dcqp__more { margin-left: 3px; font-size: .625rem; font-weight: 600; color: var(--cms-text-secondary); }

        .dcqp__unclaimed, .dcqp__mine {
            display: inline-flex; align-items: center; gap: 4px;
            font-size: .6875rem; font-weight: 600; padding: 1px 7px; border-radius: 999px;
        }
        .dcqp__unclaimed { color: var(--cms-text-secondary); background: var(--cms-border-light); }
        .dcqp__mine      { color: var(--cms-info-text);      background: var(--cms-info-light); }

        .dcqp__open {
            flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
            width: 100%; padding: 10px; border: 0; border-top: 1px solid var(--cms-border);
            background: var(--cms-surface); color: var(--cms-accent-text);
            cursor: pointer; font: inherit; font-weight: 600;
        }
        .dcqp__open:hover { background: var(--cms-bg); }
    `],
})
export class DynamicChatQuickPanelComponent implements OnInit {
    private readonly api        = inject(DynamicChatService);
    private readonly live       = inject(DynamicChatLiveEventsService);
    private readonly router     = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    readonly conversations = signal<ReadonlyArray<AgentConversationDto>>([]);
    readonly loading       = signal(true);

    /** Re-poll cadence while the (transient) drawer is open. */
    private static readonly POLL_MS = 15_000;
    /** Cap on handling-agent avatars per row before collapsing to "+N". */
    private static readonly MAX_AGENTS = 2;

    ngOnInit(): void {
        // Realtime-first while the drawer is open: an initial load on open
        // (`startWith`), then refetch on a `queue.changed` nudge, or on a fallback
        // timer tick that fires only while the WS is DISCONNECTED (so the open-only
        // poll is a true no-WS fallback, not a parallel 15s poll).
        merge(
            interval(DynamicChatQuickPanelComponent.POLL_MS).pipe(filter(() => !this.live.isConnected())),
            this.live.watchQueue().pipe(catchError(() => EMPTY)),
        )
            .pipe(
                startWith(0),
                switchMap(() => this.api.listQueue().pipe(catchError(() => EMPTY))),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(list => {
                this.loading.set(false);
                this.conversations.set(list);
            });
    }

    /** New (waiting) conversations first, then most-recently-active. */
    sorted(): readonly AgentConversationDto[] {
        return sortQueue(this.conversations());
    }

    open(conv: AgentConversationDto): void {
        // Deep-link into the full workspace, preselecting (= the page claims it).
        this.router.navigate(['/dynamic-chat'], { queryParams: { c: conv.id } });
    }

    openWorkspace(): void {
        this.router.navigate(['/dynamic-chat']);
    }

    displayedAgents(conv: AgentConversationDto): readonly QueueAgentDto[] {
        return (conv.agents ?? []).slice(0, DynamicChatQuickPanelComponent.MAX_AGENTS);
    }

    extraAgentCount(conv: AgentConversationDto): number {
        return Math.max(0, (conv.agents?.length ?? 0) - DynamicChatQuickPanelComponent.MAX_AGENTS);
    }

    avatarFor(agent: QueueAgentDto): ChatAvatarUser {
        return avatarUserFor(agent.displayName, agent.userId, agent.avatarUrl);
    }

    agentsTitle(conv: AgentConversationDto): string {
        const names = (conv.agents ?? []).map(a => a.displayName ?? 'Agent');
        return names.length ? `Handled by ${names.join(', ')}` : '';
    }
}
