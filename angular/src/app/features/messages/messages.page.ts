import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    HostListener,
    OnDestroy,
    OnInit,
    ViewEncapsulation,
    computed,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngxs/store';
import { EMPTY, Subject, catchError, debounceTime, distinctUntilChanged, filter, fromEvent, interval, map, merge, switchMap } from 'rxjs';
import { CoolmsEditorComponent } from '@coolms/editor-angular';
import { AppConfigState, AuthState, CmsLoaderComponent } from '@coolms/core-angular';
import { CmsPageHeaderComponent, CmsPaneSplitterComponent, DateTimeFormatService, DateTimePipe, DayGroup, groupByDay, ToastService, UserAvatarComponent, UserSearchSelectComponent } from '@coolms/ui-angular';
import { VfsSecureImgDirective } from '../vfs/vfs-secure-img.directive';
import { avatarUserFor, ChatAvatarUser } from './chat-avatar.util';
import { ChatPresenceLiveService } from './chat-presence-live.service';
import { firstInboxPage, InboxPage, nextInboxPage, refreshWindow } from './inbox-paging.util';
import { conversationLabel, lastActivityTs, presenceDot, rowPreview as rowPreviewOf, unreadFor } from './conversation-row.util';
import { advanceReadOverride, mayMarkRead } from './mark-read.util';
import { mentionsUser } from './mentions.util';
import { advancePeerCursor, peerReadCursors, readByEveryoneSeq } from './read-receipts.util';
import { channelTriggerAt, linkifyChannelRefs, matchChannels } from './channel-refs.util';
import { MentionDirectoryUser, MessagesService } from './messages.service';
import { ChatRoomNudge, MessagesLiveEventsService } from './messages-live-events.service';
import { ChatAttachmentDto, ChatChannelDto, ChatConversationDto, ChatMessageDto, ConversationParticipantDto, MentionCandidate, MentionRef, ReactionRef } from './messages.types';
import { RtcCallService } from '../rtc/rtc-call.service';
import { RtcMediaKind } from '../rtc/rtc.types';

/**
 * Internal Messages (`/admin/messages`, ledger #1007 shell · #1008 rich composer
 * · #1009 attachments · #1010 realtime · #1011 emoji · #1019 self-set status ·
 * #1023 connection-derived online dot) — the user↔user chat
 * surface over the generic Chat engine. Two panes:
 *  - LEFT: the current user's conversations + a "New message" user picker that
 *    opens (or reuses) a 1:1 DM via `POST /chat/conversations {withUserId}` (#1006).
 *  - RIGHT: the selected thread + a rich-text composer.
 *
 * Realtime (#1010): subscribing to the selected conversation's
 * `chat.room.{id}` Centrifugo channel ({@link MessagesLiveEventsService}) makes
 * new messages appear instantly — on a body-less `message.posted` nudge we
 * cursor-refetch anything past our local `lastSeq`. A slow (20s) reconcile poll
 * is kept as a safety net for when realtime is unavailable (e.g. the Messenger
 * worker is down); both feed the same dedupe-by-id merge.
 *
 * The composer is the `comment`-profile `<coolms-editor>` (bold/italic/strike/
 * sup/sub/link) and posts `bodyFormat:html` — the backend sanitises the HTML to
 * the comment allow-list on write (#1005), so nothing unsafe ever persists.
 * Messages render html via Angular's auto-sanitised `[innerHTML]` (plain bodies
 * still escape through `{{ }}`). Enter sends; Shift+Enter inserts a newline
 * (a capture-phase intercept stops ProseMirror from splitting the paragraph on
 * a bare Enter).
 *
 * Attachments (#1009): a 📎 button uploads each picked file to the user's private
 * chat-uploads store (`POST /chat/attachments`, multipart) → pending chips →
 * `doSend()` threads the descriptors into the message (an attachment-only message
 * with an empty body is allowed). On a message, image attachments render inline
 * via the auth-aware `[vfsSecureSrc]` directive (Bearer → blob → object URL);
 * other files render a download chip that fetches the blob and triggers a
 * browser download. Emoji + realtime are follow-up slices.
 *
 * "My" messages are matched by `senderParticipantId === my participant id`
 * (resolved from the conversation's `participants` by my user id).
 *
 * `ViewEncapsulation.None` (mirrors RichTextFieldComponent + the editor itself):
 * required so the `.msg__composer` height overrides reach the editor's
 * imperatively-mounted `.cms-editor__mount`, and so `.msg__body p { … }` reaches
 * the `[innerHTML]`-injected paragraphs (neither carries `_ngcontent`). Every
 * rule is anchored to the `.msg`/`app-messages-page` prefix to stay scoped.
 */
