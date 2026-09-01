import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    OnInit,
    ViewChild,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Subject, catchError, distinctUntilChanged, filter, map, merge, of, switchMap, timer } from 'rxjs';

import {
    CmsPageHeaderComponent,
    DateTimeFormatService,
    DayGroup,
    groupByDay,
    PageTitleService,
    PageToolbarComponent,
    ToastService,
    ToolbarAction,
    UserAvatarComponent,
} from '@coolms/ui-angular';
import { avatarUserFor, ChatAvatarUser } from '../messages/chat-avatar.util';
import { ErrorHandlerService } from '@coolms/core-angular';

import { DynamicChatLiveEventsService } from './dynamic-chat-live-events.service';
import { DynamicChatService } from './dynamic-chat.service';
import { AgentConversationDto, ChatAttachmentDto, ChatMessageDto, QueueAgentDto, RoomNudge } from './dynamic-chat.types';

/** Queue auto-refresh cadence — there is no queue-level realtime channel, so
 *  the queue is polled (per-conversation nudges keep the OPEN thread live). */
const QUEUE_POLL_MS = 12_000;

/**
 * DynamicChat agent inbox (`/admin/dynamic-chat`, — closes the
 * two-way DynamicChat loop in the UI.
 *
 * **Two-pane layout** under a `cms-page-header`: the left pane is the
 * visitor queue (every active DynamicChat conversation), the right pane is the
 * selected conversation's thread + a composer.
 *
 * **Flow.** Selecting a conversation JOINs it (`POST …/join` -> the agent
 * becomes a participant + we learn our `agentParticipantId`), then reads the
 * history via the generic Chat cursor read, then subscribes to
 * `chat.room.{id}` for push. Each realtime nudge (body-less) triggers a
 * cursor pull of messages after the local high-water seq. Replies POST to
 * `/chat/messages` and append on the response (idempotent via `clientId`).
 *
 * **Realtime model.** The OPEN thread is live via Centrifugo; the QUEUE is
 * polled every {@link QUEUE_POLL_MS} (+ a manual Refresh) since the backend
 * publishes no queue-level channel. Realtime is best-effort: every read path
 * also works via poll/cursor, so a dropped socket degrades silently.
 *
 * **XSS.** Message bodies render through Angular interpolation (`{{ }}`),
 * which HTML-escapes — never `[innerHTML]`. `white-space: pre-wrap` keeps
 * the visitor's line breaks without allowing markup.
 */
