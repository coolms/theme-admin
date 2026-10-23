import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subject, catchError, debounceTime, filter, forkJoin, map, of, switchMap } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, AuthState, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CoolmsEditorComponent } from '@coolms/editor-angular';

import { ContactDto, ContactsService } from '../contacts/contacts.service';
import {
    CmsPageHeaderComponent,
    CmsPaneSplitterComponent,
    ContextMenuItem,
    ContextMenuService,
    DateTimeFormatService,
    DateTimePipe,
    DraftStoreService,
    EmptyStateComponent,
    PageToolbarComponent,
    TagInputComponent,
    TagOption,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { EmailLiveEvent, EmailLiveEventsService } from './email-live-events.service';
import { MailPreferencesService } from './mail-preferences.service';
import { loadsRemoteImagesAtOnce, openingMailbox } from './mail-opening';
import { mailboxMenuNodes } from './mailbox-menu';
import { messageFrameDoc } from './message-frame-doc';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import { buildForward } from './forward.util';
import { MESSAGE_TOOLBAR_TREE, deleteMenuItems, messageFacts, moveMenuItems, rowTargetIds } from './message-actions';
import { EmailService } from './email.service';
import { applyUnreadDelta, folderCount, folderCountTitle, folderUnread, importedFraction } from './folder-fraction.util';
import { draftRequestFromForm, requiredOnStep, usernameFieldsEditable, usernamesForCreate } from './mailbox-wizard.util';
import { buildReplyQuote } from './reply-quote.util';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';
import {
    EmailAttachmentDto,
    EmailFolderDto,
    EmailMailboxDto,
    EmailMessageDetailDto,
    EmailMessageDto,
    EmailOAuthProviderDto,
    EmailSearchHitDto,
    InboundWorkflowOption,
    MailboxAuthMethod,
    MailboxSecurity,
    MailboxWriteRequest,
    OutgoingEmailRequest,
} from './email.types';

/** The two-way-bound model behind the mailbox connection editor form. */
interface MailboxFormModel {
    label: string;
    emailAddress: string;
    imapHost: string;
    imapPort: number;
    imapSecurity: MailboxSecurity;
    imapUsername: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecurity: MailboxSecurity;
    smtpUsername: string;
    password: string;
    enabled: boolean;
    inboundWorkflowKey: string;
    /**: `password` uses the password field; `oauth` connects via Google. */
    authMethod: MailboxAuthMethod;
    /** OAuth provider key when `authMethod` is `oauth` (only `google` today). */
    oauthProvider: string;
}

/** A saved compose/reply draft -- the composer's restorable state. */
interface ComposeDraft {
    /** C.4.b: recipient chips. Pre-C.4.b drafts stored `to` as a comma-string -- coerced on load. */
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    text: string;
    html: string;
    rich: boolean;
}

/**
 * The Email mailbox client (`/admin/email`). A three-pane reader over
 * the read/send/reply/folders/seen APIs-):
 *
 *  - LEFT rail: the mailbox picker + folder list (each folder shows its unread
 *    count, `GET /email/mailboxes/{id}/folders`).
 *  - MIDDLE: the selected folder's messages, newest-sent first, offset-paginated
 *    ("Load more"). Unread rows are bold; opening one marks it read.
 *  - RIGHT: the opened message -- headers + snippet + a collapsible raw RFC-822
 *    source (the backend stores the raw `.eml`; MIME body extraction is a future
 *    refinement). "Reply" + a top-bar "Compose" open an inline composer that
 *    posts through the mailbox's own SMTP (send / reply-in-thread ).
 *
 * Read-only-friendly: with no mailboxes configured (the common dev state) the
 * body degrades to an empty state rather than erroring. Monolithic single
 * component like {@link MessagesPageComponent} -- the closest two-pane analog.
 */
@Component({
    selector: 'app-email-mailbox-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    // A mailbox's settings: a modal over this page, kept in step with its URL.
    providers: [MailboxSettingsModal],
    imports: [FormsModule, CoolmsEditorComponent, EmptyStateComponent, DateTimePipe, CmsPageHeaderComponent, PageToolbarComponent, CmsPaneSplitterComponent, TagInputComponent],
    template: `
        <div class="mbx">
            <cms-page-header icon="envelope" [title]="'Email'"
                             [actions]="headerActions()" (actionClick)="onHeaderAction($event)" />

            <!-- Declares nothing: the tree names the three actions, says which
                 need a mailbox, and says that Import greys out while one is
                 running. Every node sits in the header, so no bar renders. -->
            <app-page-toolbar
                [treeSlug]="toolbarTree"
                [context]="toolbarContext()"
                [iconsOnly]="true"
                (headerActionsChanged)="headerActions.set($event)"
                (actionClick)="onHeaderAction($event)" />
            <!-- Always-present hidden file input for the "Import" header action. -->
            <input #importInput type="file" accept=".eml,.mbox,message/rfc822,text/plain" hidden
                   (change)="onImportFileSelected(importInput)" />

            @if (!loadingMailboxes() && mailboxes().length === 0) {
                <div class="mbx__empty-wrap mbx__empty-wrap--col">
                    <app-empty-state icon="envelope"
                                     title="No mailboxes configured"
                                     hint="Add an IMAP/SMTP mailbox to read and send mail from here." />
                    <button type="button" class="mbx__btn mbx__btn--primary" (click)="openCreateMailbox()">
                        <i class="bi bi-plus-lg"></i> Add mailbox
                    </button>
                </div>
            } @else {
                <div class="mbx__body">
                    <!-- LEFT: mailbox picker + folder rail -->
                    <aside class="mbx__rail">
                        <span class="mbx__rail-label">Mailbox</span>
                        <div class="mbx__accounts" role="tablist" aria-label="Mailboxes">
                            @for (mb of mailboxes(); track mb.id) {
                                <button type="button" class="mbx__account"
                                        role="tab"
                                        [class.mbx__account--active]="mb.id === selectedMailboxId()"
                                        [attr.aria-selected]="mb.id === selectedMailboxId()"
                                        [title]="mb.label || mb.emailAddress || mb.id"
                                        (click)="pickMailbox(mb.id)"
                                        (contextmenu)="onMailboxContextMenu($event, mb.id)">
                                    <span class="mbx__account-avatar"
                                          [style.background]="avatarColor(mb.id)">
                                        {{ mailboxInitial(mb) }}
                                        @if (mailboxUnread()[mb.id] > 0) {
                                            <span class="mbx__account-badge"
                                                  [attr.aria-label]="mailboxUnread()[mb.id] + ' unread'">
                                                {{ mailboxUnread()[mb.id] > 99 ? '99+' : mailboxUnread()[mb.id] }}
                                            </span>
                                        }
                                    </span>
                                    <span class="mbx__account-label">{{ mb.label || mb.emailAddress || mb.id }}</span>
                                </button>
                            }
                        </div>
                        <nav class="mbx__folders">
                            @for (f of folders(); track f.folder) {
                                <button type="button" class="mbx__folder"
                                        [class.mbx__folder--active]="f.folder === selectedFolder()"
                                        [title]="folderCountTitle(f)"
                                        (click)="selectFolder(f.folder)">
                                    <span class="mbx__folder-name">{{ f.folder }}</span>
                                    @if (folderUnread(f) > 0) {
                                        <span class="mbx__badge">{{ folderUnread(f) }}</span>
                                    }
                                    <span class="mbx__folder-total">{{ folderCount(f) }}</span>
                                    @if (importedFraction(f) !== null) {
                                        <span class="mbx__folder-progress" aria-hidden="true">
                                            <span class="mbx__folder-progress-bar"
                                                  [style.width.%]="importedFraction(f)"></span>
                                        </span>
                                    }
                                </button>
                            }
                            @if (folders().length === 0) {
                                <p class="mbx__rail-note">No folders yet.</p>
                            }
                        </nav>
                    </aside>

                    <cms-pane-splitter [minWidth]="180" [maxWidth]="380"
                                       storageKey="coolms.email.railWidth" />

                    <!-- MIDDLE: message list (or search results) -->
                    <section class="mbx__list">
                        <div class="mbx__search">
                            <i class="bi bi-search mbx__search-icon"></i>
                            <input type="text" class="mbx__search-input" [(ngModel)]="searchQuery"
                                   placeholder="Search this mailbox…"
                                   (keyup.enter)="runSearch()" />
                            @if (searchActive() || searchQuery) {
                                <button type="button" class="mbx__search-clear" (click)="clearSearch()"
                                        aria-label="Clear search">
                                    <i class="bi bi-x-lg"></i>
                                </button>
                            }
                        </div>

                        <!-- Bulk action bar (backlog slice 3): shown once ≥1 message is
                             checked in the folder view; acts on the whole selection. -->
                        @if (!searchActive() && selectedCount() > 0) {
                            <div class="mbx__bulkbar">
                                <span class="mbx__bulkbar-count">{{ selectedCount() }} selected</span>
                                <div class="mbx__bulkbar-actions" (pointerdown)="noteActionPoint($event)">
                                    <app-page-toolbar [treeSlug]="messageTree" [context]="bulkFacts()" [iconsOnly]="true"
                                                      (actionClick)="onBulkAction($event)" />
                                    <button type="button" class="mbx__btn mbx__btn--sm" (click)="selectAllLoaded()"
                                            title="Select all loaded messages">All</button>
                                    <button type="button" class="mbx__btn mbx__btn--sm" (click)="clearSelection()"
                                            aria-label="Clear selection" title="Clear selection">
                                        <i class="bi bi-x-lg"></i>
                                    </button>
                                </div>
                            </div>
                        }

                        @if (searchActive()) {
                            @if (searching() && searchResults().length === 0) {
                                <p class="mbx__note">Searching…</p>
                            } @else if (searchResults().length === 0) {
                                <app-empty-state icon="search" title="No matches"
                                                 hint="No messages matched your search." />
                            } @else {
                                <div class="mbx__search-summary">Results for “{{ searchQuery }}”</div>
                                @for (h of searchResults(); track h.id) {
                                    <button type="button" class="mbx__row"
                                            [class.mbx__row--active]="h.id === selectedMessage()?.id"
                                            [class.mbx__row--unread]="!h.seen"
                                            (click)="openSearchHit(h)">
                                        <div class="mbx__row-top">
                                            <span class="mbx__row-from">{{ h.fromName || h.fromAddress || '(unknown)' }}</span>
                                            <span class="mbx__row-date">{{ hitDate(h) | appDateTime }}</span>
                                        </div>
                                        <div class="mbx__row-subject">{{ h.subject || '(no subject)' }}</div>
                                        <div class="mbx__row-snippet">
                                            <span class="mbx__row-folder">{{ h.folder }}</span>{{ h.snippet }}
                                        </div>
                                    </button>
                                }
                                @if (searchHasMore()) {
                                    <button type="button" class="mbx__more" [disabled]="searching()"
                                            (click)="loadMoreSearch()">
                                        {{ searching() ? 'Searching…' : 'Load more' }}
                                    </button>
                                }
                            }
                        } @else if (loadingMessages() && messages().length === 0) {
                            <p class="mbx__note">Loading…</p>
                        } @else if (messages().length === 0) {
                            <app-empty-state icon="inbox" title="No messages"
                                             hint="This folder is empty." />
                        } @else {
                            @for (m of messages(); track m.id) {
                                <div class="mbx__row" (contextmenu)="onMessageRowContextMenu($event, m)"
                                     [class.mbx__row--active]="m.id === selectedMessage()?.id"
                                     [class.mbx__row--unread]="!m.seen"
                                     [class.mbx__row--checked]="isSelected(m.id)">
                                    <input type="checkbox" class="mbx__row-check"
                                           [checked]="isSelected(m.id)"
                                           (click)="onCheckboxClick(m, $event)"
                                           aria-label="Select message" />
                                    <button type="button" class="mbx__row-main" (click)="onRowClick(m, $event)">
                                        <div class="mbx__row-top">
                                            <span class="mbx__row-from">{{ m.fromName || m.fromAddress || '(unknown)' }}</span>
                                            <span class="mbx__row-date">{{ m.sentAt | appDateTime }}</span>
                                        </div>
                                        <div class="mbx__row-subject">{{ m.subject || '(no subject)' }}</div>
                                        <div class="mbx__row-snippet">{{ m.snippet }}</div>
                                    </button>
                                    <button type="button" class="mbx__row-star"
                                            [class.mbx__row-star--on]="m.flagged"
                                            [title]="m.flagged ? 'Unstar' : 'Star'"
                                            (click)="toggleFlag(m, $event)">
                                        <i class="bi" [class.bi-star-fill]="m.flagged" [class.bi-star]="!m.flagged"></i>
                                    </button>
                                </div>
                            }
                            @if (hasMore()) {
                                <button type="button" class="mbx__more" [disabled]="loadingMessages()"
                                        (click)="loadMore()">
                                    {{ loadingMessages() ? 'Loading…' : 'Load more' }}
                                </button>
                            }
                        }
                    </section>

                    <cms-pane-splitter [minWidth]="280" [maxWidth]="620"
                                       storageKey="coolms.email.listWidth" />

                    <!-- RIGHT: message detail -->
                    <section class="mbx__detail">
                        @if (loadingDetail()) {
                            <p class="mbx__note">Loading…</p>
                        } @else if (selectedMessage()) {
                            @let msg = selectedMessage()!;
                            <div class="mbx__detail-head">
                                <h2 class="mbx__detail-subject">{{ msg.subject || '(no subject)' }}</h2>
                                <div class="mbx__detail-meta">
                                    <div><strong>From:</strong> {{ msg.fromName ? msg.fromName + ' · ' : '' }}{{ msg.fromAddress }}</div>
                                    <div><strong>To:</strong> {{ (msg.toAddresses || []).join(', ') }}</div>
                                    <div><strong>Date:</strong> {{ msg.sentAt | appDateTime }}</div>
                                </div>
                                <!-- The actions on the open message: the explorers' bar, icons only, from the server's tree
                                     (navi.toolbar.email.message), the same nodes as a message row's menu. -->
                                <div class="mbx__detail-actions" (pointerdown)="noteActionPoint($event)">
                                    <app-page-toolbar [treeSlug]="messageTree" [context]="detailFacts()" [iconsOnly]="true"
                                                      (actionClick)="onDetailAction($event)" />
                                </div>
                            </div>
                            @if (thread().length > 1) {
                                <div class="mbx__thread">
                                    <div class="mbx__thread-head">
                                        <i class="bi bi-chat-left-text"></i> Conversation
                                        <span class="mbx__thread-count">({{ thread().length }})</span>
                                    </div>
                                    <div class="mbx__thread-list">
                                        @for (t of thread(); track t.id) {
                                            <button type="button" class="mbx__thread-item"
                                                    [class.mbx__thread-item--active]="t.id === msg.id"
                                                    [class.mbx__thread-item--unread]="t.seen === false"
                                                    (click)="openThreadMessage(t)">
                                                <span class="mbx__thread-from">{{ t.fromName || t.fromAddress || '(unknown)' }}</span>
                                                <span class="mbx__thread-subject">{{ t.subject || t.snippet || '(no subject)' }}</span>
                                                <span class="mbx__thread-date">{{ t.sentAt | appDateTime }}</span>
                                            </button>
                                        }
                                    </div>
                                </div>
                            }
                            <div class="mbx__detail-body">
                                @if (msg.bodyHtml) {
                                    @if (msg.hasRemoteContent && !loadRemoteImages()) {
                                        <div class="mbx__remote-note">
                                            <i class="bi bi-shield-lock"></i>
                                            <span>Remote images are blocked for your privacy.</span>
                                            <button type="button" class="mbx__remote-load" (click)="loadRemoteImages.set(true)">Load images</button>
                                        </div>
                                    }
                                    <iframe class="mbx__body-frame" [srcdoc]="bodyFrameDoc()"
                                            sandbox="allow-popups allow-popups-to-escape-sandbox"
                                            referrerpolicy="no-referrer" title="Message body"></iframe>
                                } @else if (msg.bodyText) {
                                    <pre class="mbx__body-text">{{ msg.bodyText }}</pre>
                                } @else if (msg.snippet) {
                                    <p class="mbx__detail-snippet">{{ msg.snippet }}</p>
                                }
                                @if (loadingAttachments() || attachments().length > 0) {
                                    <div class="mbx__attachments">
                                        <div class="mbx__attachments-head">
                                            <i class="bi bi-paperclip"></i>
                                            Attachments@if (attachments().length > 0) { <span class="mbx__attachments-count">({{ attachments().length }})</span> }
                                        </div>
                                        @if (loadingAttachments() && attachments().length === 0) {
                                            <p class="mbx__note">Loading attachments…</p>
                                        } @else {
                                            <div class="mbx__attachment-list">
                                                @for (att of attachments(); track att.index) {
                                                    <div class="mbx__attachment">
                                                        <i class="bi mbx__attachment-icon bi-{{ attachmentIcon(att.contentType) }}"></i>
                                                        <div class="mbx__attachment-meta">
                                                            <span class="mbx__attachment-name" [title]="att.filename">{{ att.filename }}</span>
                                                            <span class="mbx__attachment-size">{{ humanSize(att.sizeBytes) }}</span>
                                                        </div>
                                                        <div class="mbx__attachment-actions">
                                                            <button type="button" class="mbx__icon-btn" title="Download"
                                                                    (click)="downloadAttachment(att)">
                                                                <i class="bi bi-download"></i>
                                                            </button>
                                                            <button type="button" class="mbx__icon-btn" title="Save to my files"
                                                                    [disabled]="savingAttachment() === att.index"
                                                                    (click)="saveAttachmentToFiles(att)">
                                                                <i class="bi"
                                                                   [class.bi-hdd]="savingAttachment() !== att.index"
                                                                   [class.bi-hourglass-split]="savingAttachment() === att.index"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                }
                                            </div>
                                        }
                                    </div>
                                }
                                @if (msg.rawBody) {
                                    <details class="mbx__raw">
                                        <summary>Raw source</summary>
                                        <pre>{{ msg.rawBody }}</pre>
                                    </details>
                                } @else {
                                    <p class="mbx__note">No body stored for this message.</p>
                                }
                            </div>
                        } @else {
                            <div class="mbx__empty-wrap">
                                <app-empty-state icon="envelope-open"
                                                 title="No message selected"
                                                 hint="Pick a message from the list to read it." />
                            </div>
                        }
                    </section>
                </div>
            }

            <!-- Composer dock (compose + reply) — Gmail-style: floats bottom-right, does
                 NOT block the mailbox behind it, and minimizes to its header bar. -->
            @if (composeOpen()) {
                <div class="mbx__dock">
                    <div class="mbx__compose mbx__compose--dock" [class.mbx__compose--min]="composeMinimized()">
                        <div class="mbx__compose-head">
                            <button type="button" class="mbx__compose-title" (click)="toggleMinimize()"
                                    [title]="composeMinimized() ? 'Expand' : 'Minimize'">{{ composeDockTitle() }}</button>
                            <div class="mbx__compose-head-actions">
                                <button type="button" class="mbx__compose-close" (click)="toggleMinimize()"
                                        [attr.aria-label]="composeMinimized() ? 'Expand' : 'Minimize'">
                                    <i class="bi" [class.bi-dash-lg]="!composeMinimized()" [class.bi-chevron-up]="composeMinimized()"></i>
                                </button>
                                <button type="button" class="mbx__compose-close" (click)="closeCompose()" aria-label="Close">
                                    <i class="bi bi-x-lg"></i>
                                </button>
                            </div>
                        </div>
                        <div class="mbx__compose-body">
                            <div class="mbx__field">
                                <div class="mbx__field-head">
                                    <span>To</span>
                                    @if (!composeShowCcBcc()) {
                                        <button type="button" class="mbx__btn mbx__btn--sm" (click)="composeShowCcBcc.set(true)">Cc/Bcc</button>
                                    }
                                </div>
                                <app-tag-input [(ngModel)]="composeTo" (ngModelChange)="onComposeChange()"
                                               [options]="contactOptions()" (queryChange)="onRecipientQuery($event)"
                                               placeholder="Start typing a name or email…" />
                            </div>
                            @if (composeShowCcBcc()) {
                                <label class="mbx__field">
                                    <span>Cc</span>
                                    <app-tag-input [(ngModel)]="composeCc" (ngModelChange)="onComposeChange()"
                                                   [options]="contactOptions()" (queryChange)="onRecipientQuery($event)"
                                                   placeholder="Cc…" />
                                </label>
                                <label class="mbx__field">
                                    <span>Bcc</span>
                                    <app-tag-input [(ngModel)]="composeBcc" (ngModelChange)="onComposeChange()"
                                                   [options]="contactOptions()" (queryChange)="onRecipientQuery($event)"
                                                   placeholder="Bcc…" />
                                </label>
                            }
                            <label class="mbx__field">
                                <span>Subject</span>
                                <input type="text" [(ngModel)]="composeSubject" (ngModelChange)="onComposeChange()" placeholder="Subject" />
                            </label>
                            <div class="mbx__field">
                                <div class="mbx__field-head">
                                    <span>Message</span>
                                    <button type="button" class="mbx__btn mbx__btn--sm" (click)="toggleComposeRich()"
                                            [title]="composeRich() ? 'Switch to a plain-text body' : 'Switch to a rich-text body'">
                                        <i class="bi" [class.bi-file-text]="composeRich()" [class.bi-type]="!composeRich()"></i>
                                        {{ composeRich() ? 'Plain text' : 'Rich text' }}
                                    </button>
                                </div>
                                @if (composeRich()) {
                                    <coolms-editor class="mbx__editor"
                                                   profile="standard"
                                                   [content]="composeHtml()"
                                                   [mountKey]="composeKey()"
                                                   (contentChange)="composeHtml.set($event); onComposeChange()" />
                                } @else {
                                    <textarea rows="8" [(ngModel)]="composeText" (ngModelChange)="onComposeChange()" placeholder="Write your message…"></textarea>
                                }
                            </div>
                            @if (composeMode() === 'reply') {
                                <p class="mbx__compose-hint">
                                    Recipient + subject default from the original message if left blank.
                                </p>
                            }
                        </div>
                        <div class="mbx__compose-foot mbx__compose-foot--split">
                            <div class="mbx__compose-foot-side">
                                @if (draftSaved()) {
                                    <span class="mbx__draft-badge"><i class="bi bi-check2"></i> Draft saved</span>
                                    <button type="button" class="mbx__btn mbx__btn--sm" (click)="discardDraft()">
                                        <i class="bi bi-trash"></i> Discard
                                    </button>
                                }
                            </div>
                            <div class="mbx__compose-foot-side">
                                <button type="button" class="mbx__btn" (click)="closeCompose()">Cancel</button>
                                <button type="button" class="mbx__btn mbx__btn--primary" [disabled]="sending()"
                                        (click)="sendCompose()">
                                    {{ sending() ? 'Sending…' : 'Send' }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            }

            <!-- Mailbox connection editor (create + edit) -->
            @if (mailboxEditorOpen()) {
                <div class="mbx__overlay" (click)="closeMailboxEditor()">
                    <div class="mbx__compose mbx__compose--wide" (click)="$event.stopPropagation()">
                        <div class="mbx__compose-head">
                            <span>Add mailbox</span>
                            <button type="button" class="mbx__compose-close" (click)="closeMailboxEditor()" aria-label="Close">
                                <i class="bi bi-x-lg"></i>
                            </button>
                        </div>
                        <div class="mbx__compose-body">
                            <div class="mbx__wizard-head">
                                <span class="mbx__wizard-status">Step {{ mbStep() }} of 4 — {{ mbStepTitle() }}</span>
                                <div class="mbx__wizard-dots">
                                    @for (n of mbSteps; track n) {
                                        <span class="mbx__wizard-dot"
                                              [class.mbx__wizard-dot--active]="n === mbStep()"
                                              [class.mbx__wizard-dot--done]="n < mbStep()"></span>
                                    }
                                </div>
                            </div>

                            @if (mbStep() === 1) {
                                <label class="mbx__field">
                                    <span>Label</span>
                                    <input type="text" [(ngModel)]="mbForm.label" placeholder="Support inbox" />
                                </label>
                                <label class="mbx__field">
                                    <span>Email address</span>
                                    <input type="email" [(ngModel)]="mbForm.emailAddress" placeholder="support@example.com" />
                                </label>

                                <label class="mbx__field">
                                    <span>Authentication</span>
                                    <select [(ngModel)]="mbForm.authMethod" (ngModelChange)="onAuthMethodChange($event)">
                                        <option value="password">Password</option>
                                        <option value="oauth">OAuth (connect an account)</option>
                                    </select>
                                </label>
                                @if (mbForm.authMethod === 'oauth') {
                                    <label class="mbx__field">
                                        <span>Provider</span>
                                        <select [(ngModel)]="mbForm.oauthProvider" (ngModelChange)="onProviderChange($event)">
                                            @for (p of oauthProviders(); track p.key) {
                                                <option [value]="p.key">{{ p.label || p.key }}</option>
                                            }
                                        </select>
                                        <small class="mbx__field-hint">
                                            The IMAP/SMTP servers are pre-filled for {{ providerLabel(mbForm.oauthProvider) }}.
                                            The last step opens {{ providerLabel(mbForm.oauthProvider) }}'s consent screen;
                                            the mailbox is created only once the account is authorized. It signs in as its
                                            address, and no password is stored.
                                        </small>
                                    </label>
                                }
                            }

                            @if (mbStep() === 2) {
                                <fieldset class="mbx__fieldset">
                                    <legend>Incoming (IMAP)</legend>
                                    <div class="mbx__grid">
                                        <label class="mbx__field mbx__field--grow">
                                            <span>Host</span>
                                            <input type="text" [(ngModel)]="mbForm.imapHost" placeholder="imap.example.com" />
                                        </label>
                                        <label class="mbx__field mbx__field--port">
                                            <span>Port</span>
                                            <input type="number" [(ngModel)]="mbForm.imapPort" placeholder="993" />
                                        </label>
                                        <label class="mbx__field mbx__field--sec">
                                            <span>Security</span>
                                            <select [(ngModel)]="mbForm.imapSecurity">
                                                @for (opt of securityOptions; track opt) {
                                                    <option [value]="opt">{{ opt }}</option>
                                                }
                                            </select>
                                        </label>
                                    </div>
                                    @if (usernameEditable()) {
                                        <label class="mbx__field">
                                            <span>Username</span>
                                            <input type="text" [(ngModel)]="mbForm.imapUsername"
                                                   [placeholder]="mbForm.emailAddress.trim() || 'support@example.com'" />
                                            <small class="mbx__field-hint">
                                                Leave blank to sign in as the address. An alias that differs is an administrator's setting.
                                            </small>
                                        </label>
                                    } @else {
                                        <div class="mbx__field">
                                            <span>Username</span>
                                            <span class="mbx__static">{{ mbForm.emailAddress.trim() || '—' }}</span>
                                            <small class="mbx__field-hint">{{ usernameRuleHint() }}</small>
                                        </div>
                                    }
                                </fieldset>
                            }

                            @if (mbStep() === 3) {
                                <fieldset class="mbx__fieldset">
                                    <legend>Outgoing (SMTP)</legend>
                                    <div class="mbx__grid">
                                        <label class="mbx__field mbx__field--grow">
                                            <span>Host</span>
                                            <input type="text" [(ngModel)]="mbForm.smtpHost" placeholder="smtp.example.com" />
                                        </label>
                                        <label class="mbx__field mbx__field--port">
                                            <span>Port</span>
                                            <input type="number" [(ngModel)]="mbForm.smtpPort" placeholder="465" />
                                        </label>
                                        <label class="mbx__field mbx__field--sec">
                                            <span>Security</span>
                                            <select [(ngModel)]="mbForm.smtpSecurity">
                                                @for (opt of securityOptions; track opt) {
                                                    <option [value]="opt">{{ opt }}</option>
                                                }
                                            </select>
                                        </label>
                                    </div>
                                    @if (usernameEditable()) {
                                        <label class="mbx__field">
                                            <span>Username</span>
                                            <input type="text" [(ngModel)]="mbForm.smtpUsername"
                                                   [placeholder]="mbForm.emailAddress.trim() || 'support@example.com'" />
                                            <small class="mbx__field-hint">
                                                Leave blank to sign in as the address. An alias that differs is an administrator's setting.
                                            </small>
                                        </label>
                                    } @else {
                                        <div class="mbx__field">
                                            <span>Username</span>
                                            <span class="mbx__static">{{ mbForm.emailAddress.trim() || '—' }}</span>
                                            <small class="mbx__field-hint">{{ usernameRuleHint() }}</small>
                                        </div>
                                    }
                                </fieldset>
                            }

                            @if (mbStep() === 4 && isOauthCreate()) {
                                <div class="mbx__oauth">
                                    <span class="mbx__oauth-label">{{ providerLabel(mbForm.oauthProvider) }} connection</span>
                                    <p class="mbx__oauth-text">
                                        Connecting opens {{ providerLabel(mbForm.oauthProvider) }}'s consent screen for
                                        <strong>{{ mbForm.emailAddress.trim() }}</strong> and returns here. The mailbox is created only
                                        after the account is authorized and the connection is proven; nothing is saved if the consent
                                        is refused or abandoned. No password is stored.
                                    </p>
                                    <small class="mbx__field-hint">
                                        Automation and enabling are set afterwards, in the mailbox's settings.
                                    </small>
                                </div>
                            }

                            @if (mbStep() === 4 && !isOauthCreate()) {
                                @if (mbForm.authMethod === 'password') {
                                    <label class="mbx__field">
                                        <span>Password</span>
                                        <input type="password" [(ngModel)]="mbForm.password" autocomplete="new-password"
                                               placeholder="Mailbox password" />
                                    </label>
                                }

                                <label class="mbx__field">
                                    <span>Start workflow on new email (optional)</span>
                                    <select [(ngModel)]="mbForm.inboundWorkflowKey">
                                        <option value="">— None (disabled) —</option>
                                        @for (opt of workflowChoices(); track opt.key) {
                                            <option [value]="opt.key">{{ opt.label }}</option>
                                        }
                                    </select>
                                    <small class="mbx__field-hint">
                                        A first-contact email to this mailbox starts the chosen deployed workflow
                                        (replies feed the existing conversation). “None” disables the trigger.
                                    </small>
                                </label>

                                <label class="mbx__check">
                                    <input type="checkbox" [(ngModel)]="mbForm.enabled" />
                                    <span>Enabled (included in fetch/send)</span>
                                </label>

                            }
                        </div>
                        <div class="mbx__compose-foot mbx__compose-foot--split">
                            <div class="mbx__foot-left">
                            </div>
                            <div class="mbx__foot-right">
                                <button type="button" class="mbx__btn" (click)="closeMailboxEditor()">Cancel</button>
                                @if (mbStep() > 1) {
                                    <button type="button" class="mbx__btn" (click)="prevStep()">
                                        <i class="bi bi-chevron-left"></i> Back
                                    </button>
                                }
                                @if (mbStep() < 4) {
                                    <button type="button" class="mbx__btn mbx__btn--primary" (click)="nextStep()">
                                        Next <i class="bi bi-chevron-right"></i>
                                    </button>
                                } @else if (isOauthCreate()) {
                                    <button type="button" class="mbx__btn mbx__btn--primary" [disabled]="connecting()"
                                            (click)="connectDraft()">
                                        <i class="bi bi-box-arrow-up-right"></i>
                                        {{ connecting() ? 'Redirecting…' : 'Connect with ' + providerLabel(mbForm.oauthProvider) }}
                                    </button>
                                } @else {
                                    <button type="button" class="mbx__btn mbx__btn--primary" [disabled]="savingMailbox()"
                                            (click)="saveMailbox()">
                                        {{ savingMailbox() ? 'Saving…' : 'Create mailbox' }}
                                    </button>
                                }
                            </div>
                        </div>
                    </div>
                </div>
            }
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .mbx { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .mbx__top {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 16px; border-bottom: 1px solid var(--cms-border);
        }
        .mbx__top-title { display: flex; align-items: center; gap: 8px; }
        .mbx__top-title h1 { margin: 0; font-size: 1.125rem; }
        .mbx__empty-wrap { flex: 1; display: flex; align-items: center; justify-content: center; }
        .mbx__body { flex: 1; display: flex; min-height: 0; }

        .mbx__rail {
            width: 230px; flex: 0 0 230px;
            padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;
        }
        .mbx__rail-label { font-size: .75rem; color: var(--cms-text-muted); text-transform: uppercase; }
        .mbx__accounts { display: flex; flex-direction: column; gap: 2px; }
        .mbx__account {
            display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
            padding: 6px 8px; border: 0; border-radius: var(--cms-radius-md, 8px); background: transparent; cursor: pointer;
            color: var(--cms-text); font: inherit;
        }
        .mbx__account:hover { background: var(--cms-surface-hover); }
        .mbx__account--active { background: var(--cms-selected-light); }
        .mbx__account-avatar {
            position: relative; flex: 0 0 auto; width: 34px; height: 34px; border-radius: 50%;
            display: inline-flex; align-items: center; justify-content: center;
            color: var(--cms-text-inverse); font-size: .95rem; font-weight: 600; line-height: 1; user-select: none;
        }
        .mbx__account--active .mbx__account-avatar { box-shadow: 0 0 0 2px var(--cms-surface), 0 0 0 4px var(--cms-selected); }
        .mbx__account-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .875rem; }
        .mbx__account--active .mbx__account-label { font-weight: 600; }
        .mbx__account-badge {
            position: absolute; top: -3px; right: -3px;
            background: var(--cms-accent, #F5A623); color: var(--cms-accent-fg, #1a1a1a); border-radius: 999px;
            font-size: .625rem; font-weight: 600; line-height: 1; padding: 2px 5px; min-width: 16px;
            text-align: center; box-shadow: 0 0 0 2px var(--cms-surface);
        }
        .mbx__folders { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
        .mbx__folder {
            position: relative;
            display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;
            padding: 7px 9px; border: 0; border-radius: var(--cms-radius, 6px); background: transparent; cursor: pointer;
            color: var(--cms-text); font-size: .875rem;
        }
        .mbx__folder:hover { background: var(--cms-surface-hover); }
        .mbx__folder--active { background: var(--cms-selected-light); font-weight: 600; }
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
        .mbx__rail-note, .mbx__note { color: var(--cms-text-muted); font-size: .8125rem; padding: 12px; }

        .mbx__list {
            width: 340px; flex: 0 0 340px; border-right: 1px solid var(--cms-border);
            overflow-y: auto; display: flex; flex-direction: column;
        }
        .mbx__row {
            display: flex; align-items: flex-start; gap: 8px; width: 100%;
            padding: 10px 12px; border-bottom: 1px solid var(--cms-border);
            background: transparent; color: var(--cms-text);
        }
        .mbx__row:hover { background: var(--cms-surface-hover); }
        .mbx__row--active { background: var(--cms-selected-light); }
        .mbx__row--checked { background: var(--cms-selected-light); }
        .mbx__row-check { margin: 3px 0 0; width: 15px; height: 15px; flex: 0 0 auto; cursor: pointer; accent-color: var(--cms-accent, #F5A623); }
        .mbx__row-main {
            display: flex; flex-direction: column; gap: 2px; text-align: left; flex: 1 1 auto;
            min-width: 0; padding: 0; border: 0; background: transparent; cursor: pointer; color: inherit; font: inherit;
        }
        .mbx__row-star {
            flex: 0 0 auto; align-self: center; border: 0; background: transparent; cursor: pointer;
            color: var(--cms-text-muted); padding: 2px 4px; font-size: .95rem; line-height: 1;
        }
        .mbx__row-star:hover { color: var(--cms-accent, #F5A623); }
        .mbx__row-star--on { color: var(--cms-accent, #F5A623); }
        .mbx__row--unread .mbx__row-from, .mbx__row--unread .mbx__row-subject { font-weight: 700; }
        /* Bulk action bar (backlog slice 3). Not sticky — the search box above it already is. */
        .mbx__bulkbar {
            display: flex; align-items: center; justify-content: space-between; gap: 8px;
            padding: 6px 10px; border-bottom: 1px solid var(--cms-border);
            background: var(--cms-surface-alt, var(--cms-surface-hover));
        }
        .mbx__bulkbar-count { font-size: .8125rem; font-weight: 600; }
        .mbx__bulkbar-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .mbx__row-top { display: flex; justify-content: space-between; gap: 8px; }
        .mbx__row-from { font-size: .875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mbx__row-date { color: var(--cms-text-muted); font-size: .75rem; flex: 0 0 auto; }
        .mbx__row-subject { font-size: .8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mbx__row-snippet { color: var(--cms-text-muted); font-size: .75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mbx__more { margin: 10px; padding: 8px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius, 6px); background: var(--cms-surface); cursor: pointer; color: var(--cms-text); }

        .mbx__search {
            display: flex; align-items: center; gap: 6px; padding: 8px 10px;
            border-bottom: 1px solid var(--cms-border); position: sticky; top: 0;
            background: var(--cms-surface); z-index: 1;
        }
        .mbx__search-icon { color: var(--cms-text-muted); font-size: .8125rem; }
        .mbx__search-input {
            flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 6px); background: var(--cms-surface); color: var(--cms-text); font: inherit; font-size: .8125rem;
        }
        .mbx__search-clear { border: 0; background: transparent; cursor: pointer; color: var(--cms-text-muted); padding: 2px 4px; }
        .mbx__search-summary {
            padding: 6px 12px; font-size: .75rem; color: var(--cms-text-muted);
            border-bottom: 1px solid var(--cms-border);
        }
        .mbx__row-folder {
            display: inline-block; font-size: .6875rem; background: var(--cms-surface-alt, var(--cms-surface-hover));
            border-radius: var(--cms-radius-sm, 4px); padding: 0 5px; margin-right: 5px; color: var(--cms-text-secondary);
        }

        .mbx__detail { flex: 1; overflow-y: auto; padding: 16px 20px; min-width: 0; }
        .mbx__detail-head { border-bottom: 1px solid var(--cms-border); padding-bottom: 12px; margin-bottom: 12px; }
        .mbx__detail-subject { margin: 0 0 8px; font-size: 1.125rem; }
        .mbx__detail-meta { display: flex; flex-direction: column; gap: 2px; font-size: .8125rem; color: var(--cms-text-secondary); }
        /* No box of its own: the explorers' bar inside keeps its spacing. */
        .mbx__detail-actions { display: contents; }
        .mbx__detail-snippet { white-space: pre-wrap; }
        .mbx__thread {
            margin-top: 14px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md, 8px); overflow: hidden;
        }
        .mbx__thread-head {
            display: flex; align-items: center; gap: 6px; padding: 7px 11px;
            background: var(--cms-surface-alt, var(--cms-surface-hover)); border-bottom: 1px solid var(--cms-border);
            font-size: .8125rem; font-weight: 600; color: var(--cms-text-muted);
        }
        .mbx__thread-count { color: var(--cms-text-muted); font-weight: 400; }
        .mbx__thread-list { display: flex; flex-direction: column; }
        .mbx__thread-item {
            display: grid; grid-template-columns: 140px 1fr auto; align-items: baseline; gap: 10px;
            width: 100%; text-align: left; padding: 8px 11px; border: 0; border-bottom: 1px solid var(--cms-border);
            background: transparent; color: var(--cms-text); cursor: pointer; font: inherit;
        }
        .mbx__thread-item:last-child { border-bottom: 0; }
        .mbx__thread-item:hover { background: var(--cms-surface-hover); }
        .mbx__thread-item--active { background: var(--cms-selected-light); }
        .mbx__thread-item--unread { font-weight: 600; }
        .mbx__thread-from { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8125rem; }
        .mbx__thread-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cms-text-muted); font-size: .8125rem; }
        .mbx__thread-item--active .mbx__thread-subject,
        .mbx__thread-item--unread .mbx__thread-subject { color: var(--cms-text); }
        .mbx__thread-date { color: var(--cms-text-muted); font-size: .75rem; white-space: nowrap; }
        .mbx__raw { margin-top: 12px; }
        .mbx__raw summary { cursor: pointer; color: var(--cms-text-muted); font-size: .8125rem; }
        .mbx__raw pre {
            margin-top: 8px; padding: 12px; background: var(--cms-surface-alt, var(--cms-surface)); border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 6px); max-height: 400px; overflow: auto; font-size: .75rem; white-space: pre-wrap; word-break: break-word;
        }

        /* Rendered message body (sandboxed iframe) + its remote-image gate. */
        .mbx__body-frame {
            display: block; width: 100%; min-height: 320px; height: 60vh;
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius, 6px); background: #fff;
        }
        .mbx__body-text {
            margin: 0 0 12px; padding: 12px; background: var(--cms-surface-alt, var(--cms-surface));
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius, 6px);
            font-size: .8125rem; white-space: pre-wrap; word-break: break-word;
        }
        .mbx__remote-note {
            display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 8px 12px;
            background: var(--cms-surface-alt, var(--cms-surface)); border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 6px); font-size: .8125rem; color: var(--cms-text-secondary);
        }
        .mbx__remote-load {
            margin-left: auto; padding: 4px 10px; border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-md, 8px); background: var(--cms-surface);
            color: var(--cms-accent); cursor: pointer; font-size: .8125rem;
        }
        .mbx__remote-load:hover { background: var(--cms-surface-alt, var(--cms-surface)); }

        /* Attachment chip row (backlog slice 6b). */
        .mbx__attachments { margin-top: 14px; border-top: 1px solid var(--cms-border); padding-top: 12px; }
        .mbx__attachments-head { display: flex; align-items: center; gap: 6px; font-size: .8125rem; font-weight: 600; color: var(--cms-text-secondary); margin-bottom: 8px; }
        .mbx__attachments-count { color: var(--cms-text-muted); font-weight: 400; }
        .mbx__attachment-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .mbx__attachment {
            display: flex; align-items: center; gap: 8px; max-width: 320px;
            padding: 6px 8px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md, 8px); background: var(--cms-surface);
        }
        .mbx__attachment-icon { font-size: 1.1rem; color: var(--cms-accent, #F5A623); flex: 0 0 auto; }
        .mbx__attachment-meta { display: flex; flex-direction: column; min-width: 0; }
        .mbx__attachment-name { font-size: .8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mbx__attachment-size { font-size: .6875rem; color: var(--cms-text-muted); }
        .mbx__attachment-actions { display: flex; gap: 2px; flex: 0 0 auto; }
        .mbx__icon-btn {
            display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
            border: 0; border-radius: var(--cms-radius, 6px); background: transparent; color: var(--cms-text-secondary); cursor: pointer;
        }
        .mbx__icon-btn:hover { background: var(--cms-surface-hover); color: var(--cms-text); }
        .mbx__icon-btn:disabled { opacity: .6; cursor: default; }

        .mbx__btn {
            display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--cms-radius, 6px);
            border: 1px solid var(--cms-border); background: var(--cms-surface); color: var(--cms-text);
            cursor: pointer; font-size: .8125rem;
        }
        .mbx__btn:hover { background: var(--cms-surface-hover); }
        .mbx__btn--primary { background: var(--cms-accent, #F5A623); border-color: var(--cms-accent, #F5A623); color: var(--cms-accent-fg, #1a1a1a); }
        .mbx__btn:disabled { opacity: .6; cursor: default; }

        .mbx__overlay {
            position: fixed; inset: 0; background: var(--cms-overlay-scrim); display: flex;
            align-items: center; justify-content: center; z-index: 50;
        }
        .mbx__compose {
            width: 560px; max-width: 95vw; max-height: 90vh; display: flex; flex-direction: column;
            background: var(--cms-surface); border: 1px solid var(--cms-border); border-radius: var(--cms-radius-lg, 10px); overflow: hidden;
        }
        .mbx__compose-head {
            display: flex; align-items: center; justify-content: space-between; padding: 12px 16px;
            border-bottom: 1px solid var(--cms-border); font-weight: 600;
        }
        .mbx__compose-close { border: 0; background: transparent; cursor: pointer; color: var(--cms-text-muted); }
        .mbx__compose-body { padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
        .mbx__field { display: flex; flex-direction: column; gap: 4px; font-size: .8125rem; }
        .mbx__field span { color: var(--cms-text-secondary); }
        .mbx__field input, .mbx__field textarea {
            width: 100%; padding: 8px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius, 6px);
            background: var(--cms-surface); color: var(--cms-text); font: inherit;
        }
        .mbx__field textarea { resize: vertical; }
        /* Rich-compose header row: the "Message" label + the rich/plain toggle. */
        .mbx__field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .mbx__btn--sm { padding: 3px 8px; font-size: .75rem; }
        /* The embedded <coolms-editor> fills the composer width; its own min-height
         * keeps it usable and the overlay body scrolls if it grows. */
        .mbx__editor { display: block; }
        .mbx__compose-hint { color: var(--cms-text-muted); font-size: .75rem; margin: 0; }
        .mbx__compose-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--cms-border); }

        /* Composer dock: floats bottom-right, does NOT block the mailbox, and
         * collapses to just its header bar when minimized (body + foot hidden, form kept). */
        .mbx__dock { position: fixed; right: 24px; bottom: 0; z-index: 50; }
        .mbx__compose--dock {
            width: 680px; max-width: calc(100vw - 48px); max-height: min(80vh, 720px);
            border-radius: 10px 10px 0 0; box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12));
        }
        .mbx__compose--dock.mbx__compose--min { max-height: none; }
        .mbx__compose--min .mbx__compose-body,
        .mbx__compose--min .mbx__compose-foot { display: none; }
        .mbx__compose-title {
            flex: 1 1 auto; min-width: 0; padding: 0; border: 0; background: transparent;
            color: inherit; font: inherit; font-weight: 600; cursor: pointer; text-align: left;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mbx__compose-head-actions { display: flex; align-items: center; gap: 2px; }

        .mbx__top-actions { display: flex; align-items: center; gap: 8px; }
        .mbx__empty-wrap--col { flex-direction: column; gap: 16px; }

        .mbx__compose--wide { width: 640px; }
        .mbx__fieldset { border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md, 8px); padding: 12px; margin: 0; display: flex; flex-direction: column; gap: 12px; }
        .mbx__fieldset legend { padding: 0 6px; font-size: .75rem; color: var(--cms-text-muted); text-transform: uppercase; }
        .mbx__grid { display: flex; gap: 12px; }
        .mbx__field--grow { flex: 1 1 auto; }
        .mbx__field--port { flex: 0 0 88px; }
        .mbx__field--sec { flex: 0 0 130px; }
        .mbx__field select {
            width: 100%; padding: 8px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius, 6px);
            background: var(--cms-surface); color: var(--cms-text); font: inherit;
        }
        .mbx__field-hint { color: var(--cms-text-muted); font-size: .6875rem; }
        .mbx__check { display: flex; align-items: center; gap: 8px; font-size: .8125rem; color: var(--cms-text-secondary); }
        .mbx__check input { width: 16px; height: 16px; }
        .mbx__compose-foot--split { justify-content: space-between; }
        .mbx__compose-foot-side { display: flex; align-items: center; gap: 8px; }
        .mbx__draft-badge { display: inline-flex; align-items: center; gap: 4px; font-size: .8125rem; color: var(--cms-text-muted); }
        .mbx__foot-right { display: flex; gap: 8px; }

        .mbx__oauth { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md, 8px); }
        .mbx__oauth-label { font-size: .75rem; color: var(--cms-text-muted); text-transform: uppercase; }
        .mbx__oauth-text { margin: 0; font-size: .8125rem; line-height: 1.45; color: var(--cms-text); }
        .mbx__static { padding: 6px 0; font-size: .8125rem; color: var(--cms-text); }
        .mbx__oauth-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .mbx__oauth-badge { display: inline-flex; align-items: center; gap: 5px; font-size: .8125rem; color: var(--cms-text-muted); }
        .mbx__oauth-badge--ok { color: var(--cms-success, #16a34a); }

        .mbx__wizard-head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px; }
        .mbx__wizard-status { font-size: .75rem; color: var(--cms-text-muted); text-transform: uppercase; letter-spacing: .03em; }
        .mbx__wizard-dots { display: flex; gap: 6px; }
        .mbx__wizard-dot { flex: 1; height: 4px; border-radius: 999px; background: var(--cms-border); transition: background .15s ease; }
        .mbx__wizard-dot--done { background: var(--cms-accent, #F5A623); opacity: .5; }
        .mbx__wizard-dot--active { background: var(--cms-selected); opacity: 1; }
    `],
})
export class EmailMailboxPageComponent implements OnInit {
    private readonly email = inject(EmailService);
    private readonly router = inject(Router);
    private readonly toast = inject(ToastService);
    private readonly drafts = inject(DraftStoreService);
    private readonly contacts = inject(ContactsService);
    private readonly dtf = inject(DateTimeFormatService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly emailLive = inject(EmailLiveEventsService);
    private readonly mailPrefs = inject(MailPreferencesService);
    private readonly store = inject(Store);
    private readonly route = inject(ActivatedRoute);
    private readonly naviGraph = inject(NaviGraphService);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly crumbs = inject(CrumbNamesService);
    private readonly settingsModal = inject(MailboxSettingsModal);
    /**
     * Each navigation that ends on this page. The breadcrumb's names are cleared when ANY navigation starts, and this
     * page navigates within itself (its mailbox settings open, change pane and close by the URL), so its crumb is
     * named again after each one, not only when the selected mailbox changes.
     */
    private readonly navigated = toSignal(this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)));
    /** Home / Email / {mailbox}: the selected mailbox is the crumb after the page's own. */
    private readonly mailboxCrumb = effect(() => {
        this.navigated();
        const id = this.selectedMailboxId();
        const mb = id === null ? undefined : this.mailboxes().find(m => m.id === id);
        this.crumbs.setTail(mb ? (mb.label || mb.emailAddress || null) : null);
    });
    /** The toolbar tree's nodes: the context menu is built from the same declaration as the action bar. */
    readonly toolbarNodes = signal<NaviGraphNode[]>([]);

    /** Current user UUID (rfc4122) -- the per-user realtime channel `email.user.{id}`. */
    readonly currentUserId = computed<string | null>(() => {
        const u = this.store.selectSnapshot(AuthState.currentUser);
        return u?.id ?? null;
    });

    /**
     * Whether the caller holds `ROLE_ADMIN` -- the same question the server puts to
     * `isGranted()` when it applies the username rule. Presentation only: the wizard
     * shows an alias field to an administrator and the derived address to everyone
     * else; the server derives or accepts on its own account whatever is sent.
     */
    readonly callerIsAdmin = computed<boolean>(() => {
        const u = this.store.selectSnapshot(AuthState.currentUser);
        return (u?.roles ?? []).includes('ROLE_ADMIN');
    });

    private readonly domSanitizer = inject(DomSanitizer);

    /** Per-message opt-in to load the remote images the server flagged; reset on open. */
    readonly loadRemoteImages = signal(false);

    /**
     * The `srcdoc` for the message-body iframe: the server-sanitised HTML wrapped in a
     * minimal document whose CSP blocks EVERY remote fetch until the reader loads
     * images. The iframe itself is `sandbox`ed (no scripts, no same-origin), so this is
     * defence in depth over the server sanitiser -- and `bypassSecurityTrustHtml` is
     * safe here precisely because the content is already sanitised AND contained.
     */
    readonly bodyFrameDoc = computed<SafeHtml | null>(() => {
        const html = this.selectedMessage()?.bodyHtml;
        if (html === null || html === undefined || html === '') {
            return null;
        }
        return this.domSanitizer.bypassSecurityTrustHtml(messageFrameDoc(html, this.loadRemoteImages()));
    });

    /**
     * localStorage key for the last-selected mailbox, so a reload restores it instead
     * of snapping to the first mailbox. Per-browser UI state -- sits beside the list-pane
     * width (`coolms.email.listWidth`, persisted by `<cms-pane-splitter>`) in the same store.
     */
    private static readonly LAST_MAILBOX_KEY = 'coolms.email.lastMailboxId';

    private static readonly PAGE_SIZE = 50;

    readonly mailboxes = signal<EmailMailboxDto[]>([]);
    readonly selectedMailboxId = signal<string | null>(null);
    /** Per-mailbox unread total (mailboxId -> unseen across its folders), for the switcher badges. */
    readonly mailboxUnread = signal<Record<string, number>>({});
    readonly folders = signal<EmailFolderDto[]>([]);
    readonly selectedFolder = signal<string>('INBOX');
    readonly messages = signal<EmailMessageDto[]>([]);
    readonly selectedMessage = signal<EmailMessageDetailDto | null>(null);
    readonly hasMore = signal<boolean>(false);

    /**
     * Multi-select (backlog slices 3+4): the checkbox / Shift / Ctrl selection over the
     * current folder's loaded messages. Drives the bulk action bar and is independent of
     * {@link selectedMessage} (the message opened in the right pane). Cleared on
     * mailbox/folder change and after a bulk action.
     */
    readonly selectedIds = signal<Set<string>>(new Set<string>());
    readonly selectedCount = computed(() => this.selectedIds().size);
    readonly bulkBusy = signal<boolean>(false);
    /** Range-select origin for Shift-click (the last individually (de)selected row). */
    private selectAnchorId: string | null = null;

    readonly loadingMailboxes = signal<boolean>(true);
    readonly loadingMessages = signal<boolean>(false);
    readonly loadingDetail = signal<boolean>(false);

    /**
     * Attachments (backlog slice 6b) parsed on demand from the OPEN message's `.eml`
     *. Fetched only when the detail reports `hasAttachments`, guarded by the
     * same {@link openSeq} so a slow fetch for a previous message can't populate.
     * `savingAttachment` holds the index currently being copied to the user's files.
     */
    readonly attachments = signal<EmailAttachmentDto[]>([]);
    readonly loadingAttachments = signal<boolean>(false);
    readonly savingAttachment = signal<number | null>(null);

    /**
     * The open message's conversation thread, oldest-sent first. Fetched on
     * open (guarded by {@link openSeq}); the "Conversation" strip renders only when
     * it holds more than one message.
     */
    readonly thread = signal<EmailMessageDto[]>([]);

    readonly composeOpen = signal<boolean>(false);
    readonly composeMode = signal<'compose' | 'reply'>('compose');
    readonly sending = signal<boolean>(false);
    private readonly replyTargetId = signal<string | null>(null);
    /** Dock minimized state: the window collapses to just its header bar,
     *  keeping the form (and its draft) alive so it restores exactly as left. */
    readonly composeMinimized = signal<boolean>(false);

    /**
     * Draft autosave. While the composer is open, edits are debounced-saved
     * to a per-(mailbox, compose|reply-target) localStorage draft (via
     * {@link DraftStoreService}); reopening the composer restores it, sending or
     * discarding clears it. `draftSaved` drives the "Draft saved" footer indicator.
     * `compose*Initial` snapshot the fresh-open baseline so a reply's pre-filled
     * quote isn't itself treated as unsaved content.
     */
    readonly draftSaved = signal<boolean>(false);
    private composeToInitial: string[] = [];
    private composeCcInitial: string[] = [];
    private composeBccInitial: string[] = [];
    private composeSubjectInitial = '';
    private composeTextInitial = '';
    private composeHtmlInitial = '';
    private composeRichInitial = true;
    private draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private page = 1;
    /**
     * Monotonic request guards. Each async load captures `++seq` and
     * ignores its own response if `seq` is no longer the latest -- so a slower
     * in-flight request that resolves after a newer one (rapid message clicks,
     * folder switch mid-"Load more") can't clobber the current view/list.
     */
    private openSeq = 0;
    private listSeq = 0;

    /** File input for the "Import" header action, clicked programmatically from {@link onHeaderAction}. */
    private readonly importInput = viewChild<ElementRef<HTMLInputElement>>('importInput');

    /** Platform section-header actions: Add mailbox always; Import + Compose once a mailbox is selected. */
    /** Which actions exist, and when, is declared by this tree -- not here. */
    readonly toolbarTree = 'navi.toolbar.email.mailbox';
    readonly headerActions = signal<ToolbarAction[]>([]);

    /**
     * What the tree's conditions are evaluated against.
     *
     * Both keys are BOOLEANS answering "does this apply / is it busy", not a
     * second copy of the model: the mailbox id stays here, and the tree never
     * learns what a mailbox id looks like.
     */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _hasMailbox: null !== this.selectedMailboxId(),
        _importing:  this.importing(),
    }));

    /**
     * The actions on messages: one server tree for the icon bar above the open message, the bar above the checked
     * rows, and a message row's menu. The page says what its target is; the
     * tree says which actions apply to it.
     */
    readonly messageTree = MESSAGE_TOOLBAR_TREE;
    readonly messageNodes = signal<NaviGraphNode[]>([]);
    readonly detailFacts = computed(() => {
        const m = this.selectedMessage();
        return messageFacts(m ? [m] : []);
    });
    readonly bulkFacts = computed(() => {
        const ids = this.selectedIds();
        return messageFacts(this.messages().filter(m => ids.has(m.id)));
    });
    /** Where the pointer last went down on a message bar, or a row was right-clicked: Move's and Delete's second step
     *  (the folders; Trash or permanent) opens there. */
    private actionPoint = { x: 0, y: 0 };

    onHeaderAction(id: string): void {
        switch (id) {
            case 'add-mailbox':
                this.openCreateMailbox();
                break;
            case 'import':
                this.importInput()?.nativeElement.click();
                break;
            case 'compose':
                this.openCompose();
                break;
            case 'mailbox-settings':
                this.openMailboxSettings();
                break;
            case 'module-settings':
                // Email's own settings, in the settings shell's module scope.
                void this.router.navigate(['/email', 'settings']);
                break;
        }
    }

    /**
     * A right-click on a mailbox: it is selected, and the menu holds exactly the action bar's actions for it -- the
     * tree's nodes outside the header, filtered by the same conditions -- never one that exists only here. Only on the
     * mailboxes: on text, links and inputs the browser's own menu stays.
     */
    onMailboxContextMenu(event: MouseEvent, id: string): void {
        if (id !== this.selectedMailboxId()) {
            this.pickMailbox(id);
        }
        const bar = mailboxMenuNodes(this.toolbarNodes());
        this.contextMenu.openFromNodes(
            event,
            bar,
            { ...this.toolbarContext(), _hasMailbox: true },
            action => this.onHeaderAction(action),
        );
    }

    noteActionPoint(event: PointerEvent): void {
        this.actionPoint = { x: event.clientX, y: event.clientY };
    }

    /** The open message's bar. */
    onDetailAction(action: string): void {
        const m = this.selectedMessage();
        if (m) {
            this.onMessageAction(action, [m.id]);
        }
    }

    /** The checked rows' bar. */
    onBulkAction(action: string): void {
        this.onMessageAction(action, [...this.selectedIds()]);
    }

    /** A message row's menu: the same actions as the bars, on the checked rows when this row is one of them. */
    onMessageRowContextMenu(event: MouseEvent, m: EmailMessageDto): void {
        const ids = rowTargetIds(this.selectedIds(), m.id);
        const targets = this.messages().filter(x => ids.includes(x.id));
        this.actionPoint = { x: event.clientX, y: event.clientY };
        this.contextMenu.openFromNodes(event, this.messageNodes(), messageFacts(targets),
            action => this.onMessageAction(action, ids));
    }

    /** One place for every action on messages, from either bar or a row's menu. */
    onMessageAction(action: string, ids: string[]): void {
        if (ids.length === 0) {
            return;
        }
        switch (action) {
            case 'reply':
            case 'forward':
                this.withOpen(ids[0], () => (action === 'reply' ? this.openReply() : this.openForward()));
                break;
            case 'mark-read':
            case 'mark-unread':
                this.bulkMarkSeen(action === 'mark-read', new Set(ids));
                break;
            case 'star':
            case 'unstar':
                this.bulkFlag(action === 'star', new Set(ids));
                break;
            case 'move':
                this.openFollowUp(moveMenuItems(this.folders().map(f => f.folder), this.folderOf(ids[0])), id => {
                    if (id.startsWith('move:')) {
                        this.bulkMoveTo(id.slice('move:'.length), new Set(ids));
                    }
                });
                break;
            case 'delete':
                this.openFollowUp(deleteMenuItems(ids.length, this.folderOf(ids[0]) === 'Trash'), id => {
                    if (id === 'delete:trash' || id === 'delete:permanent') {
                        this.bulkDelete(id === 'delete:permanent', new Set(ids));
                    }
                });
                break;
        }
    }

    /** Run `then` on this message open in the detail pane, opening it first when another one is. */
    private withOpen(id: string, then: () => void): void {
        if (this.selectedMessage()?.id === id) {
            then();
            return;
        }
        const m = this.messages().find(x => x.id === id);
        if (m) {
            this.openById(m.id, m.seen ?? true, m.folder ?? this.selectedFolder(), then);
        }
    }

    private folderOf(id: string): string {
        return this.messages().find(m => m.id === id)?.folder ?? this.selectedFolder();
    }

    /** Move's and Delete's second step, as a menu where the first was chosen. Opened after the first menu closes. */
    private openFollowUp(items: ContextMenuItem[], onAction: (id: string) => void): void {
        const at = new MouseEvent('contextmenu', { clientX: this.actionPoint.x, clientY: this.actionPoint.y });
        setTimeout(() => this.contextMenu.open(at, items, onAction));
    }

    /** C.4.b: recipient chips (were comma-strings pre-C.4.b). Each is an `app-tag-input` `string[]` model. */
    composeTo: string[] = [];
    composeCc: string[] = [];
    composeBcc: string[] = [];
    composeSubject = '';
    composeText = '';
    /** Cc/Bcc rows are hidden until the user asks for them (Gmail-style). */
    readonly composeShowCcBcc = signal<boolean>(false);
    /**
     * Shared contact-typeahead suggestions for the To/Cc/Bcc inputs (C.4.b). Fed by
     * {@link onRecipientQuery} (debounced `GET /contacts?q=`); each tag-input filters
     * this list by its own local query, so one shared source drives all three.
     */
    readonly contactOptions = signal<TagOption[]>([]);
    private readonly recipientQuery$ = new Subject<string>();
    /**
     * Rich-text compose (backlog slice 2). `true` renders the platform
     * `<coolms-editor>` (standard profile -> bold/italic/link/lists/quote) and
     * sends an HTML body; `false` keeps the legacy plain `<textarea>`. Sticky
     * across composes (a user's choice persists); defaults to rich.
     */
    readonly composeRich = signal<boolean>(true);
    /** The rich editor's live HTML (storage form); read on send as `request.html`. */
    readonly composeHtml = signal<string>('');
    /**
     * Bumped to force a clean editor re-mount (clears content + undo + cursor)
     * on open / close / after-send -- mirrors MessagesPageComponent's composerKey.
     */
    readonly composeKey = signal<string>('0');

    // Search: when active, the middle pane shows mailbox-wide search
    // hits instead of the current folder's messages.
    private static readonly SEARCH_PAGE_SIZE = 20;
    readonly searchActive = signal<boolean>(false);
    readonly searching = signal<boolean>(false);
    readonly searchResults = signal<EmailSearchHitDto[]>([]);
    readonly searchHasMore = signal<boolean>(false);
    searchQuery = '';
    private searchPage = 1;
    private searchSeq = 0;

    // Import: upload a .eml/.mbox file into the current folder.
    readonly importing = signal<boolean>(false);

    readonly mailboxEditorOpen = signal<boolean>(false);
    readonly savingMailbox = signal<boolean>(false);
    /** Which of the 4 wizard steps the mailbox editor is showing (1-based). Reset to 1 on open. */
    readonly mbStep = signal(1);
    /** Step numbers for the wizard progress indicator. */
    readonly mbSteps = [1, 2, 3, 4] as const;
    readonly securityOptions: MailboxSecurity[] = ['none', 'ssl', 'starttls'];
    mbForm: MailboxFormModel = EmailMailboxPageComponent.blankMailboxForm();

    // OAuth connect: an in-flight "Connect with ..." redirect of a new mailbox.
    readonly connecting = signal<boolean>(false);
    /** After returning from the provider's consent, select this mailbox once the list loads. */
    private pendingSelectId: string | null = null;

    // OAuth provider picker: the registered providers (backend-driven,
    // so a new one appears with no FE change) + their editable IMAP/SMTP presets.
    readonly oauthProviders = signal<EmailOAuthProviderDto[]>([{ key: 'google', label: 'Google' }]);
    private static readonly PROVIDER_PRESETS: Partial<Record<string, { imapHost: string; smtpHost: string; smtpPort: number; smtpSecurity: MailboxSecurity }>> = {
        google: { imapHost: 'imap.gmail.com', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'ssl' },
        microsoft: { imapHost: 'outlook.office365.com', smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecurity: 'starttls' },
    };

    /** Deployed workflow definitions offered by the inbound-workflow picker. */
    readonly inboundWorkflowOptions = signal<InboundWorkflowOption[]>([]);

    ngOnInit(): void {
        // C.4.b: debounced contact typeahead for the To/Cc/Bcc chips. An empty
        // query clears the suggestions; a failed search degrades to none.
        this.recipientQuery$.pipe(
            debounceTime(200),
            switchMap(q => q.trim() === ''
                ? of<ContactDto[]>([])
                : this.contacts.list(q).pipe(catchError(() => of<ContactDto[]>([])))),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(list => this.contactOptions.set(this.toRecipientOptions(list)));

        this.consumeOAuthReturn();
        // A mailbox named in the URL (`/email;mailbox=<id>`, and with `?settings=` its settings open over it): that
        // mailbox is the one to open.
        this.pendingSelectId ??= this.route.snapshot.paramMap.get('mailbox');
        this.settingsModal.attach();
        const pattern = this.store.selectSnapshot(AppConfigState.manifest)?.navi?.graphBySlug;
        if (pattern) {
            this.naviGraph.loadTree(pattern.replace('{slug}', this.toolbarTree))
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(nodes => this.toolbarNodes.set(nodes));
            this.naviGraph.loadTree(pattern.replace('{slug}', this.messageTree))
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(nodes => this.messageNodes.set(nodes));
        }
        // The mailboxes and the person's mail settings together: the settings name the mailbox to open on. A setting
        // that cannot be read is its default -- the page never waits on it.
        forkJoin({ list: this.email.listMailboxes(), prefs: this.mailPrefs.readOrDefaults() }).subscribe({
            next: ({ list, prefs }) => {
                this.mailboxes.set(list);
                this.loadingMailboxes.set(false);
                this.loadMailboxUnread(list);

                const saved = localStorage.getItem(EmailMailboxPageComponent.LAST_MAILBOX_KEY);
                const prefer = this.pendingSelectId;
                this.pendingSelectId = null;
                // Precedence: an OAuth-return target, then the default mailbox the person chose in their profile, then
                // the persisted last mailbox, then the first mailbox -- each only if it still exists in the list.
                const target = openingMailbox(list, prefer, prefs.defaultMailboxId, saved);
                if (target !== null) {
                    this.selectMailbox(target);
                }
            },
            error: () => {
                this.loadingMailboxes.set(false);
                this.toast.error('Could not load mailboxes.');
            },
        });

        // Populate the inbound-workflow picker. Non-blocking + non-fatal: on failure the
        // select still offers "None" plus any value already stored on the edited mailbox.
        this.email.listInboundWorkflowOptions().subscribe({
            next: opts => this.inboundWorkflowOptions.set(opts),
            error: () => this.inboundWorkflowOptions.set([]),
        });

        // The OAuth provider picker. Non-fatal: on failure the editor keeps
        // its default single "Google" option.
        this.email.listOAuthProviders().subscribe({
            next: list => {
                if (list.length > 0) {
                    this.oauthProviders.set(list);
                }
            },
            error: () => { /* keep the default provider list */ },
        });

        // The list moves on its own. Subscribe to the per-user
        // mailbox channel; every nudge (ids/counts only, never content) refetches
        // over REST. Non-fatal: on any realtime error the page still works via
        // manual reload, so we swallow rather than toast on a stale token.
        const uid = this.currentUserId();
        if (uid !== null) {
            this.emailLive.watch(uid)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: evt => this.onMailReceived(evt),
                    error: () => { /* swallow -- manual reload still works */ },
                });
        }
    }

    /**
     * A realtime nudge that a mailbox the current user can see gained new mail. The
     * payload carries ids and a count only, so we refetch over REST: the OPEN mailbox
     * reloads its folders + list (new mail + counts); any OTHER mailbox just refreshes
     * its switcher badge. Owner-only channel auth is enforced server-side.
     */
    private onMailReceived(evt: EmailLiveEvent): void {
        if (evt.mailboxId === this.selectedMailboxId()) {
            this.loadFolders();
            return;
        }
        this.email.listFolders(evt.mailboxId).subscribe({
            next: folders => this.patchMailboxUnread(evt.mailboxId, folders),
            error: () => { /* leave the badge as-is on a transient failure */ },
        });
    }

    selectMailbox(id: string): void {
        this.selectedMailboxId.set(id);
        this.selectedMessage.set(null);
        this.messages.set([]);
        this.clearSelection();
        this.clearSearch();
        this.loadFolders();
    }

    /**
     * The user picked a mailbox from the switcher -- select it AND remember the
     * choice in localStorage (`coolms.email.lastMailboxId`) so a reload restores it
     * instead of defaulting to the first mailbox. Distinct from {@link selectMailbox}
     * so the initial restore-on-load doesn't re-persist what it just read.
     */
    pickMailbox(id: string): void {
        if (id === this.selectedMailboxId()) {
            return;
        }
        this.selectMailbox(id);
        localStorage.setItem(EmailMailboxPageComponent.LAST_MAILBOX_KEY, id);
    }

    /** First letter for a mailbox avatar (label > address), uppercased; '?' when unknown. */
    mailboxInitial(mb: EmailMailboxDto): string {
        const label = mb.label ?? '';
        const src = (label.trim() !== '' ? label : (mb.emailAddress ?? '')).trim();
        return src.length > 0 ? src.charAt(0).toUpperCase() : '?';
    }

    /** Deterministic avatar colour from the mailbox id (stable hue per mailbox). */
    avatarColor(id: string): string {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = (hash * 31 + id.charCodeAt(i)) % 360;
        }
        return `hsl(${hash}, 48%, 45%)`;
    }

    /** Fetch each mailbox's unread total (sum of folder `unseen`) for the switcher badges. */
    private loadMailboxUnread(list: EmailMailboxDto[]): void {
        if (list.length === 0) {
            this.mailboxUnread.set({});
            return;
        }
        forkJoin(list.map(mb => this.email.listFolders(mb.id).pipe(
            map(folders => [mb.id, folders.reduce((sum, f) => sum + folderUnread(f), 0)] as const),
            catchError(() => of([mb.id, 0] as const)),
        ))).subscribe(pairs => this.mailboxUnread.set(Object.fromEntries(pairs)));
    }

    /** Patch a single mailbox's unread badge from a freshly-loaded folder list. */
    private patchMailboxUnread(id: string, folders: EmailFolderDto[]): void {
        const unread = folders.reduce((sum, f) => sum + folderUnread(f), 0);
        this.mailboxUnread.update(prev => ({ ...prev, [id]: unread }));
    }

    selectFolder(folder: string): void {
        this.selectedFolder.set(folder);
        this.selectedMessage.set(null);
        this.clearSelection();
        this.clearSearch();
        this.loadMessages(true);
    }

    loadMore(): void {
        this.page += 1;
        this.loadMessages(false);
    }

    openMessage(m: EmailMessageDto): void {
        this.openById(m.id, m.seen ?? true, m.folder ?? this.selectedFolder());
    }

    /** Open a search hit -- same detail path as a folder message. */
    openSearchHit(hit: EmailSearchHitDto): void {
        this.openById(hit.id, hit.seen ?? true, hit.folder ?? this.selectedFolder());
    }

    /** Load a message's detail; mark it read if it was unread. Shared by list + search. */
    private openById(id: string, seen: boolean, folder: string, then?: () => void): void {
        const seq = ++this.openSeq;
        this.attachments.set([]);
        this.loadingAttachments.set(false);
        this.thread.set([]);
        // Remote images load at once only when the person's profile says "always loaded"; otherwise blocked until asked.
        this.loadRemoteImages.set(loadsRemoteImagesAtOnce(this.mailPrefs.current()));
        this.loadingDetail.set(true);
        this.email.getMessage(id).subscribe({
            next: detail => {
                if (seq !== this.openSeq) { return; }
                this.selectedMessage.set(detail);
                this.loadingDetail.set(false);
                then?.();
                this.loadThread(id, seq);
                if (detail.hasAttachments === true) {
                    this.loadAttachments(id, seq);
                }
                if (!seen) {
                    this.applySeen(id, folder, true);
                }
            },
            error: () => {
                if (seq !== this.openSeq) { return; }
                this.loadingDetail.set(false);
                this.toast.error('Could not open the message.');
            },
        });
    }

    /**
     * Fetch the open message's conversation thread, guarded by {@link openSeq}
     * so a slow response for a previously-opened message can't populate the strip.
     * Best-effort: a failure just leaves the strip hidden (a single message never
     * shows it anyway).
     */
    private loadThread(id: string, seq: number): void {
        this.email.listThread(id).subscribe({
            next: msgs => {
                if (seq !== this.openSeq) { return; }
                this.thread.set(msgs);
            },
            error: () => { /* the conversation strip is a convenience; degrade silently */ },
        });
    }

    /** Open another message in the conversation strip (it may live in a different folder). */
    openThreadMessage(m: EmailMessageDto): void {
        if (m.id === this.selectedMessage()?.id) {
            return;
        }
        this.openById(m.id, m.seen ?? true, m.folder ?? this.selectedFolder());
    }

    /** Run a full-text search across the selected mailbox. */
    runSearch(): void {
        const q = this.searchQuery.trim();
        const mailboxId = this.selectedMailboxId();
        if (q === '') {
            this.clearSearch();
            return;
        }
        if (mailboxId === null) {
            return;
        }
        this.clearSelection(); // the bulk bar is folder-view only; drop any lingering selection
        this.searchPage = 1;
        this.searchActive.set(true);
        const seq = ++this.searchSeq;
        this.searching.set(true);
        this.email.searchMessages({ q, mailboxId, page: 1 }).subscribe({
            next: hits => {
                if (seq !== this.searchSeq) { return; }
                this.searchResults.set(hits);
                this.searchHasMore.set(hits.length >= EmailMailboxPageComponent.SEARCH_PAGE_SIZE);
                this.searching.set(false);
            },
            error: () => {
                if (seq !== this.searchSeq) { return; }
                this.searching.set(false);
                this.toast.error('Search failed.');
            },
        });
    }

    loadMoreSearch(): void {
        const q = this.searchQuery.trim();
        const mailboxId = this.selectedMailboxId();
        if (q === '' || mailboxId === null) {
            return;
        }
        this.searchPage += 1;
        const seq = ++this.searchSeq;
        this.searching.set(true);
        this.email.searchMessages({ q, mailboxId, page: this.searchPage }).subscribe({
            next: hits => {
                if (seq !== this.searchSeq) { return; }
                this.searchResults.set([...this.searchResults(), ...hits]);
                this.searchHasMore.set(hits.length >= EmailMailboxPageComponent.SEARCH_PAGE_SIZE);
                this.searching.set(false);
            },
            error: () => {
                if (seq !== this.searchSeq) { return; }
                this.searching.set(false);
                this.toast.error('Search failed.');
            },
        });
    }

    /** Exit search and return to the folder message list. */
    clearSearch(): void {
        this.searchSeq++; // invalidate any in-flight search so its late response can't resurrect results
        this.searchQuery = '';
        this.searchActive.set(false);
        this.searching.set(false);
        this.searchResults.set([]);
        this.searchHasMore.set(false);
    }

    /** A search hit's `sentAt` is Unix SECONDS; the date pipe wants an ISO string. */
    hitDate(hit: EmailSearchHitDto): string | null {
        return hit.sentAt != null ? new Date(hit.sentAt * 1000).toISOString() : null;
    }

    /** Row star click: toggle this message's flag without opening it (backlog slice 7). */
    toggleFlag(m: EmailMessageDto, ev: MouseEvent): void {
        ev.stopPropagation();
        this.applyFlag(m.id, !(m.flagged ?? false));
    }

    /** POST the flag, then reflect it locally (row + open detail). */
    private applyFlag(messageId: string, flagged: boolean): void {
        this.email.markFlagged(messageId, flagged).subscribe({
            next: () => {
                this.messages.set(this.messages().map(x => (x.id === messageId ? { ...x, flagged } : x)));
                const sel = this.selectedMessage();
                if (sel && sel.id === messageId) {
                    this.selectedMessage.set({ ...sel, flagged });
                }
            },
            error: () => this.toast.error('Could not update the flag.'),
        });
    }

    /** Flag/unflag every selected message in one action (mirrors {@link bulkMarkSeen}). */
    bulkFlag(flagged: boolean, ids: ReadonlySet<string> = this.selectedIds()): void {
        const targets = this.messages().filter(m => ids.has(m.id) && (m.flagged ?? false) !== flagged);
        if (targets.length === 0) {
            this.clearSelection();
            return;
        }
        const changed = new Set(targets.map(m => m.id));
        this.bulkBusy.set(true);
        forkJoin(targets.map(m => this.email.markFlagged(m.id, flagged))).subscribe({
            next: () => {
                this.messages.set(this.messages().map(x => (changed.has(x.id) ? { ...x, flagged } : x)));
                const sel = this.selectedMessage();
                if (sel && changed.has(sel.id)) {
                    this.selectedMessage.set({ ...sel, flagged });
                }
                this.bulkBusy.set(false);
                this.toast.success(`${flagged ? 'Flagged' : 'Unflagged'} ${targets.length} message(s).`);
                this.clearSelection();
            },
            error: () => {
                this.bulkBusy.set(false);
                this.toast.error('Could not update all messages.');
            },
        });
    }

    /** The mailbox's folders minus the one the message is already in -- the move targets. */
    moveTargets(current: string): string[] {
        return this.folders()
            .map(f => f.folder)
            .filter(f => f !== current);
    }

    /** How much of a folder is here (percent), or null when it is whole or unmeasured. */
    importedFraction(f: EmailFolderDto): number | null {
        return importedFraction(f);
    }

    /** `1,314 / 5,512` while a folder is part-imported, otherwise just the count. */
    folderCount(f: EmailFolderDto): string {
        return folderCount(f);
    }

    /** The sentence the rail's fraction stands for, as a tooltip. */
    folderCountTitle(f: EmailFolderDto): string {
        return folderCountTitle(f);
    }

    /** The unread badge: the SERVER's count when known, else the imported one. */
    folderUnread(f: EmailFolderDto): number {
        return folderUnread(f);
    }

    /** Move every selected message to a folder in one action (mirrors {@link bulkFlag}). */
    bulkMoveTo(folder: string, ids: ReadonlySet<string> = this.selectedIds()): void {
        const targets = this.messages().filter(m => ids.has(m.id) && (m.folder ?? this.selectedFolder()) !== folder);
        if (targets.length === 0) {
            this.clearSelection();
            return;
        }
        const moved = new Set(targets.map(m => m.id));
        this.bulkBusy.set(true);
        forkJoin(targets.map(m => this.email.moveMessage(m.id, folder))).subscribe({
            next: () => {
                this.messages.set(this.messages().filter(m => !moved.has(m.id)));
                const sel = this.selectedMessage();
                if (sel && moved.has(sel.id)) {
                    this.selectedMessage.set(null);
                }
                this.bulkBusy.set(false);
                this.loadFolders();
                this.toast.success(`Moved ${targets.length} message(s) to ${folder}.`);
                this.clearSelection();
            },
            error: () => {
                this.bulkBusy.set(false);
                this.toast.error('Could not move all messages.');
            },
        });
    }

    /** Delete every selected message in one action: move-to-Trash or PERMANENTLY purge. */
    bulkDelete(permanent: boolean, ids: ReadonlySet<string> = this.selectedIds()): void {
        const targets = this.messages().filter(m => ids.has(m.id));
        if (targets.length === 0) {
            this.clearSelection();
            return;
        }
        const removed = new Set(targets.map(m => m.id));
        this.bulkBusy.set(true);
        forkJoin(targets.map(m => this.email.deleteMessage(m.id, permanent))).subscribe({
            next: () => {
                this.messages.set(this.messages().filter(m => !removed.has(m.id)));
                const sel = this.selectedMessage();
                if (sel && removed.has(sel.id)) {
                    this.selectedMessage.set(null);
                }
                this.bulkBusy.set(false);
                this.loadFolders();
                this.toast.success(permanent
                    ? `Deleted ${targets.length} message(s) permanently.`
                    : `Moved ${targets.length} message(s) to Trash.`);
                this.clearSelection();
            },
            error: () => {
                this.bulkBusy.set(false);
                this.toast.error('Could not delete all messages.');
            },
        });
    }

    /** Fetch the open message's attachment metadata; `seq` ties it to the current open. */
    private loadAttachments(messageId: string, seq: number): void {
        this.loadingAttachments.set(true);
        this.email.listAttachments(messageId).subscribe({
            next: list => {
                if (seq !== this.openSeq) { return; }
                this.attachments.set(list);
                this.loadingAttachments.set(false);
            },
            error: () => {
                if (seq !== this.openSeq) { return; }
                this.attachments.set([]);
                this.loadingAttachments.set(false);
            },
        });
    }

    /** Download one attachment -- fetch the blob (bearer-auth) and hand the browser an object URL. */
    downloadAttachment(att: EmailAttachmentDto): void {
        const msg = this.selectedMessage();
        if (!msg) {
            return;
        }
        this.email.fetchAttachment(msg.id, att.index).subscribe({
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

    /** Copy one attachment into the user's VFS home ("Save to my files", ). */
    saveAttachmentToFiles(att: EmailAttachmentDto): void {
        const msg = this.selectedMessage();
        if (!msg || this.savingAttachment() !== null) {
            return;
        }
        this.savingAttachment.set(att.index);
        this.email.saveAttachment(msg.id, att.index).subscribe({
            next: res => {
                this.savingAttachment.set(null);
                this.toast.success(`Saved "${res.filename}" to your files.`);
            },
            error: () => {
                this.savingAttachment.set(null);
                this.toast.error(`Couldn't save "${att.filename}".`);
            },
        });
    }

    /** Human-readable byte size for an attachment chip (e.g. "1.2 MB"). */
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
        return `${n.toFixed(1)} ${units[i]}`;
    }

    /** A bootstrap-icon suffix for an attachment by MIME type (used as `bi-{{ ... }}`). */
    attachmentIcon(contentType: string): string {
        const t = contentType.toLowerCase();
        if (t.startsWith('image/')) {
            return 'file-earmark-image';
        }
        if (t === 'application/pdf') {
            return 'file-earmark-pdf';
        }
        if (t.startsWith('text/')) {
            return 'file-earmark-text';
        }
        if (t.includes('zip') || t.includes('compress') || t.includes('tar') || t.includes('rar')) {
            return 'file-earmark-zip';
        }
        if (t.includes('word') || t.includes('opendocument.text')) {
            return 'file-earmark-word';
        }
        if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) {
            return 'file-earmark-spreadsheet';
        }
        return 'file-earmark';
    }

    isSelected(id: string): boolean {
        return this.selectedIds().has(id);
    }

    /** Row click: plain = open the message; Ctrl/Cmd = toggle in selection; Shift = range-select. */
    onRowClick(m: EmailMessageDto, ev: MouseEvent): void {
        if (ev.shiftKey) {
            ev.preventDefault();
            this.selectRangeTo(m.id);
        } else if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault();
            this.toggleSelect(m.id);
        } else {
            this.openMessage(m);
        }
    }

    /**
     * Checkbox click: a plain toggle of this one message; never opens it. We let the
     * NATIVE checkbox toggle drive its own tick (so it always renders checked) and
     * mirror the same flip into the selection signal -- they agree for a plain toggle,
     * and `[checked]` re-asserts from the signal on the next change detection. Shift/Ctrl
     * range selection lives on the row body ({@link onRowClick}), so the checkbox never
     * hits a case where the signal and the native tick could drift.
     */
    onCheckboxClick(m: EmailMessageDto, ev: MouseEvent): void {
        ev.stopPropagation(); // don't bubble to the row's open handler
        this.toggleSelect(m.id);
    }

    /** Add/remove one message id; it becomes the Shift-range anchor. */
    private toggleSelect(id: string): void {
        const next = new Set(this.selectedIds());
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        this.selectedIds.set(next);
        this.selectAnchorId = id;
    }

    /** Select the contiguous run (by display order) from the anchor to `id`. */
    private selectRangeTo(id: string): void {
        const ids = this.messages().map(m => m.id);
        const to = ids.indexOf(id);
        const from = this.selectAnchorId !== null ? ids.indexOf(this.selectAnchorId) : -1;
        if (to === -1 || from === -1) {
            this.toggleSelect(id);
            return;
        }
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        const next = new Set(this.selectedIds());
        for (let i = lo; i <= hi; i++) {
            next.add(ids[i]);
        }
        this.selectedIds.set(next);
        // Anchor stays put so successive Shift-clicks grow/shrink from the same origin.
    }

    /** Select every currently-loaded message in the folder. */
    selectAllLoaded(): void {
        this.selectedIds.set(new Set(this.messages().map(m => m.id)));
    }

    /** Drop the whole selection (and the range anchor). */
    clearSelection(): void {
        if (this.selectedIds().size > 0) {
            this.selectedIds.set(new Set<string>());
        }
        this.selectAnchorId = null;
    }

    /**
     * Mark every selected message read/unread in one action (backlog slice 3). Only
     * messages whose state actually changes are sent (idempotent no-ops skipped), then
     * the local rows, any open detail, and the folder's unread count are reconciled from
     * the delta. Reuses the existing per-message `/seen` endpoint via forkJoin.
     */
    bulkMarkSeen(seen: boolean, ids: ReadonlySet<string> = this.selectedIds()): void {
        const targets = this.messages().filter(m => ids.has(m.id) && (m.seen ?? false) !== seen);
        if (targets.length === 0) {
            this.clearSelection();
            return;
        }
        const folder = this.selectedFolder();
        const changed = new Set(targets.map(m => m.id));
        this.bulkBusy.set(true);
        forkJoin(targets.map(m => this.email.markSeen(m.id, seen))).subscribe({
            next: () => {
                this.messages.set(this.messages().map(x => (changed.has(x.id) ? { ...x, seen } : x)));
                const sel = this.selectedMessage();
                if (sel && changed.has(sel.id)) {
                    this.selectedMessage.set({ ...sel, seen });
                }
                const delta = seen ? -targets.length : targets.length;
                this.folders.set(this.folders().map(f =>
                    f.folder === folder ? applyUnreadDelta(f, delta) : f));
                const mbId = this.selectedMailboxId();
                if (mbId !== null) {
                    this.patchMailboxUnread(mbId, this.folders());
                }
                this.bulkBusy.set(false);
                this.toast.success(`Marked ${targets.length} message(s) ${seen ? 'read' : 'unread'}.`);
                this.clearSelection();
            },
            error: () => {
                this.bulkBusy.set(false);
                this.toast.error('Could not update all messages.');
            },
        });
    }

    openCompose(): void {
        this.composeMode.set('compose');
        this.replyTargetId.set(null);
        this.composeTo = [];
        this.composeCc = [];
        this.composeBcc = [];
        this.composeShowCcBcc.set(false);
        this.contactOptions.set([]);
        this.composeSubject = '';
        this.clearComposeBody();
        // Baseline for dirty-tracking (a fresh compose is empty), then restore any
        // saved draft so the user continues where they left off.
        this.snapshotComposeInitial();
        this.restoreDraftIfAny();
        this.composeMinimized.set(false);
        this.composeOpen.set(true);
    }

    /**
     * Import a picked `.eml`/`.mbox` file into the selected mailbox's current folder
     *. Reads the file text client-side and posts it as JSON; `.mbox` extension
     * bulk-splits an archive, else a single `.eml`. Refreshes the folder counts + list
     * on success. Resets the input so the same file can be re-picked.
     */
    onImportFileSelected(input: HTMLInputElement): void {
        const file = input.files?.[0];
        const mailboxId = this.selectedMailboxId();
        if (!file || mailboxId === null) {
            return;
        }
        const isMbox = /\.mbox$/i.test(file.name);
        this.importing.set(true);

        const reader = new FileReader();
        reader.onload = (): void => {
            const content = typeof reader.result === 'string' ? reader.result : '';
            this.email.importMail(mailboxId, content, this.selectedFolder(), isMbox).subscribe({
                next: r => {
                    this.finishImport(input);
                    this.toast.success(`Imported ${r.imported ?? 0} of ${r.total ?? 0} message(s) (${r.skipped ?? 0} skipped).`);
                    this.loadFolders();
                },
                error: () => {
                    this.finishImport(input);
                    this.toast.error('Import failed — check the file and try again.');
                },
            });
        };
        reader.onerror = (): void => {
            this.finishImport(input);
            this.toast.error('Could not read the file.');
        };
        reader.readAsText(file);
    }

    private finishImport(input: HTMLInputElement): void {
        this.importing.set(false);
        input.value = '';
    }

    openReply(): void {
        const msg = this.selectedMessage();
        if (!msg) {
            return;
        }
        this.composeMode.set('reply');
        this.replyTargetId.set(msg.id);
        this.composeTo = (msg.fromAddress ?? '').trim() !== '' ? [msg.fromAddress!.trim()] : [];
        this.composeCc = [];
        this.composeBcc = [];
        this.composeShowCcBcc.set(false);
        this.contactOptions.set([]);
        this.composeSubject = this.rePrefix(msg.subject ?? '');
        // Pre-fill the composer with the quoted original so the reply carries the
        // context of what it answers ("the message we reply to"). clearComposeBody()
        // resets + bumps composeKey (forces the editor re-mount); the quote is set
        // after, so the editor mounts with it.
        this.clearComposeBody();
        const quote = buildReplyQuote(msg, this.dtf);
        this.composeText = quote.text;
        this.composeHtml.set(quote.html);
        // Baseline = the pre-filled quote (so an untouched reply isn't "dirty"),
        // then restore any saved draft for THIS reply target.
        this.snapshotComposeInitial();
        this.restoreDraftIfAny();
        this.composeMinimized.set(false);
        this.composeOpen.set(true);
    }

    /** Forward the open message: a new message, "Fwd:" on the subject, the original's header block and text. */
    openForward(): void {
        const msg = this.selectedMessage();
        if (!msg) {
            return;
        }
        this.composeMode.set('compose');
        this.replyTargetId.set(null);
        this.composeTo = [];
        this.composeCc = [];
        this.composeBcc = [];
        this.composeShowCcBcc.set(false);
        this.contactOptions.set([]);
        const fwd = buildForward(msg, this.dtf);
        this.composeSubject = fwd.subject;
        this.clearComposeBody();
        this.composeText = fwd.text;
        this.composeHtml.set(fwd.html);
        this.snapshotComposeInitial();
        this.composeMinimized.set(false);
        this.composeOpen.set(true);
    }

    /** Toggle the composer dock between full-size and its collapsed header bar.
     *  The form stays mounted (its draft + editor state survive), so it restores as left. */
    toggleMinimize(): void {
        this.composeMinimized.update(v => !v);
    }

    /** The dock header label: the subject the user typed, else the mode label. */
    composeDockTitle(): string {
        const subject = this.composeSubject.trim();
        return subject !== '' ? subject : (this.composeMode() === 'reply' ? 'Reply' : 'New message');
    }

    /** localStorage draft key for the current composer, or null when unkeyable. */
    private composeDraftKey(): string | null {
        const mb = this.selectedMailboxId();
        if (mb === null) {
            return null;
        }
        if (this.composeMode() === 'reply') {
            const rt = this.replyTargetId();
            return rt !== null ? `email.${mb}.reply.${rt}` : null;
        }
        return `email.${mb}.compose`;
    }

    /** A recipient tag-input typed: push the query into the debounced search stream. */
    onRecipientQuery(q: string): void {
        this.recipientQuery$.next(q);
    }

    /**
     * Map contacts to recipient options: one row per distinct email address, the
     * chip value being the bare address (what we send) and the label the
     * Gmail-style `Name <addr>`. Contacts with no email are skipped -- you can't
     * address them.
     */
    private toRecipientOptions(list: ContactDto[]): TagOption[] {
        const opts: TagOption[] = [];
        const seen = new Set<string>();
        for (const c of list) {
            const name = (c.displayName ?? '').trim();
            for (const entry of c.emails ?? []) {
                const addr = entry.value.trim();
                const dedupe = addr.toLowerCase();
                if (addr === '' || seen.has(dedupe)) {
                    continue;
                }
                seen.add(dedupe);
                opts.push({ value: addr, label: name !== '' ? `${name} <${addr}>` : addr });
            }
        }
        return opts;
    }

    /**
     * Coerce a persisted recipient field to an address array. C.4.b stores arrays,
     * but a draft saved before this ship holds a comma-joined string -- split it so
     * old drafts still restore into the tag-inputs.
     */
    private asAddressArray(value: unknown): string[] {
        if (Array.isArray(value)) {
            return value.map(x => String(x).trim()).filter(x => x !== '');
        }
        if (typeof value === 'string') {
            return value.split(',').map(x => x.trim()).filter(x => x !== '');
        }
        return [];
    }

    /** Snapshot the current composer values as the fresh-open baseline. */
    private snapshotComposeInitial(): void {
        // Copy the arrays: the tag-inputs reassign a NEW array on every change, so
        // the baseline must be its own snapshot, not an alias of the live model.
        this.composeToInitial = [...this.composeTo];
        this.composeCcInitial = [...this.composeCc];
        this.composeBccInitial = [...this.composeBcc];
        this.composeSubjectInitial = this.composeSubject;
        this.composeTextInitial = this.composeText;
        this.composeHtmlInitial = this.composeHtml();
        this.composeRichInitial = this.composeRich();
    }

    /** True when the composer differs from its fresh-open baseline (worth saving). */
    private isComposeDirty(): boolean {
        // Recipient arrays are compared by CONTENT (join) -- reference compare would
        // read every tag-input change as dirty since it emits a fresh array.
        return this.composeTo.join('\n') !== this.composeToInitial.join('\n')
            || this.composeCc.join('\n') !== this.composeCcInitial.join('\n')
            || this.composeBcc.join('\n') !== this.composeBccInitial.join('\n')
            || this.composeSubject !== this.composeSubjectInitial
            || this.composeText !== this.composeTextInitial
            || this.composeHtml() !== this.composeHtmlInitial
            || this.composeRich() !== this.composeRichInitial;
    }

    /** Load + apply a saved draft for the current key into the composer, if present. */
    private restoreDraftIfAny(): void {
        const key = this.composeDraftKey();
        const draft = key !== null ? this.drafts.load<ComposeDraft>(key) : null;
        if (draft === null) {
            this.draftSaved.set(false);
            return;
        }
        // Coerce: pre-C.4.b drafts stored `to` as a comma-string; cc/bcc may be absent.
        this.composeTo = this.asAddressArray(draft.to);
        this.composeCc = this.asAddressArray(draft.cc);
        this.composeBcc = this.asAddressArray(draft.bcc);
        if (this.composeCc.length > 0 || this.composeBcc.length > 0) {
            this.composeShowCcBcc.set(true);
        }
        this.composeSubject = draft.subject;
        this.composeText = draft.text;
        this.composeRich.set(draft.rich);
        this.composeHtml.set(draft.html);
        this.composeKey.update(k => String(Number(k) + 1)); // re-mount the editor with the draft
        this.draftSaved.set(true);
    }

    /** Debounced autosave hook -- called from the composer field change bindings. */
    onComposeChange(): void {
        if (this.draftSaveTimer !== null) {
            clearTimeout(this.draftSaveTimer);
        }
        this.draftSaveTimer = setTimeout(() => this.saveDraftNow(), 600);
    }

    /** Persist the draft if dirty, else clear it (so deleting your edits removes it). */
    private saveDraftNow(): void {
        const key = this.composeDraftKey();
        if (key === null) {
            return;
        }
        if (this.isComposeDirty()) {
            this.drafts.save(key, {
                to: this.composeTo,
                cc: this.composeCc,
                bcc: this.composeBcc,
                subject: this.composeSubject,
                text: this.composeText,
                html: this.composeHtml(),
                rich: this.composeRich(),
            } satisfies ComposeDraft);
            this.draftSaved.set(true);
        } else {
            this.drafts.clear(key);
            this.draftSaved.set(false);
        }
    }

    /** Discard the current draft and close the composer without sending. */
    discardDraft(): void {
        const key = this.composeDraftKey();
        if (key !== null) {
            this.drafts.clear(key);
        }
        this.draftSaved.set(false);
        this.composeOpen.set(false);
        this.clearComposeBody();
    }

    closeCompose(): void {
        // Persist the latest edit as a draft (the debounce may not have fired), then
        // close. The draft is KEPT -- reopening the composer restores it; "Discard"
        // is the explicit delete.
        if (this.draftSaveTimer !== null) {
            clearTimeout(this.draftSaveTimer);
            this.draftSaveTimer = null;
        }
        this.saveDraftNow();
        this.composeOpen.set(false);
        this.clearComposeBody();
    }

    /** Flip the composer between the rich `<coolms-editor>` and the plain textarea.
     *  Both bodies persist independently, so a round-trip toggle loses nothing. */
    toggleComposeRich(): void {
        this.composeRich.update(v => !v);
    }

    /** Reset the compose BODY (both plain + rich) and force a clean editor re-mount.
     *  Recipient + subject are managed by the open* methods, not here. */
    private clearComposeBody(): void {
        this.composeText = '';
        this.composeHtml.set('');
        this.composeKey.update(k => String(Number(k) + 1));
    }

    /**
     * Derive a plain-text fallback from the rich editor's HTML so the outgoing
     * email always carries a text body (the backend requires >=1 body, and
     * non-HTML clients fall back to this). Uses DOMParser to decode entities and
     * drop tags; `<br>` + block boundaries become newlines so it stays readable.
     */
    private htmlToPlainText(html: string): string {
        if (html.trim() === '') {
            return '';
        }
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.body.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        doc.body.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote')
            .forEach(el => el.append('\n'));
        const text = doc.body.textContent ?? '';
        return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    sendCompose(): void {
        const rich = this.composeRich();
        const html = rich ? this.composeHtml() : '';
        // Rich mode sends an HTML body plus a stripped-tags plain-text fallback;
        // plain mode keeps the textarea text exactly as before.
        const text = rich ? this.htmlToPlainText(html) : this.composeText.trim();
        if (text === '') {
            this.toast.error('Enter a message body.');
            return;
        }
        // Recipients are already parsed address chips; just trim/dedupe empties.
        const to = this.composeTo.map(x => x.trim()).filter(x => x !== '');
        const cc = this.composeCc.map(x => x.trim()).filter(x => x !== '');
        const bcc = this.composeBcc.map(x => x.trim()).filter(x => x !== '');
        const isReply = this.composeMode() === 'reply';
        if (!isReply && to.length === 0) {
            this.toast.error('Enter at least one recipient.');
            return;
        }
        const mailboxId = this.selectedMailboxId();
        if (mailboxId === null) {
            return;
        }

        const request: OutgoingEmailRequest = { text };
        if (rich) {
            // text passed the non-empty guard above, so html has visible content.
            request.html = html;
        }
        if (to.length > 0) {
            request.to = to;
        }
        if (cc.length > 0) {
            request.cc = cc;
        }
        if (bcc.length > 0) {
            request.bcc = bcc;
        }
        const subject = this.composeSubject.trim();
        if (subject !== '') {
            request.subject = subject;
        }

        const replyId = this.replyTargetId();
        const draftKey = this.composeDraftKey();
        const call = isReply && replyId !== null
            ? this.email.reply(replyId, request)
            : this.email.send(mailboxId, request);

        this.sending.set(true);
        call.subscribe({
            next: () => {
                this.sending.set(false);
                // A sent message is no longer a draft -- drop it.
                if (draftKey !== null) {
                    this.drafts.clear(draftKey);
                }
                this.draftSaved.set(false);
                this.composeOpen.set(false);
                this.clearComposeBody();
                this.toast.success(isReply ? 'Reply sent.' : 'Message sent.');
                // Refresh folders (Sent count) + the current message list.
                this.loadFolders();
            },
            error: () => {
                this.sending.set(false);
                this.toast.error('Send failed — check the mailbox SMTP settings.');
            },
        });
    }

    openCreateMailbox(): void {
        this.mbStep.set(1);
        this.mbForm = EmailMailboxPageComponent.blankMailboxForm();
        this.mailboxEditorOpen.set(true);
    }

    /**
     * A mailbox's settings open in a modal over this page (decided 2026-10-24), named in the URL so a link opens
     * them and Back closes them; the wizard only adds a mailbox.
     */
    openMailboxSettings(): void {
        const id = this.selectedMailboxId();
        if (id) {
            this.settingsModal.open(id);
        }
    }

    closeMailboxEditor(): void {
        this.mailboxEditorOpen.set(false);
    }

    /** Human title for the current wizard step (shown in the step indicator). */
    mbStepTitle(): string {
        switch (this.mbStep()) {
            case 1: return 'Mailbox';
            case 2: return 'Incoming (IMAP)';
            case 3: return 'Outgoing (SMTP)';
            case 4: return this.isOauthCreate() ? 'Connect' : 'Credentials & automation';
            default: return '';
        }
    }

    /** A NEW OAuth mailbox: the wizard ends in a connect, not a create. */
    isOauthCreate(): boolean {
        return this.mbForm.authMethod === 'oauth';
    }

    /** Whether the IMAP/SMTP username fields are shown editable -- see the wizard rules. */
    usernameEditable(): boolean {
        return usernameFieldsEditable(this.mbForm.authMethod, this.callerIsAdmin());
    }

    /** Why the username is shown rather than asked for. */
    usernameRuleHint(): string {
        return this.mbForm.authMethod === 'oauth'
            ? `Signs in as the address -- ${this.providerLabel(this.mbForm.oauthProvider)} authenticates the account itself.`
            : 'Signs in as the address. An alias that differs is an administrator\'s setting.';
    }

    /** Advance one wizard step if the current step's required fields pass validation. */
    nextStep(): void {
        if (!this.validateStep(this.mbStep())) {
            return;
        }
        this.mbStep.set(Math.min(4, this.mbStep() + 1));
    }

    /** Go back one wizard step (no validation). */
    prevStep(): void {
        this.mbStep.set(Math.max(1, this.mbStep() - 1));
    }

    /**
     * Validate ONLY the fields owned by `step`; toast the first blank and return false.
     * The full check still runs in {@link saveMailbox} / {@link connectDraft} as the
     * final gate -- this only gates "Next". Usernames are on no step: they are derived
     * from the address (password) or absent (OAuth), see the wizard rules.
     */
    private validateStep(step: number): boolean {
        const blank = requiredOnStep(step, this.mbForm).find(([, v]) => v.trim() === '');
        if (blank) {
            this.toast.error(`${blank[0]} is required.`);
            return false;
        }
        return true;
    }

    /** Steps 1-3 together, the final gate before a create or a connect. */
    private validateAllSteps(): boolean {
        return [1, 2, 3].every(step => this.validateStep(step));
    }

    /**
     * The create form's auth-method toggle: picking OAuth selects a provider (the
     * current one if still available, else the first) and applies its IMAP/SMTP
     * presets + clears any password.
     */
    onAuthMethodChange(method: MailboxAuthMethod): void {
        if (method !== 'oauth') {
            return;
        }
        const providers = this.oauthProviders();
        const key = providers.some(p => p.key === this.mbForm.oauthProvider)
            ? this.mbForm.oauthProvider
            : (providers[0]?.key ?? 'google');
        this.applyProviderPresets(key);
    }

    /** The provider picker changed: switch to that provider's IMAP/SMTP presets. */
    onProviderChange(key: string): void {
        this.applyProviderPresets(key);
    }

    /** Set the OAuth provider + pre-fill its (editable) IMAP/SMTP endpoints; clear the password. */
    private applyProviderPresets(key: string): void {
        this.mbForm.oauthProvider = key;
        this.mbForm.password = '';
        const preset = EmailMailboxPageComponent.PROVIDER_PRESETS[key];
        if (preset === undefined) {
            return;
        }
        this.mbForm.imapHost = preset.imapHost;
        this.mbForm.imapPort = 993;
        this.mbForm.imapSecurity = 'ssl';
        this.mbForm.smtpHost = preset.smtpHost;
        this.mbForm.smtpPort = preset.smtpPort;
        this.mbForm.smtpSecurity = preset.smtpSecurity;
    }

    /** Human label for a provider key (from the fetched list, else ucfirst; '' -> 'OAuth'). */
    providerLabel(key: string): string {
        const found = this.oauthProviders().find(p => p.key === key);
        if (found?.label !== undefined && found.label !== '') {
            return found.label;
        }
        if (key === '') {
            return 'OAuth';
        }
        return key.charAt(0).toUpperCase() + key.slice(1);
    }

    /**
     * Authorize first: hand the intended NEW OAuth mailbox to the server as a draft and
     * leave for the provider's consent screen. No mailbox exists until the callback has
     * proven the grant; the callback bounces to `?oauth=connected&mailbox=<new id>`
     * (handled by {@link consumeOAuthReturn}), so the editor is not kept open here --
     * there is nothing to edit yet.
     */
    connectDraft(): void {
        if (!this.validateAllSteps()) {
            return;
        }
        const provider = this.providerLabel(this.mbForm.oauthProvider);
        this.connecting.set(true);
        this.email.connectMailboxDraft(draftRequestFromForm(this.mbForm)).subscribe({
            next: res => {
                const url = res.authorizationUrl;
                if (url !== undefined && url !== '') {
                    window.location.href = url; // leave the SPA for the provider's consent screen
                } else {
                    this.connecting.set(false);
                    this.toast.error(`Could not start the ${provider} connection.`);
                }
            },
            error: () => {
                this.connecting.set(false);
                this.toast.error(`Could not start the ${provider} connection.`);
            },
        });
    }

    /**
     * Handle a redirect back from the provider's consent (`?oauth=connected|error&mailbox=`):
     * toast the outcome, remember which mailbox to select, and strip the query so a page
     * refresh doesn't re-toast. A connected `mailbox` may be one that did not exist when
     * the browser left (authorize-first), so the list is what shows it.
     */
    private consumeOAuthReturn(): void {
        const params = new URLSearchParams(window.location.search);
        const outcome = params.get('oauth');
        if (outcome === null) {
            return;
        }
        if (outcome === 'connected') {
            this.pendingSelectId = params.get('mailbox');
            this.toast.success('Mailbox connected.');
        } else {
            this.toast.error('The account was not connected — nothing was saved. Please try again.');
        }
        history.replaceState(null, '', window.location.pathname + window.location.hash);
    }

    /**
     * Options for the inbound-workflow `<select>`: the deployed workflows,
     * plus -- if the mailbox already stores a key that is NOT among them (a workflow
     * since undeployed, or one set via the API/console) -- a synthetic leading option
     * so the current value stays selected and visible rather than being silently blanked.
     */
    workflowChoices(): InboundWorkflowOption[] {
        const opts = this.inboundWorkflowOptions();
        const current = this.mbForm.inboundWorkflowKey.trim();
        if (current !== '' && !opts.some(o => o.key === current)) {
            return [{ key: current, label: `${current} (not currently deployed)` }, ...opts];
        }
        return opts;
    }

    /**
     * Save an edit, or create a PASSWORD mailbox. A new OAuth mailbox never comes
     * through here: it is connected first ({@link connectDraft}) and exists only once
     * the grant has proven.
     */
    saveMailbox(): void {
        if (this.isOauthCreate()) {
            this.connectDraft();
            return;
        }
        const f = this.mbForm;

        // Required-field checks mirror the backend CreateMailboxProcessor. Usernames are
        // not among them: the server derives both from the address, and only an
        // administrator may send an alias (the wizard rules).
        if (!this.validateAllSteps()) {
            return;
        }
        if (f.password.trim() === '') {
            this.toast.error('Password is required.');
            return;
        }

        const request: MailboxWriteRequest = {
            label: f.label.trim(),
            emailAddress: f.emailAddress.trim(),
            imapHost: f.imapHost.trim(),
            imapPort: f.imapPort,
            imapSecurity: f.imapSecurity,
            smtpHost: f.smtpHost.trim(),
            smtpPort: f.smtpPort,
            smtpSecurity: f.smtpSecurity,
            enabled: f.enabled,
            // Present '' clears the trigger; a value sets it (merge-patch convention).
            inboundWorkflowKey: f.inboundWorkflowKey.trim(),
        };
        Object.assign(request, usernamesForCreate(this.callerIsAdmin(), f.imapUsername, f.smtpUsername));
        request.password = f.password;

        this.savingMailbox.set(true);
        this.email.createMailbox(request).subscribe({
            next: saved => {
                this.savingMailbox.set(false);
                this.mailboxEditorOpen.set(false);
                this.toast.success('Mailbox created.');
                this.reloadMailboxes(saved.id);
            },
            error: () => {
                this.savingMailbox.set(false);
                this.toast.error('Could not create the mailbox — check the connection settings.');
            },
        });
    }

    /** Refresh the mailbox list after a create/update/delete; select `preferId` if present. */
    private reloadMailboxes(preferId: string | null): void {
        this.email.listMailboxes().subscribe({
            next: list => {
                this.mailboxes.set(list);
                const next = (preferId && list.some(m => m.id === preferId))
                    ? preferId
                    : (list[0]?.id ?? null);
                if (next === null) {
                    this.selectedMailboxId.set(null);
                    this.folders.set([]);
                    this.messages.set([]);
                    this.selectedMessage.set(null);
                } else {
                    this.selectMailbox(next);
                }
            },
            error: () => this.toast.error('Could not reload mailboxes.'),
        });
    }

    private loadFolders(): void {
        const id = this.selectedMailboxId();
        if (id === null) {
            return;
        }
        this.email.listFolders(id).subscribe({
            next: list => {
                this.folders.set(list);
                this.patchMailboxUnread(id, list);
                const current = this.selectedFolder();
                if (list.length > 0 && !list.some(f => f.folder === current)) {
                    this.selectedFolder.set(list[0].folder);
                }
                this.loadMessages(true);
            },
            error: () => {
                this.folders.set([]);
                this.loadMessages(true);
            },
        });
    }

    private loadMessages(reset: boolean): void {
        const id = this.selectedMailboxId();
        if (id === null) {
            this.messages.set([]);
            return;
        }
        if (reset) {
            this.page = 1;
        }
        const seq = ++this.listSeq;
        this.loadingMessages.set(true);
        this.email.listMessages(id, this.selectedFolder(), this.page).subscribe({
            next: list => {
                if (seq !== this.listSeq) { return; }
                this.messages.set(reset ? list : [...this.messages(), ...list]);
                this.hasMore.set(list.length >= EmailMailboxPageComponent.PAGE_SIZE);
                this.loadingMessages.set(false);
            },
            error: () => {
                if (seq !== this.listSeq) { return; }
                this.loadingMessages.set(false);
                this.toast.error('Could not load messages.');
            },
        });
    }

    /** POST the read/unread flag, then reflect it locally (row + detail + folder count). */
    private applySeen(messageId: string, folder: string, seen: boolean): void {
        this.email.markSeen(messageId, seen).subscribe({
            next: () => {
                this.messages.set(this.messages().map(x => (x.id === messageId ? { ...x, seen } : x)));
                // Reflect the flag in any matching search hit too.
                this.searchResults.set(this.searchResults().map(x => (x.id === messageId ? { ...x, seen } : x)));
                const sel = this.selectedMessage();
                if (sel && sel.id === messageId) {
                    this.selectedMessage.set({ ...sel, seen });
                }
                const delta = seen ? -1 : 1;
                this.folders.set(this.folders().map(f =>
                    f.folder === folder ? applyUnreadDelta(f, delta) : f));
                const mbId = this.selectedMailboxId();
                if (mbId !== null) {
                    this.patchMailboxUnread(mbId, this.folders());
                }
            },
            error: () => {
                this.toast.error('Could not update the message.');
            },
        });
    }

    private rePrefix(subject: string): string {
        const trimmed = subject.trim();
        if (trimmed === '') {
            return 'Re:';
        }
        return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
    }

    private static blankMailboxForm(): MailboxFormModel {
        return {
            label: '',
            emailAddress: '',
            imapHost: '',
            imapPort: 993,
            imapSecurity: 'ssl',
            imapUsername: '',
            smtpHost: '',
            smtpPort: 465,
            smtpSecurity: 'ssl',
            smtpUsername: '',
            password: '',
            enabled: true,
            inboundWorkflowKey: '',
            authMethod: 'password',
            oauthProvider: 'google',
        };
    }
}