@Component({
    selector: 'app-messages-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
    imports: [UserSearchSelectComponent, CoolmsEditorComponent, VfsSecureImgDirective, UserAvatarComponent, DateTimePipe, NgTemplateOutlet, CmsPageHeaderComponent, CmsPaneSplitterComponent, CmsLoaderComponent],
    template: `
        <cms-page-header icon="chat-dots" [title]="'Messages'">
            <div class="msg__status" header-actions>
                <button type="button" class="msg__status-btn" (click)="toggleStatusMenu()"
                        [title]="'Your status: ' + statusLabel(myStatus())">
                    <span class="msg__status-dot" [style.background]="statusColor(myStatus())"></span>
                    <span class="msg__status-label">{{ statusLabel(myStatus()) }}</span>
                    <i class="bi bi-chevron-down msg__status-caret"></i>
                </button>
                @if (showStatusMenu()) {
                    <div class="msg__status-menu" role="menu" aria-label="Set your status">
                        @for (s of MANUAL_STATUSES; track s.value) {
                            <button type="button" class="msg__status-item"
                                    [class.msg__status-item--on]="myStatus() === s.value"
                                    (click)="pickStatus(s.value)">
                                <span class="msg__status-dot" [style.background]="s.color"></span>
                                {{ s.label }}
                            </button>
                        }
                        <div class="msg__status-sep"></div>
                        <label class="msg__status-away" title="Automatically switch to Away after this long with no activity">
                            <span>Away after</span>
                            <select class="msg__status-away-sel"
                                    (change)="setAwayAfter(+$any($event.target).value)">
                                @for (m of AWAY_OPTIONS; track m) {
                                    <option [value]="m" [selected]="m === awayAfterMin()">{{ m }} min</option>
                                }
                            </select>
                        </label>
                    </div>
                }
            </div>
        </cms-page-header>
        <div class="msg">
            <aside class="msg__list">
                <div class="msg__list-head">
                    <span class="msg__list-label">Conversations</span>
                    <div class="msg__head-actions">
                        <button type="button" class="msg__browse"
                                [class.msg__browse--on]="showChannels()"
                                (click)="toggleChannels()" title="Browse public channels">
                            <i class="bi bi-hash"></i> Channels
                        </button>
                        <button type="button" class="cms-btn cms-btn-sm cms-btn-primary" (click)="toggleNew()">＋ New</button>
                    </div>
                </div>

                @if (showNew()) {
                    <div class="msg__picker">
                        <button type="button" class="msg__selfnotes"
                                [disabled]="starting()" (click)="startSelfNotes()">
                            <i class="bi bi-journal-text"></i><span>Message yourself</span>
                        </button>
                        <div class="msg__newmode">
                            <button type="button" class="msg__newmode-btn"
                                    [class.msg__newmode-btn--on]="newMode() === 'people'"
                                    (click)="newMode.set('people')">People</button>
                            <button type="button" class="msg__newmode-btn"
                                    [class.msg__newmode-btn--on]="newMode() === 'channel'"
                                    (click)="newMode.set('channel')">Channel</button>
                        </div>

                        @if (newMode() === 'channel') {
                            <input #chanInput type="text" class="msg__group-title"
                                   placeholder="Channel name"
                                   [value]="channelName()"
                                   (input)="channelName.set(chanInput.value)"
                                   (keyup.enter)="startChannel()" />
                            <p class="msg__newhint"><i class="bi bi-hash"></i> A public channel anyone can find and join.</p>
                            <button type="button" class="msg__start"
                                    [disabled]="starting() || !channelName().trim()" (click)="startChannel()">
                                Create channel
                            </button>
                        } @else {
                        <app-user-search-select
                                [apiUrl]="usersApiUrl()"
                                entityLabel="user"
                                placeholder="Add people…"
                                extraFilter="isSystem eq false"
                                (valueChange)="onUserPicked($event)" />

                        @if (groupMembers().length > 0) {
                            <div class="msg__chips">
                                @for (m of groupMembers(); track m.id) {
                                    <span class="msg__chip">
                                        <span class="msg__chip-label">{{ m.label }}</span>
                                        <button type="button" class="msg__chip-x"
                                                (click)="removeMember(m.id)" title="Remove">×</button>
                                    </span>
                                }
                            </div>

                            @if (groupMembers().length > 1) {
                                <input #titleInput type="text" class="msg__group-title"
                                       placeholder="Group name (optional)"
                                       [value]="groupTitle()"
                                       (input)="groupTitle.set(titleInput.value)" />
                            }

                            <button type="button" class="msg__start"
                                    [disabled]="starting()" (click)="startConversation()">
                                {{ groupMembers().length > 1 ? 'Create group' : 'Start chat' }}
                            </button>
                        }
                        }
                    </div>
                }

                @if (showChannels()) {
                    <div class="msg__channels">
                        <div class="msg__channels-head">
                            <span><i class="bi bi-hash"></i> Public channels</span>
                            <button type="button" class="msg__channels-refresh"
                                    (click)="loadChannels()" title="Refresh"><i class="bi bi-arrow-clockwise"></i></button>
                        </div>
                        @if (loadingChannels()) {
                            <div class="msg__loading"><cms-loader label="Loading channels" /></div>
                        } @else if (channels().length === 0) {
                            <p class="msg__hint">No public channels yet. Create one with ＋ New → Channel.</p>
                        } @else {
                            <ul class="msg__channels-list">
                                @for (ch of channels(); track ch.id) {
                                    <li class="msg__channel">
                                        <span class="msg__channel-name"># {{ ch.title || 'Untitled' }}</span>
                                        @if (ch.joined) {
                                            <button type="button" class="msg__channel-open"
                                                    (click)="openChannel(ch)">Open</button>
                                        } @else {
                                            <button type="button" class="msg__channel-join"
                                                    (click)="joinChannel(ch)">Join</button>
                                        }
                                    </li>
                                }
                            </ul>
                        }
                    </div>
                } @else if (loadingList()) {
                    <div class="msg__loading"><cms-loader label="Loading conversations" /></div>
                } @else if (conversations().length === 0) {
                    <p class="msg__hint">No conversations yet. Start one with ＋ New.</p>
                } @else {
                    <div class="msg__search">
                        <i class="bi bi-search msg__search-icon"></i>
                        <input type="text" class="msg__search-input" placeholder="Search conversations…"
                               [value]="convQuery()" (input)="convQuery.set($any($event.target).value)" />
                        @if (convQuery()) {
                            <button type="button" class="msg__search-clear" (click)="convQuery.set('')" title="Clear">×</button>
                        }
                    </div>
                    @if (filteredConversations().length === 0) {
                        <p class="msg__hint">No conversations match "{{ convQuery() }}".</p>
                    } @else {
                    <ul class="msg__rows">
                        @for (c of filteredConversations(); track c.id) {
                            <li>
                                <button type="button"
                                        class="msg__row"
                                        [class.msg__row--active]="c.id === selectedId()"
                                        [class.msg__row--readonly]="c.viewerState === 'excluded'"
                                        [class.msg__row--muted]="c.viewerMuted"
                                        [class.msg__row--unread]="!c.viewerMuted && unreadCount(c) > 0"
                                        (click)="select(c.id)"
                                        (contextmenu)="onRowContextMenu($event, c)">
                                    <app-user-avatar size="sm" [user]="rowAvatar(c)" [status]="rowStatus(c)" />
                                    <span class="msg__row-body">
                                        <span class="msg__row-top">
                                            <span class="msg__row-name">{{ counterpartName(c) }}</span>
                                            @if (c.viewerMuted) {
                                                <i class="bi bi-bell-slash msg__row-mute" title="Muted"></i>
                                            }
                                            @if (c.lastMessageAt) {
                                                <span class="msg__row-time">{{ relativeTime(c.lastMessageAt) }}</span>
                                            }
                                        </span>
                                        <span class="msg__row-bottom">
                                            <span class="msg__row-preview">{{ rowPreview(c) }}</span>
                                            @if (unreadCount(c) > 0) {
                                                <span class="msg__badge" [title]="unreadCount(c) + ' unread'">{{ unreadCount(c) }}</span>
                                            }
                                        </span>
                                    </span>
                                </button>
                            </li>
                        }
                    </ul>
                    }
                    @if (hasMoreConversations()) {
                        <!-- Inbox paging (#2120). Rendered OUTSIDE the match/no-match
                             branch on purpose: the search is client-side over the rows
                             loaded so far, so "no conversations match" is exactly the
                             moment the user needs to reach the rest. -->
                        <button type="button" class="msg__more"
                                (click)="loadMoreConversations()"
                                [disabled]="loadingMoreConversations()">
                            @if (loadingMoreConversations()) {
                                Loading…
                            } @else if (convQuery()) {
                                Load more to search further
                            } @else {
                                Load more
                            }
                        </button>
                    }
                }
            </aside>

            <cms-pane-splitter storageKey="cms.msg.listW" [minWidth]="220" [maxWidth]="480" />

            <section class="msg__thread">
                @if (error()) {
                    <p class="msg__err" (click)="error.set(null)">{{ error() }}</p>
                }

                @if (!selectedId()) {
                    <div class="msg__empty">Select a conversation, or start a new one.</div>
                } @else {
                    <header class="msg__thread-head">
                        <app-user-avatar size="sm" [user]="rowAvatar(selected())" [status]="rowStatus(selected())" />
                        <span class="msg__thread-name">{{ counterpartName(selected()) }}</span>
                        @if (!isGroup() && rowStatus(selected()); as st) {
                            <span class="msg__thread-presence" [style.color]="statusColor(st)">{{ presenceLabel(st) }}</span>
                        }
                        <!-- No margin-left:auto needed: .msg__thread-name is flex:1 1 auto
                             and already absorbs the header's slack. The inline style that
                             used to sit here computed to 0 for exactly that reason. -->
                        <button type="button" class="msg__call-btn"
                                (click)="startCall('audio')" [disabled]="callActive()" title="Start audio call">
                            <i class="bi bi-telephone"></i>
                        </button>
                        <button type="button" class="msg__call-btn"
                                (click)="startCall('video')" [disabled]="callActive()" title="Start video call">
                            <i class="bi bi-camera-video"></i>
                        </button>
                        @if (isGroup()) {
                            <button type="button" class="msg__members-btn"
                                    [class.msg__members-btn--on]="showMembers()"
                                    (click)="toggleMembers()" title="Members">
                                <i class="bi bi-people"></i>
                                <span>{{ members().length }}</span>
                            </button>
                        }
                    </header>

                    @if (isGroup() && showMembers()) {
                        <div class="msg__members">
                            <ul class="msg__members-list">
                                @for (p of members(); track p.participantId) {
                                    <li class="msg__member">
                                        <app-user-avatar size="sm" [user]="memberAvatar(p)" />
                                        <span class="msg__member-name">{{ p.displayName || 'Unknown' }}</span>
                                        @if (p.role === 'owner') {
                                            <span class="msg__member-role">Owner</span>
                                        }
                                        @if (iAmOwner() && p.role !== 'owner' && p.userId) {
                                            <button type="button" class="msg__member-x" title="Remove"
                                                    (click)="removeGroupMember(p.userId)">×</button>
                                        }
                                    </li>
                                }
                            </ul>
                            @if (iAmOwner()) {
                                <div class="msg__members-add">
                                    <app-user-search-select
                                            [apiUrl]="usersApiUrl()"
                                            entityLabel="user"
                                            placeholder="Add people…"
                                            extraFilter="isSystem eq false"
                                            (valueChange)="onMemberPicked($event)" />
                                    <label class="msg__members-share" title="Let people you add read messages sent before they joined">
                                        <input type="checkbox"
                                               [checked]="shareHistoryOnAdd()"
                                               (change)="shareHistoryOnAdd.set($any($event.target).checked)" />
                                        <span>Share chat history</span>
                                    </label>
                                </div>
                            } @else {
                                <button type="button" class="msg__leave" (click)="leaveGroup()">Leave group</button>
                            }
                        </div>
                    }

                    @if (pinnedMessages().length) {
                        <div class="msg__pins">
                            <button type="button" class="msg__pins-head" (click)="pinnedOpen.set(!pinnedOpen())">
                                <i class="bi bi-pin-angle-fill"></i>
                                <span>{{ pinnedMessages().length }} pinned</span>
                                <i class="bi" [class.bi-chevron-down]="!pinnedOpen()" [class.bi-chevron-up]="pinnedOpen()"></i>
                            </button>
                            @if (pinnedOpen()) {
                                <ul class="msg__pins-list">
                                    @for (p of pinnedMessages(); track p.id) {
                                        <li class="msg__pin">
                                            <button type="button" class="msg__pin-jump" (click)="scrollToMessage(p.id)" title="Jump to message">
                                                <span class="msg__pin-snippet">{{ pinSnippet(p) }}</span>
                                            </button>
                                            @if (canPin()) {
                                                <button type="button" class="msg__pin-x" title="Unpin" (click)="togglePin(p)">×</button>
                                            }
                                        </li>
                                    }
                                </ul>
                            }
                        </div>
                    }

                    <div class="msg__scroll" #threadScroll (scroll)="onThreadScroll()">
                        @if (loadingOlder()) {
                            <p class="msg__hint msg__hint--older">Loading earlier messages…</p>
                        }
                        @if (loadingThread()) {
                            <div class="msg__loading"><cms-loader label="Loading messages" /></div>
                        }
                        @for (g of dayGroups(); track g.key) {
                            <div class="msg__daysep">{{ g.label }}</div>
                            @for (m of g.items; track m.id; let i = $index) {
                                <ng-container [ngTemplateOutlet]="msgBubble" [ngTemplateOutletContext]="{ $implicit: m, prev: i > 0 ? g.items[i - 1] : null }" />
                            }
                        }
                    </div>

                    @if (pending().length || uploading()) {
                        <div class="msg__pending">
                            @for (p of pending(); track p.vfsNodeId) {
                                <span class="msg__chip">
                                    <i class="bi" [class.bi-image]="p.kind === 'image'" [class.bi-paperclip]="p.kind !== 'image'"></i>
                                    <span class="msg__chip-name">{{ p.filename }}</span>
                                    <button type="button" class="msg__chip-x" title="Remove"
                                            (click)="removePending(p)">×</button>
                                </span>
                            }
                            @if (uploading()) {
                                <span class="msg__chip msg__chip--loading">Uploading…</span>
                            }
                        </div>
                    }

                    @if (typingName()) {
                        <div class="msg__typing">
                            <span class="msg__typing-dots"><i></i><i></i><i></i></span>
                            {{ typingName() }} is typing…
                        </div>
                    }

                    @if (isExcluded()) {
                        <div class="msg__readonly">
                            <i class="bi bi-eye"></i>
                            <span>You were removed from this conversation. You can still read the history, but can't send new messages.</span>
                        </div>
                    } @else {
                    <div class="msg__composer" #composer [style.--msg-editor-h]="composerH() + 'px'">
                        <div class="msg__composer-grip"
                             [class.msg__composer-grip--active]="resizing()"
                             (pointerdown)="onGripDown($event)"
                             (pointermove)="onGripMove($event)"
                             (pointerup)="onGripUp($event)"
                             title="Drag to resize the message box"></div>
                        @if (showEmoji()) {
                            <div class="msg__emoji-backdrop" (click)="showEmoji.set(false)"></div>
                            <div class="msg__emoji-pop" role="menu" aria-label="Emoji">
                                @for (e of EMOJIS; track e) {
                                    <button type="button" class="msg__emoji" [title]="e"
                                            (click)="insertEmoji(e)">{{ e }}</button>
                                }
                            </div>
                        }
                        <!-- A bare at-sign in a conversation with no other members
                             has nothing to list until the directory is searched, and
                             an invisible menu reads as "mentions are broken" — which
                             is how it was reported (#2106). Say what to do instead. -->
                        @if (mentionMenuOpen() && !mentionCandidates().length && mentionQuery() === '') {
                            <div class="msg__mention-pop msg__mention-pop--hint">
                                <span class="msg__mention-hint">Type a name to mention anyone…</span>
                            </div>
                        }
                        @if (mentionMenuOpen() && mentionCandidates().length) {
                            <div class="msg__mention-pop" role="listbox" aria-label="Mention a user">
                                @for (c of mentionCandidates(); track c.userId; let i = $index) {
                                    <button type="button" class="msg__mention-opt"
                                            [class.msg__mention-opt--active]="i === mentionActiveIndex()"
                                            (mouseenter)="mentionActiveIndex.set(i)"
                                            (mousedown)="onMentionMouseDown($event, c)">
                                        <app-user-avatar size="sm" [user]="candidateAvatar(c)" />
                                        <span class="msg__mention-name">{{ c.displayName || 'Unknown' }}</span>
                                        @if (!c.inConversation) {
                                            <span class="msg__mention-tag">not in chat</span>
                                        }
                                    </button>
                                }
                            </div>
                        }
                        <!-- #channel typeahead (#2114). Same shell as the mention
                             popover; only channels WITH a handle can be cited, so
                             an empty result says why rather than showing nothing. -->
                        @if (channelMenuOpen()) {
                            @if (channelCandidates().length) {
                                <div class="msg__mention-pop" role="listbox" aria-label="Reference a channel">
                                    @for (c of channelCandidates(); track c.id; let i = $index) {
                                        <button type="button" class="msg__mention-opt"
                                                [class.msg__mention-opt--active]="i === channelActiveIndex()"
                                                (mouseenter)="channelActiveIndex.set(i)"
                                                (mousedown)="onChannelMouseDown($event, c)">
                                            <span class="msg__chan-hash">#</span>
                                            <span class="msg__mention-name">{{ c.slug }}</span>
                                            @if (c.title) {
                                                <span class="msg__mention-tag">{{ c.title }}</span>
                                            }
                                        </button>
                                    }
                                </div>
                            } @else {
                                <div class="msg__mention-pop msg__mention-pop--hint">
                                    <span class="msg__mention-hint">
                                        {{ loadingChannels() ? 'Loading channels…' : 'No channel matches that.' }}
                                    </span>
                                </div>
                            }
                        }
                        @if (mentionAddPrompt(); as ap) {
                            <div class="msg__mention-addbar">
                                <span class="msg__mention-addtxt"><strong>{{ ap.name }}</strong> isn't in this conversation.</span>
                                <button type="button" class="msg__mention-addbtn" (click)="confirmAddMention()">Add to conversation</button>
                                <button type="button" class="msg__mention-dismiss" (click)="dismissAddMention()" aria-label="Dismiss">✕</button>
                            </div>
                        }
                        <input #fileInput type="file" multiple hidden
                               [accept]="acceptTypes"
                               (change)="onFilesPicked($event)" />

                        <!-- One unified input shell: the rich editor fills the width,
                             with an action bar (emoji · attach │ Send) beneath it. -->
                        <div class="msg__composer-shell">
                            <coolms-editor class="msg__editor"
                                           profile="comment"
                                           [content]="composerHtml()"
                                           [mountKey]="composerKey()"
                                           (contentChange)="onComposerInput($event)" />
                            <div class="msg__composer-bar">
                                <div class="msg__composer-tools">
                                    <button type="button" class="msg__tool" title="Emoji" aria-label="Emoji"
                                            [class.msg__tool--on]="showEmoji()"
                                            (click)="toggleEmoji()">
                                        <i class="bi bi-emoji-smile"></i>
                                    </button>
                                    <button type="button" class="msg__tool" title="Attach files" aria-label="Attach files"
                                            [disabled]="uploading()"
                                            (click)="fileInput.click()">
                                        <i class="bi bi-paperclip"></i>
                                    </button>
                                </div>
                                <button type="button" class="msg__send"
                                        [disabled]="!canSend()"
                                        (click)="doSend()">
                                    <i class="bi bi-send-fill"></i>
                                    <span>Send</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    }
                }
            </section>

            <!-- Threads T2: the thread side-panel — the root message + its replies
                 + a reply composer. Opens beside the main thread as a 3rd column. -->
            @if (openThreadRoot()) {
                <cms-pane-splitter side="end" storageKey="cms.msg.tpW" [minWidth]="260" [maxWidth]="520" />
                <aside class="msg__tp">
                    <header class="msg__tp-head">
                        <span class="msg__tp-title"><i class="bi bi-chat-left-text"></i> Thread</span>
                        <button type="button" class="msg__tp-close" (click)="closeThread()" title="Close thread">×</button>
                    </header>
                    <div class="msg__tp-body">
                        @if (loadingThreadPanel()) {
                            <div class="msg__loading"><cms-loader label="Loading thread" /></div>
                        } @else {
                            @for (m of threadMessages(); track m.id; let i = $index) {
                                <ng-container [ngTemplateOutlet]="msgBubble" [ngTemplateOutletContext]="{ $implicit: m, inThread: true, prev: i > 0 ? threadMessages()[i - 1] : null }" />
                            }
                            @if (threadMessages().length <= 1) {
                                <p class="msg__tp-empty">No replies yet — start the discussion below.</p>
                            }
                        }
                    </div>
                    <div class="msg__tp-composer">
                        <textarea #tpInput class="msg__tp-input" rows="1" placeholder="Reply in thread…"
                                  [value]="threadReply()"
                                  (input)="threadReply.set(tpInput.value)"
                                  (keydown)="onThreadKeydown($event)"></textarea>
                        <button type="button" class="msg__tp-send"
                                [disabled]="sendingThreadReply() || !threadReply().trim()"
                                (click)="sendThreadReply()" title="Send reply"><i class="bi bi-send-fill"></i></button>
                    </div>
                </aside>
            }
        </div>

        <!-- Conversation-row right-click context menu (membership semantics):
             mark-as-read + leave / remove-from-list. -->
        @if (ctxMenu(); as ctx) {
            <div class="msg__ctx-backdrop" (click)="closeCtxMenu()" (contextmenu)="$event.preventDefault(); closeCtxMenu()"></div>
            <div class="msg__ctx" role="menu" [style.left.px]="ctx.x" [style.top.px]="ctx.y">
                <!-- Not offered to an EXCLUDED viewer (#2111): MarkRead 403s a
                     participant who has left, and the click used to fire anyway
                     and swallow the failure — clearing the row's badge locally
                     while the topbar's re-derived count stayed put, so the two
                     disagreed until reload. An action that cannot succeed should
                     not be on the menu. -->
                @if (unreadCount(ctx.conv) > 0 && ctx.conv.viewerState === 'active') {
                    <button type="button" class="msg__ctx-item" (click)="ctxMarkRead(ctx.conv)">
                        <i class="bi bi-check2-all"></i><span>Mark as read</span>
                    </button>
                }
                @if (ctx.conv.viewerState === 'active') {
                    <button type="button" class="msg__ctx-item" (click)="ctxToggleMute(ctx.conv)">
                        <i class="bi" [class.bi-bell]="ctx.conv.viewerMuted" [class.bi-bell-slash]="!ctx.conv.viewerMuted"></i>
                        <span>{{ ctx.conv.viewerMuted ? 'Unmute' : 'Mute' }}</span>
                    </button>
                }
                @if (ctx.conv.viewerState === 'excluded') {
                    <button type="button" class="msg__ctx-item" (click)="ctxLeave(ctx.conv)">
                        <i class="bi bi-x-circle"></i><span>Remove from list</span>
                    </button>
                } @else if (ctxCanLeave(ctx.conv)) {
                    <button type="button" class="msg__ctx-item msg__ctx-item--danger" (click)="ctxLeave(ctx.conv)">
                        <i class="bi bi-box-arrow-left"></i><span>Leave {{ ctx.conv.visibility === 'public' ? 'channel' : 'group' }}</span>
                    </button>
                }
                @if (unreadCount(ctx.conv) === 0 && ctx.conv.viewerState !== 'excluded' && ctx.conv.viewerState !== 'active' && !ctxCanLeave(ctx.conv)) {
                    <span class="msg__ctx-empty">No actions</span>
                }
            </div>
        }

        <!-- Shared message bubble (Threads T2): rendered in the main timeline AND
             the thread panel. \`inThread\` (panel) hides the thread affordances. -->
        <ng-template #msgBubble let-m let-inThread="inThread" let-prev="prev">
            @if (m.type === 'text') {
                <div class="msg__line" [class.msg__line--me]="isMine(m)" [class.msg__line--grouped]="!startsRun(m, prev)" [attr.data-mid]="m.id">
                    @if (!isMine(m)) {
                        @if (startsRun(m, prev)) {
                            <app-user-avatar size="sm" [user]="senderAvatar(m)" />
                        } @else {
                            <span class="msg__avatar-spacer" aria-hidden="true"></span>
                        }
                    }
                    <div class="msg__bubble" [class.msg__bubble--me]="isMine(m)" [class.msg__bubble--mentionsme]="mentionsMe(m)">
                    @if (showSenderName(m, prev)) {
                        <span class="msg__sender">{{ senderName(m) }}</span>
                    }
                    @if (m.body) {
                        @if (isHtml(m)) {
                            <span class="msg__body msg__body--html" [innerHTML]="renderMentions(m)"
                                  (click)="onBodyClick($event)"></span>
                        } @else {
                            <span class="msg__body">{{ m.body }}</span>
                        }
                    }
                    @if (m.attachments?.length) {
                        <div class="msg__atts">
                            @for (a of (m.attachments ?? []); track a.vfsNodeId) {
                                @if (a.kind === 'image') {
                                    <button type="button" class="msg__att-img"
                                            [title]="a.filename"
                                            (click)="downloadAttachment(a)">
                                        <img [vfsSecureSrc]="downloadUrl(a)" [alt]="a.filename" />
                                    </button>
                                } @else {
                                    <button type="button" class="msg__att-file"
                                            (click)="downloadAttachment(a)">
                                        <i class="bi bi-paperclip"></i>
                                        <span class="msg__att-name">{{ a.filename }}</span>
                                        <span class="msg__att-size">{{ humanSize(a.sizeBytes) }}</span>
                                    </button>
                                }
                            }
                        </div>
                    }
                    <div class="msg__meta">
                        @if (m.pinnedAt) {
                            <i class="bi bi-pin-angle-fill msg__pinmark" title="Pinned"></i>
                        }
                        <span class="msg__metatime">{{ m.createdAt | appDateTime:'time' }}</span>
                        @if (isMine(m)) {
                            @if (readReceiptSeq() >= m.seq) {
                                <i class="bi bi-check2-all msg__tick msg__tick--read" title="Read"></i>
                            } @else {
                                <i class="bi bi-check2 msg__tick" title="Sent"></i>
                            }
                        }
                    </div>
                    @if (reactionGroups(m).length) {
                        <div class="msg__reactions">
                            @for (g of reactionGroups(m); track g.emoji) {
                                <button type="button" class="msg__reaction" [class.msg__reaction--mine]="g.mine"
                                        [disabled]="!canReact()" (click)="toggleReaction(m, g.emoji)"
                                        [title]="g.mine ? 'You reacted — click to remove' : 'React with ' + g.emoji">
                                    <span class="msg__reaction-emoji">{{ g.emoji }}</span>
                                    <span class="msg__reaction-count">{{ g.count }}</span>
                                </button>
                            }
                        </div>
                    }
                    <div class="msg__threadbar">
                        @if (!inThread && m.replyCount) {
                            <button type="button" class="msg__threadcount" (click)="openThread(m)">
                                <i class="bi bi-chat-left-text"></i> {{ m.replyCount }} {{ m.replyCount === 1 ? 'reply' : 'replies' }}
                            </button>
                        }
                        @if (!inThread) {
                            <button type="button" class="msg__threadreply" (click)="openThread(m)" title="Reply in thread">
                                <i class="bi bi-reply"></i> Reply
                            </button>
                        }
                        @if (canPin()) {
                            @if (m.pinnedAt) {
                                <button type="button" class="msg__threadreply" (click)="togglePin(m)" title="Unpin">
                                    <i class="bi bi-pin-angle"></i> Unpin
                                </button>
                            } @else {
                                <button type="button" class="msg__threadreply" (click)="togglePin(m)" title="Pin message">
                                    <i class="bi bi-pin-angle"></i> Pin
                                </button>
                            }
                        }
                        @if (canReact()) {
                            <div class="msg__react-wrap">
                                <button type="button" class="msg__threadreply" (click)="toggleReactionPicker(m)" title="Add reaction">
                                    <i class="bi bi-emoji-smile"></i> React
                                </button>
                                @if (reactionPickerFor() === m.id) {
                                    <div class="msg__react-palette">
                                        @for (e of reactionPalette; track e) {
                                            <button type="button" class="msg__react-opt" (click)="pickReaction(m, e)" [title]="'React with ' + e">{{ e }}</button>
                                        }
                                    </div>
                                }
                            </div>
                        }
                    </div>
                    </div>
                </div>
            } @else {
                <div class="msg__sys">
                    <span>{{ m.body }}</span>
                    @if (rtcRecordingCallId(m); as rcid) {
                        <button type="button" class="msg__sys-dl" (click)="downloadRtcRecording(rcid)" title="Download the call recording">
                            <i class="bi bi-download"></i> Download recording
                        </button>
                    }
                </div>
            }
        </ng-template>
    `,
    styles: [`
        app-messages-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
        .msg { display: flex; flex: 1 1 auto; min-height: 0; background: var(--cms-surface, #fff); }
        .msg__list { flex: 0 0 280px; display: flex; flex-direction: column; min-height: 0; }
        .msg__list-head { display: flex; align-items: center; justify-content: space-between; padding: .75rem 1rem; border-bottom: 1px solid var(--cms-border, #e5e7eb); }
        .msg__title { margin: 0; font-size: 1rem; font-weight: 600; }
        .msg__list-label { font-size: .72rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--cms-text-secondary, #6b7280); }
        .msg__thread-presence { flex: 0 0 auto; font-size: .72rem; font-weight: 600; padding: .05rem .45rem; border-radius: 999px; background: var(--cms-canvas, #f3f4f6); }
        /* The composer placeholder and the "older messages" hint stay TEXT:
           they sit inline above a list that is already on screen, where a
           40px spinner would push the conversation around. A loader replaces
           a placeholder that owns the whole pane, not one that shares it. */
        .msg__loading { display: flex; align-items: center; justify-content: center; padding: 24px 0; }
        .msg__head-actions { display: flex; align-items: center; gap: .35rem; }
        .msg__browse { display: inline-flex; align-items: center; gap: .25rem; border: 1px solid var(--cms-btn-border, #d1d5db); background: var(--cms-surface); color: var(--cms-text-secondary, #6b7280); border-radius: var(--cms-radius, 6px); padding: .35rem .6rem; font: inherit; font-size: .82rem; cursor: pointer; }
        .msg__browse:hover { border-color: var(--cms-btn-hover-border, #9ca3af); }
        .msg__browse--on { background: var(--cms-border-light, #f0f2f5); color: var(--cms-primary, #2563eb); border-color: var(--cms-primary, #2563eb); }
        .msg__newmode { display: flex; gap: .25rem; margin-bottom: .5rem; }
        .msg__newmode-btn { flex: 1 1 0; border: 1px solid var(--cms-btn-border, #d1d5db); background: var(--cms-surface); color: var(--cms-text-secondary, #6b7280); border-radius: var(--cms-radius, 6px); padding: .3rem; font: inherit; font-size: .82rem; cursor: pointer; }
        .msg__newmode-btn--on { background: var(--cms-border-light, #f0f2f5); color: var(--cms-primary, #2563eb); border-color: var(--cms-primary, #2563eb); font-weight: 500; }
        .msg__newhint { margin: .4rem 0 .1rem; font-size: .75rem; color: var(--cms-text-muted, #848b96); }
        .msg__channels { border-bottom: 1px solid var(--cms-border, #e5e7eb); }
        .msg__channels-head { display: flex; align-items: center; justify-content: space-between; padding: .55rem 1rem; font-size: .8rem; font-weight: 600; color: var(--cms-text-secondary, #6b7280); background: var(--cms-canvas, #f3f4f6); }
        .msg__channels-refresh { border: 0; background: transparent; color: var(--cms-text-secondary, #6b7280); cursor: pointer; padding: .1rem .3rem; font-size: .9rem; }
        .msg__channels-list { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow-y: auto; }
        .msg__channel { display: flex; align-items: center; gap: .5rem; padding: .5rem 1rem; border-bottom: 1px solid var(--cms-border-light, #f0f2f5); }
        .msg__channel-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .88rem; }
        .msg__channel-join { border: 0; background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse); border-radius: var(--cms-radius, 6px); padding: .25rem .6rem; font: inherit; font-size: .78rem; cursor: pointer; flex-shrink: 0; }
        .msg__channel-open { border: 1px solid var(--cms-btn-border, #d1d5db); background: var(--cms-surface); color: var(--cms-text-secondary, #6b7280); border-radius: var(--cms-radius, 6px); padding: .25rem .6rem; font: inherit; font-size: .78rem; cursor: pointer; flex-shrink: 0; }
        .msg__picker { padding: .6rem 1rem; border-bottom: 1px solid var(--cms-border, #e5e7eb); }
        /* "Message yourself" quick-action (#1333) at the top of the New composer. */
        .msg__selfnotes { display: flex; align-items: center; gap: .5rem; width: 100%; margin-bottom: .5rem; padding: .45rem .6rem; border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-md, 8px); background: var(--cms-canvas, #f3f4f6); color: var(--cms-text, #111827); font: inherit; font-size: .85rem; font-weight: 500; cursor: pointer; }
        .msg__selfnotes:hover { background: var(--cms-hover, #f3f4f6); border-color: var(--cms-primary, #2563eb); }
        .msg__selfnotes:disabled { opacity: .6; cursor: default; }
        .msg__selfnotes i { color: var(--cms-primary, #2563eb); }
        .msg__chips { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .5rem; }
        .msg__chip { display: inline-flex; align-items: center; gap: .3rem; max-width: 100%; padding: .15rem .3rem .15rem .55rem; border-radius: 999px; background: var(--cms-border-light, #f0f2f5); color: var(--cms-text, #111827); font-size: .8rem; }
        .msg__chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 12rem; }
        .msg__chip-x { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: 0; border-radius: 999px; background: transparent; color: var(--cms-text-secondary, #6b7280); font-size: 1rem; line-height: 1; cursor: pointer; padding: 0; }
        .msg__chip-x:hover { background: var(--cms-surface-hover); color: var(--cms-text, #111827); }
        .msg__group-title { display: block; width: 100%; margin-top: .5rem; padding: .35rem .6rem; border: 1px solid var(--cms-btn-border, #d1d5db); border-radius: var(--cms-radius, 6px); font: inherit; font-size: .85rem; }
        .msg__group-title:focus { outline: none; border-color: var(--cms-primary, #2563eb); box-shadow: 0 0 0 2px rgba(37,99,235,.15); }
        .msg__start { margin-top: .55rem; width: 100%; border: 0; background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse); border-radius: var(--cms-radius, 6px); padding: .4rem .7rem; font: inherit; font-size: .85rem; font-weight: 500; cursor: pointer; }
        .msg__start:disabled { opacity: .6; cursor: default; }
        /* Self set-status control (#1019) under the list header. */
        .msg__status { position: relative; }
        .msg__status-btn { display: inline-flex; align-items: center; gap: .4rem; border: 1px solid var(--cms-border, #e5e7eb); background: transparent; cursor: pointer; font: inherit; font-size: .8rem; color: var(--cms-text, #111827); padding: .3rem .6rem; border-radius: var(--cms-radius, 6px); }
        .msg__status-btn:hover { background: var(--cms-hover, #f3f4f6); }
        .msg__status-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; display: inline-block; }
        .msg__status-label { font-weight: 500; }
        .msg__status-caret { font-size: .65rem; opacity: .6; }
        .msg__status-backdrop { position: fixed; inset: 0; z-index: 20; }
        .msg__status-menu { position: absolute; top: 100%; right: 0; left: auto; z-index: 21; min-width: 170px; background: var(--cms-surface); border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-md, 8px); box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12)); padding: 4px; }
        .msg__status-item { display: flex; align-items: center; gap: .55rem; width: 100%; text-align: left; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: .82rem; padding: .4rem .5rem; border-radius: var(--cms-radius, 6px); color: var(--cms-text, #111827); }
        .msg__status-item:hover { background: var(--cms-hover, #f3f4f6); }
        .msg__status-item--on { font-weight: 600; }
        .msg__status-sep { height: 1px; background: var(--cms-border-light, #f0f2f5); margin: 4px 2px; }
        .msg__status-away { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .35rem .5rem .2rem; font-size: .78rem; color: var(--cms-text-secondary, #6b7280); }
        .msg__status-away-sel { font: inherit; font-size: .78rem; padding: .15rem .3rem; border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius, 6px); background: var(--cms-surface); color: var(--cms-text, #111827); cursor: pointer; }
        .msg__search { display: flex; align-items: center; gap: .4rem; margin: .5rem .75rem; padding: .3rem .55rem; border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-md, 8px); background: var(--cms-canvas, #f3f4f6); }
        .msg__search:focus-within { border-color: var(--cms-primary, #2563eb); box-shadow: 0 0 0 2px rgba(37,99,235,.12); }
        .msg__search-icon { font-size: .8rem; color: var(--cms-text-secondary, #6b7280); flex: 0 0 auto; }
        .msg__search-input { flex: 1 1 auto; min-width: 0; border: 0; background: transparent; font: inherit; font-size: .85rem; color: var(--cms-text, #111827); }
        .msg__search-input:focus { outline: none; }
        .msg__search-clear { flex: 0 0 auto; border: 0; background: transparent; color: var(--cms-text-secondary, #6b7280); cursor: pointer; font-size: 1rem; line-height: 1; padding: 0 .2rem; }
        .msg__search-clear:hover { color: var(--cms-text, #111827); }
        .msg__rows { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1 1 auto; }
        .msg__row { display: flex; align-items: center; gap: .6rem; width: 100%; text-align: left; border: 0; background: transparent; padding: .55rem 1rem; font: inherit; cursor: pointer; border-bottom: 1px solid var(--cms-border-light, #f0f2f5); color: var(--cms-text, #111827); }
        .msg__row:hover { background: var(--cms-hover, #f3f4f6); }
        .msg__row--active { background: var(--cms-accent-light, #FEF7E6); }
        /* Two-line row body: name + time on top, message preview + unread badge below. */
        .msg__row-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: .15rem; }
        .msg__row-top { display: flex; align-items: baseline; gap: .4rem; }
        .msg__row-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
        .msg__row--active .msg__row-name { font-weight: 600; }
        .msg__row-time { flex: 0 0 auto; font-size: .7rem; color: var(--cms-text-secondary, #6b7280); font-weight: 400; }
        .msg__row-bottom { display: flex; align-items: center; gap: .4rem; }
        .msg__row-preview { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .78rem; color: var(--cms-text-secondary, #6b7280); }
        /* Unread conversation: strengthen the name + preview so it pops in the list. */
        .msg__row--unread .msg__row-name { font-weight: 700; }
        .msg__row--unread .msg__row-preview { color: var(--cms-text, #111827); font-weight: 500; }
        /* Muted conversation (#1332): dim the row + a small bell-slash marker. */
        .msg__row--muted { opacity: .62; }
        .msg__row-mute { flex: 0 0 auto; font-size: .72rem; color: var(--cms-text-secondary, #6b7280); }
        /* Unread count badge on a conversation row (#1017). */
        .msg__badge { flex: 0 0 auto; min-width: 18px; height: 18px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center; border-radius: 9px; background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse); font-size: .68rem; font-weight: 700; line-height: 1; }
        .msg__hint { padding: 1rem; color: var(--cms-text-secondary, #6b7280); font-size: .85rem; }
        /* Inbox "Load more" (#2120) — a footer under the scrolling row list, so it
           stays reachable while the rows above it scroll. */
        .msg__more { flex: 0 0 auto; width: 100%; border: 0; border-top: 1px solid var(--cms-border-light, #f0f2f5); background: transparent; padding: .5rem 1rem; font: inherit; font-size: .78rem; color: var(--cms-text-secondary, #6b7280); cursor: pointer; }
        .msg__more:hover:not(:disabled) { background: var(--cms-hover, #f3f4f6); color: var(--cms-text, #111827); }
        .msg__more:disabled { cursor: default; opacity: .7; }
        .msg__thread { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
        /* ─ Threads T2: per-message thread affordances + the thread side-panel ─ */
        .msg__threadbar { display: flex; align-items: center; gap: .4rem; margin-top: .3rem; }
        .msg__threadcount { display: inline-flex; align-items: center; gap: .3rem; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: .72rem; font-weight: 600; color: var(--cms-primary, #2563eb); padding: 0; }
        .msg__threadcount:hover { text-decoration: underline; }
        .msg__bubble--me .msg__threadcount { color: #dbeafe; }
        .msg__threadreply { display: inline-flex; align-items: center; gap: .25rem; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: .72rem; color: var(--cms-text-secondary, #6b7280); padding: 0; opacity: 0; transition: opacity .12s ease; }
        .msg__bubble:hover .msg__threadreply { opacity: 1; }
        .msg__bubble--me .msg__threadreply { color: rgba(255,255,255,.75); }
        /* Reactions (#1334): per-emoji chips below the bubble + a quick-react palette. */
        .msg__reactions { display: flex; flex-wrap: wrap; gap: .25rem; margin-top: .3rem; }
        .msg__reaction { display: inline-flex; align-items: center; gap: .2rem; border: 1px solid var(--cms-border, #e5e7eb); background: var(--cms-canvas, #f3f4f6); border-radius: 999px; padding: .05rem .4rem; cursor: pointer; font: inherit; font-size: .74rem; line-height: 1.4; transition: background .12s ease, border-color .12s ease; }
        .msg__reaction:hover:not(:disabled) { border-color: var(--cms-primary, #2563eb); }
        .msg__reaction:disabled { cursor: default; }
        .msg__reaction--mine { border-color: var(--cms-primary, #2563eb); background: var(--cms-border-light, #f0f2f5); color: var(--cms-primary, #2563eb); font-weight: 600; }
        .msg__reaction-count { font-variant-numeric: tabular-nums; }
        .msg__bubble--me .msg__reaction { background: rgba(255,255,255,.15); border-color: rgba(255,255,255,.3); color: var(--cms-text-inverse); }
        .msg__bubble--me .msg__reaction--mine { background: rgba(255,255,255,.3); border-color: var(--cms-text-inverse); }
        .msg__react-wrap { position: relative; display: inline-flex; }
        /* Anchor the quick-react popover to the RIGHT of the React button (which is
           the last/rightmost item in the threadbar) so it grows LEFTWARD, over the
           bubble. Left-anchoring ('left: 0') grew it rightward and overflowed the
           container's right edge on own messages (the line is right-aligned), which
           tripped the stream's horizontal scrollbar (#1334 follow-up). */
        .msg__react-palette { position: absolute; bottom: 100%; right: 0; margin-bottom: .3rem; display: flex; gap: .1rem; padding: .2rem; background: var(--cms-surface); border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-md, 8px); box-shadow: var(--cms-shadow-md, 0 4px 12px rgba(0,0,0,.10)); z-index: 20; }
        .msg__react-opt { border: 0; background: transparent; cursor: pointer; font-size: 1.15rem; line-height: 1; padding: .15rem .25rem; border-radius: var(--cms-radius, 6px); transition: background .1s ease; }
        .msg__react-opt:hover { background: var(--cms-canvas, #f3f4f6); }
        /* The panel — a 3rd flex column beside the main thread. */
        .msg__tp { flex: 0 0 340px; display: flex; flex-direction: column; min-height: 0; background: var(--cms-canvas, #f3f4f6); }
        .msg__tp-head { display: flex; align-items: center; justify-content: space-between; padding: .7rem 1rem; border-bottom: 1px solid var(--cms-border, #e5e7eb); font-weight: 600; flex-shrink: 0; background: var(--cms-surface); }
        .msg__tp-title { display: inline-flex; align-items: center; gap: .4rem; font-size: .9rem; }
        .msg__tp-close { border: 0; background: transparent; cursor: pointer; font-size: 1.3rem; line-height: 1; color: var(--cms-text-secondary, #6b7280); padding: 0 .2rem; }
        .msg__tp-body { flex: 1 1 auto; overflow-y: auto; padding: .7rem 1rem; display: flex; flex-direction: column; gap: .5rem; }
        .msg__tp-empty { color: var(--cms-text-secondary, #6b7280); font-size: .8rem; font-style: italic; margin: .2rem 0; }
        .msg__tp-composer { flex-shrink: 0; display: flex; align-items: flex-end; gap: .4rem; padding: .6rem .8rem; border-top: 1px solid var(--cms-border, #e5e7eb); background: var(--cms-surface); }
        .msg__tp-input { flex: 1 1 auto; resize: none; border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-lg, 10px); padding: .5rem .7rem; font: inherit; font-size: .85rem; min-height: 38px; max-height: 140px; }
        .msg__tp-input:focus { outline: none; border-color: var(--cms-primary, #2563eb); box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
        .msg__tp-send { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border: 0; border-radius: var(--cms-radius-lg, 10px); background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse); cursor: pointer; font-size: 1rem; }
        .msg__tp-send:disabled { background: var(--cms-text-muted); cursor: default; }
        /* Error strip on the palette's own danger pair. The text was #b91c1c and
           --cms-danger-text is #991b1b, so it darkens a shade; that is the point,
           since it now follows a theme instead of pinning one snapshot of it. */
        .msg__err { margin: 0; padding: .5rem 1rem; background: var(--cms-danger-light); color: var(--cms-danger-text); font-size: .82rem; cursor: pointer; }
        .msg__empty { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; color: var(--cms-text-secondary, #6b7280); }
        .msg__thread-head { display: flex; align-items: center; gap: .6rem; padding: .7rem 1.1rem; border-bottom: 1px solid var(--cms-border, #e5e7eb); font-weight: 600; flex-shrink: 0; }
        .msg__thread-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; min-width: 0; }
        /* Audio / video call actions in the thread header (#2124). These carried NO
           rule at all: the class was in the markup and nothing matched it, so both
           rendered with the BROWSER'S default button chrome — an outset border,
           #f0f0f0, black text, square corners — which matched nothing else in the
           admin and, being the UA's hard-coded colours rather than tokens, stayed
           light-grey-on-black in dark mode. Same vocabulary as the members button
           below, sized square because they are icon-only. */
        .msg__call-btn { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 30px; height: 30px; border: 1px solid var(--cms-btn-border, #d1d5db); background: var(--cms-surface); color: var(--cms-text-secondary, #6b7280); border-radius: var(--cms-radius, 6px); font: inherit; font-size: .9rem; cursor: pointer; transition: border-color .12s ease, color .12s ease; }
        .msg__call-btn:hover:not(:disabled) { border-color: var(--cms-btn-hover-border, #9ca3af); color: var(--cms-text, #111827); }
        .msg__call-btn:disabled { opacity: .5; cursor: default; }
        .msg__members-btn { display: inline-flex; align-items: center; gap: .3rem; border: 1px solid var(--cms-btn-border, #d1d5db); background: var(--cms-surface); color: var(--cms-text-secondary, #6b7280); border-radius: var(--cms-radius, 6px); padding: .2rem .5rem; font: inherit; font-size: .8rem; font-weight: 500; cursor: pointer; flex-shrink: 0; }
        .msg__members-btn:hover { border-color: var(--cms-btn-hover-border, #9ca3af); }
        .msg__members-btn--on { background: var(--cms-border-light, #f0f2f5); color: var(--cms-primary, #2563eb); border-color: var(--cms-primary, #2563eb); }
        .msg__members { padding: .7rem 1.1rem; border-bottom: 1px solid var(--cms-border, #e5e7eb); background: var(--cms-surface); flex-shrink: 0; }
        .msg__members-list { list-style: none; margin: 0 0 .5rem; padding: 0; display: flex; flex-direction: column; gap: .1rem; max-height: 220px; overflow-y: auto; }
        .msg__member { display: flex; align-items: center; gap: .5rem; padding: .25rem .1rem; }
        .msg__member-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .85rem; }
        .msg__member-role { font-size: .65rem; text-transform: uppercase; letter-spacing: .04em; color: var(--cms-text-muted, #848b96); background: var(--cms-border-light, #f0f2f5); border-radius: 999px; padding: .05rem .4rem; }
        .msg__member-x { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 0; border-radius: 999px; background: transparent; color: var(--cms-text-secondary, #6b7280); font-size: 1.1rem; line-height: 1; cursor: pointer; padding: 0; flex-shrink: 0; }
        .msg__member-x:hover { background: rgba(220,38,38,.1); color: var(--cms-danger); }
        .msg__members-add { display: flex; flex-direction: column; gap: .4rem; }
        .msg__members-share { display: flex; align-items: center; gap: .4rem; font-size: .78rem; color: var(--cms-text-secondary, #6b7280); cursor: pointer; user-select: none; }
        .msg__members-share input { margin: 0; cursor: pointer; }
        .msg__leave { width: 100%; border: 1px solid var(--cms-btn-border, #d1d5db); background: var(--cms-surface); color: var(--cms-danger); border-radius: var(--cms-radius, 6px); padding: .4rem; font: inherit; font-size: .85rem; cursor: pointer; }
        .msg__leave:hover { background: rgba(220,38,38,.06); border-color: var(--cms-danger); }
        /* Membership semantics: an excluded (read-only) row + its banner. */
        .msg__row--readonly { opacity: .72; }
        .msg__readonly { display: flex; align-items: center; gap: .5rem; margin: .4rem .8rem .8rem; padding: .55rem .7rem; border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-md, 8px); background: var(--cms-canvas, #f3f4f6); color: var(--cms-text-secondary, #6b7280); font-size: .82rem; }
        .msg__readonly i { flex: 0 0 auto; }
        /* Conversation-row context menu. */
        .msg__ctx-backdrop { position: fixed; inset: 0; z-index: 40; }
        .msg__ctx { position: fixed; z-index: 41; min-width: 180px; background: var(--cms-surface, #fff); border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-md, 8px); box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12)); padding: .3rem; display: flex; flex-direction: column; }
        .msg__ctx-item { display: flex; align-items: center; gap: .55rem; width: 100%; border: 0; background: transparent; border-radius: var(--cms-radius, 6px); padding: .45rem .55rem; font: inherit; font-size: .85rem; color: var(--cms-text, #111827); cursor: pointer; text-align: left; }
        .msg__ctx-item:hover { background: var(--cms-hover, #f3f4f6); }
        .msg__ctx-item i { flex: 0 0 auto; width: 1rem; text-align: center; color: var(--cms-text-secondary, #6b7280); }
        .msg__ctx-item--danger { color: var(--cms-danger); }
        .msg__ctx-item--danger i { color: var(--cms-danger); }
        .msg__ctx-empty { padding: .45rem .55rem; font-size: .8rem; color: var(--cms-text-secondary, #6b7280); }
        /* 'overflow-x: hidden' is explicit: a bare 'overflow-y: auto' computes the
           x-axis to 'auto' (CSS: one non-visible axis forces the other from
           'visible' to 'auto'), so any stray horizontal overflow — a wide embed, a
           long unbreakable token, an absolutely-positioned popover on the edge —
           would silently give the whole stream a horizontal scrollbar. */
        .msg__scroll { flex: 1 1 auto; overflow-x: hidden; overflow-y: auto; padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: .4rem; background: var(--cms-canvas, #f3f4f6); }
        /* Pinned-messages bar (pinning) — a collapsible strip above the timeline
         * holding the conversation's curated pins, most-recently-pinned first. */
        .msg__pins { flex: 0 0 auto; border-bottom: 1px solid var(--cms-border, #e5e7eb); background: var(--cms-canvas, #f3f4f6); }
        .msg__pins-head { display: flex; align-items: center; gap: .4rem; width: 100%; border: 0; background: transparent; padding: .45rem 1rem; font: inherit; font-size: .82rem; font-weight: 600; color: var(--cms-text-secondary, #6b7280); cursor: pointer; }
        .msg__pins-head i:first-child { color: var(--cms-primary, #2563eb); }
        .msg__pins-head span { flex: 1 1 auto; text-align: left; }
        .msg__pins-list { list-style: none; margin: 0; padding: 0 0 .3rem; max-height: 30vh; overflow-y: auto; }
        .msg__pin { display: flex; align-items: center; gap: .3rem; padding: 0 .6rem 0 1rem; }
        .msg__pin-jump { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; border: 0; background: transparent; padding: .3rem .4rem; font: inherit; font-size: .82rem; color: var(--cms-text, #111827); cursor: pointer; text-align: left; border-radius: var(--cms-radius, 6px); }
        .msg__pin-jump:hover { background: var(--cms-hover, #f3f4f6); }
        .msg__pin-snippet { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .msg__pin-x { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 0; border-radius: 999px; background: transparent; color: var(--cms-text-secondary, #6b7280); font-size: 1.05rem; line-height: 1; cursor: pointer; padding: 0; }
        .msg__pin-x:hover { background: var(--cms-surface-hover); color: var(--cms-text, #111827); }
        /* Pin marker on a pinned bubble's meta line + a brief highlight when
         * jumped-to from the pinned bar. */
        .msg__pinmark { font-size: .72rem; color: var(--cms-primary, #2563eb); }
        .msg__bubble--me .msg__pinmark { color: var(--cms-text-inverse); }
        @keyframes msgPinFlash { 0%, 100% { background: transparent; } 25% { background: rgba(37,99,235,.16); } }
        .msg__line--flash .msg__bubble { animation: msgPinFlash 1.4s ease; }
        /* Each text message is a line = [avatar] + bubble; the line owns the
         * left/right alignment so the avatar tucks under the bubble's bottom
         * edge (incoming only — own messages need no avatar). */
        .msg__line { display: flex; align-items: flex-end; gap: .4rem; max-width: 78%; align-self: flex-start; }
        .msg__line--me { align-self: flex-end; }
        /* Consecutive messages from the same sender group together: the repeat
           avatar collapses to a spacer (keeps bubble alignment) and the gap
           tightens so a run reads as one block. */
        .msg__line--grouped { margin-top: -.25rem; }
        .msg__avatar-spacer { flex: 0 0 auto; width: 24px; }
        /* Sender name above an incoming bubble in a group/channel (first of a run). */
        .msg__sender { display: block; margin-bottom: .12rem; font-size: .7rem; font-weight: 600; line-height: 1.2; color: var(--cms-text-secondary, #6b7280); }
        .msg__bubble { max-width: 100%; min-width: 0; background: var(--cms-surface); border: 1px solid var(--cms-border, #e5e7eb); border-radius: 12px; border-bottom-left-radius: 3px; padding: .45rem .7rem; font-size: .9rem; line-height: 1.4; word-wrap: break-word; }
        .msg__bubble--me { background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse); border-color: transparent; border-bottom-left-radius: 12px; border-bottom-right-radius: 3px; }
        /* A message that @-mentions YOU (#2124). The class binding was live and
           mentionsMe() worked, but NOTHING matched the class — so the one message
           in a busy thread that needs to stand out looked exactly like every other
           one. Same accent as the inline mention token. */
        .msg__bubble--mentionsme { border-color: var(--cms-primary, #2563eb); box-shadow: inset 3px 0 0 var(--cms-primary, #2563eb); }
        /* On your OWN bubble the accent would be primary-on-primary; keep the
           marker legible by inverting it, as the mention token itself does. */
        .msg__bubble--me.msg__bubble--mentionsme { box-shadow: inset 3px 0 0 rgba(255, 255, 255, .65); }
        .msg__body { white-space: pre-wrap; }
        .msg__body--html { white-space: normal; }
        /* The comment-profile editor emits block <p> + inline marks; neutralize
         * default paragraph margins so a single-line message reads tight inside
         * the bubble while multi-paragraph messages still gain spacing. These
         * target [innerHTML]-injected nodes — reachable only because the host
         * uses ViewEncapsulation.None. */
        .msg__body p { margin: 0; }
        .msg__body p + p { margin-top: .4rem; }
        .msg__body a { color: inherit; text-decoration: underline; }
        .msg__bubble--me .msg__body a { color: var(--cms-text-inverse); }
        .msg__sys { align-self: center; display: inline-flex; align-items: center; gap: .5rem; color: var(--cms-text-secondary, #6b7280); font-size: .78rem; font-style: italic; }
        .msg__sys-dl { display: inline-flex; align-items: center; gap: .3rem; border: 1px solid var(--cms-btn-border, #d1d5db); background: var(--cms-surface); color: var(--cms-primary, #2563eb); border-radius: var(--cms-radius, 6px); padding: .15rem .5rem; font: inherit; font-size: .78rem; font-style: normal; cursor: pointer; }
        .msg__sys-dl:hover { background: var(--cms-border-light, #f0f2f5); border-color: var(--cms-primary, #2563eb); }
        /* Per-day separator chip (#1033) — one date pill above each day's run of
         * messages (Today / Yesterday / a formatted date), so the bubbles only
         * need to carry the time. */
        .msg__daysep { align-self: center; margin: .5rem 0 .25rem; padding: .16rem .7rem; font-size: .7rem; font-weight: 600; color: var(--cms-text-secondary, #6b7280); background: var(--cms-surface); border: 1px solid var(--cms-border, #e5e7eb); border-radius: 999px; }
        /* In-bubble meta line (#1033): the message time + (own messages) the
         * sent/read tick, grouped bottom-right WhatsApp-style. "Read" is the
         * tinted double-check; "Sent" the single check (#1018). */
        .msg__meta { display: flex; align-items: center; justify-content: flex-end; gap: .25rem; margin-top: .15rem; font-size: .66rem; line-height: 1; color: var(--cms-text-secondary, #6b7280); }
        .msg__bubble--me .msg__meta { color: rgba(255, 255, 255, .8); }
        .msg__metatime { font-variant-numeric: tabular-nums; }
        .msg__tick { font-size: .74rem; }
        .msg__tick--read { color: #0ea5e9; }
        .msg__bubble--me .msg__tick--read { color: #bae6fd; }
        .msg__hint--older { text-align: center; padding: .4rem; }
        /* "X is typing…" hint above the composer (#1016). */
        .msg__typing { display: flex; align-items: center; gap: .45rem; padding: .25rem 1.1rem .1rem; font-size: .78rem; color: var(--cms-text-secondary, #6b7280); flex-shrink: 0; }
        .msg__typing-dots { display: inline-flex; gap: 3px; }
        .msg__typing-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--cms-text-secondary, #6b7280); display: inline-block; animation: msg-typing-bounce 1.2s infinite ease-in-out both; }
        .msg__typing-dots i:nth-child(2) { animation-delay: .15s; }
        .msg__typing-dots i:nth-child(3) { animation-delay: .3s; }
        @keyframes msg-typing-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .4; } 40% { transform: translateY(-3px); opacity: 1; } }
        /* ─ Composer (#1008 rich · redesigned: one unified input shell) ─
         * The editor fills the shell width with an action bar (emoji · attach │
         * Send) beneath it, like a modern chat composer. .msg__composer stays the
         * relatively-positioned padding wrapper so the emoji popover anchors to it. */
        .msg__composer { position: relative; padding: .7rem 1.1rem; border-top: 1px solid var(--cms-border, #e5e7eb); flex-shrink: 0; background: var(--cms-surface); }
        .msg__composer-shell { display: flex; flex-direction: column; border: 1px solid var(--cms-border, #e5e7eb); border-radius: 12px; background: var(--cms-surface); overflow: hidden; transition: border-color .15s ease, box-shadow .15s ease; }
        .msg__composer-shell:focus-within { border-color: var(--cms-primary, #2563eb); box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
        /* The rich editor now spans the full shell width (was flex:0 0 auto → cramped). */
        .msg__editor { display: block; width: 100%; }
        .msg__composer .cms-editor { min-height: 0; border: 0; background: transparent; }
        .msg__composer .cms-editor__mount,
        .msg__composer .cms-editor__source { min-height: 46px; max-height: var(--msg-editor-h, 168px); padding: 10px 12px; font-size: .9rem; border: 0; }
        /* Drag handle straddling the composer's top border — raises/lowers the
         * editor's scroll ceiling (--msg-editor-h). Persisted to localStorage. */
        .msg__composer-grip { position: absolute; top: -4px; left: 0; right: 0; height: 9px; cursor: ns-resize; z-index: 6; touch-action: none; }
        .msg__composer-grip::before { content: ''; position: absolute; top: 4px; left: 50%; transform: translateX(-50%); width: 40px; height: 3px; border-radius: 2px; background: var(--cms-border, #e5e7eb); opacity: 0; transition: opacity .15s ease, background .15s ease; }
        .msg__composer-grip:hover::before, .msg__composer-grip--active::before { opacity: 1; background: var(--cms-primary, #2563eb); }
        /* Action bar beneath the editor, inside the shell. */
        .msg__composer-bar { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .3rem .4rem .3rem .35rem; border-top: 1px solid var(--cms-border-light, #f0f2f5); background: var(--cms-canvas, #f3f4f6); }
        .msg__composer-tools { display: flex; align-items: center; gap: .1rem; }
        .msg__tool { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 0; border-radius: var(--cms-radius-md, 8px); background: transparent; color: var(--cms-text-secondary, #6b7280); cursor: pointer; font-size: 1.05rem; }
        .msg__tool:hover:not(:disabled) { background: var(--cms-hover, #f3f4f6); color: var(--cms-text, #111827); }
        .msg__tool--on { background: var(--cms-accent-light, #FEF7E6); color: var(--cms-primary, #2563eb); }
        .msg__tool:disabled { opacity: .5; cursor: default; }
        .msg__send { display: inline-flex; align-items: center; gap: .4rem; border: 0; border-radius: var(--cms-radius-md, 8px); background: var(--cms-primary, #2563eb); color: var(--cms-text-inverse); padding: .4rem .85rem; font: inherit; font-size: .85rem; font-weight: 600; cursor: pointer; }
        .msg__send:hover:not(:disabled) { background: var(--cms-primary-hover, #1d4ed8); }
        .msg__send:disabled { background: var(--cms-text-muted); cursor: default; }
        /* Emoji picker popover (composer). The backdrop is a transparent
         * full-viewport catcher so an outside click closes it without a
         * document-level listener. */
        .msg__emoji-backdrop { position: fixed; inset: 0; z-index: 20; }
        .msg__emoji-pop { position: absolute; bottom: calc(100% - .3rem); left: 1.1rem; z-index: 21; width: 264px; max-height: 200px; overflow-y: auto; display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; padding: 8px; background: var(--cms-surface); border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-lg, 10px); box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12)); }
        .msg__emoji { border: 0; background: transparent; cursor: pointer; font-size: 1.25rem; line-height: 1; padding: 4px; border-radius: var(--cms-radius, 6px); }
        .msg__emoji:hover { background: var(--cms-hover, #f3f4f6); }
        /* @-mention typeahead popover (anchored above the composer input). */
        .msg__mention-pop--hint { padding: .5rem .6rem; }
        .msg__mention-hint { color: var(--cms-text-muted); font-size: .82rem; }
        .msg__mention-pop { position: absolute; bottom: calc(100% - .3rem); left: 1.1rem; z-index: 22; min-width: 220px; max-width: 320px; max-height: 240px; overflow-y: auto; padding: .3rem; background: var(--cms-surface); border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-lg, 10px); box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12)); display: flex; flex-direction: column; }
        .msg__mention-opt { display: flex; align-items: center; gap: .5rem; width: 100%; border: 0; background: transparent; border-radius: var(--cms-radius, 6px); padding: .35rem .5rem; font: inherit; font-size: .85rem; color: var(--cms-text, #111827); cursor: pointer; text-align: left; }
        .msg__mention-opt--active { background: var(--cms-border-light, #f0f2f5); }
        .msg__mention-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; min-width: 0; }
        /* "not in chat" tag on a directory (non-member) mention candidate. */
        .msg__mention-tag { flex: 0 0 auto; font-size: .68rem; text-transform: uppercase; letter-spacing: .02em; color: var(--cms-text-muted, #848b96); background: var(--cms-border-light, #f0f2f5); border-radius: var(--cms-radius-sm, 4px); padding: .05rem .3rem; }
        /* "Add {name} to conversation?" prompt after mentioning a non-member. */
        .msg__mention-addbar { position: absolute; bottom: calc(100% - .3rem); left: 1.1rem; right: 1.1rem; z-index: 21; display: flex; align-items: center; gap: .5rem; padding: .4rem .6rem; background: var(--cms-surface, #fff); border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-lg, 10px); box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12)); font-size: .82rem; }
        .msg__mention-addtxt { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cms-text, #111827); }
        .msg__mention-addbtn { flex: 0 0 auto; border: 0; border-radius: var(--cms-radius, 6px); padding: .3rem .6rem; font: inherit; font-size: .8rem; font-weight: 600; color: var(--cms-text-inverse); background: var(--cms-primary, #2563eb); cursor: pointer; }
        .msg__mention-dismiss { flex: 0 0 auto; border: 0; background: transparent; color: var(--cms-text-muted, #848b96); font-size: .9rem; line-height: 1; cursor: pointer; padding: .2rem; }
        /* An @-mention token inside a rendered message body. */
        .msg__mention { color: var(--cms-primary, #2563eb); background: var(--cms-border-light, #f0f2f5); border-radius: var(--cms-radius-sm, 4px); padding: 0 .2rem; font-weight: 600; }
        .msg__bubble--me .msg__mention { color: var(--cms-text-inverse); background: rgba(255, 255, 255, .22); }
        /* A #channel reference (#2114) — same tint as a mention, but clickable. */
        .msg__chanref { color: var(--cms-primary, #2563eb); background: var(--cms-border-light, #f0f2f5); border-radius: var(--cms-radius-sm, 4px); padding: 0 .2rem; font-weight: 600; cursor: pointer; }
        .msg__chanref:hover { text-decoration: underline; }
        .msg__bubble--me .msg__chanref { color: var(--cms-text-inverse); background: rgba(255, 255, 255, .22); }
        /* The leading hash in a #channel typeahead row. */
        .msg__chan-hash { flex: 0 0 auto; width: 1.4rem; text-align: center; font-weight: 700; color: var(--cms-text-muted, #848b96); }
        /* Pending attachment chips (composer, above the input row). */
        .msg__pending { display: flex; flex-wrap: wrap; gap: .4rem; padding: .5rem 1.1rem 0; flex-shrink: 0; background: var(--cms-surface); }
        .msg__chip { display: inline-flex; align-items: center; gap: .35rem; max-width: 220px; padding: .25rem .5rem; border: 1px solid var(--cms-border, #e5e7eb); border-radius: 16px; background: var(--cms-bg, #f8f9fa); font-size: .8rem; }
        .msg__chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .msg__chip-x { border: 0; background: transparent; color: var(--cms-text-secondary, #6b7280); cursor: pointer; font-size: 1rem; line-height: 1; padding: 0; }
        .msg__chip-x:hover { color: var(--cms-danger-text); }
        .msg__chip--loading { color: var(--cms-text-secondary, #6b7280); font-style: italic; }
        /* Attachment rendering inside a bubble. */
        .msg__atts { display: flex; flex-direction: column; gap: .35rem; margin-top: .35rem; }
        .msg__att-img { padding: 0; border: 0; background: transparent; cursor: pointer; line-height: 0; }
        .msg__att-img img { max-width: 240px; max-height: 240px; border-radius: var(--cms-radius-md, 8px); display: block; }
        .msg__att-file { display: inline-flex; align-items: center; gap: .4rem; max-width: 260px; padding: .35rem .55rem; border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-md, 8px); background: rgba(0,0,0,.03); color: inherit; cursor: pointer; font: inherit; font-size: .82rem; text-align: left; }
        .msg__bubble--me .msg__att-file { border-color: rgba(255,255,255,.4); background: rgba(255,255,255,.15); }
        .msg__att-file:hover { background: var(--cms-surface-hover); }
        .msg__bubble--me .msg__att-file:hover { background: rgba(255,255,255,.25); }
        .msg__att-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .msg__att-size { flex: 0 0 auto; opacity: .7; font-size: .72rem; }
    `],
})
export class MessagesPageComponent implements OnInit, AfterViewInit, OnDestroy {
    private readonly api       = inject(MessagesService);
    private readonly live      = inject(MessagesLiveEventsService);
    private readonly presenceLive = inject(ChatPresenceLiveService);
    private readonly store     = inject(Store);
    private readonly toast     = inject(ToastService);
    private readonly route     = inject(ActivatedRoute);
    private readonly dtf       = inject(DateTimeFormatService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly rtcCall   = inject(RtcCallService);

    /**
     * Pending `?c=<id>` preselect (from the topbar quick-panel, #1012/#1029).
     * Re-armed on every distinct `?c=` value — so clicking "open full" on a
     * conversation while ALREADY on `/messages` switches to it (the snapshot-once
     * approach didn't, since Angular reuses the component on a query-param change).
     * Cleared once applied so a later list reload can't yank you off a thread you
     * navigated to manually.
     */
    private pendingPreselect: string | null = null;

    private readonly threadScroll = viewChild<ElementRef<HTMLElement>>('threadScroll');
    private readonly composerEl   = viewChild<ElementRef<HTMLElement>>('composer');

    /**
     * `accept` hint for the file picker — mirrors the backend MIME allow-list
     * (images + PDF + Office docs). The server is authoritative and rejects
     * anything else with a 4xx; this just nudges the OS picker.
     */
    readonly acceptTypes =
        'image/*,application/pdf,' +
        'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
        'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    readonly conversations = signal<ChatConversationDto[]>([]);
    readonly selectedId    = signal<string | null>(null);
    readonly messages      = signal<ChatMessageDto[]>([]);
    readonly loadingList   = signal(false);
    readonly loadingThread = signal(false);
    readonly error         = signal<string | null>(null);

    /**
     * Inbox paging (#2120). The list used to be the WHOLE inbox on every load —
     * and on every background refresh — so its cost grew with tenure and never
     * came back down.
     *
     * `hasMoreConversations` is inferred from the page LENGTH (the endpoint
     * returns a bare array with no total): a short page is the last one.
     * ⚠️ {@link reloadList} re-reads as many rows as are ON SCREEN, not one
     * page — otherwise any background refresh would silently throw away every
     * page the user had loaded.
     */
    private readonly CONV_PAGE = 30;
    readonly hasMoreConversations = signal(false);
    readonly loadingMoreConversations = signal(false);
    /**
     * Rows CONSUMED from the server's ordering — the next page's offset, and
     * deliberately not `conversations().length`. See `inbox-paging.util`, which
     * holds the rules (and the quick panel's copy of this state).
     */
    private convOffset = 0;

    /**
     * Threads T2 — the thread side-panel. `openThreadRoot` is the (top-level)
     * message the panel is scoped to, or null when closed; `threadMessages` is
     * that thread's root + replies (seq-ascending). The panel has its own plain
     * composer (`threadReply`).
     */
    readonly openThreadRoot     = signal<ChatMessageDto | null>(null);
    readonly threadMessages     = signal<ChatMessageDto[]>([]);
    readonly loadingThreadPanel = signal(false);
    readonly threadReply        = signal('');
    readonly sendingThreadReply = signal(false);

    /**
     * Pinning — the open conversation's pinned messages (most-recently-pinned
     * first), loaded on select + refreshed on the `pin` room nudge; `pinnedOpen`
     * toggles the collapsible pinned-bar list.
     */
    readonly pinnedMessages = signal<ChatMessageDto[]>([]);
    readonly pinnedOpen     = signal(false);

    /**
     * I may pin/unpin in the open conversation — any ACTIVE member (Slack-channel
     * semantics), NOT an excluded/read-only remnant. Mirrors the composer gate.
     */
    readonly canPin = computed<boolean>(() => !!this.selectedId() && !this.isExcluded());

    /**
     * Emoji reactions (#1334). `canReact` mirrors the composer/pin gate (any ACTIVE
     * member, NOT an excluded read-only remnant). `reactionPalette` is the fixed
     * quick-react set; `reactionPickerFor` holds the id of the message whose react
     * palette is open (null = none), so only one palette shows at a time.
     */
    readonly reactionPalette = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🙏'] as const;
    readonly reactionPickerFor = signal<string | null>(null);
    readonly canReact = computed<boolean>(() => !!this.selectedId() && !this.isExcluded());

    /**
     * Thread bucketed into per-day groups for the date-separator render (#1033),
     * resolved in the user's tz. Recomputes whenever {@link messages} changes;
     * the bubbles within a group show time only (the date lives on the chip).
     */
    readonly dayGroups = computed<DayGroup<ChatMessageDto>[]>(
        () => groupByDay(this.messages(), m => m.createdAt, this.dtf),
    );

    /**
     * Lazy "load earlier" paging (#1033): the thread opens on its NEWEST page
     * and prepends older pages as the user scrolls to the top. `hasMoreOlder`
     * gates the scroll trigger; `loadingOlder` guards re-entry while a page is
     * in flight. (Before this, the head read capped a long thread at its OLDEST
     * messages and never showed the newest.)
     */
    private readonly PAGE = 40;
    readonly loadingOlder = signal(false);
    readonly hasMoreOlder = signal(false);
    /** Composer HTML (comment-profile editor storage form). */
    readonly composerHtml  = signal('');
    /** Bumped after a successful send to force a clean editor re-mount (clears
     *  content + undo history + cursor). */
    readonly composerKey   = signal('0');

    // ── @-mentions ─────────────────────────────────────────────────────────
    /** The `@…` autocomplete popover is showing. */
    readonly mentionMenuOpen = signal(false);
    /** The raw text typed after `@` (for filtering + know how many chars to replace). */
    readonly mentionQuery = signal('');
    /** Keyboard-highlighted candidate index in {@link mentionCandidates}. */
    readonly mentionActiveIndex = signal(0);
    /**
     * Drafted `@`-mentions this composer picked, keyed by user id → display name.
     * On send, only the ones whose `@name` still appears in the body are sent
     * (so deleting a mention token un-mentions it). Cleared on send / switch.
     */
    readonly mentionDraft = signal<Map<string, string>>(new Map());
    /** Directory search results for the current `@query` (mention-anyone, v2). */
    readonly mentionDirectory = signal<readonly MentionDirectoryUser[]>([]);
    /**
     * The "add to conversation?" prompt shown after picking a NON-member in a
     * group I own (mention-anyone v2). Null = no prompt; the mention is already
     * inserted, this just offers to also add them.
     */
    readonly mentionAddPrompt = signal<{ userId: string; name: string } | null>(null);
    /** Debounce timer + in-flight subscription for the directory search. */
    private mentionSearchTimer: ReturnType<typeof setTimeout> | null = null;
    private mentionSearchSub: { unsubscribe(): void } | null = null;

    // ── #-channel references ───────────────────────────────────────────────

    /** The `#…` channel typeahead is open (#2114). */
    readonly channelMenuOpen = signal(false);
    /** Text typed after `#`, before the caret (may be ''). */
    readonly channelQuery = signal('');
    /** Keyboard-highlighted candidate index in {@link channelCandidates}. */
    readonly channelActiveIndex = signal(0);

    /**
     * Channels offered for `#…` — matched on HANDLE first, then name, so typing
     * either the thing you see (`Release Notes`) or the thing you type
     * (`release-notes`) finds it.
     *
     * Only channels WITH a handle appear: a `#reference` has to resolve to
     * exactly one room, and one without a handle has nothing to cite. The list
     * comes from `GET /chat/channels`, fetched once the first time `#` is typed
     * — the browse panel already loads it, so most of the time it is warm.
     */
    readonly channelCandidates = computed<readonly ChatChannelDto[]>(() => {
        if (!this.channelMenuOpen()) {
            return [];
        }
        return matchChannels(this.channels(), this.channelQuery());
    });

    /**
     * Candidates for the `@…` popover (v2): conversation MEMBERS first (matching
     * the query, `inConversation: true`), then DIRECTORY users so a mention can
     * reach someone not in the conversation. Excludes me; de-duplicated; capped.
     */
    readonly mentionCandidates = computed<readonly MentionCandidate[]>(() => {
        if (!this.mentionMenuOpen()) {
            return [];
        }
        const me = this.meId;
        const q = this.mentionQuery().toLowerCase();
        const seen = new Set<string>();
        const out: MentionCandidate[] = [];
        for (const p of this.members()) {
            if (!p.userId || p.userId === me || seen.has(p.userId)) {
                continue;
            }
            if (!(p.displayName ?? '').toLowerCase().includes(q)) {
                continue;
            }
            seen.add(p.userId);
            out.push({ userId: p.userId, displayName: p.displayName ?? 'Unknown', avatarUrl: p.avatarUrl ?? null, inConversation: true });
        }
        const memberIds = new Set(this.members().map(p => p.userId).filter(Boolean));
        for (const u of this.mentionDirectory()) {
            if (!u.userId || u.userId === me || seen.has(u.userId)) {
                continue;
            }
            seen.add(u.userId);
            // A directory hit may itself be a member whose NAME didn't match the
            // query (matched by identifier instead) — don't mislabel them "not in
            // chat" or offer to re-add them.
            out.push({ userId: u.userId, displayName: u.displayName, avatarUrl: u.avatarUrl, inConversation: memberIds.has(u.userId) });
        }
        return out.slice(0, 8);
    });

    /** Can I pull a non-member into the OPEN conversation? (owner of a group.) */
    readonly canAddMention = computed<boolean>(() => this.isGroup() && this.iAmOwner());

    /**
     * Resizable composer: the editor's scroll ceiling in px (`--msg-editor-h`).
     * Seeded from localStorage so a chosen height survives reloads; dragged via
     * the top grip. Clamped to [{@link COMPOSER_MIN_H}, {@link COMPOSER_MAX_H}].
     * NB: these two bounds are declared BEFORE the signal — the initializer calls
     * `clampComposerH`, which reads them, so they must already hold their values.
     */
    private readonly COMPOSER_MIN_H = 80;
    private readonly COMPOSER_MAX_H = 480;
    readonly composerH = signal<number>(
        this.clampComposerH(this.readStoredNumber('cms.msg.composerH', 168)),
    );
    /** A composer resize drag is in progress (drives the grip's active style). */
    readonly resizing = signal(false);
    private resizeStartY = 0;
    private resizeStartH = 0;

    /**
     * Auto-away (presence): after this many idle minutes with no activity we flip
     * a self-set `online`/unset status to `away` — reverting to `online` on the
     * next activity. Never clobbers a MANUAL `busy`/`offline`/`away`. Per-device
     * (localStorage); options offered in the status menu.
     */
    readonly AWAY_OPTIONS: readonly number[] = [5, 10, 15, 30];
    readonly awayAfterMin = signal<number>(this.readStoredNumber('cms.msg.awayAfterMin', 10));
    /** TRUE only while WE hold an auto-set `away` — so activity knows to revert it. */
    private autoAway = false;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private lastActivityAt = 0;
    private visibilityHandler?: () => void;
    readonly sending       = signal(false);
    readonly showNew       = signal(false);
    /** The "New" composer mode (Chat-channels arc): a DM/group of people, or a public channel. */
    readonly newMode       = signal<'people' | 'channel'>('people');
    /** The new-channel name (composer, `channel` mode). */
    readonly channelName   = signal('');
    /** The public-channel browse panel (Chat-channels arc) is open. */
    readonly showChannels  = signal(false);
    /** A channels-discovery fetch is in flight. */
    readonly loadingChannels = signal(false);
    /** The public channels to browse (`GET /chat/channels`). */
    readonly channels      = signal<ChatChannelDto[]>([]);
    /**
     * The "New" composer's picked members (the group slice). Each pick from the
     * user search adds a chip; a lone member starts a 1:1 DM, two-or-more starts
     * a group. `label` resolves async (best-effort) — see {@link onUserPicked}.
     */
    readonly groupMembers  = signal<{ id: string; label: string }[]>([]);
    /** Optional group name (only offered when 2+ members are picked). */
    readonly groupTitle    = signal('');
    /** A create-conversation request is in flight (gates the Start button). */
    readonly starting      = signal(false);
    /** The group members panel (thread header) is open (G2). */
    readonly showMembers   = signal(false);
    /**
     * Owner's "Share chat history" choice when adding a member (G2.1). Default
     * ON → the joiner sees the full pre-join history; OFF → they see only
     * messages from the moment they join. Enforced server-side per participant.
     */
    readonly shareHistoryOnAdd = signal(true);
    /** Emoji picker popover open state (composer). */
    readonly showEmoji     = signal(false);
    /** Attachments uploaded but not yet sent (composer chips). */
    readonly pending       = signal<ChatAttachmentDto[]>([]);
    /** At least one file is mid-upload (gates Send + the attach button). */
    readonly uploading     = signal(false);

    /** A small curated palette for the composer emoji picker (#1011). */
    readonly EMOJIS: readonly string[] = [
        '😀', '😄', '😁', '😊', '🙂', '😉', '😍', '😘', '😎', '🤩',
        '🤔', '😴', '😢', '😭', '😡', '🥳', '😱', '🤯', '🙃', '😬',
        '👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '🤝', '✌️', '🤞',
        '❤️', '🔥', '⭐', '✅', '❌', '⚠️', '🎉', '🚀', '💡', '📌',
    ];

    /** Bound capture-phase Enter handler; detached on destroy. */
    private enterHandler?: (ev: KeyboardEvent) => void;

    /**
     * Slow RECONCILE poll — realtime (#1010) is the primary update path; this is
     * the FALLBACK for when no realtime/WS engine is connected (e.g. Centrifugo
     * isn't installed, or the Messenger worker draining its publish queue is
     * down). The poll TICK still runs on a timer, but {@link poll} no-ops while
     * the WebSocket is connected (#1041) — so it's a true fallback, not a
     * parallel path. Both feed the same dedupe-by-id merge, so they never
     * double-insert.
     */
    private readonly POLL_MS = 20000;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private lastSeq = 0;

    /**
     * Coalesces realtime room nudges into ONE catch-up fetch (#1041). A burst of
     * `message.posted` nudges (e.g. Centrifugo replaying history on reconnect, or
     * several messages landing at once) pings this; the debounced subscriber pulls
     * everything past `lastSeq` in a single request instead of one fetch per nudge.
     */
    private readonly roomCatchUp$ = new Subject<void>();

    /** "X is typing…" indicator (#1016): the other participant's name, or null. */
    readonly typingName = signal<string | null>(null);
    private typingTimer: ReturnType<typeof setTimeout> | null = null;
    /** Throttle outgoing typing signals to at most one per 3s while composing. */
    private lastTypingSentAt = 0;

    /**
     * Optimistic per-conversation read cursor (#1017): `convId → seq we've
     * locally marked read`. Overrides the server `lastReadSeq` so opening a
     * conversation clears its unread badge instantly (before the list refetches).
     */
    readonly readSeqOverride = signal<Record<string, number>>({});

    /**
     * Conversation-row right-click context menu (membership semantics): the
     * screen-anchored position + the target conversation, or null when closed.
     */
    readonly ctxMenu = signal<{ x: number; y: number; conv: ChatConversationDto } | null>(null);

    /**
     * Each OTHER participant's read cursor in the open conversation, keyed by
     * participant id. Seeded on open from their `lastReadSeq` and advanced by
     * each `read` nudge.
     *
     * ⚠️ Per-PEER, not a single number (#2112). The high-water below is the
     * MINIMUM across peers — "read by everyone" — but a `read` nudge names ONE
     * participant, so folding it into a scalar with `max()` made any single
     * member's cursor speak for the whole group: one person opening a 20-member
     * channel flipped every sender's ticks to "Read". Seeding took the min and
     * updating took the max, so the bug only appeared once a nudge arrived,
     * never on load — and never at all in a DM, where the two agree.
     */
    private readonly peerReadSeqs = signal<ReadonlyMap<string, number>>(new Map());

    /**
     * Read-receipt high-water (#1018): the lowest read cursor across the OTHER
     * participants of the OPEN conversation. My sent messages with `seq <=` this
     * are "Read" by everyone; newer ones are "Sent".
     */
    readonly readReceiptSeq = computed<number>(() => readByEveryoneSeq(this.peerReadSeqs()));

    /**
     * My self-set presence status (#1019) — drives the status control's dot + the
     * dot others see on my avatar. Derived from my participant on list load (so a
     * reload reflects the persisted value) and set optimistically on pick. `null`
     * = no status set ("Set status").
     */
    readonly myStatus       = signal<string | null>(null);
    readonly showStatusMenu = signal(false);

    /**
     * Connection-derived ONLINE set (#1023) — the rfc4122 ids of counterparts
     * currently holding a live realtime connection. Distinct from the self-set
     * {@link myStatus}/`presenceStatus`: this is "actually here right now".
     * {@link effectiveStatus} overlays the self-set away/busy on top.
     *
     * PUSHED since #2122: the shared `presence.chat` channel reports join/leave,
     * so this is whatever {@link ChatPresenceLiveService} last saw. The polled
     * set below is the fallback for a client whose socket is down.
     */
    readonly presencePolled = signal<ReadonlySet<string>>(new Set());
    readonly presenceOnline = computed<ReadonlySet<string>>(
        () => (this.presenceLive.live() ? this.presenceLive.online() : this.presencePolled()),
    );

    /**
     * How often online presence is re-polled (ms) while push is unavailable.
     * Connection-state changes slowly, and this now runs only as a fallback.
     */
    private readonly PRESENCE_POLL_MS = 20_000;

    /** The presence options offered by the status control (value → label + dot color). */
    readonly STATUSES: ReadonlyArray<{ value: string; label: string; color: string }> = [
        { value: 'online',  label: 'Online',         color: '#22c55e' },
        { value: 'away',    label: 'Away',           color: '#f59e0b' },
        { value: 'busy',    label: 'Busy',           color: '#ef4444' },
        { value: 'offline', label: 'Appear offline', color: 'var(--cms-text-muted)' },
    ];

    /**
     * The statuses a user can MANUALLY pick — `away` is intentionally excluded
     * (#1324): it is AUTO-only (the idle timer sets it; any real activity clears
     * it). Keeping it out of the menu removes the ambiguity that made a reloaded
     * `away` stick — there was no way to tell an auto-away from a manual one, so
     * the revert-on-activity never fired after a page reload.
     */
    readonly MANUAL_STATUSES = this.STATUSES.filter(s => s.value !== 'away');

    readonly usersApiUrl = computed<string>(() => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        return m?.identity?.usersUrl ?? '';
    });