@Component({
    selector: 'coolms-admin-dynamic-chat',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsPageHeaderComponent, PageToolbarComponent, UserAvatarComponent],
    template: `
        <div class="lc-page">
            <cms-page-header
                title="Dynamic Chat"
                icon="chat-left-dots"
                [subtitle]="subtitle()"
                [actions]="headerActions()"
                (actionClick)="onHeaderAction($event)">
            </cms-page-header>

            <!-- Declares nothing itself: the tree says which buttons exist, what
                 they are called and who may see them, and this emits them up to
                 the header. The bar renders nothing, every node being
                 position:header. -->
            <app-page-toolbar
                [treeSlug]="toolbarTree"
                (headerActionsChanged)="headerActions.set($event)"
                (actionClick)="onHeaderAction($event)" />

            <div class="lc-body">
                <!-- - Queue pane - -->
                <aside class="lc-queue">
                    <!-- Queue tabs: triage by claim state. New customers land
                         in Unassigned; a manager opens one to CLAIM it (-> Mine); All
                         is the full active set. Counts let a manager see load at a glance. -->
                    <div class="lc-tabs" role="tablist">
                        <button type="button" class="lc-tab" role="tab"
                                [class.lc-tab--active]="tab() === 'unassigned'"
                                [attr.aria-selected]="tab() === 'unassigned'"
                                (click)="tab.set('unassigned')">
                            Unassigned
                            @if (unassignedCount() > 0) { <span class="lc-tab__count">{{ unassignedCount() }}</span> }
                        </button>
                        <button type="button" class="lc-tab" role="tab"
                                [class.lc-tab--active]="tab() === 'mine'"
                                [attr.aria-selected]="tab() === 'mine'"
                                (click)="tab.set('mine')">
                            Mine
                            @if (mineCount() > 0) { <span class="lc-tab__count">{{ mineCount() }}</span> }
                        </button>
                        <button type="button" class="lc-tab" role="tab"
                                [class.lc-tab--active]="tab() === 'all'"
                                [attr.aria-selected]="tab() === 'all'"
                                (click)="tab.set('all')">
                            All
                            @if (conversations().length > 0) { <span class="lc-tab__count">{{ conversations().length }}</span> }
                        </button>
                    </div>

                    <div class="lc-queue-list">
                        @if (loadingQueue()) {
                            <div class="lc-empty lc-empty--sm">Loading…</div>
                        } @else if (filteredConversations().length === 0) {
                            <div class="lc-empty lc-empty--sm">
                                <i class="bi bi-inbox"></i>
                                <span>{{ emptyQueueLabel() }}</span>
                            </div>
                        } @else {
                            @for (conv of filteredConversations(); track conv.id) {
                                <button
                                    type="button"
                                    class="lc-queue-item"
                                    [class.lc-queue-item--active]="conv.id === selectedId()"
                                    (click)="select(conv)">
                                    <div class="lc-queue-item__row">
                                        <span class="lc-queue-item__title">{{ conv.title || 'Visitor' }}</span>
                                        <span class="lc-queue-item__time">{{ formatTime(conv.updatedAt) }}</span>
                                    </div>
                                    <div class="lc-queue-item__row lc-queue-item__row--meta">
                                        @if (conv.agentStatus === 'answered') {
                                            <span class="lc-badge lc-badge--answered" title="An agent replied last">Answered</span>
                                        } @else {
                                            <span class="lc-badge lc-badge--new" title="The visitor is waiting for a reply">New</span>
                                        }
                                        @if (conv.contextType === 'lead') {
                                            <span class="lc-chip" title="Linked to a captured lead">
                                                <i class="bi bi-person-lines-fill"></i> Lead
                                            </span>
                                        }
                                        @if (conv.agents?.length) {
                                            <span class="lc-agents" [title]="agentsTitle(conv)">
                                                @for (a of displayedAgents(conv); track a.userId) {
                                                    <app-user-avatar size="sm" [user]="avatarFor(a)" [status]="a.presenceStatus ?? null" />
                                                }
                                                @if (extraAgentCount(conv); as extra) {
                                                    <span class="lc-agents__more">+{{ extra }}</span>
                                                }
                                            </span>
                                        }
                                    </div>
                                </button>
                            }
                        }
                    </div>
                </aside>

                <!-- - Thread pane - -->
                <section class="lc-thread-pane">
                    @if (selectedConversation(); as conv) {
                        <header class="lc-thread-head">
                            <div class="lc-thread-head__main">
                                <span class="lc-thread-head__title">{{ conv.title || 'Visitor' }}</span>
                                <span class="lc-badge"
                                      [class.lc-badge--active]="conv.status === 'active'"
                                      [class.lc-badge--closed]="conv.status !== 'active'">
                                    {{ conv.status }}
                                </span>
                                @if (conv.agentStatus === 'answered') {
                                    <span class="lc-badge lc-badge--answered">Answered</span>
                                } @else {
                                    <span class="lc-badge lc-badge--new">New</span>
                                }
                            </div>
                            <div class="lc-thread-head__actions">
                                @if (joining()) {
                                    <span class="lc-thread-head__hint">Joining…</span>
                                } @else if (claimedHere()) {
                                    <!-- Release un-claims (leaves) so the conversation drops back
                                         to Unassigned for another manager to pick up. -->
                                    <button type="button" class="cms-btn cms-btn-ghost cms-btn-sm"
                                            [disabled]="releasing()"
                                            (click)="release(conv)"
                                            title="Un-claim — return this conversation to the Unassigned queue">
                                        <i class="bi bi-box-arrow-left"></i>
                                        <span>{{ releasing() ? 'Releasing…' : 'Release' }}</span>
                                    </button>
                                }
                            </div>
                        </header>

                        <div class="lc-thread" #thread>
                            @if (loadingThread()) {
                                <div class="lc-empty">Loading conversation…</div>
                            } @else if (messages().length === 0) {
                                <div class="lc-empty">No messages yet</div>
                            } @else {
                                @for (g of dayGroups(); track g.key) {
                                    <div class="lc-daysep">{{ g.label }}</div>
                                    @for (msg of g.items; track msg.id) {
                                    @if (msg.type === 'system' || msg.type === 'event') {
                                        <div class="lc-system">{{ msg.body }}</div>
                                    } @else {
                                        <div class="lc-msg"
                                             [class.lc-msg--mine]="isMine(msg)"
                                             [class.lc-msg--them]="!isMine(msg)">
                                            @if (msg.body) {
                                                <div class="lc-bubble">{{ msg.body }}</div>
                                            }
                                            @if (msg.attachments?.length) {
                                                <div class="lc-atts">
                                                    @for (att of msg.attachments; track att.vfsNodeId) {
                                                        @if (att.kind === 'image' && imageUrlFor(att.vfsNodeId); as url) {
                                                            <button type="button" class="lc-att-img"
                                                                    (click)="downloadFile(att)"
                                                                    [title]="att.filename">
                                                                <img [src]="url" [alt]="att.filename">
                                                            </button>
                                                        } @else {
                                                            <button type="button" class="lc-att-file"
                                                                    (click)="downloadFile(att)"
                                                                    [title]="'Download ' + att.filename">
                                                                <i class="bi"
                                                                   [class.bi-file-earmark-image]="att.kind === 'image'"
                                                                   [class.bi-paperclip]="att.kind !== 'image'"></i>
                                                                <span class="lc-att-file__name">{{ att.filename }}</span>
                                                                <span class="lc-att-file__size">{{ formatSize(att.sizeBytes) }}</span>
                                                            </button>
                                                        }
                                                    }
                                                </div>
                                            }
                                            <div class="lc-msg__time">{{ formatBubbleTime(msg.createdAt) }}</div>
                                        </div>
                                    }
                                    }
                                }
                            }
                        </div>

                        <form class="lc-composer"
                              [class.lc-composer--drag]="dragOver()"
                              (submit)="$event.preventDefault(); send()"
                              (dragover)="onDragOver($event)"
                              (dragleave)="onDragLeave($event)"
                              (drop)="onDrop($event)">
                            @if (pendingAttachments().length || uploading()) {
                                <div class="lc-pending">
                                    @for (att of pendingAttachments(); track att.vfsNodeId) {
                                        <span class="lc-pending__chip" [title]="att.filename">
                                            <i class="bi"
                                               [class.bi-file-earmark-image]="att.kind === 'image'"
                                               [class.bi-paperclip]="att.kind !== 'image'"></i>
                                            <span class="lc-pending__name">{{ att.filename }}</span>
                                            <button type="button" class="lc-pending__x"
                                                    (click)="removePending(att)" title="Remove">
                                                <i class="bi bi-x"></i>
                                            </button>
                                        </span>
                                    }
                                    @if (uploading()) {
                                        <span class="lc-pending__chip lc-pending__chip--busy">
                                            <i class="bi bi-arrow-repeat"></i> Uploading…
                                        </span>
                                    }
                                </div>
                            }
                            <div class="lc-composer__row">
                                <button type="button" class="lc-composer__attach"
                                        (click)="fileInput.click()"
                                        [disabled]="conv.status !== 'active' || joining()"
                                        title="Attach a file">
                                    <i class="bi bi-paperclip"></i>
                                </button>
                                <input #fileInput type="file" multiple hidden (change)="onFilesSelected($event)">
                                <textarea
                                    class="lc-composer__input"
                                    rows="1"
                                    placeholder="Type a reply…  (Enter to send, Shift+Enter for a new line, or drop a file)"
                                    [value]="draft()"
                                    [disabled]="conv.status !== 'active' || joining()"
                                    (input)="draft.set($any($event.target).value)"
                                    (keydown)="onComposerKeydown($event)">
                                </textarea>
                                <button
                                    type="submit"
                                    class="cms-btn cms-btn-primary lc-composer__send"
                                    [disabled]="!canSend()">
                                    <i class="bi bi-send"></i>
                                    <span>Send</span>
                                </button>
                            </div>
                        </form>
                    } @else {
                        <div class="lc-empty lc-empty--placeholder">
                            <i class="bi bi-chat-left-dots"></i>
                            <span>Select a conversation to read its history and reply.</span>
                        </div>
                    }
                </section>
            </div>
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        .lc-page { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .lc-body { display: flex; flex: 1; min-height: 0; }

        /* - Queue - */
        .lc-queue {
            width: 320px;
            flex-shrink: 0;
            border-right: 1px solid var(--cms-border);
            background: var(--cms-surface);
            display: flex;
            flex-direction: column;
            min-height: 0;
        }

        /* Queue triage tabs */
        .lc-tabs {
            display: flex;
            flex-shrink: 0;
            border-bottom: 1px solid var(--cms-border);
            background: var(--cms-surface);
        }
        .lc-tab {
            flex: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 9px 6px;
            border: 0;
            border-bottom: 2px solid transparent;
            background: transparent;
            cursor: pointer;
            font: inherit;
            font-size: .8125rem;
            font-weight: 600;
            color: var(--cms-text-secondary);
        }
        .lc-tab:hover { color: var(--cms-text); background: var(--cms-bg); }
        .lc-tab--active {
            color: var(--cms-accent-text);
            border-bottom-color: var(--cms-accent);
        }
        .lc-tab__count {
            min-width: 18px;
            padding: 0 5px;
            border-radius: 999px;
            font-size: .6875rem;
            line-height: 1.4;
            background: var(--cms-border-light);
            color: var(--cms-text-secondary);
        }
        .lc-tab--active .lc-tab__count { background: var(--cms-accent); color: var(--cms-accent-fg); }

        .lc-queue-list {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }
        .lc-queue-item {
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
            text-align: left;
            padding: 10px 14px;
            border: 0;
            border-bottom: 1px solid var(--cms-border-light);
            border-left: 3px solid transparent;
            background: transparent;
            cursor: pointer;
            font: inherit;
            color: var(--cms-text);
        }
        .lc-queue-item:hover { background: var(--cms-bg); }
        .lc-queue-item--active {
            background: var(--cms-accent-light);
            border-left-color: var(--cms-accent);
        }
        .lc-queue-item__row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .lc-queue-item__row--meta { gap: 6px; justify-content: flex-start; }
        .lc-queue-item__title {
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .lc-queue-item__time {
            flex-shrink: 0;
            font-size: .75rem;
            color: var(--cms-text-muted);
        }

        /* - Status badge + lead chip - */
        .lc-badge {
            font-size: .6875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .02em;
            padding: 1px 7px;
            border-radius: 999px;
        }
        .lc-badge--active { background: var(--cms-success-light); color: var(--cms-success-text); }
        .lc-badge--closed { background: var(--cms-border-light);  color: var(--cms-text-secondary); }
        /* Triage status: New = visitor waiting (attention), Answered = agent replied last (calm). */
        .lc-badge--new      { background: var(--cms-warning-light); color: var(--cms-warning-text); }
        .lc-badge--answered { background: var(--cms-border-light);  color: var(--cms-text-secondary); }
        .lc-chip {
            font-size: .6875rem;
            font-weight: 600;
            color: var(--cms-info-text);
            background: var(--cms-info-light);
            padding: 1px 7px;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        /* Handling-agent avatar stack on a queue row. */
        .lc-agents {
            display: inline-flex;
            align-items: center;
            margin-left: auto;
        }
        .lc-agents app-user-avatar:not(:first-child) {
            margin-left: -6px;
        }
        .lc-agents__more {
            margin-left: 3px;
            font-size: .625rem;
            font-weight: 600;
            color: var(--cms-text-secondary, #6b7280);
        }

        /* - Thread pane - */
        .lc-thread-pane {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            background: var(--cms-bg);
        }
        .lc-thread-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 10px 18px;
            min-height: 48px;
            border-bottom: 1px solid var(--cms-border);
            background: var(--cms-surface);
            flex-shrink: 0;
        }
        .lc-thread-head__main { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .lc-thread-head__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .lc-thread-head__title {
            font-weight: 600;
            font-size: 1rem;
            color: var(--cms-text);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .lc-thread-head__hint { font-size: .8125rem; color: var(--cms-text-muted); }

        .lc-thread {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 16px 18px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .lc-msg {
            display: flex;
            flex-direction: column;
            max-width: 72%;
        }
        .lc-msg--them { align-self: flex-start; align-items: flex-start; }
        .lc-msg--mine { align-self: flex-end;   align-items: flex-end; }
        .lc-bubble {
            padding: 8px 12px;
            border-radius: var(--cms-radius-lg);
            font-size: .9375rem;
            line-height: 1.4;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .lc-msg--them .lc-bubble {
            background: var(--cms-surface);
            color: var(--cms-text);
            border: 1px solid var(--cms-border);
            border-bottom-left-radius: var(--cms-radius-sm);
        }
        .lc-msg--mine .lc-bubble {
            background: var(--cms-accent);
            color: var(--cms-accent-fg);
            border-bottom-right-radius: var(--cms-radius-sm);
        }
        .lc-msg__time {
            font-size: .6875rem;
            color: var(--cms-text-muted);
            margin-top: 2px;
            padding: 0 4px;
        }
        .lc-system {
            align-self: center;
            font-size: .75rem;
            color: var(--cms-text-secondary);
            background: var(--cms-border-light);
            padding: 3px 10px;
            border-radius: 999px;
            white-space: pre-wrap;
            word-break: break-word;
            max-width: 80%;
            text-align: center;
        }
        /* Per-day separator chip — one date pill above each day's run, so
         * the bubbles only carry the time. Mirrors the Messages thread. */
        .lc-daysep {
            align-self: center;
            margin: 6px 0 2px;
            padding: 2px 11px;
            font-size: .7rem;
            font-weight: 600;
            color: var(--cms-text-secondary);
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: 999px;
        }

        /* - Message attachments - */
        .lc-atts {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 4px;
        }
        .lc-att-img {
            padding: 0;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            overflow: hidden;
            cursor: pointer;
            background: var(--cms-surface);
            line-height: 0;
        }
        .lc-att-img img {
            display: block;
            max-width: 220px;
            max-height: 220px;
            object-fit: cover;
        }
        .lc-att-file {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            max-width: 260px;
            padding: 7px 10px;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            background: var(--cms-surface);
            color: var(--cms-text);
            cursor: pointer;
            font: inherit;
            text-align: left;
        }
        .lc-att-file:hover { background: var(--cms-bg); }
        .lc-att-file .bi { font-size: 1.1rem; color: var(--cms-text-secondary); flex-shrink: 0; }
        .lc-att-file__name {
            font-size: .8125rem;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .lc-att-file__size { font-size: .6875rem; color: var(--cms-text-muted); flex-shrink: 0; }
        .lc-msg--mine .lc-att-file { /* keep file chips readable on the accent side */
            background: var(--cms-surface);
            color: var(--cms-text);
        }

        /* - Composer - */
        .lc-composer {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px 18px;
            border-top: 1px solid var(--cms-border);
            background: var(--cms-surface);
            flex-shrink: 0;
        }
        .lc-composer--drag {
            outline: 2px dashed var(--cms-accent);
            outline-offset: -6px;
            background: var(--cms-accent-light);
        }
        .lc-composer__row { display: flex; align-items: flex-end; gap: 10px; }
        .lc-composer__attach {
            flex-shrink: 0;
            width: 38px;
            height: 38px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            background: var(--cms-surface);
            color: var(--cms-text-secondary);
            cursor: pointer;
            font-size: 1.05rem;
        }
        .lc-composer__attach:hover:not(:disabled) { background: var(--cms-bg); color: var(--cms-text); }
        .lc-composer__attach:disabled { opacity: .5; cursor: not-allowed; }

        /* - Pending (staged) attachments - */
        .lc-pending { display: flex; flex-wrap: wrap; gap: 6px; }
        .lc-pending__chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            max-width: 220px;
            padding: 3px 4px 3px 8px;
            border: 1px solid var(--cms-border);
            border-radius: 999px;
            background: var(--cms-bg);
            font-size: .75rem;
            color: var(--cms-text);
        }
        .lc-pending__chip--busy { color: var(--cms-text-muted); padding-right: 10px; }
        .lc-pending__name {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .lc-pending__x {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            border: 0;
            border-radius: 999px;
            background: transparent;
            color: var(--cms-text-muted);
            cursor: pointer;
            flex-shrink: 0;
        }
        .lc-pending__x:hover { background: var(--cms-border-light); color: var(--cms-text); }

        .lc-composer__input {
            flex: 1;
            resize: none;
            max-height: 140px;
            min-height: 38px;
            padding: 8px 12px;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            font: inherit;
            line-height: 1.4;
            color: var(--cms-text);
            background: var(--cms-surface);
        }
        .lc-composer__input:focus {
            outline: none;
            border-color: var(--cms-accent);
        }
        .lc-composer__input:disabled { background: var(--cms-bg); cursor: not-allowed; }
        .lc-composer__send { flex-shrink: 0; }

        /* - Empty states - */
        .lc-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 10px;
            flex: 1;
            color: var(--cms-text-muted);
            font-size: .9375rem;
            padding: 24px;
            text-align: center;
        }
        .lc-empty .bi { font-size: 1.75rem; opacity: .7; }
        .lc-empty--sm { flex: none; padding: 28px 14px; }
        .lc-empty--placeholder { margin: auto; }
    `],
})
export class DynamicChatPageComponent implements OnInit {
    @ViewChild('thread') private readonly threadEl?: ElementRef<HTMLElement>;