    readonly selected = computed<ChatConversationDto | null>(() =>
        this.conversations().find(c => c.id === this.selectedId()) ?? null,
    );

    /** The selected conversation's ACTIVE participants (G2 members panel). */
    readonly members = computed<readonly ConversationParticipantDto[]>(() =>
        this.selected()?.participants ?? [],
    );

    /** Client-side conversation-list filter query (matches the counterpart name / group title). */
    readonly convQuery = signal('');

    /**
     * The conversation list narrowed by {@link convQuery} (empty query → the
     * full list) and sorted most-recently-active first — the inbox convention,
     * keyed on {@link ChatConversationDto.lastMessageAt} (falling back to
     * `updatedAt` for a conversation with no messages yet). The `watchUser`
     * refetch keeps it live as new messages land.
     */
    readonly filteredConversations = computed<readonly ChatConversationDto[]>(() => {
        const q = this.convQuery().trim().toLowerCase();
        const all = this.conversations();
        const matched = q === ''
            ? [...all]
            : all.filter(c => this.counterpartName(c).toLowerCase().includes(q));
        return matched.sort((a, b) => lastActivityTs(b) - lastActivityTs(a));
    });

    /**
     * The inbox row's second line: the server-derived last-message preview,
     * prefixed "You: " when the viewer sent it, or a muted "No messages yet"
     * placeholder for a fresh conversation.
     */
    rowPreview(c: ChatConversationDto): string {
        return rowPreviewOf(c);
    }