    private readonly api        = inject(DynamicChatService);
    private readonly live       = inject(DynamicChatLiveEventsService);

    /** WS connection state as a stream (built in the injection context, ). */
    private readonly connected$ = toObservable(this.live.isConnected);
    private readonly toast      = inject(ToastService);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly route      = inject(ActivatedRoute);
    private readonly router     = inject(Router);
    private readonly dtf        = inject(DateTimeFormatService);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * Conversation id to auto-select once the queue has loaded it, from a
     * `?c=<id>` deep-link (the topbar quick-panel, ). One-shot: cleared
     * after it's applied so a later poll can't yank the agent back to it; a new
     * `?c=` value re-arms it.
     */
    private pendingPreselect: string | null = null;

    // - Queue state -
    readonly conversations = signal<ReadonlyArray<AgentConversationDto>>([]);
    readonly loadingQueue  = signal(true);
    private readonly queueReload$ = new Subject<void>();

    /** Queue triage tab: Unassigned (no agent) / Mine (I claimed it) / All. */
    readonly tab = signal<'unassigned' | 'mine' | 'all'>('all');

    // - Thread state -
    readonly selectedId         = signal<string | null>(null);
    readonly agentParticipantId = signal<string | null>(null);
    readonly messages           = signal<ReadonlyArray<ChatMessageDto>>([]);
    /** Thread bucketed into per-day groups for the WhatsApp-style date separators. */
    readonly dayGroups = computed<DayGroup<ChatMessageDto>[]>(
        () => groupByDay(this.messages(), m => m.createdAt, this.dtf),
    );
    readonly loadingThread      = signal(false);
    readonly joining            = signal(false);
    readonly releasing          = signal(false);
    readonly sending            = signal(false);
    readonly draft              = signal('');

    // - Attachment state -
    /** Files uploaded but not yet sent (staged in the composer). */
    readonly pendingAttachments = signal<ReadonlyArray<ChatAttachmentDto>>([]);
    /** Count of in-flight uploads (composer is busy while > 0). */
    readonly uploadingCount     = signal(0);
    readonly uploading          = computed(() => this.uploadingCount() > 0);
    readonly dragOver           = signal(false);
    /** Object URLs for already-fetched image attachments, keyed by node id. */
    readonly imageUrls          = signal<ReadonlyMap<string, string>>(new Map());
    /** Node ids whose image fetch is in flight (avoid duplicate requests). */
    private readonly imageLoading = new Set<string>();
    /** All object URLs we minted, revoked on destroy to avoid leaks. */
    private readonly createdUrls  = new Set<string>();

    readonly selectedConversation = computed(() =>
        this.conversations().find(c => c.id === this.selectedId()) ?? null,
    );

    // - Queue triage -
    /** Unassigned = no joined agent; Mine = I claimed it; All = everything. */
    readonly filteredConversations = computed(() => {
        const all = this.conversations();
        switch (this.tab()) {
            case 'unassigned': return all.filter(c => !(c.agents?.length));
            case 'mine':       return all.filter(c => c.assignedToMe === true);
            default:           return all;
        }
    });
    readonly unassignedCount = computed(() => this.conversations().filter(c => !(c.agents?.length)).length);
    readonly mineCount       = computed(() => this.conversations().filter(c => c.assignedToMe === true).length);
    readonly emptyQueueLabel = computed(() => {
        switch (this.tab()) {
            case 'unassigned': return 'No unassigned conversations';
            case 'mine':       return 'You have not claimed any conversations';
            default:           return 'No open conversations';
        }
    });