    /**
     * A compact "when" for an inbox row: `now` (< 1 min), the clock time for
     * today, `Yesterday`, a weekday within the last week, else a short date.
     */
    relativeTime(iso: string): string {
        const then = new Date(iso);
        const ts = then.getTime();
        if (Number.isNaN(ts)) {
            return '';
        }
        const now = new Date();
        const diffMs = now.getTime() - ts;
        if (diffMs < 60_000) {
            return 'now';
        }
        if (then.toDateString() === now.toDateString()) {
            return then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (then.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        }
        if (diffMs < 7 * 86_400_000) {
            return then.toLocaleDateString([], { weekday: 'short' });
        }
        return then.toLocaleDateString([], { day: 'numeric', month: 'short' });
    }

    /** The selected conversation is a `group` (only groups have a members panel). */
    readonly isGroup = computed<boolean>(() => this.selected()?.kind === 'group');

    /** True while a call is ringing / connected — disables the header call button. */
    readonly callActive = computed<boolean>(() => this.rtcCall.activeCall() !== null);

    /** Place an audio or video call into the open conversation (Track B — the backend rings the roster). */
    startCall(mediaKind: RtcMediaKind = 'audio'): void {
        const conversationId = this.selectedId();
        if (conversationId === null) {
            return;
        }
        this.rtcCall.place(conversationId, mediaKind, this.counterpartName(this.selected()));
    }

    /**
     * I was EXCLUDED from the open conversation (removed by the owner, keeping
     * read-only history) — membership/history semantics. The FE renders a
     * read-only banner and hides the composer.
     */
    readonly isExcluded = computed<boolean>(() => this.selected()?.viewerState === 'excluded');

    /** I am the group's Owner → I can add/remove members (G2). */
    readonly iAmOwner = computed<boolean>(() => {
        const me = this.meId;
        if (!me) {
            return false;
        }
        return this.members().some(p => p.userId === me && p.role === 'owner');
    });

    private get meId(): string | null {
        return this.store.selectSnapshot(AuthState.currentUser)?.id ?? null;
    }

    readonly canSend = computed<boolean>(() =>
        !!this.selectedId()
        && (this.hasText(this.composerHtml()) || this.pending().length > 0)
        && !this.sending()
        && !this.uploading(),
    );

    constructor() {
        // Deep-link (#1012/#1029): arm the `?c=<id>` preselect on every distinct
        // value and apply it once the list contains it. As an OBSERVABLE (not a
        // one-shot snapshot) so clicking "open full" on a conversation while
        // already on `/messages` switches the open thread — Angular reuses the
        // component on a query-param change, so ngOnInit/snapshot never re-fire.
        this.route.queryParamMap
            .pipe(
                map(p => p.get('c')),
                distinctUntilChanged(),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(cid => {
                this.pendingPreselect = cid;
                this.applyPreselect();
            });

        // Realtime (#1010): (re)subscribe to the selected conversation's
        // `chat.room.{id}` channel whenever the selection changes — switchMap
        // tears down the prior subscription, takeUntilDestroyed the whole chain.
        // Realtime degrades silently (the slow reconcile poll covers an outage).
        toObservable(this.selectedId)
            .pipe(
                switchMap(id => (id === null ? EMPTY : this.live.watchRoom(id))),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: nudge => this.onRoomNudge(nudge),
                error: () => { /* realtime down — the reconcile poll + initial read cover it */ },
            });

        // Debounced room catch-up (#1041): a burst of `message.posted` nudges
        // collapses into ONE `listMessages` cursor pull (afterSeq=lastSeq), instead
        // of one fetch per nudge — bounds the request rate regardless of nudge volume.
        this.roomCatchUp$
            .pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.catchUp());

        // Realtime (re)connect catch-up (#1041): when the WS engine comes up — first
        // connect OR a reconnect after an outage during which the fallback poll was
        // the only path — pull anything we missed once, so a gap can't linger if no
        // further nudge arrives. No-op when nothing's selected (catchUp guards it).
        toObservable(this.live.isConnected)
            .pipe(distinctUntilChanged(), filter(connected => connected), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.catchUp());

        // Background inbox activity (#1021): subscribe to my per-user channel for
        // the whole session (independent of the open conversation) so the
        // conversation LIST's unread badges + presence dots update live even for
        // conversations I'm NOT currently viewing. Debounced so a burst of
        // messages coalesces into one list refetch. Degrades silently.
        const me = this.meId;
        if (me) {
            this.live.watchUser(me)
                .pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: () => this.reloadList(),
                    error: () => { /* realtime down — list (re)load + reconcile poll cover it */ },
                });
        }

        // Online presence FALLBACK (#1023, #2122). The live answer arrives pushed
        // on the shared `presence.chat` channel; this queries
        // `GET /chat/presence` for the counterparts the list shows, and ONLY while
        // push is unavailable — a client whose socket is down, or one that
        // subscribed but could not read the initial roster.
        //
        // ⚠️ Both gates matter. `presenceLive.live()` is the #2106 rule (poll is
        // the no-realtime fallback, never a parallel path); `visibilityState` is
        // the #2107 rule (a backgrounded tab has no dot to update, and each tick
        // costs the server a Centrifugo round trip). Before push existed, the
        // first gate could not be applied at all — nothing published presence —
        // which is what made a left-open tab the most expensive idle client in
        // the product.
        merge(
            toObservable(this.conversations).pipe(debounceTime(500)),
            interval(this.PRESENCE_POLL_MS),
            // …and one immediate refresh when the tab comes back, so the dots are
            // right the moment you look at them rather than up to 20s later.
            fromEvent(document, 'visibilitychange'),
        )
            .pipe(
                filter(() => !this.presenceLive.live() && 'hidden' !== document.visibilityState),
                map(() => this.counterpartUids()),
                switchMap(uids => this.api.fetchOnline(uids).pipe(catchError(() => EMPTY))),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(onlineMap =>
                this.presencePolled.set(
                    new Set(Object.keys(onlineMap).filter(uid => onlineMap[uid])),
                ),
            );
    }

    ngOnInit(): void {
        this.reloadList();
        // The channel list is what a `#handle` in an already-received message
        // resolves against (#2114), so it has to be here before the first render
        // — not only once someone opens the browse panel. One small read, cached
        // in the signal the panel and the typeahead already share.
        this.loadChannels();
        this.setupIdleTracking();
        this.destroyRef.onDestroy(() => this.stopPolling());
    }

    /**
     * A body-less `message.posted` nudge arrived — pull anything past our local
     * high-water `lastSeq` (skips our own just-sent message, already applied).
     */
    private onRoomNudge(nudge: ChatRoomNudge): void {
        const id = this.selectedId();
        if (id === null || nudge.conversationId !== id) {
            return;
        }
        if (nudge.type === 'typing') {
            this.onTypingNudge(nudge.participantId);
            return;
        }
        if (nudge.type === 'read') {
            this.onReadNudge(nudge.participantId, nudge.seq);
            return;
        }
        if (nudge.type === 'presence') {
            this.onPresenceNudge(nudge.userId, nudge.status);
            return;
        }
        if (nudge.type === 'pin') {
            // Pinning: the pinned set changed — refresh the pinned bar.
            this.loadPinned(id);
            return;
        }
        if (nudge.type === 'reaction') {
            // Reactions (#1334): a message's reactions changed — reconcile the
            // affected message's chips (a reaction doesn't bump seq, so the
            // seq-cursor catch-up below wouldn't touch it).
            this.reconcileReactions(id);
            return;
        }
        if (nudge.seq <= this.lastSeq) {
            return;
        }
        // Coalesce into one debounced catch-up (#1041) rather than fetching per nudge.
        this.roomCatchUp$.next();
        // Threads T2: a reply lives in a thread, not the main timeline — if a
        // thread panel is open, refresh it so others' replies appear live.
        const openRoot = this.openThreadRoot();
        if (openRoot) {
            this.loadThreadPanel(openRoot.id);
        }
    }

    /**
     * A `typing` nudge arrived (#1016) — show "X is typing…" (mapping the
     * participantId to a name we already hold) and auto-clear after a short
     * idle. Our own typing echo is ignored. A fresh nudge resets the timer.
     */
    private onTypingNudge(participantId: string): void {
        if (participantId === this.myParticipantId()) {
            return;
        }
        const p = (this.selected()?.participants ?? []).find(x => x.participantId === participantId);
        this.typingName.set(p?.displayName ?? 'Someone');
        if (this.typingTimer) {
            clearTimeout(this.typingTimer);
        }
        this.typingTimer = setTimeout(() => this.typingName.set(null), 4000);
    }

    /**
     * A `read` nudge arrived (#1018) — another participant advanced their read
     * cursor. Bump the receipt high-water (monotonic) so my sent messages up to
     * that seq flip to "Read". My own read echo is ignored (a receipt tracks
     * OTHERS reading MY messages, not me reading theirs).
     */
    private onReadNudge(participantId: string, seq: number): void {
        if (participantId === this.myParticipantId()) {
            return;
        }
        this.peerReadSeqs.update(cur => advancePeerCursor(cur, participantId, seq));
    }

    /**
     * A `presence` nudge arrived (#1020) — a user changed their status. Flip the
     * colored dot on their avatar everywhere they appear (header / bubbles / list
     * rows) by updating their `presenceStatus` in the conversations signal. My
     * own status is already reflected via the set-status control, but keep it in
     * sync if it changed from another device.
     */
    private onPresenceNudge(userId: string, status: string): void {
        if (userId === this.meId) {
            this.myStatus.set(status);
            return;
        }
        this.conversations.update(list => list.map(c => {
            const ps = c.participants;
            if (!ps?.some(p => p.userId === userId)) {
                return c;
            }
            return {
                ...c,
                participants: ps.map(p => (p.userId === userId ? { ...p, presenceStatus: status } : p)),
            };
        }));
    }

    /**
     * My participant id in the open conversation (resolved from my user id). Falls
     * back to the server-computed `viewerParticipantId` — an EXCLUDED member isn't
     * in the active `participants` roster, but their read-only history still needs
     * "my messages" marked right (membership/history semantics).
     */
    private myParticipantId(): string | null {
        const conv = this.selected();
        const me = this.meId;
        return (conv?.participants ?? []).find(p => p.userId === me)?.participantId
            ?? conv?.viewerParticipantId
            ?? null;
    }


    ngAfterViewInit(): void {
        // Enter-to-send: intercept a bare Enter in the composer during the
        // CAPTURE phase, before ProseMirror's own keymap (bound on the inner
        // contenteditable) can split the paragraph. Shift+Enter and IME
        // composition fall through to the editor → soft newline / candidate
        // commit. Bound once on the stable composer wrapper; the editor
        // re-mounts inside it without needing re-binding.
        this.enterHandler = (ev: KeyboardEvent) => {
            // The #-channel popover takes the same priority as the @ one — only
            // one of the two can be open, since their triggers are different
            // characters at the caret (#2114).
            const chans = this.channelCandidates();
            if (this.channelMenuOpen() && chans.length && !ev.isComposing) {
                if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const n = chans.length;
                    const dir = ev.key === 'ArrowDown' ? 1 : -1;
                    this.channelActiveIndex.update(i => (i + dir + n) % n);
                    return;
                }
                if (ev.key === 'Enter' || ev.key === 'Tab') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    this.pickChannelRef(chans[this.channelActiveIndex()]);
                    return;
                }
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    this.closeChannelMenu();
                    return;
                }
            }
            // The @-mention popover takes priority: arrow-navigate, Enter/Tab to
            // pick, Escape to dismiss — none of these reach the editor or send.
            const candidates = this.mentionCandidates();
            if (this.mentionMenuOpen() && candidates.length && !ev.isComposing) {
                if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const n = candidates.length;
                    const dir = ev.key === 'ArrowDown' ? 1 : -1;
                    this.mentionActiveIndex.update(i => (i + dir + n) % n);
                    return;
                }
                if (ev.key === 'Enter' || ev.key === 'Tab') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    this.pickMention(candidates[this.mentionActiveIndex()]);
                    return;
                }
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    this.closeMentionMenu();
                    return;
                }
            }
            if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            this.doSend();
        };
        this.composerEl()?.nativeElement.addEventListener('keydown', this.enterHandler, true);
    }

    ngOnDestroy(): void {
        this.stopPolling();
        this.clearTyping();
        this.teardownIdleTracking();
        this.closeMentionMenu(); // tears down the mention search timer + subscription
        if (this.enterHandler) {
            this.composerEl()?.nativeElement.removeEventListener('keydown', this.enterHandler, true);
        }
    }

    /**
     * Whether editor HTML carries visible text (so an empty `<p></p>` doc — the
     * Tiptap empty state — doesn't enable Send or post a blank message). Strips
     * tags, collapses `&nbsp;`, trims.
     */
    private hasText(html: string): boolean {
        if (!html) {
            return false;
        }
        const text = html
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text !== '';
    }

    /** A conversation's display label — shared with the quick panel (#2126). */
    counterpartName(c: ChatConversationDto | null): string {
        return conversationLabel(c, this.meId);
    }

    /**
     * Unread message count for a conversation (#1017): `lastSeq` minus my read
     * cursor (the larger of the server `lastReadSeq` and any optimistic local
     * override set on open). 0 when caught up.
     */
    unreadCount(c: ChatConversationDto | null): number {
        // Rule shared with the quick panel (#2126); the optimistic override is
        // page-only state, so it is passed in rather than assumed.
        return unreadFor(c, this.meId, c === null ? 0 : (this.readSeqOverride()[c.id] ?? 0));
    }

    /**
     * Mark a conversation read up to `seq` — optimistically clear its unread
     * badge (local override) then persist the cursor server-side (#1017).
     */
    private markConversationRead(convId: string, seq: number): void {
        if (seq <= 0) {
            return;
        }
        this.readSeqOverride.update(m => advanceReadOverride(m, convId, seq));
        // Send the seq we are actually claiming (#2115). It was computed here
        // for the optimistic override and then thrown away, so the server marked
        // read up to ITS `lastSeq` — including messages this client had not
        // received, whose senders were then told "Read".
        this.api.markRead(convId, seq).subscribe({ error: () => { /* best-effort */ } });
    }

    /**
     * Avatar for a conversation row / thread header — the FIRST other
     * participant (1:1 DMs have exactly one; a future group thread shows the
     * first, which is good enough for the roster glyph). Colored-initials
     * fallback from `displayName` — no backend avatar URL needed (#1013).
     */
    rowAvatar(c: ChatConversationDto | null): ChatAvatarUser {
        const me = this.meId;
        // Self-notes (#1333): show MY own avatar — there is no "other" participant.
        if (c?.kind === 'self_notes') {
            const mine = (c.participants ?? []).find(p => p.userId === me);
            return avatarUserFor(mine?.displayName ?? null, mine?.userId ?? c.id ?? null, mine?.avatarUrl);
        }
        const other = (c?.participants ?? []).find(p => p.userId && p.userId !== me);
        return avatarUserFor(other?.displayName ?? null, other?.userId ?? c?.id ?? null, other?.avatarUrl);
    }

    /** Avatar for a message bubble — resolved from the sender participant. */
    senderAvatar(m: ChatMessageDto): ChatAvatarUser {
        const p = (this.selected()?.participants ?? [])
            .find(x => x.participantId === m.senderParticipantId);
        return avatarUserFor(p?.displayName ?? null, p?.userId ?? m.senderParticipantId ?? null, p?.avatarUrl);
    }

    /** Display name of a message's sender (for the group/channel sender label). */
    senderName(m: ChatMessageDto): string {
        const p = (this.selected()?.participants ?? [])
            .find(x => x.participantId === m.senderParticipantId);
        return p?.displayName ?? 'Someone';
    }

    /**
     * This message begins a consecutive same-sender run — so it shows the avatar
     * (incoming) and, in a group/channel, the sender name; the rest of the run
     * collapses under it. `prev` is the message rendered just above WITHIN the
     * same day-group (null at a day boundary → always starts a run).
     */
    startsRun(m: ChatMessageDto, prev: ChatMessageDto | null): boolean {
        return !prev || prev.senderParticipantId !== m.senderParticipantId;
    }

    /** Show the sender's name above an incoming bubble — groups/channels only, first of a run. */
    showSenderName(m: ChatMessageDto, prev: ChatMessageDto | null): boolean {
        return this.isGroup() && !this.isMine(m) && this.startsRun(m, prev);
    }

    /** Presence dot for a conversation's counterpart (the first other participant). */
    rowStatus(c: ChatConversationDto | null): string | null {
        const me = this.meId;
        const other = (c?.participants ?? []).find(p => p.userId && p.userId !== me);
        return this.effectiveStatus(other?.userId, other?.presenceStatus);
    }

    /** Presence dot for a message's sender (incoming bubbles). */
    senderStatus(m: ChatMessageDto): string | null {
        const p = (this.selected()?.participants ?? []).find(x => x.participantId === m.senderParticipantId);
        return this.effectiveStatus(p?.userId, p?.presenceStatus);
    }

    /**
     * The dot a user gets — the #1019 self-set status OVER the #1022/#1023
     * connection-derived online layer:
     *  - self-set `away`/`busy` → ALWAYS shown (a deliberate declaration; visible
     *    even when the connection-presence layer is unavailable, e.g. Centrifugo
     *    presence off — so "who is away/busy" is legible regardless of ops state);
     *  - self-set `offline` ("appear offline") → no dot;
     *  - otherwise → green `online` only while the user holds a live realtime socket.
     */
    private effectiveStatus(userId: string | null | undefined, manual: string | null | undefined): string | null {
        return presenceDot(userId, manual, this.presenceOnline());
    }

    /** Distinct counterpart user ids across the conversation list — the presence poll set. */
    private counterpartUids(): string[] {
        const me = this.meId;
        const ids = new Set<string>();
        for (const c of this.conversations()) {
            for (const p of c.participants ?? []) {
                if (p.userId && p.userId !== me) {
                    ids.add(p.userId);
                }
            }
        }
        return [...ids];
    }

    /**
     * Close floating menus (the presence-status menu + the quick-react emoji
     * palette) on an outside click / Escape. Replaces a fixed backdrop, which the
     * page-header's `container-type` (CSS containment) would otherwise clip to the
     * header strip so it couldn't catch body clicks.
     */
    @HostListener('document:click', ['$event'])
    onDocumentClick(ev: MouseEvent): void {
        const target = ev.target as HTMLElement;
        if (this.showStatusMenu() && !target.closest('.msg__status')) {
            this.showStatusMenu.set(false);
        }
        // Reactions (#1334): dismiss the open quick-react palette on any click
        // outside its wrap. The React toggle button AND the palette both live in
        // `.msg__react-wrap`, so the opening click and the emoji picks (whose own
        // handlers run first, as they bubble before this document listener) don't
        // self-close it.
        if (this.reactionPickerFor() !== null && !target.closest('.msg__react-wrap')) {
            this.reactionPickerFor.set(null);
        }
    }

    @HostListener('document:keydown.escape')
    onStatusEscape(): void {
        this.showStatusMenu.set(false);
        this.reactionPickerFor.set(null);
    }

    toggleStatusMenu(): void {
        this.showStatusMenu.update(v => !v);
    }

    /** Set my presence status: optimistic local update + persist (#1019). */
    pickStatus(status: string): void {
        this.showStatusMenu.set(false);
        // A manual pick supersedes any auto-away; re-arm so idle-away can re-engage
        // from the fresh state (goAutoAway only fires from online/unset).
        this.autoAway = false;
        this.armIdleTimer();
        if (this.myStatus() === status) {
            return;
        }
        this.myStatus.set(status);
        this.api.setStatus(status).subscribe({
            // Refetch so my new status flows back onto my participant rows (and
            // re-derives consistently); the optimistic set already shows it.
            next: () => this.reloadList(),
            error: () => this.error.set('Could not update your status.'),
        });
    }

    /** Status-menu "Away after" pick — persist (per-device) + apply immediately. */
    setAwayAfter(min: number): void {
        if (!this.AWAY_OPTIONS.includes(min)) {
            return;
        }
        this.awayAfterMin.set(min);
        this.storeNumber('cms.msg.awayAfterMin', min);
        this.armIdleTimer();
    }

    // ── Auto-away idle tracking ─────────────────────────────────────────────
    // Activity anywhere (pointer/keyboard/wheel/touch, or the tab regaining
    // focus) re-arms an idle timer; on expiry we flip an available status to
    // `away`. It NEVER overrides a manual busy/offline/away — only the
    // online/unset "available" state auto-transitions, and only an auto-set
    // `away` is auto-reverted on the next activity. Scoped to this page's
    // lifetime (torn down on destroy).

    private setupIdleTracking(): void {
        this.lastActivityAt = Date.now();
        this.armIdleTimer();
        const opts: AddEventListenerOptions = { passive: true, capture: true };
        for (const ev of this.ACTIVITY_EVENTS) {
            document.addEventListener(ev, this.onActivity, opts);
        }
        this.visibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                this.onActivity();
            }
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    private teardownIdleTracking(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        const opts: AddEventListenerOptions = { capture: true };
        for (const ev of this.ACTIVITY_EVENTS) {
            document.removeEventListener(ev, this.onActivity, opts);
        }
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = undefined;
        }
    }

    private readonly ACTIVITY_EVENTS: readonly string[] = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

    /** Bound so add/removeEventListener target the same reference. */
    private readonly onActivity = (): void => {
        if (this.myStatus() === 'away') {
            // Away is AUTO-only, so any genuine activity (pointer/keyboard/wheel/
            // touch) or the tab regaining focus means I'm present again — clear it.
            // This also un-sticks an `away` that was seeded from a prior session on
            // reload (the in-memory `autoAway` flag resets to false on reload, which
            // was the "opened the chat but still Away" bug). Never fights a manual
            // pick — busy/offline are not reverted here.
            this.autoAway = false;
            this.setStatusInternal('online');
            this.lastActivityAt = Date.now();
            this.armIdleTimer();
            return;
        }
        const now = Date.now();
        if (now - this.lastActivityAt < 2000) {
            return; // throttle re-arm on high-frequency events (pointermove/wheel)
        }
        this.lastActivityAt = now;
        this.armIdleTimer();
    };

    private armIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        this.idleTimer = setTimeout(() => this.goAutoAway(), this.awayAfterMin() * 60_000);
    }

    private goAutoAway(): void {
        const s = this.myStatus();
        // Only from the available state — never clobber a manual away/busy/offline.
        if (s === null || s === 'online') {
            this.autoAway = true;
            this.setStatusInternal('away');
        }
    }

    /** Set my status WITHOUT the manual-pick side effects (no menu close / list reload). */
    private setStatusInternal(status: string): void {
        if (this.myStatus() === status) {
            return;
        }
        this.myStatus.set(status);
        this.api.setStatus(status).subscribe({
            error: () => { /* transient — the presence poll + next transition self-heal */ },
        });
    }

    // ── Resizable composer ──────────────────────────────────────────────────

    onGripDown(ev: PointerEvent): void {
        this.resizeStartY = ev.clientY;
        this.resizeStartH = this.composerH();
        this.resizing.set(true);
        try {
            (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
        } catch { /* no active pointer (e.g. synthetic event) — drag still tracks via move/up */ }
        ev.preventDefault();
    }

    onGripMove(ev: PointerEvent): void {
        if (!this.resizing()) {
            return;
        }
        // Drag UP (clientY decreases) → taller composer.
        this.composerH.set(this.clampComposerH(this.resizeStartH + (this.resizeStartY - ev.clientY)));
    }

    onGripUp(ev: PointerEvent): void {
        if (!this.resizing()) {
            return;
        }
        this.resizing.set(false);
        try {
            (ev.target as HTMLElement).releasePointerCapture(ev.pointerId);
        } catch { /* capture already released */ }
        this.storeNumber('cms.msg.composerH', this.composerH());
    }

    private clampComposerH(h: number): number {
        return Math.min(this.COMPOSER_MAX_H, Math.max(this.COMPOSER_MIN_H, Math.round(h)));
    }

    // ── localStorage helpers (per-device UI prefs) ──────────────────────────

    private readStoredNumber(key: string, fallback: number): number {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) {
                return fallback;
            }
            const n = Number(raw);
            return Number.isFinite(n) ? n : fallback;
        } catch {
            return fallback; // private mode / disabled storage
        }
    }

    private storeNumber(key: string, value: number): void {
        try {
            localStorage.setItem(key, String(value));
        } catch { /* quota / private mode — non-fatal */ }
    }

    statusColor(status: string | null): string {
        return this.STATUSES.find(s => s.value === status)?.color ?? 'var(--cms-text-muted, #848b96)';
    }

    statusLabel(status: string | null): string {
        return this.STATUSES.find(s => s.value === status)?.label ?? 'Set status';
    }

    /** Human-readable presence for the thread header (`online` reads as "Active"). */
    presenceLabel(status: string | null): string {
        switch (status) {
            case 'online': return 'Active';
            case 'away':   return 'Away';
            case 'busy':   return 'Busy';
            default:       return '';
        }
    }

    /** One-shot guard: only the FIRST status sync (fresh page mount) reverts a stale away. */
    private firstStatusSync = true;

    /**
     * Seed `myStatus` from my participant in any loaded conversation (so a reload
     * reflects the persisted status). Leaves the current value when none is found.
     */
    private syncMyStatus(): void {
        const me = this.meId;
        for (const c of this.conversations()) {
            const mine = (c.participants ?? []).find(p => p.userId === me);
            if (mine?.presenceStatus != null) {
                this.myStatus.set(mine.presenceStatus);
                break;
            }
        }
        // On the FIRST sync after mount, a seeded `away` is a stale auto-away from a
        // prior session — the user just navigated here, so show them present at once
        // (no "Away" flash). Later syncs (background polls) skip this, so a genuine
        // idle-away on THIS device is preserved until the user actually returns.
        if (this.firstStatusSync) {
            this.firstStatusSync = false;
            if (this.myStatus() === 'away' && document.visibilityState === 'visible') {
                this.autoAway = false;
                this.setStatusInternal('online');
            }
        }
    }

    isMine(m: ChatMessageDto): boolean {
        const mine = this.myParticipantId();
        return mine !== null && m.senderParticipantId === mine;
    }

    isHtml(m: ChatMessageDto): boolean {
        return m.bodyFormat === 'html' && !!m.body;
    }

    /**
     * Insert an emoji into the composer at the caret (#1011). The `<coolms-editor>`
     * is a black box with no imperative insert API, so we reach the one
     * contenteditable it mounts, focus it, and use `execCommand('insertText')` —
     * ProseMirror observes the resulting input event and emits `contentChange`,
     * keeping `composerHtml` in sync and the caret in place. Fallback (rare —
     * execCommand is unsupported): append to the model + force a clean re-mount.
     */
    insertEmoji(emoji: string): void {
        const host = this.composerEl()?.nativeElement;
        const editable = host?.querySelector('[contenteditable="true"]') as HTMLElement | null;
        let inserted = false;
        if (editable) {
            editable.focus();
            try {
                inserted = document.execCommand('insertText', false, emoji);
            } catch {
                inserted = false;
            }
        }
        if (!inserted) {
            // Model-level fallback: append the emoji and re-mount the editor so
            // it re-parses (Tiptap normalises a trailing text node into the doc).
            this.composerHtml.update(h => h + emoji);
            this.composerKey.update(k => String(Number(k) + 1));
        }
    }

    // ── @-mentions ─────────────────────────────────────────────────────────

    /** Does message `m` @-mention the CURRENT user? Drives the bubble highlight. */
    mentionsMe(m: ChatMessageDto): boolean {
        return mentionsUser(m, this.meId);
    }

    /**
     * On each composer edit, detect a live `@query` immediately before the caret
     * and open the typeahead (else close it). The `<coolms-editor>` is a black
     * box, so we read the native Selection of its contenteditable. A matched query
     * also kicks off a debounced DIRECTORY search (mention-anyone, v2).
     */
    private updateMentionMenu(): void {
        const before = this.textBeforeCaret();
        // A mention token is `@` (at string start or after whitespace) + up to 30
        // name chars, sitting right at the caret with no intervening space.
        const match = null === before ? null : /(?:^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
        if (null === match) {
            this.closeMentionMenu();
            return;
        }
        this.mentionQuery.set(match[1]);
        this.mentionActiveIndex.set(0);
        this.mentionMenuOpen.set(true);
        this.queueMentionSearch(match[1]);
    }

    /**
     * The text of the caret's own text node, up to the caret — what both
     * typeaheads match their trigger against. NULL when there is no usable
     * caret (no selection, a range rather than a caret, or a caret outside the
     * editor), which both callers treat as "no trigger".
     *
     * The `<coolms-editor>` is a black box, so this reads the native Selection
     * of its contenteditable rather than any editor API.
     */
    private textBeforeCaret(): string | null {
        const host = this.composerEl()?.nativeElement;
        const editable = host?.querySelector('[contenteditable="true"]') as HTMLElement | null;
        const sel = window.getSelection();
        if (!editable || !sel || sel.rangeCount === 0 || !sel.isCollapsed) {
            return null;
        }
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE || !editable.contains(node)) {
            return null;
        }

        return (node.textContent ?? '').slice(0, range.startOffset);
    }

    /**
     * The `#…` half of the same trick (#2114) — a channel handle being typed
     * right at the caret opens the channel typeahead.
     *
     * Handles are lowercase kebab-case, so the pattern is narrow on purpose: a
     * `#` followed by anything else (a heading, `#1`, a colour) is not a
     * reference and must not pop a menu over what you are writing.
     */
    private updateChannelMenu(): void {
        const query = channelTriggerAt(this.textBeforeCaret());
        if (null === query) {
            this.closeChannelMenu();
            return;
        }
        // Only fetch once — the browse panel shares this signal, so it is often
        // already populated.
        if (this.channels().length === 0 && !this.loadingChannels()) {
            this.loadChannels();
        }
        this.channelQuery.set(query);
        this.channelActiveIndex.set(0);
        this.channelMenuOpen.set(true);
    }

    private closeChannelMenu(): void {
        if (this.channelMenuOpen()) {
            this.channelMenuOpen.set(false);
        }
        this.channelQuery.set('');
    }

    onChannelMouseDown(ev: Event, c: ChatChannelDto): void {
        ev.preventDefault();
        this.pickChannelRef(c);
    }

    /**
     * Insert `#handle ` at the active `#query`.
     *
     * Nothing is recorded in a draft the way a mention is: a channel reference
     * needs no snapshot, because the handle IS the identity and it never
     * changes. That is the whole reason the slug exists rather than the title.
     */
    pickChannelRef(c: ChatChannelDto): void {
        const slug = c.slug;
        if (!slug) {
            return;
        }
        const html = this.composerHtml();
        const token = '#' + this.channelQuery();
        const idx = html.lastIndexOf(token);
        if (idx >= 0) {
            this.composerHtml.set(html.slice(0, idx) + '#' + slug + '&nbsp;' + html.slice(idx + token.length));
            this.composerKey.update(k => String(Number(k) + 1));
        }
        this.closeChannelMenu();
    }

    /** Debounced directory search feeding {@link mentionDirectory} (mention-anyone, v2). */
    private queueMentionSearch(query: string): void {
        if (this.mentionSearchTimer) {
            clearTimeout(this.mentionSearchTimer);
        }
        const q = query.trim();
        if (q === '') {
            // A bare `@` searches the DIRECTORY for nothing — there is no query to
            // send — but the menu still opens, and it is not empty: `mentionCandidates`
            // lists this conversation's own members, which is who you almost always
            // mean. Before #2106 this path left the menu blank, so `@` looked broken
            // until you typed a letter, which is exactly what was reported.
            this.mentionDirectory.set([]);
            return;
        }
        this.mentionSearchTimer = setTimeout(() => {
            this.mentionSearchSub?.unsubscribe();
            this.mentionSearchSub = this.api.searchUsers(q).subscribe(users => this.mentionDirectory.set(users));
        }, 200);
    }

    private closeMentionMenu(): void {
        if (this.mentionMenuOpen()) {
            this.mentionMenuOpen.set(false);
        }
        this.mentionQuery.set('');
        this.mentionDirectory.set([]);
        if (this.mentionSearchTimer) {
            clearTimeout(this.mentionSearchTimer);
            this.mentionSearchTimer = null;
        }
        this.mentionSearchSub?.unsubscribe();
        this.mentionSearchSub = null;
    }

    /** Mouse-pick: prevent the default focus steal so the editor keeps its caret. */
    onMentionMouseDown(ev: Event, c: MentionCandidate): void {
        ev.preventDefault();
        this.pickMention(c);
    }

    /**
     * Insert `@name ` at the active `@query` and record the drafted mention. For a
     * NON-member picked by the owner of a group, ALSO surface the "add to
     * conversation?" prompt (mention-anyone v2) — the mention itself is cosmetic
     * until they're added (a non-member can't read the conversation), so the prompt
     * offers to pull them in. In a DM / for a non-owner, only the cosmetic mention
     * lands. Also called from the keyboard handler.
     */
    pickMention(c: MentionCandidate): void {
        const name = (c.displayName || 'user').trim();
        this.insertMentionToken(name);
        this.mentionDraft.update(prev => {
            const map = new Map(prev);
            map.set(c.userId, name);
            return map;
        });
        const offerAdd = !c.inConversation && this.canAddMention();
        this.closeMentionMenu();
        if (offerAdd) {
            this.mentionAddPrompt.set({ userId: c.userId, name });
        }
    }

    /**
     * Replace the trailing `@query` in the MODEL (not the live editor DOM — a click
     * on the popover drops ProseMirror's selection and its node recycling makes DOM
     * ranges unreliable) with `@name&nbsp;`, then re-mount the editor. The token is
     * the last `@query` in the composer HTML (the typeahead only matches at the
     * caret, which sits at the end).
     */
    private insertMentionToken(name: string): void {
        const html = this.composerHtml();
        const token = '@' + this.mentionQuery();
        const idx = html.lastIndexOf(token);
        if (idx < 0) {
            return;
        }
        const next = html.slice(0, idx) + '@' + this.escapeHtml(name) + '&nbsp;' + html.slice(idx + token.length);
        this.composerHtml.set(next);
        this.composerKey.update(k => String(Number(k) + 1));
    }

    /** Owner accepts the "add {name}?" prompt → pull the mentioned user into the group. */
    confirmAddMention(): void {
        const prompt = this.mentionAddPrompt();
        const id = this.selectedId();
        this.mentionAddPrompt.set(null);
        if (!prompt || !id) {
            return;
        }
        this.api.addParticipants(id, [prompt.userId], this.shareHistoryOnAdd()).subscribe({
            next: conv => this.applyConversation(conv),
            error: (err: { status?: number }) =>
                this.error.set(err?.status === 403 ? 'Only the group owner can add members.' : 'Could not add the member.'),
        });
    }

    /** Dismiss the "add to conversation?" prompt (the mention stays as a cosmetic reference). */
    dismissAddMention(): void {
        this.mentionAddPrompt.set(null);
    }

    /**
     * The drafted mentions whose `@label` still appears in the outgoing body (so
     * deleting a mention token before send drops it), each `{userId, label}`.
     */
    private resolveOutgoingMentions(html: string): MentionRef[] {
        const draft = this.mentionDraft();
        if (draft.size === 0) {
            return [];
        }
        const text = (html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
        const out: MentionRef[] = [];
        draft.forEach((label, userId) => {
            if (text.includes('@' + label)) {
                out.push({ userId, label });
            }
        });
        return out;
    }

    /**
     * A message body with its `@label` mention tokens wrapped in a tint span. The
     * labels come from the message's OWN stored `mentions` (snapshotted at send),
     * so it tints member AND non-member ("mention anyway") references and stays
     * correct if a name later changes. Angular re-sanitises at the `[innerHTML]`
     * binding.
     */
    renderMentions(m: ChatMessageDto): string {
        let html = m.body ?? '';
        html = linkifyChannelRefs(html, this.channels());
        const refs = m.mentions ?? [];
        if (!refs.length) {
            return html;
        }
        // The server sanitiser encodes `@` as a numeric entity (e.g. `&#64;`) in the
        // stored HTML body, so a literal-`@` regex never matches. Decode the `@`
        // entities back before matching — `@` is safe punctuation, so this doesn't
        // weaken the already-sanitised markup. (A label may itself contain `@`, e.g.
        // an email, so both the trigger and in-label `@`s decode.)
        html = html.replace(/&(?:#0*64|#x0*40|commat);/gi, '@');
        // Longest label first so a short label can't clobber a longer one.
        const labels = [...new Set(refs.map(r => r.label).filter(Boolean))].sort((a, b) => b.length - a.length);
        for (const label of labels) {
            // Match + inject the HTML-escaped form (the composer escaped it into the
            // body); the escaped label is safe to inject verbatim.
            const esc = this.escapeHtml(label);
            const pattern = new RegExp('@' + this.escapeRegExp(esc) + '(?![\\p{L}\\p{N}])', 'gu');
            html = html.replace(pattern, () => `<span class="msg__mention">@${esc}</span>`);
        }
        return html;
    }

    /**
     * Turn `#handle` into a clickable channel reference (#2114).
     *
     * ⚠️ Only handles this client has actually RESOLVED are wrapped. A `#word`
     * that matches no channel stays plain text — a reference that looks live and
     * goes nowhere is worse than one that was never offered. It also means the
     * injected markup is built from a slug taken from the channel LIST, never
     * from message content, so nothing an author writes can reach the DOM
     * through this path.
     */
    /** Avatar view-model for a mention-typeahead candidate (photo, else colored initials). */
    candidateAvatar(c: MentionCandidate): ChatAvatarUser {
        return avatarUserFor(c.displayName, c.userId, c.avatarUrl);
    }

    private escapeHtml(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    private escapeRegExp(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    reloadList(): void {
        // Only show the full "Loading…" placeholder on the INITIAL load. A live
        // background refresh (the `watchUser` nudge — e.g. a dropped call posting
        // its "Call cancelled" system messages) already has rows on screen, so
        // flashing the whole list to "Loading…" and back reads as a jarring
        // reload/jitter. Rows are keyed by `c.id`, so a silent `conversations.set`
        // updates them in place with no flash.
        if (this.conversations().length === 0) {
            this.loadingList.set(true);
        }
        // Re-read what is CURRENTLY on screen, not just the first page (#2120):
        // a refresh that dropped back to one page would erase every "Load more"
        // the user had clicked — and this runs on a live nudge, mid-scroll.
        const want = refreshWindow(this.CONV_PAGE, this.conversations().length);
        this.api.listConversations(want).subscribe({
            next: list => {
                this.applyInboxPage(firstInboxPage(list, want));
                this.loadingList.set(false);
                this.applyPreselect();
                this.syncMyStatus();
            },
            error: () => { this.error.set('Could not load your conversations.'); this.loadingList.set(false); },
        });
    }

    /** Append the next page of inbox rows (#2120) — the rules live in `inbox-paging.util`. */
    loadMoreConversations(): void {
        if (this.loadingMoreConversations() || !this.hasMoreConversations()) {
            return;
        }
        this.loadingMoreConversations.set(true);
        this.api.listConversations(this.CONV_PAGE, this.convOffset).subscribe({
            next: list => {
                this.loadingMoreConversations.set(false);
                this.applyInboxPage(nextInboxPage(this.inboxPage(), list, this.CONV_PAGE));
            },
            error: () => { this.loadingMoreConversations.set(false); },
        });
    }

    /** The paging state, reassembled from the signals that hold it. */
    private inboxPage(): InboxPage<ChatConversationDto> {
        return { rows: this.conversations(), offset: this.convOffset, hasMore: this.hasMoreConversations() };
    }

    private applyInboxPage(page: InboxPage<ChatConversationDto>): void {
        this.conversations.set([...page.rows]);
        this.convOffset = page.offset;
        this.hasMoreConversations.set(page.hasMore);
    }

    /**
     * Honor a pending `?c=<conversationId>` deep-link (the topbar quick-panel
     * #1012/#1029) once the conversation list contains it — open that thread.
     * Re-runs after each list load and on every `?c=` change (see the ctor),
     * so the deep-link works both on first arrival and while already on the page.
     */
    private applyPreselect(): void {
        const id = this.pendingPreselect;
        if (id === null) {
            return;
        }
        if (!this.conversations().some(c => c.id === id)) {
            // ⚠️ Since the inbox is PAGED (#2120), "not in the list" no longer
            // means "not loaded yet" — a deep-link to an older conversation may
            // sit pages down and no amount of re-listing will surface it. Fetch
            // that ONE row and drop it in. A 404 is the honest answer for a
            // conversation the caller is not a member of; drop the pending id so
            // the next list load doesn't ask again.
            // Guarded by the id, not a bare flag: a plain "already fetching" would
            // make a `?c=` change land while an earlier fetch was in flight and be
            // dropped on the floor.
            if (this.preselectFetchingId === id) {
                return;
            }
            this.preselectFetchingId = id;
            this.api.getConversation(id).subscribe({
                next: conv => {
                    this.clearPreselectFetch(id);
                    if (!this.conversations().some(c => c.id === conv.id)) {
                        this.conversations.set([conv, ...this.conversations()]);
                    }
                    this.applyPreselect();
                },
                error: () => {
                    this.clearPreselectFetch(id);
                    // Only abandon the deep-link we were actually chasing — the URL
                    // may have moved on to a different conversation since.
                    if (this.pendingPreselect === id) {
                        this.pendingPreselect = null;
                    }
                },
            });
            return;
        }
        this.pendingPreselect = null;
        if (this.selectedId() !== id) {
            this.select(id);
        }
    }

    /**
     * The conversation id {@link applyPreselect} currently has a one-row fetch out
     * for — it must not re-fire that fetch on every list load, and must not block
     * a fetch for a DIFFERENT id.
     */
    private preselectFetchingId: string | null = null;

    private clearPreselectFetch(id: string): void {
        if (this.preselectFetchingId === id) {
            this.preselectFetchingId = null;
        }
    }

    select(id: string): void {
        if (this.selectedId() === id) {
            return;
        }
        this.selectedId.set(id);
        this.messages.set([]);
        // Drop any composer draft so it can't leak into the newly-opened thread.
        this.pending.set([]);
        this.mentionDraft.set(new Map());
        this.mentionAddPrompt.set(null);
        this.closeMentionMenu();
        this.showEmoji.set(false);
        this.showMembers.set(false);
        this.clearTyping();
        this.lastSeq = 0;
        this.hasMoreOlder.set(false);
        this.loadingOlder.set(false);
        // Reset the pinned bar for the newly-opened conversation, then load it.
        this.pinnedMessages.set([]);
        this.pinnedOpen.set(false);
        this.loadThread();
        this.loadPinned(id);
        this.startPolling();
        // Marking read happens once the messages ARRIVE ({@link applyMessages}) —
        // not here (#2115). At this point `lastSeq` is 0 and the only seq to hand
        // is the conversation row's, which is the SERVER's high-water: claiming
        // it would mark messages this client has not fetched, and tell their
        // senders "Read". An EXCLUDED (read-only) viewer is skipped there too —
        // they cannot read new messages, and the server gates a non-member
        // mark-read anyway.
        const opened = this.selected();
        // Seed the read-receipt cursors from the peers' persisted values so a
        // re-opened thread shows "Read" without waiting for a fresh nudge (#1018).
        this.peerReadSeqs.set(peerReadCursors(opened?.participants, this.meId));
    }

    /** Clear the "X is typing…" indicator + its idle timer. */
    private clearTyping(): void {
        this.typingName.set(null);
        if (this.typingTimer) {
            clearTimeout(this.typingTimer);
            this.typingTimer = null;
        }
    }

    toggleNew(): void {
        const next = !this.showNew();
        this.showNew.set(next);
        if (next) {
            this.showChannels.set(false);
        } else {
            this.resetNew();
        }
    }

    toggleEmoji(): void {
        this.showEmoji.update(v => !v);
    }

    /**
     * A user was picked in the "New" composer — add them as a member chip
     * (deduped). The picker resets to its placeholder after each pick (it never
     * gets its `value` fed back), so the next selection appends another member.
     * The chip label resolves best-effort in the background; it renders "…"
     * until then and degrades to the id if the lookup fails.
     */
    onUserPicked(userId: string): void {
        if (!userId || this.groupMembers().some(m => m.id === userId)) {
            return;
        }
        this.groupMembers.update(list => [...list, { id: userId, label: '…' }]);
        this.api.resolveUserLabel(userId).subscribe(label => {
            this.groupMembers.update(list =>
                list.map(m => (m.id === userId ? { id: userId, label } : m)),
            );
        });
    }

    /** Drop a picked member from the "New" composer. */
    removeMember(userId: string): void {
        this.groupMembers.update(list => list.filter(m => m.id !== userId));
    }

    /**
     * Start the conversation the "New" composer describes: a single member opens
     * (or reuses) the 1:1 DM ({@link MessagesService.openDirect}, idempotent);
     * two-or-more mints a fresh group with the optional title
     * ({@link MessagesService.openGroup}). On success the new/returned
     * conversation is selected and the composer resets.
     */
    startConversation(): void {
        const members = this.groupMembers();
        if (members.length === 0 || this.starting()) {
            return;
        }
        const ids = members.map(m => m.id);
        const title = this.groupTitle().trim();
        this.starting.set(true);

        const req$ = ids.length === 1
            ? this.api.openDirect(ids[0])
            : this.api.openGroup(ids, title || null);

        req$.subscribe({
            next: conv => {
                this.starting.set(false);
                this.resetNew();
                if (!this.conversations().some(c => c.id === conv.id)) {
                    this.conversations.set([conv, ...this.conversations()]);
                }
                this.select(conv.id);
                this.reloadList();
            },
            error: (err: { status?: number }) => {
                this.starting.set(false);
                this.error.set(
                    err?.status === 404
                        ? 'One of the selected users was not found.'
                        : 'Could not start the conversation.',
                );
            },
        });
    }

    /**
     * Create a PUBLIC channel from the "New" composer's channel mode
     * (Chat-channels arc). Mints the channel, drops it into the inbox, selects
     * it, and closes the composer.
     */
    startChannel(): void {
        const title = this.channelName().trim();
        if (!title || this.starting()) {
            return;
        }
        this.starting.set(true);
        this.api.createChannel(title).subscribe({
            next: conv => {
                this.starting.set(false);
                this.resetNew();
                if (!this.conversations().some(c => c.id === conv.id)) {
                    this.conversations.set([conv, ...this.conversations()]);
                }
                this.select(conv.id);
                this.reloadList();
            },
            error: () => {
                this.starting.set(false);
                this.error.set('Could not create the channel.');
            },
        });
    }

    /**
     * Open the current user's "message yourself" NOTES conversation (#1333) from
     * the "New" composer — idempotent server-side ({@link MessagesService.openSelfNotes}),
     * so it either reuses the existing notes room or mints it. Drops it into the
     * inbox, selects it, and closes the composer.
     */
    startSelfNotes(): void {
        if (this.starting()) {
            return;
        }
        this.starting.set(true);
        this.api.openSelfNotes().subscribe({
            next: conv => {
                this.starting.set(false);
                this.resetNew();
                if (!this.conversations().some(c => c.id === conv.id)) {
                    this.conversations.set([conv, ...this.conversations()]);
                }
                this.select(conv.id);
                this.reloadList();
            },
            error: () => {
                this.starting.set(false);
                this.error.set('Could not open your notes.');
            },
        });
    }

    /** Clear + close the "New" composer. */
    private resetNew(): void {
        this.showNew.set(false);
        this.groupMembers.set([]);
        this.groupTitle.set('');
        this.newMode.set('people');
        this.channelName.set('');
    }

    // ── Public channels browse (Chat-channels arc CH2) ──────────────────────

    /** Toggle the public-channel browse panel; loads the list on open. */
    toggleChannels(): void {
        const next = !this.showChannels();
        this.showChannels.set(next);
        if (next) {
            this.showNew.set(false);
            this.loadChannels();
        }
    }

    /** Fetch the public channels discovery list (`GET /chat/channels`). */
    loadChannels(): void {
        this.loadingChannels.set(true);
        this.api.listChannels().subscribe({
            next: rows => {
                this.channels.set(rows);
                this.loadingChannels.set(false);
            },
            error: () => {
                this.channels.set([]);
                this.loadingChannels.set(false);
                this.error.set('Could not load channels.');
            },
        });
    }

    /** Open self-join a public channel from the browse list, then open its thread. */
    joinChannel(ch: ChatChannelDto): void {
        this.api.joinChannel(ch.id).subscribe({
            next: conv => {
                // Flip the browse row to "joined" + drop the channel into the inbox.
                this.channels.update(list => list.map(c => (c.id === ch.id ? { ...c, joined: true } : c)));
                if (!this.conversations().some(c => c.id === conv.id)) {
                    this.conversations.set([conv, ...this.conversations()]);
                }
                this.showChannels.set(false);
                this.select(conv.id);
                this.reloadList();
            },
            error: () => this.error.set('Could not join the channel.'),
        });
    }

    /** Open a channel the user has already joined (from the browse list). */
    openChannel(ch: ChatChannelDto): void {
        this.showChannels.set(false);
        this.select(ch.id);
    }

    /**
     * A `#handle` in a rendered message was clicked (#2114).
     *
     * Delegated from the bubble because the reference lives inside sanitised
     * `[innerHTML]`, where there is no Angular binding to attach to.
     *
     * ⚠️ The handle is read from the element's TEXT, not from a `data-` attribute:
     * Angular's HTML sanitizer keeps `class` but STRIPS `data-*`, so the obvious
     * `data-chan="…"` arrives as null and every click silently does nothing. The
     * text is the slug anyway — {@see linkifyChannelRefs} writes both from the
     * same value, and only for a channel it already resolved.
     *
     * A channel you are IN opens. One you are not in opens the browse panel
     * instead of silently doing nothing — joining is a decision, not a
     * side-effect of clicking a word in someone else's sentence.
     */
    onBodyClick(ev: Event): void {
        const el = ev.target as HTMLElement | null;
        if (!el?.classList.contains('msg__chanref')) {
            return;
        }
        const slug = (el.textContent ?? '').replace(/^#/, '');
        if ('' === slug) {
            return;
        }
        ev.preventDefault();
        const channel = this.channels().find(c => c.slug === slug);
        if (!channel) {
            return;
        }
        if (channel.joined) {
            this.select(channel.id);
            return;
        }
        this.showChannels.set(true);
        this.showNew.set(false);
    }

    // ── Group members panel (G2) ────────────────────────────────────────────

    toggleMembers(): void {
        this.showMembers.update(v => !v);
    }

    /** Avatar view-model for a participant row in the members panel. */
    memberAvatar(p: ConversationParticipantDto): ChatAvatarUser {
        return avatarUserFor(p.displayName ?? null, p.userId ?? p.participantId, p.avatarUrl);
    }

    /**
     * Owner picked a user to add to the group. Skips an existing member; on
     * success the endpoint returns the conversation with refreshed participants,
     * which we merge into the list so the panel updates in place.
     */
    onMemberPicked(userId: string): void {
        const id = this.selectedId();
        if (!id || !userId || this.members().some(m => m.userId === userId)) {
            return;
        }
        this.api.addParticipants(id, [userId], this.shareHistoryOnAdd()).subscribe({
            next: conv => this.applyConversation(conv),
            error: (err: { status?: number }) => {
                this.error.set(err?.status === 403 ? 'Only the group owner can add members.' : 'Could not add the member.');
            },
        });
    }

    /** Owner removes a member (204 → refetch the conversation to refresh the panel). */
    removeGroupMember(userId: string | null): void {
        const id = this.selectedId();
        if (!id || !userId) {
            return;
        }
        this.api.removeParticipant(id, userId).subscribe({
            next: () => this.api.getConversation(id).subscribe({ next: conv => this.applyConversation(conv) }),
            error: (err: { status?: number }) => {
                this.error.set(err?.status === 403 ? 'Only the group owner can remove members.' : 'Could not remove the member.');
            },
        });
    }

    /** A member leaves the group themselves → drop it from the inbox + deselect. */
    leaveGroup(): void {
        const id = this.selectedId();
        const me = this.meId;
        if (!id || !me) {
            return;
        }
        this.api.removeParticipant(id, me).subscribe({
            next: () => {
                this.showMembers.set(false);
                this.selectedId.set(null);
                this.conversations.set(this.conversations().filter(c => c.id !== id));
            },
            error: (err: { status?: number }) => {
                this.error.set(err?.status === 400
                    ? 'The group owner cannot leave; transfer ownership first.'
                    : 'Could not leave the group.');
            },
        });
    }

    /** Replace a conversation in the inbox list with a fresh (re-enriched) copy. */
    private applyConversation(conv: ChatConversationDto): void {
        this.conversations.update(list => list.map(c => (c.id === conv.id ? conv : c)));
    }

    // ── Conversation-row context menu (membership semantics) ────────────────

    /** Open the right-click menu on a conversation row (anchored at the cursor). */
    onRowContextMenu(event: MouseEvent, conv: ChatConversationDto): void {
        event.preventDefault();
        // Clamp near the right/bottom edges so the menu stays on-screen.
        const x = Math.min(event.clientX, window.innerWidth - 200);
        const y = Math.min(event.clientY, window.innerHeight - 120);
        this.ctxMenu.set({ x, y, conv });
    }

    closeCtxMenu(): void {
        this.ctxMenu.set(null);
    }

    /**
     * Whether the context menu should offer "Leave group/channel" for this row —
     * only for an ACTIVE member of a group/channel who is NOT its Owner (the owner
     * must transfer ownership first, so we don't offer them a dead action).
     */
    ctxCanLeave(conv: ChatConversationDto): boolean {
        if (conv.kind !== 'group' || conv.viewerState === 'excluded') {
            return false;
        }
        const me = this.meId;
        const mine = (conv.participants ?? []).find(p => p.userId === me);
        // Active member (present in the roster) and not the owner.
        return !!mine && mine.role !== 'owner';
    }

    /**
     * Mark a conversation read from the context menu (clears its unread badge).
     *
     * This one DOES claim the server's `lastSeq` (#2115), and should: the user
     * explicitly asked for the badge gone without opening the conversation, so
     * "I have read everything in it" is precisely what they mean. Everywhere
     * else the claim is what this client actually received.
     */
    ctxMarkRead(conv: ChatConversationDto): void {
        this.markConversationRead(conv.id, conv.lastSeq ?? 0);
        this.closeCtxMenu();
    }

    /**
     * Toggle MUTE from the context menu (#1332) — optimistic: patch `viewerMuted`
     * so the row dims + the global badge drops immediately, then POST/DELETE the
     * mute endpoint; revert the flag on error. Only offered for an ACTIVE member
     * (the backend 403s a left/excluded participant).
     */
    ctxToggleMute(conv: ChatConversationDto): void {
        this.closeCtxMenu();
        const nextMuted = !conv.viewerMuted;
        this.patchMuted(conv.id, nextMuted);
        const req = nextMuted ? this.api.mute(conv.id) : this.api.unmute(conv.id);
        req.subscribe({
            error: () => {
                this.patchMuted(conv.id, !nextMuted); // revert
                this.error.set('Could not update the mute setting.');
            },
        });
    }

    /** Patch only the `viewerMuted` flag on a conversation row (preserves other live fields). */
    private patchMuted(conversationId: string, muted: boolean): void {
        this.conversations.update(list =>
            list.map(c => (c.id === conversationId ? { ...c, viewerMuted: muted } : c)));
    }

    /**
     * Leave / remove-from-list from the context menu — self-leave (the server
     * drops the read-only remnant too), then drop the row from the inbox and
     * deselect if it was open. "Removing group/channel from the left list means
     * leave it."
     */
    ctxLeave(conv: ChatConversationDto): void {
        const me = this.meId;
        this.closeCtxMenu();
        if (!me) {
            return;
        }
        this.api.removeParticipant(conv.id, me).subscribe({
            next: () => {
                if (this.selectedId() === conv.id) {
                    this.showMembers.set(false);
                    this.selectedId.set(null);
                }
                this.conversations.set(this.conversations().filter(c => c.id !== conv.id));
            },
            error: (err: { status?: number }) => {
                this.error.set(err?.status === 400
                    ? 'The group owner cannot leave; transfer ownership first.'
                    : 'Could not leave the conversation.');
            },
        });
    }

    /**
     * Composer content changed — keep the model in sync AND emit a throttled
     * typing signal (#1016) so the other participant sees "X is typing…". We
     * only signal when there's real text (not on a placeholder/clear), and at
     * most once per 3s (the server nudge is ephemeral; the indicator self-clears
     * after ~4s of silence on the receiver).
     */
    onComposerInput(html: string): void {
        this.composerHtml.set(html);
        // Re-evaluate both typeaheads against the caret on every edit. At most
        // one can match — their triggers are different characters.
        this.updateMentionMenu();
        this.updateChannelMenu();
        const id = this.selectedId();
        if (!id || !this.hasText(html)) {
            return;
        }
        const now = Date.now();
        if (now - this.lastTypingSentAt < 3000) {
            return;
        }
        this.lastTypingSentAt = now;
        this.api.sendTyping(id).subscribe({ error: () => { /* ephemeral — ignore */ } });
    }

    doSend(): void {
        const id = this.selectedId();
        const body = this.composerHtml();
        const atts = this.pending();
        // An attachment-only message (empty body) is valid; block only the
        // truly-empty case, an in-flight send, or a still-uploading attachment.
        if (!id || (!this.hasText(body) && atts.length === 0) || this.sending() || this.uploading()) {
            return;
        }
        // Send an empty body when there's no text (attachment-only) so the editor's
        // placeholder `<p></p>` doesn't persist as a stray empty paragraph.
        const outBody = this.hasText(body) ? body : '';
        // The drafted @-mentions still present in the final body (server re-validates).
        const mentions = this.resolveOutgoingMentions(outBody);
        this.sending.set(true);
        this.api.postMessage(id, outBody, this.uuid(), 'html', atts, undefined, mentions).subscribe({
            next: m => {
                // Clear the composer + re-mount the editor empty (fresh undo / cursor).
                this.composerHtml.set('');
                this.composerKey.update(k => String(Number(k) + 1));
                this.pending.set([]);
                this.mentionDraft.set(new Map());
                this.mentionAddPrompt.set(null);
                this.closeMentionMenu();
                this.applyMessages([m]);
                this.sending.set(false);
            },
            error: () => { this.error.set('Could not send the message.'); this.sending.set(false); },
        });
    }

    // ── Threads T2: the thread side-panel ──────────────────────────────────

    /** Open the thread panel scoped to a (top-level) message + load its replies. */
    openThread(root: ChatMessageDto): void {
        this.openThreadRoot.set(root);
        this.threadReply.set('');
        this.loadThreadPanel(root.id);
    }

    closeThread(): void {
        this.openThreadRoot.set(null);
        this.threadMessages.set([]);
    }

    private loadThreadPanel(rootId: string): void {
        const conv = this.selectedId();
        if (!conv) {
            return;
        }
        this.loadingThreadPanel.set(true);
        this.api.listThread(conv, rootId).subscribe({
            next: list => {
                // Guard a stale response after the user switched/closed the thread.
                if (this.openThreadRoot()?.id === rootId) {
                    this.threadMessages.set(list);
                    this.scrollThreadPanelSoon();
                }
                this.loadingThreadPanel.set(false);
            },
            error: () => { this.loadingThreadPanel.set(false); },
        });
    }

    /** Enter sends the reply; Shift+Enter inserts a newline. */
    onThreadKeydown(ev: KeyboardEvent): void {
        if ('Enter' === ev.key && !ev.shiftKey) {
            ev.preventDefault();
            this.sendThreadReply();
        }
    }

    sendThreadReply(): void {
        const conv = this.selectedId();
        const root = this.openThreadRoot();
        const body = this.threadReply().trim();
        if (!conv || !root || '' === body || this.sendingThreadReply()) {
            return;
        }
        this.sendingThreadReply.set(true);
        // Thread replies are plain text (the panel composer is a simple textarea).
        this.api.postMessage(conv, body, this.uuid(), 'plain', [], root.id).subscribe({
            next: reply => {
                this.threadReply.set('');
                // Append to the open panel (dedupe by id, keep seq order).
                this.threadMessages.update(list =>
                    list.some(m => m.id === reply.id) ? list : [...list, reply].sort((a, b) => a.seq - b.seq),
                );
                this.scrollThreadPanelSoon();
                // The root's seq didn't change, so a main-list catch-up won't refresh
                // its reply-count chip — bump it optimistically.
                this.bumpRootReplyCount(root.id);
                this.sendingThreadReply.set(false);
            },
            error: () => { this.error.set('Could not post the reply.'); this.sendingThreadReply.set(false); },
        });
    }

    /** Optimistically +1 a root message's replyCount in the main list + the panel header. */
    private bumpRootReplyCount(rootId: string): void {
        this.messages.update(list => list.map(m =>
            m.id === rootId ? { ...m, replyCount: (m.replyCount ?? 0) + 1 } : m,
        ));
        const root = this.openThreadRoot();
        if (null !== root && root.id === rootId) {
            this.openThreadRoot.set({ ...root, replyCount: (root.replyCount ?? 0) + 1 });
        }
    }

    private scrollThreadPanelSoon(): void {
        setTimeout(() => {
            const el = document.querySelector('.msg__tp-body');
            if (el) {
                el.scrollTop = el.scrollHeight;
            }
        }, 0);
    }

    // ── Pinning ─────────────────────────────────────────────────────────────

    /** Load the open conversation's pinned messages into the pinned bar. */
    private loadPinned(conversationId: string): void {
        this.api.listPinned(conversationId).subscribe({
            next: pinned => this.pinnedMessages.set(pinned),
            error: () => { /* best-effort — the bar just stays as-is */ },
        });
    }

    /**
     * Pin / unpin a message (any active member curates). Optimistically flips the
     * bubble's `pinnedAt` in the main list + reloads the pinned bar; the server's
     * `pin` room nudge reconciles every viewer.
     */
    togglePin(m: ChatMessageDto): void {
        const convId = this.selectedId();
        if (!convId) {
            return;
        }
        const willPin = !m.pinnedAt;
        const req = willPin ? this.api.pinMessage(m.id) : this.api.unpinMessage(m.id);
        // Optimistic: stamp/clear pinnedAt on the bubble in the main list.
        const stamp = willPin ? new Date().toISOString() : null;
        this.messages.update(list => list.map(x => (x.id === m.id ? { ...x, pinnedAt: stamp } : x)));
        req.subscribe({
            next: () => this.loadPinned(convId),
            error: () => {
                // Revert the optimistic flip on failure.
                this.messages.update(list => list.map(x => (x.id === m.id ? { ...x, pinnedAt: m.pinnedAt ?? null } : x)));
                this.error.set('Could not update the pin.');
            },
        });
    }

    // ── Reactions (#1334) ────────────────────────────────────────────────────

    /**
     * A message's reactions aggregated into per-emoji chips: `{emoji, count, mine}`
     * (`mine` = the current user is among the reactors). Order preserves
     * first-seen. Drives the reaction chip row.
     */
    reactionGroups(m: ChatMessageDto): { emoji: string; count: number; mine: boolean }[] {
        const me = this.meId;
        const byEmoji = new Map<string, { emoji: string; count: number; mine: boolean }>();
        for (const r of m.reactions ?? []) {
            const g = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
            g.count += 1;
            if (me && r.userId === me) {
                g.mine = true;
            }
            byEmoji.set(r.emoji, g);
        }

        return [...byEmoji.values()];
    }

    /** Toggle the react palette open for a message (only one open at a time). */
    toggleReactionPicker(m: ChatMessageDto): void {
        this.reactionPickerFor.update(cur => (cur === m.id ? null : m.id));
    }

    /** Pick an emoji from the palette: close it, then toggle the reaction. */
    pickReaction(m: ChatMessageDto, emoji: string): void {
        this.reactionPickerFor.set(null);
        this.toggleReaction(m, emoji);
    }

    /**
     * Toggle the current user's `emoji` reaction on a message (#1334). Optimistically
     * adds/removes `{emoji, me}` in the in-memory message + calls the API; the server's
     * `reaction` room nudge reconciles every viewer (incl. this one). Reverts on error.
     */
    toggleReaction(m: ChatMessageDto, emoji: string): void {
        const me = this.meId;
        if (!this.selectedId() || !me || !this.canReact()) {
            return;
        }
        const current = m.reactions ?? [];
        const had = current.some(r => r.emoji === emoji && r.userId === me);
        const next: readonly ReactionRef[] = had
            ? current.filter(r => !(r.emoji === emoji && r.userId === me))
            : [...current, { emoji, userId: me }];
        this.patchReactions(m.id, next);
        this.api.reactToMessage(m.id, emoji).subscribe({
            error: () => {
                this.patchReactions(m.id, current); // revert to the pre-toggle set
                this.error.set('Could not update the reaction.');
            },
        });
    }

    /** Patch a message's `reactions` in both the main timeline + the open thread panel. */
    private patchReactions(id: string, reactions: readonly ReactionRef[]): void {
        const apply = (list: ChatMessageDto[]): ChatMessageDto[] =>
            list.map(x => (x.id === id ? { ...x, reactions } : x));
        this.messages.update(apply);
        this.threadMessages.update(apply);
    }

    /**
     * A `reaction` room nudge arrived — re-read the current window and merge each
     * message's `reactions` in by id (a reaction doesn't bump `seq`, so the normal
     * catch-up merge, which only ADDS new-id messages, wouldn't touch existing ones).
     */
    private reconcileReactions(conversationId: string): void {
        this.api.listLatest(conversationId, this.PAGE).subscribe({
            next: fresh => {
                if (this.selectedId() !== conversationId) {
                    return;
                }
                const byId = new Map(fresh.map(m => [m.id, m.reactions ?? []] as const));
                const apply = (list: ChatMessageDto[]): ChatMessageDto[] =>
                    list.map(m => (byId.has(m.id) ? { ...m, reactions: byId.get(m.id) } : m));
                this.messages.update(apply);
                this.threadMessages.update(apply);
            },
            error: () => { /* best-effort — the next nudge/poll retries */ },
        });
    }

    /** A one-line snippet of a pinned message for the pinned-bar list (tags stripped). */
    pinSnippet(m: ChatMessageDto): string {
        const raw = (m.body ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (raw) {
            return raw.length > 80 ? raw.slice(0, 80) + '…' : raw;
        }
        return m.attachments?.length ? '📎 Attachment' : '(no text)';
    }

    /**
     * Scroll the main timeline to a message (from the pinned bar) + briefly
     * highlight it. If the message isn't currently loaded it's a no-op (the pinned
     * message may be far up the history — a fuller "jump to message" is a follow-up).
     */
    scrollToMessage(messageId: string): void {
        const el = document.querySelector(`.msg__scroll [data-mid="${messageId}"]`);
        if (!el) {
            return;
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('msg__line--flash');
        setTimeout(() => el.classList.remove('msg__line--flash'), 1400);
    }

    /** File picker change → upload each file, appending successes to `pending`. */
    onFilesPicked(ev: Event): void {
        const input = ev.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = ''; // reset so re-picking the same file fires `change` again
        if (!files.length) {
            return;
        }
        this.uploading.set(true);
        let remaining = files.length;
        const done = (): void => {
            if (--remaining === 0) {
                this.uploading.set(false);
            }
        };
        for (const file of files) {
            this.api.uploadAttachment(file).subscribe({
                next: att => { this.pending.update(list => [...list, att]); done(); },
                error: () => { this.toast.error(`Couldn't attach "${file.name}".`); done(); },
            });
        }
    }

    removePending(att: ChatAttachmentDto): void {
        this.pending.update(list => list.filter(a => a.vfsNodeId !== att.vfsNodeId));
    }

    downloadUrl(att: ChatAttachmentDto): string {
        return this.api.downloadUrl(att.vfsNodeId);
    }

    /**
     * Fetch the attachment as a Bearer-authorised blob and trigger a browser
     * download (a plain `<a href>` can't carry the token). The object URL is
     * revoked after the synthetic click so we don't leak it.
     */
    downloadAttachment(att: ChatAttachmentDto): void {
        this.api.fetchAttachment(att.vfsNodeId).subscribe({
            next: blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = att.filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 0);
            },
            error: () => this.toast.error(`Couldn't download "${att.filename}".`),
        });
    }

    /**
     * If a system notice is an RTC "recording available" notice (ADR-145 G8g #1375),
     * return the call id parsed from the `rtc:call:<uuid>:rec:ready` clientId the ingest
     * stamps; else null. Drives the "Download recording" affordance on the timeline notice.
     */
    rtcRecordingCallId(m: ChatMessageDto): string | null {
        const match = /^rtc:call:(.+):rec:ready$/.exec(m.clientId ?? '');
        return match ? match[1] : null;
    }

    /**
     * Fetch a finished group call's recording (participant-gated, G8f) as a
     * Bearer-authorised blob and trigger a browser download — same pattern as
     * {@link downloadAttachment} (a plain `<a href>` can't carry the token). The object
     * URL is revoked after the synthetic click so we don't leak it.
     */
    downloadRtcRecording(callId: string): void {
        this.rtcCall.downloadRecording(callId).subscribe({
            next: blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `recording-${callId}.mp4`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 0);
            },
            error: () => this.toast.error(`Couldn't download the recording.`),
        });
    }

    /** Human-readable byte size for a file chip (e.g. "1.2 MB"). */
    humanSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        const units = ['KB', 'MB', 'GB'];
        let n = bytes / 1024;
        let i = 0;
        while (n >= 1024 && i < units.length - 1) {
            n /= 1024;
            i++;
        }
        return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
    }

    private loadThread(): void {
        const id = this.selectedId();
        if (!id) {
            return;
        }
        this.loadingThread.set(true);
        this.hasMoreOlder.set(false);
        // Open on the NEWEST page (not the head), so a long thread shows recent
        // messages immediately; older pages load on scroll-up (#1033).
        this.api.listLatest(id, this.PAGE).subscribe({
            next: list => {
                this.applyMessages(list);
                this.loadingThread.set(false);
                this.hasMoreOlder.set(list.length >= this.PAGE);
            },
            error: () => { this.error.set('Could not load this conversation.'); this.loadingThread.set(false); },
        });
    }

    /**
     * Scroll-driven lazy load (#1033): near the top + more to fetch + not already
     * loading → pull the previous page and prepend it, preserving the viewport
     * anchor so the message under the cursor stays put.
     */
    onThreadScroll(): void {
        const el = this.threadScroll()?.nativeElement;
        if (!el || el.scrollTop > 48) {
            return;
        }
        if (this.hasMoreOlder() && !this.loadingOlder() && !this.loadingThread()) {
            this.loadOlder();
        }
    }

    private loadOlder(): void {
        const id = this.selectedId();
        const msgs = this.messages();
        if (!id || msgs.length === 0) {
            return;
        }
        const oldestSeq = msgs[0].seq;
        const el = this.threadScroll()?.nativeElement;
        // Capture the pre-prepend scroll metrics BEFORE toggling the loading hint,
        // so the restored offset reflects only the height the page itself adds.
        const prevHeight = el?.scrollHeight ?? 0;
        const prevTop = el?.scrollTop ?? 0;
        this.loadingOlder.set(true);
        this.api.listBefore(id, oldestSeq, this.PAGE).subscribe({
            next: list => {
                const added = this.mergeMessages(list);
                this.loadingOlder.set(false);
                this.hasMoreOlder.set(list.length >= this.PAGE && added > 0);
                if (added > 0 && el) {
                    // Keep the same message under the cursor: shift scrollTop by
                    // exactly the height the prepended page introduced.
                    setTimeout(() => { el.scrollTop = prevTop + (el.scrollHeight - prevHeight); }, 0);
                }
            },
            error: () => { this.loadingOlder.set(false); },
        });
    }

    /**
     * Reconcile-poll tick (#1041) — a NO-OP while the realtime WS engine is
     * connected (room nudges are the live path then); only does the catch-up
     * fetch when push is unavailable, so polling is a true fallback rather than
     * a parallel path. The timer keeps ticking cheaply; the work is gated.
     */
    private poll(): void {
        if (this.live.isConnected()) {
            return;
        }
        this.catchUp();
    }

    /**
     * Pull anything past our local high-water `lastSeq` for the open thread
     * (afterSeq cursor) and merge it. Shared by the debounced realtime
     * {@link roomCatchUp$}, the WS-(re)connect catch-up, and the no-WS fallback
     * {@link poll} — so every "fetch newer messages" path funnels through one
     * dedupe-by-id merge (#1041). No-op when nothing is selected.
     */
    private catchUp(): void {
        const id = this.selectedId();
        if (!id) {
            return;
        }
        this.api.listMessages(id, this.lastSeq, 100).subscribe({
            next: list => { if (this.selectedId() === id) { this.applyMessages(list); } },
            error: () => { /* transient — the next nudge or poll tick retries */ },
        });
    }

    /**
     * Merge incoming messages into the thread (dedupe by id, re-sort by seq),
     * advancing `lastSeq`. Returns how many were NEW — the pure state update,
     * with no scroll/read side-effects (so a backward "load earlier" page can
     * reuse it without yanking the viewport to the bottom). #1033
     */
    private mergeMessages(incoming: ChatMessageDto[]): number {
        if (!incoming.length) {
            return 0;
        }
        const seen = new Set(this.messages().map(m => m.id));
        const fresh = incoming.filter(m => !seen.has(m.id));
        if (!fresh.length) {
            return 0;
        }
        const merged = [...this.messages(), ...fresh].sort((a, b) => a.seq - b.seq);
        this.messages.set(merged);
        this.lastSeq = merged.reduce((max, m) => Math.max(max, m.seq), this.lastSeq);
        return fresh.length;
    }

    /** Append/initial merge: scroll to the latest + mark the thread read. */
    private applyMessages(incoming: ChatMessageDto[]): void {
        if (this.mergeMessages(incoming) === 0) {
            return;
        }
        this.scrollSoon();
        // The conversation is open + on-screen → what just ARRIVED counts as read
        // (#2115: `this.lastSeq` is what we hold, not what the server has). An
        // excluded viewer is read-only; the server refuses their mark-read, so
        // do not ask.
        const open = this.selectedId();
        if (open !== null && mayMarkRead(this.selected(), this.lastSeq)) {
            this.markConversationRead(open, this.lastSeq);
        }
    }

    private startPolling(): void {
        if (!this.pollTimer) {
            this.pollTimer = setInterval(() => this.poll(), this.POLL_MS);
        }
    }

    private stopPolling(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private scrollSoon(): void {
        setTimeout(() => {
            const el = this.threadScroll()?.nativeElement;
            if (el) {
                el.scrollTop = el.scrollHeight;
            }
        }, 0);
    }

    private uuid(): string {
        try {
            if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
                return crypto.randomUUID();
            }
        } catch { /* fall through */ }
        return `cid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    }
}