    /**
     * TRUE when the OPEN conversation is claimed by me — so the Release control
     * shows. `agentParticipantId` is set the moment we join (immediate, this
     * session); `assignedToMe` is the backend truth that survives the next poll.
     */
    readonly claimedHere = computed(() =>
        this.agentParticipantId() !== null || this.selectedConversation()?.assignedToMe === true,
    );

    readonly subtitle = computed(() => {
        if (this.loadingQueue()) return 'Loading the visitor queue…';
        const n = this.conversations().length;
        return n === 0
            ? 'No open visitor conversations'
            : `${n} open conversation${n === 1 ? '' : 's'}`;
    });

    /** @see AgentToolbarContributor — the server owns which buttons exist. */
    readonly toolbarTree = 'navi.toolbar.dynamic_chat.agent';

    /**
     * Filled from the toolbar tree, not built here.
     *
     * Nothing about a button — its label, its icon, whether an admin-only one
     * appears at all — is a decision this component should be making. The tree
     * is filtered by permission server-side, so an agent who is not an admin
     * never receives the Settings node, rather than receiving it and having it
     * hidden.
     */
    readonly headerActions = signal<ToolbarAction[]>([]);

    readonly canSend = computed(() => {
        const conv = this.selectedConversation();
        return conv !== null
            && conv.status === 'active'
            && !this.joining()
            && !this.sending()
            && !this.uploading()
            && (this.draft().trim() !== '' || this.pendingAttachments().length > 0);
    });

    constructor() {
        // QUEUE — realtime-first: refetch on a `queue.changed` nudge, on
        // each WS (re)connect, on manual Refresh, OR on a fallback timer tick that
        // only fires while the WS is DISCONNECTED (so polling is a true no-WS
        // fallback, not a parallel 12s poll). Errors -> null so a transient failure
        // leaves the last good list.
        //  The fallback tick and the connect signal both fire at cold load
        // (~420ms apart), so `switchMap` aborts the first request mid-flight and
        // DevTools shows a cancelled `agent/conversations` on every page open.
        // That is correct behaviour and it was MEASURED not worth removing
        //: this first tick IS the queue's initial load, so any coalescing
        // window delays the queue appearing by exactly that window, and the
        // window has to be wider than the connect gap to suppress anything. A
        // cancelled request nobody can feel, traded for a queue that paints late
        // on every open — the trade is the wrong way round. Left deliberately.
        merge(
            timer(0, QUEUE_POLL_MS).pipe(filter(() => !this.live.isConnected())),
            this.queueReload$,
            this.live.watchQueue().pipe(catchError(() => EMPTY)),
            this.connected$.pipe(distinctUntilChanged(), filter(connected => connected)),
        )
            .pipe(
                switchMap(() =>
                    this.api.listQueue().pipe(
                        catchError(() => of<AgentConversationDto[] | null>(null)),
                    ),
                ),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(list => {
                this.loadingQueue.set(false);
                if (list !== null) {
                    this.conversations.set(list);
                    this.tryApplyPreselect();
                }
            });

        // `?c=<id>` deep-link from the topbar quick-panel: arm the
        // preselect on each distinct value; it's applied once the queue contains it.
        this.route.queryParamMap
            .pipe(
                map(p => p.get('c')),
                distinctUntilChanged(),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(cid => {
                this.pendingPreselect = cid;
                this.tryApplyPreselect();
            });

        // OPEN THREAD — (re)subscribe to the room channel whenever the
        // selected conversation changes. Subscribing needs no membership;
        // the nudge handler no-ops until we've joined.
        toObservable(this.selectedId)
            .pipe(
                switchMap(id => (id === null ? EMPTY : this.live.watchRoom(id))),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: nudge => this.onRoomNudge(nudge),
                error: () => { /* realtime degrades silently — cursor read covers it */ },
            });

        // Release every image object URL we created when the page is torn down.
        this.destroyRef.onDestroy(() => {
            for (const url of this.createdUrls) {
                URL.revokeObjectURL(url);
            }
            this.createdUrls.clear();
        });
    }

    ngOnInit(): void {
        this.titleSvc.set('Dynamic Chat');
    }

    onHeaderAction(id: string): void {
        if (id === 'refresh') {
            this.queueReload$.next();
        } else if (id === 'settings') {
            // The module's settings, not one block of them.
            void this.router.navigate(['/settings', 'dynamic-chat']);
        }
    }

    /**
     * Apply a pending `?c=` preselect once the queue contains that conversation
     *. One-shot: clears `pendingPreselect` after selecting so a later
     * poll can't drag the agent back if they navigate to another conversation.
     */
    private tryApplyPreselect(): void {
        const cid = this.pendingPreselect;
        if (cid === null) {
            return;
        }
        const conv = this.conversations().find(c => c.id === cid);
        if (conv === undefined) {
            return; // not loaded yet — a later poll retries
        }
        this.pendingPreselect = null;
        if (this.selectedId() !== cid) {
            this.select(conv);
        }
    }

    /** Open a conversation: join (-> participant + agentParticipantId), then load history. */
    select(conv: AgentConversationDto): void {
        if (this.selectedId() === conv.id) {
            return;
        }
        this.selectedId.set(conv.id);
        this.agentParticipantId.set(null);
        this.messages.set([]);
        this.draft.set('');
        this.pendingAttachments.set([]);
        this.loadingThread.set(true);
        this.joining.set(true);

        this.api.join(conv.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: res => {
                    this.joining.set(false);
                    if (this.selectedId() !== conv.id) {
                        return; // user switched away mid-join
                    }
                    this.agentParticipantId.set(res.agentParticipantId ?? null);
                    this.loadThread(conv.id);
                },
                error: err => {
                    this.joining.set(false);
                    this.loadingThread.set(false);
                    this.toast.error(this.errors.humanize(err));
                },
            });
    }

    /**
     * Un-claim (release) a conversation: leave it server-side so it returns to
     * the Unassigned queue, then close the open thread + refresh the queue
     *. Idempotent on the backend, so a double-click is harmless.
     */
    release(conv: AgentConversationDto): void {
        if (this.releasing()) {
            return;
        }
        this.releasing.set(true);
        this.api.release(conv.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.releasing.set(false);
                    this.toast.success('Conversation released to the queue.');
                    // We're no longer the agent here — drop the open thread if it's this one.
                    if (this.selectedId() === conv.id) {
                        this.selectedId.set(null);
                        this.agentParticipantId.set(null);
                        this.messages.set([]);
                        this.draft.set('');
                        this.pendingAttachments.set([]);
                    }
                    this.queueReload$.next();
                },
                error: err => {
                    this.releasing.set(false);
                    this.toast.error(this.errors.humanize(err));
                },
            });
    }

    private loadThread(conversationId: string): void {
        this.api.listMessages(conversationId, 0)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: msgs => {
                    if (this.selectedId() !== conversationId) {
                        return; // stale — user moved on
                    }
                    this.messages.set([...msgs].sort((a, b) => a.seq - b.seq));
                    this.loadingThread.set(false);
                    this.hydrateImageAttachments(msgs);
                    this.scrollToBottomSoon();
                },
                error: err => {
                    this.loadingThread.set(false);
                    this.toast.error(this.errors.humanize(err));
                },
            });
    }

    /** A body-less nudge arrived — pull anything past our local high-water seq. */
    private onRoomNudge(nudge: RoomNudge): void {
        const id = this.selectedId();
        if (id === null || nudge.conversationId !== id || this.agentParticipantId() === null) {
            return;
        }
        if (nudge.seq <= this.maxSeq()) {
            return; // already have it (e.g. our own just-posted message)
        }
        this.api.listMessages(id, this.maxSeq())
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: msgs => {
                    if (this.selectedId() === id) {
                        this.appendMessages(msgs);
                    }
                },
                error: () => { /* best-effort catch-up */ },
            });
    }

    send(): void {
        const id = this.selectedId();
        const body = this.draft().trim();
        const attachments = this.pendingAttachments();
        // An attachment-only message is valid (the backend allows it); a fully
        // empty send (no body, no attachments) is not.
        if (id === null || (body === '' && attachments.length === 0)
            || this.sending() || this.joining() || this.uploading()) {
            return;
        }
        this.sending.set(true);
        const clientId = crypto.randomUUID();

        this.api.postMessage(id, body, clientId, attachments)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: msg => {
                    this.sending.set(false);
                    this.draft.set('');
                    this.pendingAttachments.set([]);
                    if (this.selectedId() === id) {
                        this.appendMessages([msg]);
                        this.hydrateImageAttachments([msg]);
                    }
                },
                error: err => {
                    this.sending.set(false);
                    this.toast.error(this.errors.humanize(err));
                },
            });
    }

    onComposerKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.send();
        }
    }

    isMine(msg: ChatMessageDto): boolean {
        const me = this.agentParticipantId();
        return me !== null && msg.senderParticipantId === me;
    }

    /**
     * Today -> time; older -> date + time, in the user's tz + 12h/24h pref.
     * Delegates to the shared {@link DateTimeFormatService} so the queue rows +
     * thread bubbles match the Calendar (was a raw `toLocaleTimeString` that
     * ignored the saved pref -> always the browser locale's 12h).
     */
    formatTime(iso: string | null): string {
        return this.dtf.auto(iso);
    }

    /** Per-bubble thread timestamp = TIME only — the date lives on the per-day separator chip. */
    formatBubbleTime(iso: string | null): string {
        return this.dtf.time(iso);
    }

    /** At most this many handling-agent avatars render in a queue row; the rest collapse to "+N". */
    private static readonly MAX_QUEUE_AGENTS = 3;

    /** The handling agents shown as avatars in a queue row (capped, ). */
    displayedAgents(conv: AgentConversationDto): readonly QueueAgentDto[] {
        return (conv.agents ?? []).slice(0, DynamicChatPageComponent.MAX_QUEUE_AGENTS);
    }

    /** How many handling agents are hidden behind the "+N" overflow (0 = none). */
    extraAgentCount(conv: AgentConversationDto): number {
        return Math.max(0, (conv.agents?.length ?? 0) - DynamicChatPageComponent.MAX_QUEUE_AGENTS);
    }

    /** Build the avatar descriptor for a handling agent (photo if any, else colored initials). */
    avatarFor(agent: QueueAgentDto): ChatAvatarUser {
        return avatarUserFor(agent.displayName, agent.userId, agent.avatarUrl);
    }

    /** Tooltip listing the agents handling a conversation, e.g. "Handled by Sarah, Mike". */
    agentsTitle(conv: AgentConversationDto): string {
        const names = (conv.agents ?? []).map(a => a.displayName ?? 'Agent');
        return names.length ? `Handled by ${names.join(', ')}` : '';
    }

    formatSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        const kb = bytes / 1024;
        return kb < 1024 ? `${kb.toFixed(kb < 10 ? 1 : 0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
    }

    // - Attachment uploads (composer) -

    /** A file picked from the hidden `<input type=file>` — upload + stage it. */
    onFilesSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files) {
            this.uploadFiles(input.files);
        }
        input.value = ''; // allow re-picking the same file
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        if (this.canAttach()) {
            this.dragOver.set(true);
        }
    }

    onDragLeave(event: DragEvent): void {
        event.preventDefault();
        this.dragOver.set(false);
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        this.dragOver.set(false);
        if (this.canAttach() && event.dataTransfer?.files?.length) {
            this.uploadFiles(event.dataTransfer.files);
        }
    }

    removePending(att: ChatAttachmentDto): void {
        this.pendingAttachments.set(this.pendingAttachments().filter(a => a.vfsNodeId !== att.vfsNodeId));
    }

    /** Whether attaching is currently permitted (active, joined conversation). */
    private canAttach(): boolean {
        const conv = this.selectedConversation();
        return conv !== null && conv.status === 'active' && !this.joining();
    }

    /** Upload each file independently; stage the descriptors as they return. */
    private uploadFiles(files: FileList | readonly File[]): void {
        if (!this.canAttach()) {
            return;
        }
        for (const file of Array.from(files)) {
            this.uploadingCount.update(n => n + 1);
            this.api.uploadAttachment(file)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: att => {
                        this.uploadingCount.update(n => Math.max(0, n - 1));
                        this.pendingAttachments.set([...this.pendingAttachments(), att]);
                    },
                    error: err => {
                        this.uploadingCount.update(n => Math.max(0, n - 1));
                        this.toast.error(this.errors.humanize(err));
                    },
                });
        }
    }

    // - Attachment rendering (thread) -

    /** The object URL for an image attachment, or null while it loads. */
    imageUrlFor(nodeId: string): string | null {
        return this.imageUrls().get(nodeId) ?? null;
    }

    /** Fetch the bytes of every not-yet-loaded image attachment in these messages. */
    private hydrateImageAttachments(msgs: ReadonlyArray<ChatMessageDto>): void {
        for (const msg of msgs) {
            for (const att of msg.attachments ?? []) {
                if (att.kind !== 'image'
                    || this.imageUrls().has(att.vfsNodeId)
                    || this.imageLoading.has(att.vfsNodeId)) {
                    continue;
                }
                this.imageLoading.add(att.vfsNodeId);
                this.api.downloadAttachment(att.vfsNodeId)
                    .pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe({
                        next: blob => {
                            this.imageLoading.delete(att.vfsNodeId);
                            const url = URL.createObjectURL(blob);
                            this.createdUrls.add(url);
                            this.imageUrls.set(new Map(this.imageUrls()).set(att.vfsNodeId, url));
                        },
                        error: () => {
                            this.imageLoading.delete(att.vfsNodeId);
                            // Leave it unresolved — the chip fallback renders instead.
                        },
                    });
            }
        }
    }

    /** Download any attachment (file chip or image) via the authenticated GET. */
    downloadFile(att: ChatAttachmentDto): void {
        this.api.downloadAttachment(att.vfsNodeId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = att.filename;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 0);
                },
                error: err => this.toast.error(this.errors.humanize(err)),
            });
    }

    private maxSeq(): number {
        return this.messages().reduce((max, m) => (m.seq > max ? m.seq : max), 0);
    }

    /** Merge fresh messages, dedupe by seq, keep seq order, then scroll. */
    private appendMessages(incoming: ReadonlyArray<ChatMessageDto>): void {
        if (incoming.length === 0) {
            return;
        }
        const seen = new Set(this.messages().map(m => m.seq));
        const fresh = incoming.filter(m => !seen.has(m.seq));
        if (fresh.length === 0) {
            return;
        }
        this.messages.set([...this.messages(), ...fresh].sort((a, b) => a.seq - b.seq));
        this.hydrateImageAttachments(fresh);
        this.scrollToBottomSoon();
    }

    private scrollToBottomSoon(): void {
        setTimeout(() => {
            const el = this.threadEl?.nativeElement;
            if (el) {
                el.scrollTop = el.scrollHeight;
            }
        }, 0);
    }
}
