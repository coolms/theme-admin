import { Dialog } from '@angular/cdk/dialog';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import {
    ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, effect, inject,
    signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Location, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, type ParamMap } from '@angular/router';
import {
    Observable, Subject, type Subscription, catchError, debounceTime, filter, forkJoin, interval, map, of, switchMap, take,
} from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState, AuthState, NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';
import { CoolmsEditorComponent } from '@coolms/editor-angular';

import { ContactDto, ContactsService } from '../contacts/contacts.service';
import {
    CmsPageHeaderComponent,
    CmsPaneSplitterComponent,
    CmsPaneToolbarComponent,
    ContextMenuItem,
    ConfirmDialogService,
    ContextMenuService,
    DateTimePipe,
    EmptyStateComponent,
    PageToolbarComponent,
    StateComponent,
    TagInputComponent,
    TagOption,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { EmailLiveEvent, EmailLiveEventsService } from './email-live-events.service';
import { MailLiveFollower, type MailMessagesChangedEvent } from './mail-messages-changed';
import { MailPreferencesService } from './mail-preferences.service';
import { MailPanesDirective } from './mail-panes.directive';
import { loadsRemoteImagesAtOnce, openingMailbox } from './mail-opening';
import { mailboxMenuNodes } from './mailbox-menu';
import { sendFailureText } from './send-via';
import { ComposeAttachButtonComponent } from './compose-attach-button.component';
import { ComposeAttachmentsComponent } from './compose-attachments.component';
import { InnerLabelDirective } from './inner-label.directive';
import {
    expiredAttachmentId,
    restoredAttachments,
    storedAttachments,
    tooLargeSend,
    type ComposeAttachment,
} from './compose-attachments';
import { MessageFrameComponent } from './message-frame.component';
import { MailQuickReplyComponent, type QuickReplyDiscarded, type QuickReplyHandOff } from './mail-quick-reply.component';
import { draftFiles, isReplyMode, replyDraftOf } from './compose-draft';
import { type MailDraftsChangedEvent } from './mail-drafts-changed';
import { DRAFT_GONE_KEPT, ServerDraft } from './server-draft';
import {
    DISCARD_UNDO_MS, MAIL_EDITOR_PROFILE, type ComposeWindowSnapshot, fromChoices, parkedWithDraft, windowRecipients,
    windowTitle, windowsToClose,
} from './compose-windows';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { openMessageSource } from './message-source-viewer.component';
import { attachmentViewKind, openImageAttachment, openPdfAttachment } from './attachment-view';
import { CrumbNamesService } from '../../shell/crumb-names.service';
import {
    LIST_ACTIONS_HANDLED, LIST_TOOLBAR_TREE, MESSAGE_ACTIONS_HANDLED, MESSAGE_TOOLBAR_TREE, handledNodes, messageFacts, moveMenuItems,
    paneActionsOf, ACTIONS_THAT_WAIT, type PendingAction, rowTargetIds, rowWithDetailState, withPending,
} from './message-actions';
import {
    NO_SEND_SENTENCE, PREFILLED_ACTIONS, QUOTE_REFUSED_SENTENCE, addressesOf, forwardFiles, preparingSentence, prefillFailure, quoteFields,
    quotedMessageUnavailable, recipientOptionsOf, unreadableSentence,
    type ComposePrefillState,
} from './compose-prefill';
import { ArchiveFlow, type ArchivedMessage } from './archive';
import { movedText, moveRefusalText, putRowsBack, staysShown, type TakenRow, takeRows } from './mail-at-once';
import { nextOpenAfter } from './mail-open-next';
import { TrashFlow, isTrashFolder, problemOf, trashRetentionText } from './trash';
import { EmailService } from './email.service';
import { applyUnreadDelta } from './folder-fraction.util';
import { INBOX_PATH, inboxFolder, inboxUnread, servedUnread } from './mailbox-unread';
import { flagChangeOf, flagRefusalText, idsOf, type MailFlagRefusedEvent } from './mail-flag-refused';
import { answerSeq, PendingReads } from './mail-pending-reads';
import { type FolderRow, folderRows } from './folder-tree.util';
import { type FolderMenuAsk, MailFolderRailComponent } from './mail-folder-rail.component';
import {
    FOLDER_TOOLBAR_TREE, NO_FLAGS, busyRefusal, emptyRefusalText, folderChangeRefusalText, folderMenuItems, folderNodes,
    isRenumbered, jobFailureText, markReadRefusalText, newFolderNode, offers, withJob, type MailFolderJobEvent,
} from './mail-folder-actions';
import { MailFolderJobs } from './mail-folder-jobs';
import { type FolderPlace, openFolderNameDialog } from './folder-name-dialog.component';
import { draftRequestFromForm, requiredOnStep, usernameFieldsEditable, usernamesForCreate } from './mailbox-wizard.util';
import { MailboxSettingsModal } from './mailbox-settings-modal.service';
import { MailboxSwitcherComponent } from './mailbox-switcher.component';
import { MailboxSyncComponent } from './mailbox-sync.component';
import { MailBulkBarComponent } from './mail-bulk-bar.component';
import { MailHitRowComponent } from './mail-hit-row.component';
import { MailServerSearchComponent, openFailureText, type ServerHitOpened } from './mail-server-search.component';
import {
    MailServerSearch, OtherMailboxesSearch, searchCommits, serverSearchRefusal, type SearchCommit, type SearchKey,
} from './mail-server-search';
import {
    folderListedFromServer, isServerRow, listedFromServer, rowKey, serverRowHit, storedIds, withFirstPageAgain, withOpenedRow,
    withoutServerRow,
} from './mail-server-rows';
import {
    AT_TOP_PX, FIRST_PAGE, type ListEnd, type PageRequest, anchorAt, arrivedAbove, listRowHeight, listSetSize,
    nearListEnd, newRowsOf, nextPageOf, offsetOfAnchor, pageRefusal, rootFontPx,
} from './mail-list-scroll';
import {
    EmailAttachmentDto,
    EmailComposeDto,
    EmailComposeMode,
    EmailComposePartDto,
    EmailDraftAnswers,
    EmailDraftDto,
    EmailDraftWrite,
    EmailFolderDto, EmailFolderTreeNodeDto,
    EmailMailboxDto,
    EmailMessageDetailDto,
    FolderJobAction,
    FolderJobDto,
    EmailMessageDto,
    EmailOAuthProviderDto,
    EmailSearchHitDto,
    InboundWorkflowOption,
    MailboxAuthMethod,
    MailboxKind,
    MailboxSecurity,
    MailboxWriteRequest,
    OutgoingEmailRequest,
    ServerMessageOpenedDto,
    ServerSearchCapability,
    ServerSearchHitDto,
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
    /** Whose the new mailbox is: a person's own, or the organisation's. */
    kind: MailboxKind;
}

/** A saved compose/reply draft -- the composer's restorable state. */
/** The query parameter naming the pane a phone shows: `folders` or `message` (the list when absent). */
const PANE_PARAM = 'pane';
type PhonePane = 'folders' | 'message';

/**
 * The Email mailbox client (`/admin/email`). A three-pane reader over
 * the read/send/reply/folders/seen APIs-):
 *
 *  - LEFT rail: the mailbox card + the folder tree as the server orders and names
 *    it (`GET /email/mailboxes/{id}/folders/tree`), each folder's counts from
 *    `GET /email/mailboxes/{id}/folders`.
 *  - MIDDLE: the selected folder's messages, newest-sent first, loaded page by page
 *    as the list is scrolled. Unread rows are bold; opening one marks it read.
 *  - RIGHT: the opened message -- headers + snippet + a collapsible raw RFC-822
 *    source (the backend stores the raw `.eml`; MIME body extraction is a future
 *    refinement). "Reply" opens the quick reply at the foot of the message;
 *    "Compose", "Reply all" and "Forward" open the composer dock. Both post
 *    through the mailbox's own SMTP (send / reply-in-thread).
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
    imports: [
        MailPanesDirective,
        StateComponent, MailboxSwitcherComponent, MailboxSyncComponent, MailFolderRailComponent,
        FormsModule, CoolmsEditorComponent, EmptyStateComponent, DateTimePipe,
        CmsPageHeaderComponent, PageToolbarComponent, CmsPaneSplitterComponent, CmsPaneToolbarComponent, TagInputComponent,
        ComposeAttachmentsComponent, MailServerSearchComponent, MailHitRowComponent, MailBulkBarComponent, MessageFrameComponent,
        MailQuickReplyComponent, CdkTrapFocus, ComposeAttachButtonComponent, InnerLabelDirective,
        NgTemplateOutlet,
        ScrollingModule,
    ],
    template: `
        <div class="mbx">
            <cms-page-header icon="envelope" [title]="'Email'"
                             [actions]="headerActions()" (actionClick)="onHeaderAction($event)" />

            <!-- Declares nothing: the tree names the page's actions, says which
                 need a mailbox, and says that Import greys out while one is
                 running. The header takes the header's nodes; the bar is not
                 drawn, since the mailbox's own actions sit on its card (the gear)
                 and in its right-click menu. -->
            <app-page-toolbar class="mbx__header-feed"
                [treeSlug]="toolbarTree"
                [context]="toolbarContext()"
                [iconsOnly]="true"
                (headerActionsChanged)="headerActions.set($event)"
                (actionClick)="onHeaderAction($event)" />
            <!-- Always-present hidden file input for the "Import" header action. -->
            <input #importInput type="file" accept=".eml,.mbox,message/rfc822,text/plain" hidden
                   (change)="onImportFileSelected(importInput)" />

            @if (!loadingMailboxes() && mailboxesFailure() === null && mailboxes().length === 0) {
                <div class="mbx__empty-wrap mbx__empty-wrap--col">
                    <app-empty-state icon="envelope"
                                     title="No mailboxes configured"
                                     hint="Add an IMAP/SMTP mailbox to read and send mail from here." />
                    <button type="button" class="mbx__btn mbx__btn--primary" (click)="openCreateMailbox()">
                        <i class="bi bi-plus-lg"></i> Add mailbox
                    </button>
                </div>
            } @else {
                <div class="mbx__body" appMailPanes #panes="appMailPanes" [class.mbx__body--reading]="loadingDetail() || selectedMessage() !== null"
                     [class.mbx__body--folders]="phoneFolders()" [class.mbx__body--one]="onePane()" [class.mbx__body--two]="twoPanes()"
                     [style.--mbx-list-width.px]="panes.layout().list">
                    <!-- LEFT: mailbox picker + folder rail -->
                    <aside class="mbx__rail" #railPane>
                        <!-- On a phone the folders stand in place of the list; Back returns to it unchanged. -->
                        <button type="button" class="mbx__phone-bar" data-test="phone-folders-back" (click)="leavePane('folders')">
                            <i class="bi bi-chevron-left" aria-hidden="true"></i>
                            <span class="mbx__phone-bar-label">Back to {{ selectedFolderName() || 'the list' }}</span>
                        </button>
                        <!-- A failed read of the mailboxes stands in place of the mailbox list (which is then empty),
                             with Retry reading it again. The message pane is not touched. -->
                        @if (mailboxesFailure() !== null) {
                            <cms-state kind="error" title="Could not load mailboxes." [error]="mailboxesFailure()" actionLabel="Retry" (acted)="loadMailboxes()" />
                        }
                        <app-mailbox-switcher [mailboxes]="mailboxes()"
                                              [currentId]="selectedMailboxId()"
                                              [unread]="mailboxUnread()"
                                              [hasSettings]="hasMailboxSettings()"
                                              (chosen)="pickMailbox($event)"
                                              (settings)="openMailboxSettings()"
                                              (menu)="onMailboxContextMenu($event.event, $event.id)" />
                        <app-mail-folder-rail [rows]="railRows()"
                                              [selected]="selectedFolder()"
                                              [failure]="foldersFailure()"
                                              [answered]="folderTree() !== null"
                                              [newFolderLabel]="newFolderLabel()"
                                              (chosen)="selectFolder($event)"
                                              (retry)="retryFolders()"
                                              (menu)="onFolderMenu($event)"
                                              (create)="createTopFolder()"
                                              (need)="panes.foldersNeedIn($event, railPane)" />
                    </aside>

                    <!-- Where folders show beside the list the column is as wide as its widest row needs, at least 200px. -->
                    <cms-pane-splitter class="mbx__split-folders" [minWidth]="panes.foldersMin()" [maxWidth]="panes.layout().foldersMax"
                                       [width]="panes.layout().folders" [ariaLabel]="panes.words.folders"
                                       (widthChange)="panes.resized('folders', $event)" />

                    <!-- MIDDLE: message list (or search results) -->
                    <section class="mbx__list">
                        <!-- On a phone the folders are one press away, above the list they choose. -->
                        <button type="button" class="mbx__phone-bar" data-test="phone-folders"
                                [attr.aria-expanded]="phoneFolders()" (click)="showPane('folders')">
                            <i class="bi bi-folder2" aria-hidden="true"></i>
                            <span class="mbx__phone-bar-label">{{ selectedFolderName() || 'Folders' }}</span>
                            <i class="bi bi-chevron-down" aria-hidden="true"></i>
                        </button>
                        <app-mailbox-sync [mailbox]="selectedMailbox()" [served]="listActions()" (finished)="onSyncFinished($event)" />
                        <div class="mbx__search">
                            <i class="bi bi-search mbx__search-icon"></i>
                            <input type="text" class="mbx__search-input" [(ngModel)]="searchQuery"
                                   placeholder="Search this mailbox…" data-test="mail-search"
                                   (ngModelChange)="onSearchTyped($event)"
                                   (keyup.enter)="onSearchEnter()" />
                            @if (searchActive() || searchQuery) {
                                <button type="button" class="mbx__search-clear" (click)="clearSearch()"
                                        aria-label="Clear search">
                                    <i class="bi bi-x-lg"></i>
                                </button>
                            }
                        </div>

                        <!-- Under the list's row and its search field, the list's one scroll region. -->
                        <!-- The rows are virtualized against this region: only those in view and a few around are drawn. -->
                        <div #listScroll class="mbx__list-scroll" data-test="list-scroll" cdkVirtualScrollingElement tabindex="-1"
                             (scroll)="onListScroll()">
                        @if (listRereading()) {
                            <!-- The same list read again: its rows stay, a thin bar says it is being read. -->
                            <div class="mbx__list-progress" data-test="list-progress" role="progressbar"
                                 aria-label="Refreshing the list"></div>
                        }
                        <!-- Bulk action bar (backlog slice 3): shown once ≥1 message is
                             checked in the folder view; acts on the whole selection. -->
                        @if (!searchActive() && selectedCount() > 0) {
                            <app-mail-bulk-bar #bulkBar [count]="selectedCount()" [actions]="bulkActions()"
                                               (action)="atAction(bulkBar.element, $event); onBulkAction($event)"
                                               (selectAll)="selectAllLoaded()" (clear)="clearSelection()" />
                        }

                        @if (!searchActive() && trashRetention(); as line) {
                            <p class="mbx__note">{{ line }}</p>
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
                                    <!-- Drawn as the server section draws a hit: the two read as one list in two parts. -->
                                    <app-mail-hit-row testId="local-hit" [from]="h.fromName || h.fromAddress" [date]="hitDate(h)"
                                                      [subject]="h.subject" [chips]="localChips(h)" [snippet]="h.snippet"
                                                      [unread]="h.seen === false" [active]="h.id === selectedMessage()?.id"
                                                      (chosen)="openSearchHit(h)" />
                                }
                                <!-- The next page is read as the results are scrolled; this row says how it went. -->
                                <ng-container [ngTemplateOutlet]="listEndRow"
                                              [ngTemplateOutletContext]="{ loading: searchingMore(), end: searchEnd(), retry: retrySearchEnd }" />
                            }
                            <!-- Older mail the open mailbox's server finds, headers only, under the stored results. -->
                            <app-mail-server-search [search]="serverSearch"
                                                    [localIds]="localResultIds()"
                                                    [folderName]="folderNameFn"
                                                    [opener]="openServerHitFn"
                                                    (opened)="onServerHitOpened($event)" />
                            @if (otherMailboxes().length > 0) {
                                @if (otherServerSearches.sections().length === 0) {
                                    <button type="button" class="mbx__others" data-test="server-search-others"
                                            (click)="searchOtherMailboxes()">
                                        <i class="bi bi-search" aria-hidden="true"></i>
                                        Search other mailboxes on the server
                                    </button>
                                } @else {
                                    @for (s of otherServerSearches.sections(); track s.mailboxId) {
                                        <app-mail-server-search [search]="s.search" [heading]="'On the server of ' + s.title"
                                                                [opener]="s.open"
                                                                (opened)="onServerHitOpened($event)" />
                                    }
                                }
                            }
                        } @else if (messagesFailure() !== null) {
                            <!-- A failed read of the folder's messages stands in place of the message list, with
                                 Retry reading it again. The mailbox pane is not touched. -->
                            <cms-state kind="error" title="Could not load messages." [error]="messagesFailure()" actionLabel="Retry" (acted)="retryMessages()" />
                        } @else if (loadingMessages() && messages().length === 0) {
                            <p class="mbx__note">Loading…</p>
                        } @else if (messages().length === 0 && listEnd() === null) {
                            <app-empty-state icon="inbox" title="No messages"
                                             hint="This folder is empty." />
                        } @else {
                            @if (serverRowGone()) {
                                <p class="mbx__note" role="status" data-test="server-row-gone">That message is no longer on the mail server.</p>
                            }
                            @if (newArrivals() > 0) {
                                <!-- New mail heard while scrolled down: the view stays, and this says how many came. -->
                                <div class="mbx__new-wrap">
                                    <button type="button" class="mbx__new-pill" data-test="new-messages" (click)="toListTop()">
                                        New messages: {{ newArrivals() }}
                                    </button>
                                </div>
                            }
                            <!-- Only the rows in view and a small buffer are drawn, each the same height. A server row
                                 (listed by the mail server, stored nowhere here) is keyed by its ref and offers Open
                                 only: no checkbox, no star, no row menu. Their places stay as empty room, so its
                                 sender, subject and date line up with a stored row's. -->
                            <cdk-virtual-scroll-viewport class="mbx__rows" data-test="list-rows" role="list" aria-label="Messages"
                                                         [itemSize]="rowHeight" [minBufferPx]="rowHeight * 4"
                                                         [maxBufferPx]="rowHeight * 8" [style.min-height.px]="messages().length * rowHeight"
                                                         (focusin)="onRowFocusIn($event)" (focusout)="onRowFocusOut($event)">
                                <ng-container *cdkVirtualFor="let m of messages(); trackBy: trackRow; let i = index">
                                @let server = isServerRowOf(m);
                                <div class="mbx__row" role="listitem" (contextmenu)="onMessageRowContextMenu($event, m)"
                                     [style.height.px]="rowHeight"
                                     [attr.aria-posinset]="i + 1" [attr.aria-setsize]="setSize()"
                                     [attr.data-key]="rowKeyOf(m)"
                                     [attr.data-ref]="server ? m.ref : null"
                                     [attr.aria-current]="!server && m.id === selectedMessage()?.id ? 'true' : null"
                                     [class.mbx__row--server]="server"
                                     [class.mbx__row--active]="!server && m.id === selectedMessage()?.id"
                                     [class.mbx__row--unread]="!m.seen"
                                     [class.mbx__row--checked]="!server && isSelected(m.id)">
                                    @if (server) {
                                        <span class="mbx__row-check mbx__row-check--none" aria-hidden="true"></span>
                                    } @else {
                                        <input type="checkbox" class="mbx__row-check" data-part="check"
                                               [checked]="isSelected(m.id)"
                                               (click)="onCheckboxClick(m, $event)"
                                               aria-label="Select message" />
                                    }
                                    <button type="button" class="mbx__row-main" data-part="main" (click)="onRowClick(m, $event)"
                                            [disabled]="server && openingRef() === m.ref">
                                        <div class="mbx__row-top">
                                            <span class="mbx__row-from">{{ m.fromName || m.fromAddress || '(unknown)' }}</span>
                                            <span class="mbx__row-date">{{ m.sentAt | appDateTime }}</span>
                                        </div>
                                        <div class="mbx__row-subject">{{ m.subject || '(no subject)' }}</div>
                                        <div class="mbx__row-snippet">{{ m.snippet }}</div>
                                    </button>
                                    @if (!server) {
                                        <button type="button" class="mbx__row-star" data-part="star"
                                                [class.mbx__row-star--on]="m.flagged"
                                                [title]="m.flagged ? 'Unstar' : 'Star'"
                                                (click)="toggleFlag(m, $event)">
                                            <i class="bi" [class.bi-star-fill]="m.flagged" [class.bi-star]="!m.flagged"></i>
                                        </button>
                                    } @else {
                                        <!-- The star's room, empty and hidden: the date lines up with a stored row's. -->
                                        <span class="mbx__row-star mbx__row-star--none" aria-hidden="true"><i class="bi bi-star"></i></span>
                                    }
                                </div>
                                </ng-container>
                            </cdk-virtual-scroll-viewport>
                            <!-- The list's end: Loading... while the next page is read; a page not read says so here,
                                 with the only Retry. -->
                            <ng-container [ngTemplateOutlet]="listEndRow"
                                          [ngTemplateOutletContext]="{ loading: loadingNextPage(), end: listEnd(), retry: retryListEndFn }" />
                        }
                        <ng-template #listEndRow let-loading="loading" let-end="end" let-retry="retry">
                            @if (end !== null) {
                                <div class="mbx__list-end" role="status" data-test="list-end">
                                    @if (end.kind === 'rate-limited' && end.seconds > 0) {
                                        <span>Retry in {{ end.seconds }} s</span>
                                    } @else {
                                        @if (end.kind === 'failed') {
                                            <span>Couldn't load</span>
                                        }
                                        <button type="button" class="mbx__more" data-test="list-end-retry" (click)="retry()">Retry</button>
                                    }
                                </div>
                            } @else if (loading) {
                                <div class="mbx__list-end" role="status" data-test="list-loading">Loading...</div>
                            }
                        </ng-template>
                        </div>
                    </section>

                    <cms-pane-splitter [minWidth]="panes.limits.list.min" [maxWidth]="panes.layout().listMax"
                                       [width]="panes.layout().list" [ariaLabel]="panes.words.list"
                                       (widthChange)="panes.resized('list', $event)" />

                    <!-- RIGHT: message detail -->
                    <section class="mbx__detail">
                        <!-- On a phone a message fills the screen; Back returns to the list. -->
                        <button type="button" class="mbx__phone-bar" data-test="phone-back" (click)="leavePane('message')">
                            <i class="bi bi-chevron-left" aria-hidden="true"></i>
                            <span class="mbx__phone-bar-label">Back</span>
                        </button>
                        <!-- The open message's actions, the server's tree (navi.toolbar.email.message): a row above the
                             subject, kept empty at its height while no message is open. -->
                        <div #detailRow class="mbx__pane-row" data-test="detail-row">
                            <cms-pane-toolbar [actions]="detailActions()" label="Message actions"
                                              (action)="atAction(detailRow, $event); onDetailAction($event)" />
                        </div>
                        <!-- Under the row, the message pane's one scroll region: header, banner, body, attachments. -->
                        <div class="mbx__detail-scroll" data-test="detail-scroll">
                        @if (loadingDetail()) {
                            <p class="mbx__note">Loading…</p>
                        } @else if (selectedMessage()) {
                            @let msg = selectedMessage()!;
                            @if (openEvicted()) {
                                <!-- A copy opened from the server that is no longer kept: it stays shown, and says so. -->
                                <p class="mbx__evicted" role="status" data-test="reader-evicted">No longer kept here; open it from the server again.</p>
                            }
                            <div class="mbx__detail-head">
                                <h2 class="mbx__detail-subject">{{ msg.subject || '(no subject)' }}</h2>
                                <div class="mbx__detail-meta">
                                    <div><strong>From:</strong> {{ msg.fromName ? msg.fromName + ' · ' : '' }}{{ msg.fromAddress }}</div>
                                    <div><strong>To:</strong> {{ (msg.toAddresses || []).join(', ') }}</div>
                                    <div><strong>Date:</strong> {{ msg.sentAt | appDateTime }}</div>
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
                                    <!-- Sandboxed to same-origin alone, as tall as its document; its links open through the page. -->
                                    <app-message-frame [html]="msg.bodyHtml" [images]="loadRemoteImages()" />
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
                                                            @if (viewKindOf(att) !== null) {
                                                                <button #viewButton type="button" class="mbx__icon-btn" title="View"
                                                                        data-test="attachment-view"
                                                                        [attr.aria-label]="'View ' + att.filename"
                                                                        [disabled]="viewingAttachment() === att.index"
                                                                        (click)="viewAttachment(att, viewButton)">
                                                                    <i class="bi bi-eye" aria-hidden="true"></i>
                                                                </button>
                                                            }
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
                            </div>
                        } @else {
                            <div class="mbx__empty-wrap">
                                <app-empty-state icon="envelope-open"
                                                 title="No message selected"
                                                 hint="Pick a message from the list to read it." />
                            </div>
                        }
                        </div>
                        <!-- The quick reply: pinned at the pane's bottom, outside the message's one scroll region. -->
                        @if (quickReplyFor(); as quick) {
                            <app-mail-quick-reply [mailboxId]="quick.mailboxId" [messageId]="quick.messageId"
                                                  [label]="quick.label" [sender]="quick.sender" [limitBytes]="composeLimit()"
                                                  [windowHolds]="replyWindowHolds()" [windowDrafts]="windowReplyDrafts()"
                                                  (expand)="handReplyToWindow($event)" (showWindow)="showReplyWindow($event)"
                                                  (discarded)="quickReplyDiscarded($event)"
                                                  (sent)="loadFolders()" />
                        }
                    </section>
                </div>
            }

            <!-- The compose windows: the one open at the right, minimized ones as bars to its left. Docked a window is
                 not modal; maximized it is centred over a dimmed backdrop, modal, and keeps the focus. Where one pane
                 shows at a time it is full screen, with Minimize and Close only. -->
            @if (composeOpen() || parkedWindows().length > 0) {
                <div class="mbx__dock" data-testid="compose-dock"
                     [class.mbx__dock--full]="onePane() && composeOpen() && !composeMinimized()">
                    @if (composeOpen() && composeMaximized() && !composeMinimized()) {
                        <div class="mbx__compose-backdrop" data-testid="compose-backdrop" tabindex="-1"
                             (click)="minimizeCompose()" (keydown.escape)="minimizeCompose()"></div>
                    }
                    @for (w of parkedWindows(); track w.id) {
                        <button type="button" class="mbx__compose-bar" data-testid="compose-bar" (click)="activateWindow(w.id)">
                            <span class="mbx__compose-bar-title">{{ titleOf(w.mode, w.subject) }}</span>
                            <span class="mbx__compose-bar-to">{{ recipientsOf(w.to, w.cc) }}</span>
                        </button>
                    }
                    @if (composeOpen()) {
                        <div #composeDock class="mbx__compose mbx__compose--dock" role="dialog" data-testid="compose-window"
                             aria-labelledby="mbx-compose-title"
                             [attr.aria-modal]="composeModal() ? 'true' : 'false'"
                             [class.mbx__compose--min]="composeMinimized()" [class.mbx__compose--max]="composeModal()"
                             [class.mbx__compose--full]="onePane()"
                             [cdkTrapFocus]="composeModal()"
                             (keydown)="onComposeKeydown($event)" (focusin)="touchWindow()">
                            <div class="mbx__compose-head">
                                <button type="button" id="mbx-compose-title" class="mbx__compose-title" data-testid="compose-title"
                                        (click)="toggleMinimize()" [title]="composeMinimized() ? 'Restore' : 'Minimize'">
                                    <span class="mbx__compose-title-text">{{ titleOf(composeMode(), composeSubject) }}</span>
                                    @if (composeMinimized()) {
                                        <span class="mbx__compose-bar-to" data-testid="compose-recipients">{{ recipientsOf(composeTo, composeCc) }}</span>
                                    }
                                </button>
                                <div class="mbx__compose-head-actions">
                                    <button type="button" class="mbx__compose-close" data-testid="compose-minimize" (click)="toggleMinimize()"
                                            [attr.aria-label]="composeMinimized() ? 'Restore' : 'Minimize'"
                                            [title]="composeMinimized() ? 'Restore' : 'Minimize'">
                                        <i class="bi" aria-hidden="true" [class.bi-dash-lg]="!composeMinimized()" [class.bi-chevron-up]="composeMinimized()"></i>
                                    </button>
                                    @if (!composeMinimized() && !onePane()) {
                                        <button type="button" class="mbx__compose-close mbx__compose-maximize" data-testid="compose-maximize"
                                                (click)="toggleMaximize()" [attr.aria-label]="composeMaximized() ? 'Restore' : 'Maximize'"
                                                [title]="composeMaximized() ? 'Restore' : 'Maximize'">
                                            <i class="bi" aria-hidden="true" [class.bi-arrows-angle-expand]="!composeMaximized()"
                                               [class.bi-arrows-angle-contract]="composeMaximized()"></i>
                                        </button>
                                    }
                                    <button type="button" class="mbx__compose-close" data-testid="compose-close" (click)="closeCompose()"
                                            aria-label="Close" title="Close, keeping the draft">
                                        <i class="bi bi-x-lg" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>
                            <ng-container [ngTemplateOutlet]="composeForm" />
                        </div>
                    }
                </div>
            }

            <!-- The composer's fields and its foot. The header fields are compact lines, their labels in one column. -->
            <ng-template #composeForm>
                <div class="mbx__compose-body">
                    @if (composePrefill(); as prefill) {
                        @if (prefill.state === 'loading') {
                            <p class="mbx__compose-state" role="status" data-testid="compose-preparing">
                                <i class="bi bi-hourglass-split" aria-hidden="true"></i>
                                <span>{{ composePreparing() }}</span>
                            </p>
                        } @else if (prefill.state === 'failed') {
                            <div class="mbx__compose-state mbx__compose-state--failed" role="alert" data-testid="compose-prefill-failed">
                                <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
                                <span>{{ prefill.sentence }}</span>
                                @if (prefill.retry) {
                                    <button type="button" class="cms-btn cms-btn-sm" (click)="retryPrefill()">Retry</button>
                                }
                            </div>
                        } @else if (prefill.answer.from.choices.length === 0) {
                            <p class="mbx__compose-note" role="status" data-testid="compose-no-send">{{ noSendSentence }}</p>
                        }
                    }
                    @if (composeFieldsShown()) {
                        <div class="mbx__lines" data-testid="compose-lines">
                            @if (composeFromChoices().length > 0) {
                                <label class="mbx__line">
                                    <span class="mbx__line-label">From</span>
                                    @if (composeMode() === 'compose') {
                                        <select class="mbx__line-field mbx__line-select" data-testid="compose-from" [ngModel]="composeFromValue()"
                                                (ngModelChange)="composeFromChosen.set($event); onComposeChange()">
                                            @for (address of composeFromChoices(); track address) {
                                                <option [value]="address">{{ address }}</option>
                                            }
                                        </select>
                                    } @else {
                                        <!-- An answer goes from the mailbox of the message it answers: shown, not chosen. -->
                                        <input type="text" readonly class="mbx__line-field mbx__line-input" data-testid="compose-from"
                                               [value]="composeFromValue() ?? ''" />
                                    }
                                </label>
                            }
                            <div class="mbx__line">
                                <span class="mbx__line-label" id="mbx-compose-to-label">To</span>
                                <app-tag-input class="mbx__line-field mbx__line-tags" data-testid="compose-to" appInnerLabel="mbx-compose-to-label"
                                                   [(ngModel)]="composeTo" (ngModelChange)="onComposeChange()"
                                                   [options]="recipientOptions()" (queryChange)="onRecipientQuery($event)"
                                                   placeholder="Add people" />
                                @if (!composeCcShown() || !composeBccShown()) {
                                    <span class="mbx__line-links">
                                        @if (!composeCcShown()) {
                                            <button type="button" class="cms-btn cms-btn-link mbx__line-link" data-testid="compose-add-cc"
                                                    aria-label="Add Cc" (click)="askLine('cc')">Cc</button>
                                        }
                                        @if (!composeBccShown()) {
                                            <button type="button" class="cms-btn cms-btn-link mbx__line-link" data-testid="compose-add-bcc"
                                                    aria-label="Add Bcc" (click)="askLine('bcc')">Bcc</button>
                                        }
                                    </span>
                                }
                            </div>
                            @if (composeCcShown()) {
                                <div class="mbx__line">
                                    <span class="mbx__line-label" id="mbx-compose-cc-label">Cc</span>
                                    <app-tag-input class="mbx__line-field mbx__line-tags" data-testid="compose-cc" appInnerLabel="mbx-compose-cc-label"
                                                   [(ngModel)]="composeCc" (ngModelChange)="onComposeChange()"
                                                   [options]="recipientOptions()" (queryChange)="onRecipientQuery($event)"
                                                   placeholder="Add people" />
                                </div>
                            }
                            @if (composeBccShown()) {
                                <div class="mbx__line">
                                    <span class="mbx__line-label" id="mbx-compose-bcc-label">Bcc</span>
                                    <app-tag-input class="mbx__line-field mbx__line-tags" data-testid="compose-bcc" appInnerLabel="mbx-compose-bcc-label"
                                                   [(ngModel)]="composeBcc" (ngModelChange)="onComposeChange()"
                                                   [options]="recipientOptions()" (queryChange)="onRecipientQuery($event)"
                                                   placeholder="Add people" />
                                </div>
                            }
                            <label class="mbx__line">
                                <span class="mbx__line-label">Subject</span>
                                <input type="text" class="mbx__line-field mbx__line-input" data-testid="compose-subject"
                                       [(ngModel)]="composeSubject" (ngModelChange)="onComposeChange()" />
                            </label>
                        </div>
                        <div class="mbx__compose-editor">
                            @if (composeRich()) {
                                <coolms-editor class="mbx__editor"
                                               [profile]="editorProfile"
                                               [content]="composeHtml()"
                                               [mountKey]="composeKey()"
                                               (contentChange)="composeHtml.set($event); onComposeChange()" />
                            } @else {
                                <textarea class="mbx__compose-text" aria-label="Message" [(ngModel)]="composeText"
                                          (ngModelChange)="onComposeChange()" placeholder="Write your message…"></textarea>
                            }
                        </div>
                        @if (composeUnreadable(); as reason) {
                            <p class="mbx__compose-note" data-testid="compose-unreadable">{{ reason }}</p>
                        }
                        @if (composeQuoteRefused()) {
                            <div class="mbx__compose-state mbx__compose-state--failed" role="alert" data-testid="compose-quote-refused">
                                <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
                                <span>{{ quoteRefusedSentence }}</span>
                                <button type="button" class="cms-btn cms-btn-sm" data-testid="compose-send-without-quote"
                                        [disabled]="sending()" (click)="sendWithoutQuote()">Send without the quote</button>
                            </div>
                        }
                        <!-- The quote is read-only, below the editor and never in it: the server appends it on send.
                             Collapsed behind its button until asked for. -->
                        @if (composeQuoteShown()) {
                            <div class="mbx__quote-row">
                                <button type="button" class="mbx__quote-toggle" data-testid="compose-quote-toggle"
                                        aria-label="Show the quoted message" title="Show the quoted message"
                                        aria-controls="mbx-compose-quote"
                                        [attr.aria-expanded]="composeQuoteOpen() ? 'true' : 'false'"
                                        (click)="composeQuoteOpen.set(!composeQuoteOpen())">•••</button>
                                <button type="button" class="cms-btn cms-btn-link mbx__quote-remove" data-testid="compose-remove-quote"
                                        (click)="removeQuote()">Remove quote</button>
                            </div>
                            @if (composeQuoteOpen()) {
                                <figure class="mbx__quote" id="mbx-compose-quote" data-testid="compose-quote-box"
                                        aria-label="The message you are answering, read only">
                                    <figcaption class="mbx__quote-head" data-testid="compose-quote-attribution">{{ composeQuoteAttribution() }}</figcaption>
                                    @if (composeRich() && composeQuoteHtml(); as quoteHtml) {
                                        <app-message-frame class="mbx__quote-frame" data-testid="compose-quote" [html]="quoteHtml"
                                                           label="The message quoted below yours" />
                                    } @else {
                                        <pre class="mbx__body-text mbx__quote-text" data-testid="compose-quote-text">{{ composeQuoteText() }}</pre>
                                    }
                                </figure>
                            }
                        }
                        @if (forwardFilesKept().length > 0) {
                            <ul class="mbx__fwd-files" data-testid="compose-forward-files" aria-label="Files of the forwarded message">
                                @for (file of forwardFilesKept(); track file.part) {
                                    <li class="mbx__fwd-file">
                                        <i class="bi bi-paperclip" aria-hidden="true"></i>
                                        <span class="mbx__fwd-file-name">{{ file.name ?? 'Attachment' }}</span>
                                        @if (file.sizeBytes !== null) {
                                            <span class="mbx__attachment-size">{{ humanSize(file.sizeBytes) }}</span>
                                        }
                                        <button type="button" class="mbx__icon-btn" [attr.aria-label]="'Remove ' + (file.name ?? 'attachment')"
                                                (click)="removeForwardFile(file.part)">
                                            <i class="bi bi-x-lg" aria-hidden="true"></i>
                                        </button>
                                    </li>
                                }
                            </ul>
                        }
                    }
                    <!-- The files and the size meter, once there are files; the foot's attach button adds them. -->
                    <app-compose-attachments #composeFiles class="mbx__compose-files" [button]="false"
                                             [mailboxId]="selectedMailboxId() ?? ''"
                                             [limitBytes]="composeLimit()"
                                             [bodyBytes]="composeBodyBytes()"
                                             [sendRefused]="composeSendRefused()"
                                             [(attachments)]="composeAttachments"
                                             (changed)="onComposeChange()" />
                </div>
                <div class="mbx__compose-foot mbx__compose-foot--bar">
                    @if (composeMaySend()) {
                        <button type="button" class="cms-btn cms-btn-primary mbx__compose-send" data-testid="compose-send"
                                title="Send (Ctrl+Enter)" [disabled]="sending()" (click)="sendCompose()">
                            {{ sending() ? 'Sending…' : 'Send' }}
                        </button>
                    }
                    @if (composeFieldsShown() && selectedMailboxId() !== null) {
                        <app-compose-attach-button class="mbx__compose-attach" [target]="composeFiles" />
                    }
                    <span class="mbx__compose-saved">
                        @if (draftSavedAt(); as savedAt) {
                            <span class="mbx__draft-badge" data-testid="compose-draft-saved">Saved {{ savedAt | appDateTime }}</span>
                        }
                    </span>
                    <div class="mbx__opts" (focusout)="onMoreFocusOut($event)" (keydown.escape)="closeMore($event)">
                        <button type="button" class="cms-btn cms-btn-ghost mbx__foot-icon" data-testid="compose-more"
                                aria-label="More options" title="More options" aria-haspopup="menu"
                                [attr.aria-expanded]="composeMoreOpen() ? 'true' : 'false'"
                                (click)="composeMoreOpen.set(!composeMoreOpen())">
                            <i class="bi bi-three-dots" aria-hidden="true"></i>
                        </button>
                        @if (composeMoreOpen()) {
                            <div class="mbx__opts-menu" role="menu" aria-label="More options" data-testid="compose-more-menu">
                                <button type="button" role="menuitemcheckbox" class="mbx__opts-item" data-testid="compose-plain-text"
                                        [attr.aria-checked]="composeRich() ? 'false' : 'true'" (click)="choosePlainText()">
                                    <i class="bi" aria-hidden="true" [class.bi-check-square]="!composeRich()" [class.bi-square]="composeRich()"></i>
                                    Plain text
                                </button>
                            </div>
                        }
                    </div>
                    <button type="button" class="cms-btn cms-btn-ghost mbx__foot-icon" data-testid="compose-discard"
                            aria-label="Discard draft" title="Discard draft" (click)="discardDraft()">
                        <i class="bi bi-trash" aria-hidden="true"></i>
                    </button>
                </div>
            </ng-template>

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
                                    <span>Whose mailbox</span>
                                    <select [(ngModel)]="mbForm.kind" name="kind">
                                        <option value="personal">Personal (yours)</option>
                                        <option value="shared">Shared (the organisation's)</option>
                                    </select>
                                    <small class="mbx__field-hint">
                                        When the account that connects it is deleted, a personal mailbox is erased with
                                        it, its mail included; a shared one is kept, to be connected again. Only a shared
                                        mailbox can send the system's mail.
                                    </small>
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
        /* The page's own spacing between the section header and the grid: the content inset the shell keeps above
           the header. */
        .mbx__body { flex: 1; display: flex; min-height: 0; margin-top: var(--cms-content-padding); }
        .mbx__phone-bar {
            display: none; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 0 12px;
            border: 0; border-bottom: 1px solid var(--cms-border); background: transparent; color: var(--cms-text);
            font: inherit; text-align: left; cursor: pointer;
        }
        .mbx__phone-bar-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        /* One pane at a time (a phone, or a grid too narrow for the list and the message): the list; the folders when
           asked for; a message once one is opened. The pane shown fills the grid over the width a splitter wrote on it
           inline (the person's saved width), as the two-pane rule does. */
        .mbx__body--one .mbx__rail, .mbx__body--one .mbx__list, .mbx__body--one .mbx__detail, .mbx__body--one > cms-pane-splitter { display: none; }
        .mbx__body--one.mbx__body--folders .mbx__rail { display: flex; width: 100% !important; flex: 1 1 auto !important; }
        .mbx__body--one:not(.mbx__body--folders):not(.mbx__body--reading) .mbx__list {
            display: flex; width: 100% !important; flex: 1 1 auto !important; border-right: 0;
        }
        .mbx__body--one.mbx__body--reading:not(.mbx__body--folders) .mbx__detail { display: flex; padding: 0 12px; }
        .mbx__body--one .mbx__detail .mbx__detail-scroll { margin: 0 -12px; padding: 0 12px 8px; }
        .mbx__body--one .mbx__phone-bar { display: flex; }
        .mbx__body--one .mbx__detail .mbx__phone-bar { margin: 0 -12px; width: calc(100% + 24px); }
        .mbx__body--one .mbx__detail .mbx__pane-row { margin: 0 -12px 8px; padding: 0 12px; }
        .mbx__body--one .mbx__rail .mbx__phone-bar, .mbx__body--two .mbx__rail .mbx__phone-bar {
            margin: 0 calc(-1 * var(--cms-panel-padding)) 4px calc(-1 * var(--cms-content-padding));
            width: calc(100% + var(--cms-panel-padding) + var(--cms-content-padding));
        }
        .mbx__body--one .mbx__detail .mbx__thread-item { grid-template-columns: minmax(0, 1fr) auto; }
        .mbx__body--one .mbx__detail .mbx__thread-subject { grid-column: 1 / -1; grid-row: 2; }
        /* Two panes, where the three minimums do not fit: the list and the message. The folders are one press away,
           standing in the list's place at the list's width until one is chosen, so the message keeps its minimum. */
        .mbx__body--two .mbx__rail, .mbx__body--two > .mbx__split-folders { display: none; }
        .mbx__body--two .mbx__list > .mbx__phone-bar, .mbx__body--two .mbx__rail > .mbx__phone-bar { display: flex; }
        .mbx__body--two.mbx__body--folders .mbx__list, .mbx__body--two.mbx__body--folders > cms-pane-splitter { display: none; }
        .mbx__body--two.mbx__body--folders .mbx__rail {
            display: flex; flex: 0 0 var(--mbx-list-width) !important; width: var(--mbx-list-width) !important;
            border-right: 1px solid var(--cms-border);
        }

        /* Feeds the page header only: the bar's nodes are drawn on the mailbox's card and in its menu. */
        .mbx__header-feed { display: none; }

        /* Starts at the panes' top, its first element level with their rows, and its content at the page header's
           content edge. */
        .mbx__rail {
            width: 230px; flex: 0 0 230px; min-width: 200px;
            padding: 0 var(--cms-panel-padding) var(--cms-panel-padding) var(--cms-content-padding);
            overflow-y: auto; display: flex; flex-direction: column; gap: 8px;
        }
        .mbx__note { color: var(--cms-text-muted); font-size: .8125rem; padding: 12px; }

        /* The row and the search field stay; under them, one scroll region. */
        .mbx__list {
            width: 340px; flex: 0 0 340px; border-right: 1px solid var(--cms-border);
            overflow: hidden; display: flex; flex-direction: column;
        }
        .mbx__list-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
        /* Over the top of the rows, taking no room: the rows do not move when it comes and goes. */
        .mbx__list-progress {
            position: sticky; top: 0; z-index: 2; flex: 0 0 auto; height: 2px; margin-bottom: -2px;
            overflow: hidden; background: color-mix(in srgb, var(--cms-accent) 20%, transparent);
        }
        .mbx__list-progress::after {
            content: ''; position: absolute; inset: 0 auto 0 0; width: 30%;
            background: var(--cms-accent); animation: mbx-list-progress 1.1s ease-in-out infinite;
        }
        @keyframes mbx-list-progress { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
        @media (prefers-reduced-motion: reduce) {
            .mbx__list-progress::after { animation: none; width: 100%; }
        }
        /* The rows' viewport: as tall as every row together; the region around it scrolls. */
        .mbx__rows { flex: 0 0 auto; }
        /* The rows' wrapper (the virtual scroll's own, absolutely placed) held to the viewport's width: left to size
           itself, it grows to its widest row's one-line text, and each row with it. */
        .mbx__rows ::ng-deep .cdk-virtual-scroll-content-wrapper { right: 0; }
        /* Every row the same height (set from the three lines it holds), so the list is drawn by arithmetic. */
        .mbx__row {
            display: flex; align-items: flex-start; gap: 8px; width: 100%; box-sizing: border-box; overflow: hidden;
            padding: 10px 12px; border-bottom: 1px solid var(--cms-border);
            background: transparent; color: var(--cms-text);
        }
        .mbx__row-from, .mbx__row-subject, .mbx__row-snippet { line-height: 1.5; min-height: 1.5em; }
        /* Over the rows' top, taking no room: the rows do not move when it comes and goes. */
        .mbx__new-wrap {
            position: sticky; top: 0; z-index: 3; flex: 0 0 auto; height: 0; overflow: visible;
            display: flex; justify-content: center;
        }
        .mbx__new-pill {
            margin-top: 8px; padding: 4px 12px; border: 0; border-radius: 999px; cursor: pointer; white-space: nowrap;
            background: var(--cms-accent); color: var(--cms-accent-contrast); font: inherit; font-size: .8125rem;
            box-shadow: var(--cms-shadow-sm); height: fit-content;
        }
        .mbx__new-pill:focus-visible { outline: 2px solid var(--cms-focus-ring); outline-offset: 2px; }
        .mbx__row:hover { background: var(--cms-surface-hover); }
        .mbx__row--active { background: var(--cms-selected-light); }
        .mbx__row--checked { background: var(--cms-selected-light); }
        .mbx__row-check { margin: 3px 0 0; width: 15px; height: 15px; flex: 0 0 auto; cursor: pointer; accent-color: var(--cms-accent, #F5A623); }
        /* A server row's empty room where a stored row has its checkbox: the same width, nothing in it. */
        .mbx__row-check--none { display: block; cursor: default; }
        .mbx__list-end {
            display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
            padding: 12px 12px 0; color: var(--cms-text-muted); font-size: .8125rem;
        }
        .mbx__list-end .mbx__more { margin: 0 0 10px; }
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
        .mbx__row-star--none { visibility: hidden; cursor: default; }
        .mbx__row--unread .mbx__row-from, .mbx__row--unread .mbx__row-subject { font-weight: 700; }
        .mbx__row-top { display: flex; justify-content: space-between; gap: 8px; }
        .mbx__row-from { font-size: .875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mbx__row-date { color: var(--cms-text-muted); font-size: .75rem; flex: 0 0 auto; }
        .mbx__row-subject { font-size: .8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mbx__row-snippet { color: var(--cms-text-muted); font-size: .75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mbx__more { margin: 10px; padding: 8px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius, 6px); background: var(--cms-surface); cursor: pointer; color: var(--cms-text); }
        .mbx__others {
            display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; text-align: left;
            border: 0; border-top: 1px solid var(--cms-border); border-bottom: 1px solid var(--cms-border);
            background: transparent; color: var(--cms-accent-text); font: inherit; font-size: .8125rem; cursor: pointer;
        }
        .mbx__others:hover { background: var(--cms-surface-hover); }

        .mbx__search {
            display: flex; align-items: center; gap: 6px; padding: 8px 10px;
            border-bottom: 1px solid var(--cms-border); flex: 0 0 auto;
            background: var(--cms-surface);
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

        /* The row stays at the top; under it, the message pane's one scroll region. */
        .mbx__detail { flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: 0 20px; min-width: 0; }
        .mbx__detail > .mbx__phone-bar, .mbx__detail > .mbx__pane-row { flex: 0 0 auto; }
        .mbx__detail-scroll {
            flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0 -20px; padding: 0 20px 16px;
            display: flex; flex-direction: column;
            /* Room for the scrollbar always: the message frame growing never narrows the pane, nor rewraps itself. */
            scrollbar-gutter: stable;
        }
        .mbx__detail-scroll > * { flex-shrink: 0; }
        /* The message pane's row of actions, at the pane's top, above the subject. */
        .mbx__pane-row { margin: 0 -20px 12px; padding: 0 20px; border-bottom: 1px solid var(--cms-border); }
        .mbx__evicted {
            margin: 0 0 12px; padding: 8px 10px; border: 1px solid var(--cms-warning-subtle-border);
            border-radius: var(--cms-radius-md); background: var(--cms-warning-subtle); color: var(--cms-warning-text);
            font-size: .8125rem;
        }
        .mbx__detail-head { border-bottom: 1px solid var(--cms-border); padding-bottom: 12px; margin-bottom: 12px; }
        .mbx__detail-subject { margin: 0 0 8px; font-size: 1.125rem; }
        .mbx__detail-meta { display: flex; flex-direction: column; gap: 2px; font-size: .8125rem; color: var(--cms-text-secondary); }
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

        /* Rendered message body (sandboxed iframe) + its remote-image gate. */
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
        /* A prepared composer: while it is read, why it could not be, and what it says of the original or of Send. */
        .mbx__compose-state {
            display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0;
            font-size: .8125rem; color: var(--cms-text-secondary);
        }
        .mbx__compose-state--failed {
            padding: 8px 10px; border: 1px solid var(--cms-danger-subtle-border); border-radius: var(--cms-radius-md);
            background: var(--cms-danger-subtle); color: var(--cms-danger-text);
        }
        .mbx__compose-note {
            margin: 0; padding: 8px 10px; border: 1px solid var(--cms-warning-subtle-border);
            border-radius: var(--cms-radius-md); background: var(--cms-warning-subtle); color: var(--cms-warning-text);
            font-size: .8125rem;
        }
        /* The quoted original below the person's own text: collapsed behind its button, opened in a framed box at
           most about 320 px tall that scrolls inside, under its attribution line. */
        .mbx__quote-row { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; }
        .mbx__quote-toggle {
            height: 24px; padding: 0 10px; border: 1px solid var(--cms-border-control); border-radius: var(--cms-radius-pill);
            background: var(--cms-surface-muted); color: var(--cms-text-secondary); font: inherit; line-height: 1; cursor: pointer;
        }
        .mbx__quote-toggle:hover { background: var(--cms-surface-hover); color: var(--cms-text); }
        .mbx__quote-toggle[aria-expanded="true"] {
            border-color: var(--cms-selected-text); background: var(--cms-selected-light); color: var(--cms-selected-text);
        }
        .mbx__quote-toggle:focus-visible { outline: 2px solid var(--cms-focus-ring); outline-offset: 2px; }
        .mbx__quote-remove { font-size: .8125rem; }
        .mbx__quote {
            flex: 0 1 auto; min-height: 0; max-height: 320px; overflow: auto; margin: 0;
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md); background: var(--cms-surface);
        }
        .mbx__quote-head {
            padding: 8px 12px; border-bottom: 1px solid var(--cms-border-light);
            color: var(--cms-text-muted); font-size: .75rem; text-align: start;
        }
        .mbx__quote-frame { padding: 4px 12px 8px; }
        .mbx__quote .mbx__quote-text { margin: 0; padding: 8px 12px; border: 0; border-radius: 0; background: transparent; }
        .mbx__fwd-files { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
        .mbx__fwd-file {
            display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 8px;
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md); font-size: .8125rem;
        }
        .mbx__fwd-file-name { overflow-wrap: anywhere; }
        .mbx__compose-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--cms-border); }

        /* Composer dock: floats bottom-right, does NOT block the mailbox, and
         * collapses to just its header bar when minimized (body + foot hidden, form kept). */
        .mbx__dock { position: fixed; right: 24px; bottom: 0; z-index: 50; display: flex; align-items: flex-end; gap: 8px; }
        .mbx__compose-bar {
            display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 220px; min-width: 0;
            padding: 8px 12px; border: 1px solid var(--cms-border); border-bottom: 0; border-radius: 10px 10px 0 0;
            background: var(--cms-surface); color: inherit; font: inherit; text-align: left; cursor: pointer;
            box-shadow: var(--cms-shadow-md);
        }
        .mbx__compose-bar-title { font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mbx__compose-bar-to {
            display: block; max-width: 100%; color: var(--cms-text-muted); font-size: .75rem; font-weight: 400;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mbx__compose-title-text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        /* Maximized: centred over a dimmed backdrop that minimizes it on a click. */
        .mbx__compose-backdrop { position: fixed; inset: 0; z-index: 0; background: var(--cms-overlay-scrim); }
        .mbx__compose--dock.mbx__compose--max {
            position: fixed; z-index: 1; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: min(960px, calc(100vw - 48px)); height: min(86vh, 900px); max-height: none; max-width: none;
            border-radius: var(--cms-radius-lg, 10px);
        }
        .mbx__compose--max .mbx__compose-body { flex: 1 1 auto; }
        /* Where one pane shows at a time, compose is full screen, never docked. */
        @media (max-width: 599.98px) {
            .mbx__dock { left: 0; right: 0; justify-content: flex-end; flex-wrap: wrap; }
            .mbx__compose--dock:not(.mbx__compose--min),
            .mbx__compose--dock.mbx__compose--max {
                position: fixed; inset: 0; z-index: 1; transform: none; width: 100%; height: 100%;
                max-width: none; max-height: none; border-radius: 0;
            }
            .mbx__compose-bar { width: auto; flex: 1 1 140px; }
        }
        /* Docked: 600 px wide (560 to 640 as the screen allows) and at most about 70% of the viewport tall. */
        .mbx__compose--dock {
            width: 600px; min-width: min(560px, calc(100vw - 48px)); max-width: min(640px, calc(100vw - 48px));
            height: 70vh; max-height: 70vh;
            border-radius: 10px 10px 0 0; box-shadow: var(--cms-shadow-lg);
        }
        .mbx__compose--dock.mbx__compose--min { height: auto; }
        .mbx__compose--dock .mbx__compose-head { padding: 4px 4px 4px 16px; min-height: 44px; }
        .mbx__compose--dock .mbx__compose-close {
            display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0;
            border-radius: var(--cms-radius);
        }
        .mbx__compose--dock .mbx__compose-close:hover { background: var(--cms-surface-hover); color: var(--cms-text); }
        .mbx__compose--dock .mbx__compose-close:focus-visible { outline: 2px solid var(--cms-focus-ring); outline-offset: -2px; }
        /* The body: the lines, then the editor taking what height is left, then the quote and the files. */
        .mbx__compose--dock .mbx__compose-body { flex: 1 1 auto; min-height: 0; padding: 0 16px 12px; gap: 10px; }
        /* The header fields: compact lines, each about 40 px with its label inside at the start and a thin divider
           below; the labels in one column as wide as the longest (at least 52 px). */
        .mbx__lines {
            flex: 0 0 auto; display: grid; grid-template-columns: minmax(52px, max-content) minmax(0, 1fr) max-content;
            column-gap: 12px; font-size: .875rem;
        }
        .mbx__line {
            grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center;
            min-height: 40px; margin: 0; border-bottom: 1px solid var(--cms-border);
        }
        .mbx__line-label { grid-column: 1; color: var(--cms-text-secondary); white-space: nowrap; }
        .mbx__line-field { grid-column: 2 / -1; min-width: 0; }
        /* A long address chip wraps inside its line and never runs under the Cc and Bcc links. */
        .mbx__line-tags { overflow: hidden; }
        .mbx__line-tags ::ng-deep .tagin-chip { max-width: 100%; overflow-wrap: anywhere; }
        .mbx__line:has(.mbx__line-links) .mbx__line-field { grid-column: 2; }
        .mbx__line-links { grid-column: 3; display: flex; align-items: center; gap: 10px; }
        .mbx__line-link { padding-top: 0; padding-bottom: 0; }
        .mbx__line-input, .mbx__line-select {
            height: 38px; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--cms-text); font: inherit;
        }
        .mbx__line-input:focus, .mbx__line-select:focus { /* ring: on the line, .mbx__line:focus-within */ outline: none; box-shadow: none; }
        .mbx__line:focus-within { border-bottom-color: var(--cms-focus-ring); box-shadow: 0 1px 0 0 var(--cms-focus-ring); }
        .mbx__line-input[readonly] { color: var(--cms-text-secondary); }
        /* The address chip field drawn as a line: its own box gives way to the line's divider. */
        .mbx__line-tags ::ng-deep .tagin-wrap { border: 0; border-radius: 0; background: transparent; padding: 4px 0; min-height: 38px; }
        .mbx__line-tags ::ng-deep .tagin-wrap:focus-within { /* ring: on the line, .mbx__line:focus-within */ box-shadow: none; }
        .mbx__compose-editor { flex: 1 1 auto; min-height: 120px; display: flex; flex-direction: column; }
        .mbx__compose-editor .mbx__editor { flex: 1 1 auto; min-height: 0; }
        .mbx__compose-text {
            flex: 1 1 auto; min-height: 0; width: 100%; resize: none; padding: 10px 12px;
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius);
            background: var(--cms-input-bg); color: var(--cms-text); font: inherit; line-height: 1.55;
        }
        .mbx__compose-files { flex: 0 0 auto; }
        /* The foot: Send, attach, the saved state, then More options and Discard. */
        .mbx__compose-foot--bar { justify-content: flex-start; align-items: center; gap: 6px; padding: 10px 10px 10px 16px; min-height: 56px; }
        .mbx__compose-send { height: 36px; padding: 0 20px; font-weight: 600; }
        .mbx__compose-saved { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mbx__compose-saved .mbx__draft-badge { font-size: .75rem; }
        .mbx__foot-icon { justify-content: center; width: 36px; height: 36px; padding: 0; }
        .mbx__foot-icon .bi { font-size: 1.05rem; }
        .mbx__opts { position: relative; display: inline-flex; }
        .mbx__opts-menu {
            position: absolute; right: 0; bottom: calc(100% + 4px); z-index: 5; min-width: 220px; padding: 4px;
            display: flex; flex-direction: column; background: var(--cms-surface); border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius); box-shadow: var(--cms-shadow-md);
        }
        .mbx__opts-item {
            display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 0 12px; border: 0;
            border-radius: var(--cms-radius-sm); background: none; color: var(--cms-text); font: inherit; text-align: start; cursor: pointer;
        }
        .mbx__opts-item:hover, .mbx__opts-item:focus-visible { background: var(--cms-bg-hover); }
        /* Full screen it is above the admin's own bars too. */
        .mbx__dock--full { z-index: 200; }
        /* Where one pane shows at a time: full screen, Minimize and Close only, each at least 44 px; so is the foot. */
        .mbx__compose--full:not(.mbx__compose--min) {
            position: fixed; inset: 0; z-index: 1; transform: none; width: 100%; height: 100%; min-width: 0;
            max-width: none; max-height: none; border-radius: 0;
        }
        .mbx__compose--full .mbx__compose-close,
        .mbx__compose--full .mbx__foot-icon,
        .mbx__compose--full .mbx__compose-send,
        .mbx__compose--full .mbx__line-link {
            min-width: var(--cms-touch-target-min); min-height: var(--cms-touch-target-min);
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
    private readonly confirmDialog = inject(ConfirmDialogService);
    private readonly contacts = inject(ContactsService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly emailLive = inject(EmailLiveEventsService);
    /**
     * Applies each mail change by seq (a late or repeated event changes nothing), and reads the open folder's list
     * again, once per burst, when messages arrive in it from another tab, device or a restore.
     */
    private readonly mailFollower = new MailLiveFollower(() => this.rereadFirstPage());
    /**
     * The read state the person chose (Mark read, Mark unread, and the read an open makes) while its write is on its
     * way: what was read or sent before the write answered keeps the person's value; after it, the server's word is
     * final (mail-pending-reads).
     */
    private readonly pendingReads = new PendingReads();
    /** The notice that said a star change was made, per message, replaced if the server refuses the change. */
    private readonly flagNotices = new Map<string, number>();
    private readonly mailPrefs = inject(MailPreferencesService);
    private readonly store = inject(Store);
    private readonly route = inject(ActivatedRoute);
    private readonly naviGraph = inject(NaviGraphService);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly crumbs = inject(CrumbNamesService);
    private readonly dialog = inject(Dialog);
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
    readonly selectedMailbox = computed(() => this.mailboxes().find(m => m.id === this.selectedMailboxId()) ?? null);
    private readonly syncBar = viewChild(MailboxSyncComponent);
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


    /** Per-message opt-in to load the remote images the server flagged; reset on open. */
    readonly loadRemoteImages = signal(false);


    /**
     * localStorage key for the last-selected mailbox, so a reload restores it instead
     * of snapping to the first mailbox. Per-browser UI state -- sits beside the list-pane
     * width (`coolms.email.listWidth`, cached by `MailPanesDirective`) in the same store.
     */
    private static readonly LAST_MAILBOX_KEY = 'coolms.email.lastMailboxId';


    readonly mailboxes = signal<EmailMailboxDto[]>([]);
    readonly selectedMailboxId = signal<string | null>(null);
    /** Per-mailbox unread number (mailboxId -> its inbox's unread, never a sum of folders), for the switcher. */
    readonly mailboxUnread = signal<Record<string, number>>({});
    /** The mailboxes whose number the mailbox list serves: a folder read does not replace it. */
    private readonly unreadServed = new Set<string>();
    /** Each mailbox's inbox path, learned from its folders, for a change event's counts. */
    private readonly inboxes = signal<Record<string, string>>({});
    readonly folders = signal<EmailFolderDto[]>([]);
    readonly selectedFolder = signal<string>('INBOX');
    readonly messages = signal<EmailMessageDto[]>([]);
    /** In Trash, when the mail server empties it -- only where that is known for the mailbox's provider. */
    readonly trashRetention = computed(() => isTrashFolder(this.selectedFolder())
        ? trashRetentionText(this.mailboxes().find(m => m.id === this.selectedMailboxId())?.trashRetentionDays)
        : null);
    readonly selectedMessage = signal<EmailMessageDetailDto | null>(null);

    /** On a phone, the folders stand in place of the list until one is chosen. */
    readonly phoneFolders = signal(false);

    /** The mailbox's folders as the server nests, orders and names them; null until it answers or when it failed. */
    readonly folderTree = signal<EmailFolderTreeNodeDto[] | null>(null);
    /** Why the tree could not be read: the rail shows it with Retry, and no rows. */
    readonly foldersFailure = signal<unknown>(null);
    /** The rail's rows: the server's tree, its counts as they stand now. */
    readonly folderRows = computed(() => folderRows(this.folderTree() ?? [], this.folders()));
    /** Whether the person may make a top-level folder, as the tree says; false until it answers. */
    readonly canCreateTop = signal(false);
    /** The folder action tree's nodes (navi.toolbar.email.folder); empty while the server serves none. */
    readonly folderActionNodes = signal<NaviGraphNode[]>([]);
    /**
     * The folder jobs started here (Mark all as read): a folder is busy with its job from the server's 202 to its end,
     * told by mail.folders.job, or read over REST while realtime is down.
     */
    readonly folderJobs = new MailFolderJobs({
        start: (mailboxId, folder) => this.email.markFolderRead(mailboxId, folder),
        empty: (mailboxId, folder, uidCeiling, uidValidity) => this.email.emptyFolder(mailboxId, folder, uidCeiling, uidValidity),
        read: (mailboxId, jobId) => this.email.folderJob(mailboxId, jobId),
        realtime: () => this.emailLive.connected(),
        reconnects: () => this.emailLive.reconnects(),
        ended: (job, mine) => this.folderJobEnded(job, mine),
        lost: job => this.foldersChangedIn(job.mailboxId),
        refused: (err, mailboxId, folder, action) => this.folderJobRefused(err, mailboxId, folder, action),
    });
    /** The rail's rows: the tree's, each busy with a job this page started on it, offering nothing while it is. */
    readonly railRows = computed<FolderRow[]>(() => {
        const mailboxId = this.selectedMailboxId();
        this.folderJobs.running();
        return this.folderRows().map(row => ({
            ...row,
            flags: withJob(row.flags ?? NO_FLAGS, this.folderJobs.busyIn(mailboxId, row.folder.folder)),
        }));
    });
    /** New folder at the foot of the list: its label when the tree offers a top-level folder, else null. */
    readonly newFolderLabel = computed<string | null>(() => {
        if (!this.canCreateTop()) {
            return null;
        }
        const node = newFolderNode(folderNodes(this.folderActionNodes()));
        return node !== null && this.naviGraph.isVisible(node, { _canCreateTop: true }) ? node.title : null;
    });
    /** The selected folder's name, as the server gives it; empty until the tree names it. */
    readonly selectedFolderName = computed(() => {
        const path = this.selectedFolder();

        return this.folderRows().find(row => row.folder.folder === path)?.name ?? '';
    });
    /** The server offers this person the mailbox's settings. */
    readonly hasMailboxSettings = computed(() => this.toolbarNodes().some(n => 'mailbox-settings' === n.meta['action']));

    private readonly location = inject(Location);
    /** A phone's width: the page shows one pane at a time. */
    private readonly phoneWidth = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 599.98px)') : null;
    /** The window is at a phone's width now. */
    private readonly phone = signal(this.phoneWidth?.matches === true);
    /** The mail grid's panes, measured on the grid itself. */
    private readonly gridPanes = viewChild(MailPanesDirective);
    /** One pane at a time, on a phone or in a grid too narrow for the list and the message; the pane shown is then in the address. */
    readonly onePane = computed(() => this.phone() || this.gridPanes()?.count() === 1);
    /** The list and the message side by side; the folders stand in the list's place when asked for. */
    readonly twoPanes = computed(() => !this.onePane() && this.gridPanes()?.count() === 2);
    /** The pane the address names now, and whether this page added that entry to the history (so Back can return). */
    private paneInAddress: PhonePane | null = null;
    private addedPaneEntry = false;

    /**
     * The address leads: a pane leaving it (the browser's Back, or the page's own) is closed; `?pane=folders` opens
     * the folders. A message pane named on a load with no message open (a reload, a shared link) is dropped from the
     * address. Called from the constructor: the query replays at once on subscribe, so every field it reads must be set.
     */
    private followPane(query: ParamMap): void {
        const named = query.get(PANE_PARAM);
        const was = this.paneInAddress;
        this.paneInAddress = named === 'folders' || named === 'message' ? named : null;
        if (this.paneInAddress === null) this.addedPaneEntry = false;
        if (was === 'folders' && this.paneInAddress !== 'folders') this.phoneFolders.set(false);
        if (was === 'message' && this.paneInAddress !== 'message') this.closeMessage();
        if (this.paneInAddress === 'folders') this.phoneFolders.set(true);
        if (this.paneInAddress === 'message' && was !== 'message' && this.selectedMessage() === null && !this.loadingDetail()) {
            this.dropPane();
        }
    }

    /** Shows a pane on a phone, as an entry of its own in the history; the list to message step from the folders replaces. */
    showPane(pane: PhonePane): void {
        if (pane === 'folders') this.phoneFolders.set(true);
        if (!this.onePane() || this.paneInAddress === pane) return;
        const replace = this.paneInAddress !== null;
        void this.router.navigate([], {
            relativeTo: this.route, queryParams: { [PANE_PARAM]: pane }, queryParamsHandling: 'merge', replaceUrl: replace,
        });
        if (!replace) this.addedPaneEntry = true;
    }

    /** The page's own Back: the history's when this page added the entry, so the browser's Back then agrees. */
    leavePane(pane: PhonePane): void {
        if (this.paneInAddress !== pane) {
            if (pane === 'folders') this.phoneFolders.set(false); else this.closeMessage();
            return;
        }
        if (this.addedPaneEntry) {
            this.addedPaneEntry = false;
            this.location.back();
            return;
        }
        this.dropPane();
    }

    private dropPane(): void {
        void this.router.navigate([], {
            relativeTo: this.route, queryParams: { [PANE_PARAM]: null }, queryParamsHandling: 'merge', replaceUrl: true,
        });
    }
    readonly hasMore = signal<boolean>(false);
    /**
     * The open folder is listed from the mail server (not fully synced): its rows are in the server's order and its
     * total is the server's. Learned from the folder's first page. Any folder's pages may carry server rows: an inbox's
     * cursor runs on past its stored rows into the server's older mail.
     */
    readonly serverListed = signal<boolean>(false);
    /** What the list's end says beyond its rows: a page could not be read, or the server asked to wait. */
    readonly listEnd = signal<ListEnd | null>(null);
    /** A next page is being read: the Loading... row stands at the list's end. */
    readonly loadingNextPage = signal<boolean>(false);
    /** New mail heard in real time while the person was scrolled down: the pill says how many. */
    readonly newArrivals = signal<number>(0);
    /** Every row's height in px: fixed, from the three lines a row holds at the root font size. */
    readonly rowHeight = listRowHeight(rootFontPx());
    /** Each row's aria-setsize: the open folder's total from the folder tree, or -1 when it is not known. */
    readonly setSize = computed(() => {
        const row = this.folderRows().find(r => r.folder.folder === this.selectedFolder());
        const total = this.serverListed() ? row?.folder.serverTotal : row?.folder.total;

        return listSetSize(total, this.messages().length);
    });
    /** The server row being opened, by its ref: it is not opened twice. */
    readonly openingRef = signal<string | null>(null);
    /** A server row opened was gone from the mail server, and left the list. */
    readonly serverRowGone = signal<boolean>(false);
    /** The list's next page: by the cursor the last answer gave, or by number; null after the last page. */
    private listNextPage: PageRequest | null = null;
    /** What the list end's Retry asks for again: the read that was not answered. */
    private listEndRetry: () => void = () => this.loadMessages(true);
    readonly retryListEndFn = (): void => this.retryListEnd();
    /** The list's scroll region and the rows' viewport in it. */
    private readonly listScroll = viewChild<ElementRef<HTMLElement>>('listScroll');
    private readonly rowsViewport = viewChild(CdkVirtualScrollViewport);
    /** The row control that had focus, kept while its row is scrolled out of the page and given back when it returns. */
    private focusedRow: { key: string; part: string } | null = null;
    readonly trackRow = (_: number, m: EmailMessageDto): string => rowKey(m);
    /** The open folder's first page has been answered: only then does reaching the list's end read on. */
    private listAnswered = false;
    /** The keys of the rows the first page gave: a first page read again stands in their place. */
    private firstPageKeys = new Set<string>();
    private listEndCountdown: Subscription | null = null;
    readonly rowKeyOf = rowKey;
    readonly isServerRowOf = isServerRow;

    /**
     * Multi-select (backlog slices 3+4): the checkbox / Shift / Ctrl selection over the
     * current folder's loaded messages. Drives the bulk action bar and is independent of
     * {@link selectedMessage} (the message opened in the right pane). Cleared on
     * mailbox/folder change and after a bulk action.
     */
    readonly selectedIds = signal<Set<string>>(new Set<string>());
    readonly selectedCount = computed(() => this.selectedIds().size);
    readonly bulkBusy = signal<boolean>(false);
    /** The action pressed and not yet answered: busy where it was pressed, the row's others disabled, not run again. */
    readonly pending = signal<PendingAction | null>(null);
    /** Range-select origin for Shift-click (the last individually (de)selected row). */
    private selectAnchorId: string | null = null;

    readonly loadingMailboxes = signal<boolean>(true);
    readonly loadingMessages = signal<boolean>(false);
    /** The list shown is being read again: its rows stay and the thin bar shows, never the Loading line. */
    readonly listRereading = signal<boolean>(false);
    /** Why the mailbox list could not be read; null once it was. The banner shows it in the mailbox pane. */
    readonly mailboxesFailure = signal<unknown>(null);
    /** Why the messages could not be read; null once they were. The banner shows it in the message pane. */
    readonly messagesFailure = signal<unknown>(null);
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
    /** The index of the attachment whose bytes View is fetching, else null. */
    readonly viewingAttachment = signal<number | null>(null);
    /** Which viewer an attachment's View opens, or null for no View. */
    protected readonly viewKindOf = attachmentViewKind;

    /**
     * The open message's conversation thread, oldest-sent first. Fetched on
     * open (guarded by {@link openSeq}); the "Conversation" strip renders only when
     * it holds more than one message.
     */
    readonly thread = signal<EmailMessageDto[]>([]);

    readonly composeOpen = signal<boolean>(false);
    /** What the composer writes: a new message, or an answer or a forward of the message `replyTargetId` names. */
    readonly composeMode = signal<'compose' | EmailComposeMode>('compose');
    /**
     * An answer's or a forward's start, as the server prepares it: being read, read, or not read and why; null for a
     * new message. Recipients, subject, From, quote and threading are the server's; none is made up here.
     */
    readonly composePrefill = signal<ComposePrefillState | null>(null);
    /** Drops an answer that arrives after its composer was closed or another was opened. */
    private prefillSeq = 0;
    /** The served recipients' names, for their chips. */
    private readonly prefillOptions = signal<TagOption[]>([]);
    readonly noSendSentence = NO_SEND_SENTENCE;
    readonly quoteRefusedSentence = QUOTE_REFUSED_SENTENCE;
    /** The person keeps the served quote; Remove quote sends without it and hides it. */
    readonly composeQuoteKept = signal<boolean>(true);
    /** A send was refused because the original could no longer be read: offer to send without the quote. */
    readonly composeQuoteRefused = signal<boolean>(false);
    /** A forward's own files (the parts of the original the quote does not show), each removable. */
    readonly forwardFilesKept = signal<EmailComposePartDto[]>([]);
    /** Whether the server served a quote to show. */
    readonly prefillHasQuote = computed(() => (this.prefillAnswer()?.quote ?? null) !== null);
    private readonly prefillAnswer = computed<EmailComposeDto | null>(() => {
        const p = this.composePrefill();
        return p?.state === 'ready' ? p.answer : null;
    });
    /** The fields show for a new message, and for a prepared one once it is read. */
    readonly composeFieldsShown = computed(() => this.composePrefill() === null || this.prefillAnswer() !== null);
    /** Send shows for a new message, and for a prepared one read with an address this person may send as. */
    readonly composeMaySend = computed(() => this.composePrefill() === null
        || (this.prefillAnswer()?.from.choices.length ?? 0) > 0);
    /** The editor profile of the compose window's body: one place, so the mail profile is a one-line change. */
    readonly editorProfile = MAIL_EDITOR_PROFILE;
    /** The confirmed aliases of each mailbox read so far, by mailbox id. */
    private readonly confirmedAliases = signal<Readonly<Record<string, readonly string[]>>>({});
    /** The From the person chose; null keeps the default (the prefill's, else the mailbox's own). */
    readonly composeFromChosen = signal<string | null>(null);
    /** The addresses From offers: none (no From shown) unless the mailbox has confirmed aliases. */
    readonly composeFromChoices = computed(() => {
        const mailboxId = this.selectedMailboxId();
        const aliases = mailboxId === null ? [] : this.confirmedAliases()[mailboxId] ?? [];
        return fromChoices(this.selectedMailbox()?.emailAddress ?? null, aliases, this.prefillAnswer()?.from.address ?? null);
    });
    /** The From shown and sent: the person's choice, else the prefill's, else the mailbox's own. */
    readonly composeFromValue = computed(() => this.composeFromChosen()
        ?? this.prefillAnswer()?.from.address ?? this.selectedMailbox()?.emailAddress ?? null);
    /** The window is maximized and showing: modal, over the backdrop. */
    readonly composeMaximized = signal(false);
    readonly composeModal = computed(() => this.composeOpen() && this.composeMaximized() && !this.composeMinimized());
    /** The open windows that are not the one being written in, drawn as bars. */
    readonly parkedWindows = signal<ComposeWindowSnapshot[]>([]);
    private windowSeq = 0;
    private activeWindowId = 0;
    private activeLastUsed = 0;
    private windowClock = 0;
    readonly composePreparing = computed(() => preparingSentence(this.composeMode() === 'forward' ? 'forward' : 'reply'));
    /** Why the original is not quoted, when the server could not read it. */
    readonly composeUnreadable = computed(() => {
        const reason = this.prefillAnswer()?.unreadable;
        return reason !== null && reason !== undefined && reason !== '' ? unreadableSentence(reason) : null;
    });
    /** The served `quote.html`, drawn read-only in the message view's frame below the person's text. */
    readonly composeQuoteHtml = computed<string | null>(() => {
        const html = this.prefillAnswer()?.quote?.html;
        return html === null || html === undefined || html === '' ? null : html;
    });
    /** The line over the opened quote: the server's attribution, else what the quote is. */
    readonly composeQuoteAttribution = computed(() => {
        const said = (this.prefillAnswer()?.quote?.attribution ?? '').trim();
        return said !== '' ? said : (this.composeMode() === 'forward' ? 'Forwarded message' : 'Quoted message');
    });
    /** The served `quote.text`: what Plain text shows, and what shows when no html was served. */
    readonly composeQuoteText = computed(() => this.prefillAnswer()?.quote?.text ?? null);
    /** The quote shows below the editor while one was served and the person kept it. */
    readonly composeQuoteShown = computed(() => this.prefillHasQuote() && this.composeQuoteKept());
    /** The recipient chips' names: the served ones, then the contacts found while typing. */
    readonly recipientOptions = computed(() => [...this.prefillOptions(), ...this.contactOptions()]);
    readonly sending = signal<boolean>(false);
    private readonly replyTargetId = signal<string | null>(null);
    private readonly quickReply = viewChild(MailQuickReplyComponent);
    private readonly composeDock = viewChild<ElementRef<HTMLElement>>('composeDock');
    private readonly injector = inject(Injector);

    /**
     * The open message's quick reply: shown for a stored message that is open and read, never while it loads, never on
     * a server row (one with no id, not yet stored), and never for a copy from the server that is no longer kept here.
     */
    readonly quickReplyFor = computed(() => {
        const msg = this.selectedMessage();
        const mailboxId = this.selectedMailboxId();
        if (msg === null || mailboxId === null || this.loadingDetail() || this.openEvicted() || isServerRow(msg) || msg.id === '') {
            return null;
        }
        const name = (msg.fromName ?? '').trim();
        const sender = name !== '' ? name : (msg.fromAddress ?? '').trim();

        return { mailboxId, messageId: msg.id, sender, label: sender !== '' ? `Write a reply to ${sender}` : 'Write a reply' };
    });
    /**
     * The reply drafts a compose window has held, by id: closed with the draft kept, the quick reply shows its first
     * words with Open and Discard, never its text in the box.
     */
    readonly windowReplyDrafts = signal<ReadonlySet<string>>(new Set());
    /** The compose window holds the open message's reply. */
    readonly replyWindowHolds = computed(() => {
        const open = this.selectedMessage()?.id ?? null;
        if (open === null) {
            return false;
        }
        return (this.composeOpen() && isReplyMode(this.composeMode()) && this.replyTargetId() === open)
            || this.parkedWindows().some(w => isReplyMode(w.mode) && w.replyTargetId === open);
    });
    /** The files of the message being written: a new message, a forward or a reply. */
    readonly composeAttachments = signal<ComposeAttachment[]>([]);
    /** The last send refused as too large: the server's measure and the limit, shown beside the files. */
    readonly composeSendRefused = signal<{ limitBytes: number; sizeBytes: number } | null>(null);
    /** The selected mailbox's limit on a message, or null when it is not known. */
    readonly composeLimit = computed<number | null>(() => {
        const id = this.selectedMailboxId();
        const limit = this.mailboxes().find(m => m.id === id)?.maxMessageBytes;

        return typeof limit === 'number' && limit > 0 ? limit : null;
    });
    /** Dock minimized state: the window collapses to just its header bar,
     *  keeping the form (and its draft) alive so it restores exactly as left. */
    readonly composeMinimized = signal<boolean>(false);

    /**
     * The window's draft on the server: made at the first save of what was written, saved after a pause as it changes,
     * and found again by the message it answers (an answer's) or as the newest of a new message's. "Draft saved" says
     * when the server last saved it. `compose*Initial` snapshot the fresh-open baseline so what was served is not
     * itself taken for something written.
     */
    private readonly activeDraft = signal<ServerDraft | null>(null);
    readonly draftSavedAt = computed(() => this.activeDraft()?.savedAt() ?? null);
    private composeToInitial: string[] = [];
    private composeCcInitial: string[] = [];
    private composeBccInitial: string[] = [];
    private composeSubjectInitial = '';
    private composeTextInitial = '';
    private composeHtmlInitial = '';
    private composeRichInitial = true;
    private draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
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
    /** The list pane's actions, the server's tree (navi.toolbar.email.list); empty while it serves none. */
    readonly listNodes = signal<NaviGraphNode[]>([]);
    readonly listActions = computed(() => paneActionsOf(this.listNodes(), {}, LIST_ACTIONS_HANDLED, this.naviGraph));
    /**
     * The open message's facts, from its list row when it is listed -- the record the row's menu and the checked-rows
     * bar read too, so one message never shows an action on one surface and not on another -- else from the detail.
     */
    readonly detailFacts = computed(() => {
        const m = this.selectedMessage();
        if (!m) {
            return messageFacts([]);
        }
        return messageFacts([this.messages().find(x => x.id === m.id) ?? m]);
    });
    readonly bulkFacts = computed(() => {
        const ids = this.selectedIds();
        return messageFacts(this.messages().filter(m => ids.has(m.id)));
    });
    /** The open message's row: the tree's nodes for it that this page can run; none while no message is open. */
    readonly detailActions = computed(() => {
        const m = this.selectedMessage();
        return m && !this.loadingDetail()
            ? withPending(paneActionsOf(this.messageNodes(), this.detailFacts(), MESSAGE_ACTIONS_HANDLED, this.naviGraph), this.pending(), [m.id])
            : [];
    });
    /** The checked rows' row: the same nodes, for them. */
    readonly bulkActions = computed(() => withPending(
        paneActionsOf(this.messageNodes(), this.bulkFacts(), MESSAGE_ACTIONS_HANDLED, this.naviGraph),
        this.pending(), [...this.selectedIds()]));
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

    /**
     * An action chosen in a pane row, by pointer or by key: its second step opens under its button, or under More
     * actions when it was chosen from there.
     */
    atAction(row: HTMLElement, id: string): void {
        const shown = row.querySelector<HTMLElement>(`[data-action="${CSS.escape(id)}"]:not([hidden])`);
        const anchor = shown ?? row.querySelector<HTMLElement>('[data-action="more"]');
        if (anchor) {
            const rect = anchor.getBoundingClientRect();
            this.actionPoint = { x: rect.left, y: rect.bottom };
        }
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
        // A server row offers Open only: the row menu leaves it out.
        if (isServerRow(m)) {
            return;
        }
        const ids = rowTargetIds(this.selectedIds(), m.id);
        const targets = this.messages().filter(x => ids.includes(x.id));
        this.actionPoint = { x: event.clientX, y: event.clientY };
        this.contextMenu.openFromNodes(event, handledNodes(this.messageNodes(), MESSAGE_ACTIONS_HANDLED), messageFacts(targets),
            action => this.onMessageAction(action, ids));
    }

    /** One place for every action on messages, from either bar or a row's menu. */
    onMessageAction(action: string, ids: string[]): void {
        if (ids.length === 0) {
            return;
        }
        const waiting = this.pending();
        if (ACTIONS_THAT_WAIT.has(action) && waiting !== null && ids.some(id => waiting.ids.has(id))) {
            return;
        }
        this.moves++;
        if (ACTIONS_THAT_WAIT.has(action) && action !== 'move') {
            this.waitFor(action, ids, () => this.runMessageAction(action, ids));
            return;
        }
        this.runMessageAction(action, ids);
    }

    /**
     * Runs a call to the server with the action pending on these messages from now until it answers: the flows mark
     * the answer by bulkBusy going false. One that asked the server nothing (a refusal said at once) ends pending here.
     */
    private waitFor(action: string, ids: readonly string[], run: () => void): void {
        this.pending.set({ action, ids: new Set(ids) });
        run();
        if (!this.bulkBusy()) {
            this.pending.set(null);
        }
    }

    /** Ends what was pending: the server answered. */
    private answered(): void {
        this.bulkBusy.set(false);
        this.pending.set(null);
    }

    private runMessageAction(action: string, ids: string[]): void {
        switch (action) {
            case 'reply':
            case 'reply-all':
            case 'forward':
                this.withOpen(ids[0], () => (action === 'reply'
                    ? this.handReplyToWindow()
                    : this.openPrefilled(PREFILLED_ACTIONS[action])));
                break;
            case 'archive':
                // Archived in All Mail the messages stay shown: nothing leaves at once, the open one stays open.
                this.keepShown = staysShown(this.roleOf(this.selectedFolder()), 'archive');
                this.archiveFlow.archive(this.listed(ids));
                this.keepShown = false;
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
                this.openFollowUp(moveMenuItems(this.moveChoices(), this.folderOf(ids[0])), id => {
                    if (id.startsWith('move:')) {
                        this.waitFor('move', ids, () => this.bulkMoveTo(id.slice('move:'.length), new Set(ids)));
                    }
                });
                break;
            case 'show-original':
                // One message's source, never several.
                if (ids.length === 1) {
                    this.showOriginal(ids[0]);
                }
                break;
            case 'delete':
                // Outside Trash, Delete moves to Trash without asking, with an Undo; in Trash it is for good, and asks.
                if (isTrashFolder(this.folderOf(ids[0]))) {
                    this.trash.deletePermanently(this.listed(ids));
                } else {
                    this.trash.moveToTrash(this.listed(ids));
                }
                break;
        }
    }

    /** A message's original source, in the full-screen viewer; focus goes back where it was when it closes. */
    private showOriginal(id: string): void {
        const open = this.selectedMessage();
        const m = open?.id === id ? open : this.messages().find(x => x.id === id);
        const subject = m?.subject ?? '';
        openMessageSource(this.dialog, { messageId: id, subject: subject !== '' ? subject : '(no subject)' });
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
    /** The Cc and the Bcc line each opened by its link at the end of the To line. */
    readonly composeAskedCc = signal<boolean>(false);
    readonly composeAskedBcc = signal<boolean>(false);
    readonly composeCcShown = computed(() => this.composeShowCcBcc() || this.composeAskedCc());
    readonly composeBccShown = computed(() => this.composeShowCcBcc() || this.composeAskedBcc());
    /** The quote below the editor is collapsed behind its button until asked for. */
    readonly composeQuoteOpen = signal<boolean>(false);
    /** The foot's More options menu. */
    readonly composeMoreOpen = signal<boolean>(false);
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
    /** What the results' end says when their next page was not read: it could not be, or the server asked to wait. */
    readonly searchEnd = signal<ListEnd | null>(null);
    /** The results' next page is being read: the Loading... row stands at their end. */
    readonly searchingMore = signal<boolean>(false);
    private searchEndCountdown: Subscription | null = null;
    readonly retrySearchEnd = (): void => this.loadMoreSearch();
    searchQuery = '';
    private searchPage = 1;
    private searchSeq = 0;
    /** The query the results shown were asked for, trimmed. */
    private activeQuery = '';
    /** The search box's keys: a search runs once typing pauses, or at Enter. */
    private readonly searchKeys = new Subject<SearchKey>();
    /** The open mailbox's server search, under the stored results. */
    readonly serverSearch = new MailServerSearch(
        (q, cursor) => this.email.serverSearch(this.selectedMailboxId() ?? '', q, cursor),
        () => this.selectedMailbox()?.serverSearch,
        capability => this.learnServerSearch(this.selectedMailboxId(), capability),
    );
    /** The same query on the person's other mailboxes' servers, asked for from the open mailbox's section. */
    readonly otherServerSearches = new OtherMailboxesSearch();
    /** Which mailbox and folder the list shows: another one starts it again from its top. */
    private listKey = '';
    /** The message open in the reader was evicted: shown still, as no longer kept here. */
    readonly openEvicted = signal(false);
    readonly otherMailboxes = computed(() => this.mailboxes().filter(m => m.id !== this.selectedMailboxId()));
    /** The stored results' ids: a server hit among them is not shown twice. */
    readonly localResultIds = computed(() => new Set(this.searchResults().map(h => h.id)));
    readonly folderNameFn = (path: string): string => this.folderNameOf(path);
    readonly openServerHitFn = (hit: ServerSearchHitDto): Observable<ServerMessageOpenedDto> | null =>
        this.email.openServerMessage(this.selectedMailboxId() ?? '', hit);

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

    constructor() {
        this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(query => this.followPane(query));
        searchCommits(this.searchKeys).pipe(takeUntilDestroyed()).subscribe(commit => this.onSearchCommit(commit));
        // Each time other rows are drawn: a row control that had focus gets it back when its row is drawn again.
        effect(onCleanup => {
            const viewport = this.rowsViewport();
            if (viewport === undefined) {
                return;
            }
            const drawn = viewport.renderedRangeStream.subscribe(() => {
                afterNextRender({ write: () => this.keepRowFocus() }, { injector: this.injector });
            });
            onCleanup(() => drawn.unsubscribe());
        });
        // The window crossing a phone's width redraws the panes.
        const phoneChanged = (e: MediaQueryListEvent): void => this.phone.set(e.matches);
        if (typeof this.phoneWidth?.addEventListener === 'function') {
            this.phoneWidth.addEventListener('change', phoneChanged);
        }
        this.destroyRef.onDestroy(() => {
            if (typeof this.phoneWidth?.removeEventListener === 'function') {
                this.phoneWidth.removeEventListener('change', phoneChanged);
            }
            this.searchEndCountdown?.unsubscribe();
            this.serverSearch.stop();
            this.otherServerSearches.stop();
        });
    }

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
            // An unanswered folder tree reads as empty: the folder actions then come from the page's own nodes.
            this.naviGraph.loadTree(pattern.replace('{slug}', FOLDER_TOOLBAR_TREE))
                .pipe(catchError(() => of<NaviGraphNode[]>([])), takeUntilDestroyed(this.destroyRef))
                .subscribe(nodes => this.folderActionNodes.set(nodes));
            // An unanswered tree reads as empty, and the list pane then keeps its own Refresh.
            this.naviGraph.loadTree(pattern.replace('{slug}', LIST_TOOLBAR_TREE))
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(nodes => this.listNodes.set(nodes));
        }
        this.loadMailboxes();

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
        this.destroyRef.onDestroy(() => this.mailFollower.stop());
        this.destroyRef.onDestroy(() => this.folderJobs.stop());
        this.destroyRef.onDestroy(() => this.pendingReads.clear());
        const uid = this.currentUserId();
        if (uid !== null) {
            this.emailLive.watch(uid)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: evt => {
                        if ('mail.sync.finished' === evt.type) {
                            this.syncBar()?.frame(evt);
                        } else if ('mail.messages.changed' === evt.type) {
                            this.onMessagesChanged(evt);
                        } else if ('mail.flag.refused' === evt.type) {
                            this.onFlagRefused(evt);
                        } else if ('mail.drafts.changed' === evt.type) {
                            this.onDraftsChanged(evt);
                        } else if ('mail.received' === evt.type) {
                            this.onMailReceived(evt);
                        } else if ('mail.folders.job' === evt.type) {
                            this.onFolderJob(evt);
                        }
                    },
                    error: () => { /* swallow -- manual reload still works */ },
                });
        }
    }

    /**
     * The mailboxes and the person's mail settings together, on page init or again from the mailbox pane's Retry:
     * the settings name the mailbox to open on. A setting that cannot be read is its default -- the page never waits
     * on it. A failed read of the list is held for the banner in the mailbox pane; the message pane is not touched.
     */
    loadMailboxes(): void {
        this.loadingMailboxes.set(true);
        this.mailboxesFailure.set(null);
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
            error: (err: unknown) => {
                this.mailboxesFailure.set(err);
                this.loadingMailboxes.set(false);
            },
        });
    }

    /**
     * A realtime nudge that a mailbox the current user can see gained new mail. The
     * payload carries ids, a count and the mailbox's unread number, never content: the
     * OPEN mailbox reloads its folders + list (new mail + counts); the switcher takes the
     * number the nudge carries, and only a nudge without one (an older server) reads it
     * again over REST. A number with a seq applies only when that seq is newer than the
     * last applied to the mailbox's number, by either this nudge or a change event.
     * Owner-only channel auth is enforced server-side.
     */
    private onMailReceived(evt: EmailLiveEvent): void {
        const unseen = evt.mailboxUnseen;
        // The mark moves only with a number applied: a frame without one leaves the order to the next that has one.
        if (typeof unseen === 'number'
            && (evt.seq === undefined || this.mailFollower.marks.badge(evt.mailboxId, evt.seq))) {
            this.mailboxUnread.update(prev => ({ ...prev, [evt.mailboxId]: unseen }));
        }
        if (evt.mailboxId === this.selectedMailboxId()) {
            this.loadFolders(true);
            return;
        }
        if (typeof unseen === 'number') {
            return;
        }
        if (this.unreadServed.has(evt.mailboxId)) {
            // A nudge without the number: the list serves it on each row.
            this.email.listMailboxes().subscribe({
                next: list => this.takeServedUnread(list),
                error: () => { /* leave the badge as-is on a transient failure */ },
            });
            return;
        }
        this.email.listFolders(evt.mailboxId).subscribe({
            next: folders => this.patchMailboxUnread(evt.mailboxId, folders),
            error: () => { /* leave the badge as-is on a transient failure */ },
        });
    }

    /**
     * What changed in a mailbox, from this tab, another tab or device, or the server's sync: applied in place, the
     * list not read again. The rows shown, the open message and its thread take their flags; a row that left the open
     * folder or is gone leaves the list; the folders take their counts and the switcher its number. Each by seq: what
     * arrives late or twice changes nothing.
     */
    private onMessagesChanged(evt: MailMessagesChangedEvent): void {
        const after = this.mailFollower.apply({
            mailboxId: this.selectedMailboxId(),
            folder: this.selectedFolder(),
            messages: this.messages(),
            thread: this.thread(),
            openMessage: this.selectedMessage(),
            folders: this.folders(),
            mailboxUnread: this.mailboxUnread(),
            inboxes: this.inboxes(),
        }, evt);
        // A read state the person chose: an event before its write answered is the old state still arriving and
        // keeps the person's value; the first one after the answer is the server's word, and a refusal when it says
        // the other value (when no mail.flag.refused said so first).
        const held = new Map<string, boolean>();
        let refusal: string | null = null;
        const notices = new Set<number>();
        for (const change of evt.changes) {
            if (!('seen' in change) || typeof change.seen !== 'boolean') {
                continue;
            }
            const notice = this.pendingReads.notice(change.id);
            const choice = this.pendingReads.choice(change.id);
            const meant = this.pendingReads.event(change.id, change.seen, evt.seq);
            if (meant === 'held' && choice !== null) {
                held.set(change.id, choice);
            } else if (meant === 'refused' && choice !== null) {
                // An entry that says it rolls a refused change back carries its reason's code. Its value is what the
                // row went back to; the words are the person's choice, the value asked for.
                const code = 'refused' in change && change.refused === 'seen' ? change.reason ?? null : null;
                refusal ??= flagRefusalText(flagChangeOf('seen', choice), code);
                if (notice !== null) {
                    notices.add(notice);
                }
            }
        }
        // One message's rows (on Gmail, one per label) refused together: said once, in place of its notice.
        notices.forEach(id => this.toast.dismiss(id));
        if (refusal !== null) {
            this.toast.error(refusal);
        }
        const keep = <T extends EmailMessageDto>(m: T): T => (held.has(m.id) ? { ...m, seen: held.get(m.id) } : m);
        this.messages.set(after.messages.map(keep));
        this.thread.set(after.thread.map(keep));
        this.selectedMessage.set(after.openMessage === null ? null : keep(after.openMessage));
        if (after.evictedOpen) {
            this.openEvicted.set(true);
        }
        this.folders.set([...after.folders]);
        this.mailboxUnread.set(after.mailboxUnread);
    }

    /**
     * The mail server refused a flag change after its write had answered: said in the page's words, in place of the
     * notice that said it was made. The mail.messages.changed that follows restores the flag as any change does.
     */
    private onFlagRefused(evt: MailFlagRefusedEvent): void {
        if (evt.mailboxId !== this.selectedMailboxId()) {
            return;
        }
        // Every row the change had reached (on Gmail, the message's row in each label) is named, and said once.
        const notices = new Set<number>();
        for (const id of evt.ids) {
            const notice = evt.flag === 'seen' ? this.pendingReads.notice(id) : this.flagNotices.get(id) ?? null;
            if (notice !== null) {
                notices.add(notice);
            }
            if (evt.flag === 'seen') {
                this.pendingReads.refusedByServer(id);
            } else {
                this.flagNotices.delete(id);
            }
        }
        notices.forEach(id => this.toast.dismiss(id));
        // Said as the change the person asked for, never as the value the row was put back to.
        this.toast.error(flagRefusalText(flagChangeOf(evt.flag, evt.wanted), evt.code, evt.reason));
    }

    /** A sync ended: the open mailbox's folders and list, and when it last synced, as the server now has them. */
    onSyncFinished(id: string): void {
        if (id === this.selectedMailboxId()) {
            this.loadFolders();
        }
        this.email.getMailbox(id).subscribe({
            next: read => this.mailboxes.set(this.mailboxes().map(m => m.id === id ? read : m)),
            error: () => { /* the synced-at stays as it was; the list above is already read */ },
        });
    }

    /**
     * Opens a mailbox. Switching from another one ends the search; the first open keeps what was typed before it and
     * searches the mailbox for it.
     */
    selectMailbox(id: string): void {
        const previous = this.selectedMailboxId();
        this.selectedMailboxId.set(id);
        this.selectedMessage.set(null);
        this.messages.set([]);
        this.clearSelection();
        if (previous !== null && previous !== id) {
            this.clearSearch();
        }
        this.loadFolders();
        if (previous === null && this.searchQuery.trim() !== '') {
            this.runSearch(this.searchQuery);
        }
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

    /**
     * Each mailbox's unread number for the switcher: the `unread` the list serves on its row, else its inbox's count
     * from its folders. Folders are never summed.
     */
    private loadMailboxUnread(list: EmailMailboxDto[]): void {
        this.unreadServed.clear();
        const served = this.takeServedUnread(list, true);
        const unserved = list.filter(mb => servedUnread(mb) === null);
        if (unserved.length === 0) {
            this.mailboxUnread.set(served);
            return;
        }
        forkJoin(unserved.map(mb => this.email.listFolders(mb.id).pipe(
            map(folders => {
                this.learnInbox(mb.id, folders);
                return [mb.id, inboxUnread(folders)] as const;
            }),
            catchError(() => of([mb.id, 0] as const)),
        ))).subscribe(pairs => this.mailboxUnread.set({ ...served, ...Object.fromEntries(pairs) }));
    }

    /**
     * The numbers the list serves on its rows, marked as served, and set on the switcher unless `onlyReturn`. A row
     * without one is left as it was.
     */
    private takeServedUnread(list: readonly EmailMailboxDto[], onlyReturn = false): Record<string, number> {
        const served: Record<string, number> = {};
        for (const mb of list) {
            const unread = servedUnread(mb);
            if (unread !== null) {
                served[mb.id] = unread;
                this.unreadServed.add(mb.id);
            }
        }
        if (!onlyReturn && Object.keys(served).length > 0) {
            this.mailboxUnread.update(prev => ({ ...prev, ...served }));
        }
        return served;
    }

    /** Remember where a mailbox's inbox is, from its folders. */
    private learnInbox(id: string, folders: readonly EmailFolderDto[]): void {
        const inbox = inboxFolder(folders);
        if (inbox !== null && this.inboxes()[id] !== inbox.folder) {
            this.inboxes.update(prev => ({ ...prev, [id]: inbox.folder }));
        }
    }

    /**
     * Patch a single mailbox's number from a freshly-loaded folder list: its inbox's count. A number the list serves
     * is not replaced by it.
     */
    private patchMailboxUnread(id: string, folders: EmailFolderDto[]): void {
        this.learnInbox(id, folders);
        if (this.unreadServed.has(id)) {
            return;
        }
        const unread = inboxUnread(folders);
        this.mailboxUnread.update(prev => ({ ...prev, [id]: unread }));
    }

    /**
     * A read or unread made here moved `folder`'s count by `delta`: the open mailbox's number follows its inbox. A
     * number the list serves moves by the same delta when the folder is the inbox.
     */
    private followLocalUnread(id: string, folder: string, delta: number): void {
        if (!this.unreadServed.has(id)) {
            this.patchMailboxUnread(id, this.folders());
            return;
        }
        const inbox = this.inboxes()[id] ?? inboxFolder(this.folders())?.folder ?? INBOX_PATH;
        if (folder === inbox) {
            this.mailboxUnread.update(prev => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }));
        }
    }

    selectFolder(folder: string): void {
        // Choosing a folder ends the folders pane as its Back would, so the history holds no step back into it.
        this.leavePane('folders');
        this.selectedFolder.set(folder);
        this.selectedMessage.set(null);
        this.clearSelection();
        this.clearSearch();
        this.loadMessages(true);
    }

    /** The list's next page, when there is one. */
    loadMore(): void {
        if (this.listNextPage !== null) {
            this.loadMessages(false, this.listNextPage);
        }
    }

    /** The list scrolled: back at its top the New messages pill goes; near its end the next page is read. */
    onListScroll(): void {
        if (this.newArrivals() > 0 && this.rowsOffset() <= AT_TOP_PX) {
            this.newArrivals.set(0);
        }
        this.readOnIfNearEnd();
    }

    /** The pill's click: the list scrolls to its top, where the new mail is. */
    toListTop(): void {
        this.listScroll()?.nativeElement.scrollTo({ top: 0 });
        this.newArrivals.set(0);
    }

    /**
     * With about one and a half screens of rows or fewer left below the view: the next page of the results, or of the
     * folder by the cursor its last page gave (in an inbox not yet synced to its bottom, the cursor runs on into the
     * server's older mail).
     */
    private readOnIfNearEnd(): void {
        const region = this.listScroll()?.nativeElement;
        if (region === undefined || region.clientHeight <= 0) {
            return;
        }
        if (this.searchActive()) {
            if (this.searchHasMore() && !this.searching() && this.searchEnd() === null
                && nearListEnd(region.scrollHeight, region.scrollTop, region.clientHeight)) {
                this.loadMoreSearch();
            }
            return;
        }
        if (this.loadingMessages() || this.listEnd() !== null || this.messagesFailure() !== null || !this.listAnswered
            || !nearListEnd(this.rowsTop() + this.messages().length * this.rowHeight, region.scrollTop, region.clientHeight)) {
            return;
        }
        if (this.listNextPage !== null) {
            this.loadMore();
        }
    }

    /** Once what was just read is drawn, reads on while the rows do not reach one and a half screens below the view. */
    private readOnAfterRender(): void {
        afterNextRender({ read: () => this.readOnIfNearEnd() }, { injector: this.injector });
    }

    /** Where the rows start in the scroll region's content, in px. */
    private rowsTop(): number {
        const region = this.listScroll()?.nativeElement;
        const rows = this.rowsViewport()?.elementRef.nativeElement;
        if (region === undefined || rows === undefined) {
            return region?.scrollHeight ?? 0;
        }

        return rows.getBoundingClientRect().top - region.getBoundingClientRect().top + region.scrollTop;
    }

    /** How far the view has scrolled into the rows, in px. */
    private rowsOffset(): number {
        const region = this.listScroll()?.nativeElement;

        return region === undefined || this.rowsViewport() === undefined ? 0 : Math.max(0, region.scrollTop - this.rowsTop());
    }

    /**
     * Applies `change` to the rows without moving what the person is looking at: scrolled down, the row at the view's
     * top stays where it shows, and the rows that came above it are counted for the New messages pill; at the top,
     * new rows simply appear.
     */
    private keepingPlace(change: () => void): void {
        const region = this.listScroll()?.nativeElement;
        const offset = this.rowsOffset();
        if (region === undefined || offset <= AT_TOP_PX) {
            change();
            return;
        }
        const before = this.messages();
        const anchor = anchorAt(before, offset, this.rowHeight);
        change();
        if (anchor === null) {
            return;
        }
        const after = this.messages();
        const arrived = arrivedAbove(before, after, anchor);
        if (arrived > 0) {
            this.newArrivals.update(n => n + arrived);
        }
        const to = offsetOfAnchor(after, anchor, this.rowHeight);
        if (to === null || to === offset) {
            return;
        }
        const top = region.scrollTop + (to - offset);
        // Written once the rows are drawn at their new length, so the region is tall enough to scroll there.
        afterNextRender({ write: () => { region.scrollTop = top; } }, { injector: this.injector });
    }

    /** A row control took focus: it is the one kept while its row is out of the page. */
    onRowFocusIn(event: FocusEvent): void {
        const target = event.target as HTMLElement;
        const part = target.getAttribute('data-part');
        const key = target.closest('[data-key]')?.getAttribute('data-key') ?? null;
        this.focusedRow = part !== null && key !== null ? { key, part } : null;
    }

    /** Focus left a row control: kept when its row was only taken out of the page, dropped when the person moved on. */
    onRowFocusOut(event: FocusEvent): void {
        const kept = this.focusedRow;
        const next = event.relatedTarget as Node | null;
        const rows = this.rowsViewport()?.elementRef.nativeElement;
        if (kept === null || (next !== null && rows?.contains(next) === true)) {
            return;
        }
        if (next !== null) {
            this.focusedRow = null;
            return;
        }
        const left = event.target as HTMLElement;
        setTimeout(() => {
            // Still in the page as the same row's control, and not focused: the person put focus elsewhere.
            if (this.focusedRow === kept && left.isConnected && document.activeElement !== left
                && left.closest('[data-key]')?.getAttribute('data-key') === kept.key) {
                this.focusedRow = null;
            }
        });
    }

    /**
     * After rows are drawn: the kept row control, when its row is drawn again, takes focus back from the scroll region;
     * when its row has left the page with focus, the scroll region holds focus, so the keys still scroll the list.
     */
    private keepRowFocus(): void {
        const kept = this.focusedRow;
        const region = this.listScroll()?.nativeElement;
        const rows = this.rowsViewport()?.elementRef.nativeElement;
        if (kept === null || region === undefined || rows === undefined) {
            return;
        }
        const active = document.activeElement;
        const lost = active === null || active === document.body;
        const control = rows.querySelector<HTMLElement>(`[data-key="${CSS.escape(kept.key)}"] [data-part="${CSS.escape(kept.part)}"]`);
        if (control !== null) {
            if (lost || active === region) {
                control.focus({ preventScroll: true });
            }
            return;
        }
        if (lost) {
            region.focus({ preventScroll: true });
        }
    }

    /** The list end's Retry: the page that was not read, asked for again. */
    retryListEnd(): void {
        this.listEndRetry();
    }

    /**
     * A server row chosen: it is stored through the server-message opener, takes its place in the list as an ordinary
     * row, and opens by its id as any message does, so the usual open marks it read. A ref the server no longer has
     * leaves the list, saying so.
     */
    private openServerRow(m: EmailMessageDto): void {
        const ref = m.ref ?? '';
        const mailboxId = this.selectedMailboxId();
        if (ref === '' || mailboxId === null || this.openingRef() === ref) {
            return;
        }
        const call = this.openServerHitFn(serverRowHit(m));
        if (call === null) {
            return;
        }
        this.serverRowGone.set(false);
        this.openingRef.set(ref);
        call.subscribe({
            next: stored => {
                this.openingRef.set(null);
                if (mailboxId !== this.selectedMailboxId()) {
                    return;
                }
                this.messages.set(withOpenedRow(this.messages(), ref, stored));
                if (this.firstPageKeys.has(rowKey(m))) {
                    this.firstPageKeys.add(`id:${stored.id}`);
                }
                const row = this.messages().find(x => !isServerRow(x) && x.id === stored.id);
                this.openMessage(row ?? { ...m, id: stored.id, folder: stored.folder, fromServer: false, ref: null });
            },
            error: (error: unknown) => {
                this.openingRef.set(null);
                const refusal = serverSearchRefusal(error);
                if (refusal.reason === 'gone') {
                    this.messages.set(withoutServerRow(this.messages(), ref));
                    this.serverRowGone.set(true);
                    return;
                }
                this.toast.error(openFailureText(refusal));
            },
        });
    }

    /** Back to the list: the open message is closed, and a detail still loading is dropped when it answers. */
    closeMessage(): void {
        this.moves++;
        this.openSeq += 1;
        this.loadingDetail.set(false);
        this.selectedMessage.set(null);
    }

    openMessage(m: EmailMessageDto): void {
        if (isServerRow(m)) {
            this.openServerRow(m);
            return;
        }
        this.showPane('message');
        this.openById(m.id, m.seen ?? true, m.folder ?? this.selectedFolder());
    }

    /** Open a search hit -- same detail path as a folder message. */
    openSearchHit(hit: EmailSearchHitDto): void {
        this.showPane('message');
        this.openById(hit.id, hit.seen ?? true, hit.folder ?? this.selectedFolder());
    }

    /** Load a message's detail; mark it read if it was unread. Shared by list + search. */
    private openById(id: string, seen: boolean, folder: string, then?: () => void): void {
        this.moves++;
        this.openEvicted.set(false);
        const seq = ++this.openSeq;
        this.attachments.set([]);
        this.loadingAttachments.set(false);
        this.thread.set([]);
        // Remote images load at once only when the person's profile says "always loaded"; otherwise blocked until asked.
        this.loadRemoteImages.set(loadsRemoteImagesAtOnce(this.mailPrefs.current()));
        this.loadingDetail.set(true);
        const readAt = this.pendingReads.stamp();
        this.email.getMessage(id).subscribe({
            next: answer => {
                if (seq !== this.openSeq) { return; }
                // Read before a read-state write answered: the person's value, not the one it carries.
                const detail = this.pendingReads.held(answer, readAt);
                this.selectedMessage.set(detail);
                this.messages.set(this.messages().map(x => (x.id === detail.id ? rowWithDetailState(x, detail) : x)));
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
        const readAt = this.pendingReads.stamp();
        this.email.listThread(id).subscribe({
            next: msgs => {
                if (seq !== this.openSeq) { return; }
                this.thread.set(this.pendingReads.heldAll(msgs, readAt));
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

    /** The search box's text changed: a search follows once typing pauses. */
    onSearchTyped(text: string): void {
        this.searchKeys.next({ kind: 'typed', q: text });
    }

    /** Enter in the search box: the search runs at once. */
    onSearchEnter(): void {
        this.searchKeys.next({ kind: 'entered', q: this.searchQuery });
    }

    /** A pause or Enter asked for a search: an emptied box leaves search; a pause on the query shown asks nothing. */
    private onSearchCommit(commit: SearchCommit): void {
        if (commit.q === '') {
            if (commit.entered || this.searchActive()) {
                this.clearSearch();
            }
            return;
        }
        if (!commit.entered && this.searchActive() && commit.q === this.activeQuery) {
            return;
        }
        this.runSearch(commit.q);
    }

    /** Run a full-text search across the selected mailbox: the stored messages, and the open mailbox's server under them. */
    runSearch(query: string = this.searchQuery): void {
        const q = query.trim();
        const mailboxId = this.selectedMailboxId();
        if (q === '') {
            this.clearSearch();
            return;
        }
        if (mailboxId === null) {
            return;
        }
        this.clearSelection(); // the bulk bar is folder-view only; drop any lingering selection
        this.activeQuery = q;
        this.otherServerSearches.stop();
        this.serverSearch.run(q);
        this.searchPage = 1;
        this.searchActive.set(true);
        this.stopSearchEnd();
        this.searchingMore.set(false);
        const seq = ++this.searchSeq;
        this.searching.set(true);
        this.email.searchMessages({ q, mailboxId, page: 1 }).subscribe({
            next: hits => {
                if (seq !== this.searchSeq) { return; }
                this.searchResults.set(hits);
                this.searchHasMore.set(hits.length >= EmailMailboxPageComponent.SEARCH_PAGE_SIZE);
                this.searching.set(false);
                this.readOnAfterRender();
            },
            error: () => {
                if (seq !== this.searchSeq) { return; }
                this.searching.set(false);
                this.toast.error('Search failed.');
            },
        });
    }

    /** The results' next page, read as they are scrolled; a page not read is said at their end, with Retry. */
    loadMoreSearch(): void {
        const q = this.activeQuery;
        const mailboxId = this.selectedMailboxId();
        if (q === '' || mailboxId === null) {
            return;
        }
        this.stopSearchEnd();
        const page = this.searchPage + 1;
        const seq = ++this.searchSeq;
        this.searching.set(true);
        this.searchingMore.set(true);
        this.email.searchMessages({ q, mailboxId, page }).subscribe({
            next: hits => {
                if (seq !== this.searchSeq) { return; }
                this.searchPage = page;
                this.searchResults.set([...this.searchResults(), ...hits]);
                this.searchHasMore.set(hits.length >= EmailMailboxPageComponent.SEARCH_PAGE_SIZE);
                this.searching.set(false);
                this.searchingMore.set(false);
                this.readOnAfterRender();
            },
            error: (err: unknown) => {
                if (seq !== this.searchSeq) { return; }
                this.searching.set(false);
                this.searchingMore.set(false);
                const refusal = pageRefusal(err);
                if (refusal.kind === 'rate-limited') {
                    this.searchEndCountdown = this.countDown(this.searchEnd, refusal.seconds);
                } else {
                    this.searchEnd.set({ kind: 'failed' });
                }
            },
        });
    }

    private stopSearchEnd(): void {
        this.searchEndCountdown?.unsubscribe();
        this.searchEndCountdown = null;
        this.searchEnd.set(null);
    }

    /** Exit search and return to the folder message list. */
    clearSearch(): void {
        this.searchSeq++; // invalidate any in-flight search so its late response can't resurrect results
        this.searchKeys.next({ kind: 'cleared' });
        this.searchQuery = '';
        this.activeQuery = '';
        this.searchActive.set(false);
        this.searching.set(false);
        this.searchResults.set([]);
        this.searchHasMore.set(false);
        this.searchingMore.set(false);
        this.stopSearchEnd();
        this.serverSearch.stop();
        this.otherServerSearches.stop();
    }

    /** The same query on the server of each of the person's other mailboxes, one after another. */
    searchOtherMailboxes(): void {
        const q = this.activeQuery;
        if (q === '') {
            return;
        }
        this.otherServerSearches.start(q, this.otherMailboxes().map(mb => ({
            mailboxId: mb.id,
            title: [mb.label, mb.emailAddress].find((v): v is string => typeof v === 'string' && v !== '') ?? 'Mailbox',
            search: new MailServerSearch(
                (query, cursor) => this.email.serverSearch(mb.id, query, cursor),
                () => this.mailboxes().find(m => m.id === mb.id)?.serverSearch,
                capability => this.learnServerSearch(mb.id, capability),
            ),
            open: hit => this.email.openServerMessage(mb.id, hit),
        })));
    }

    /** A server hit to read: opened by its stored id, as a search hit is. */
    onServerHitOpened(hit: ServerHitOpened): void {
        this.showPane('message');
        this.openById(hit.id, hit.seen, hit.folder);
    }

    /** What a server search learned of a mailbox's server (it cannot search): kept on the mailbox, so it is not asked again. */
    private learnServerSearch(mailboxId: string | null, capability: ServerSearchCapability): void {
        this.mailboxes.update(list => list.map(m => (m.id === mailboxId ? { ...m, serverSearch: capability } : m)));
    }

    /** A stored hit's folder, by the name the folder tree gives it. */
    localChips(hit: EmailSearchHitDto): string[] {
        const name = this.folderNameOf(hit.folder);
        return name === '' ? [] : [name];
    }

    /** A search hit's `sentAt` is Unix SECONDS; the date pipe wants an ISO string. */
    hitDate(hit: EmailSearchHitDto): string | null {
        return hit.sentAt != null ? new Date(hit.sentAt * 1000).toISOString() : null;
    }

    /** Row star click: toggle this message's flag without opening it (backlog slice 7). */
    toggleFlag(m: EmailMessageDto, ev: MouseEvent): void {
        ev.stopPropagation();
        if (isServerRow(m)) {
            return;
        }
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
        // At once: the rows and the open message change now; a row whose call fails changes back.
        this.setFlaggedHere(new Set(targets.map(m => m.id)), flagged);
        this.bulkBusy.set(true);
        const problems = new Map<string, string | null>();
        const reached = new Set<string>();
        forkJoin(targets.map(m => this.email.markFlagged(m.id, flagged).pipe(
            map(answer => {
                idsOf((answer as { ids?: unknown } | null)?.ids, m.id).forEach(id => reached.add(id));
                return null;
            }),
            catchError((e: unknown) => {
                problems.set(m.id, problemOf(e));
                return of(m.id);
            }),
        ))).subscribe(answers => {
            const failed = answers.filter((id): id is string => id !== null);
            if (failed.length > 0) {
                this.setFlaggedHere(new Set(failed), !flagged);
                this.toast.error(flagRefusalText(flagged ? 'star' : 'unstar', problems.get(failed[0]) ?? null));
            } else {
                const notice = this.toast.show({
                    type: 'success',
                    message: `${flagged ? 'Flagged' : 'Unflagged'} ${targets.length - failed.length} message(s).`,
                });
                // Every row the star reached shows it, and a refusal of any of them replaces this notice.
                this.setFlaggedRows(new Set([...reached].filter(id => !targets.some(m => m.id === id))), flagged);
                reached.forEach(id => this.flagNotices.set(id, notice));
            }
            this.answered();
            this.clearSelection();
        });
    }

    /** The star of these rows wherever they show: the list, the open message, its conversation, the search hits. */
    private setFlaggedRows(ids: ReadonlySet<string>, flagged: boolean): void {
        if (ids.size === 0) {
            return;
        }
        const apply = <T extends EmailMessageDto>(m: T): T => (ids.has(m.id) ? { ...m, flagged } : m);
        this.messages.set(this.messages().map(apply));
        this.thread.set(this.thread().map(apply));
        const sel = this.selectedMessage();
        if (sel && ids.has(sel.id)) {
            this.selectedMessage.set({ ...sel, flagged });
        }
    }

    /** The star of these rows, and of the open message when it is one of them, here. */
    private setFlaggedHere(ids: ReadonlySet<string>, flagged: boolean): void {
        this.messages.set(this.messages().map(x => (ids.has(x.id) ? { ...x, flagged } : x)));
        const sel = this.selectedMessage();
        if (sel && ids.has(sel.id)) {
            this.selectedMessage.set({ ...sel, flagged });
        }
    }

    /** The folders a message may move to: the tree's folders that open, in its order and by its names. */
    private moveChoices(): Array<{ folder: string; name: string }> {
        return this.folderRows()
            .filter(row => row.selectable)
            .map(row => ({ folder: row.folder.folder, name: row.name }));
    }

    /** A folder's name as the server's tree gives it; the path itself for one the tree does not hold. */
    folderNameOf(path: string | undefined): string {
        if (path === undefined) {
            return '';
        }

        return this.folderRows().find(row => row.folder.folder === path)?.name ?? path;
    }

    /** Move every selected message to a folder in one action (mirrors {@link bulkFlag}). */
    bulkMoveTo(folder: string, ids: ReadonlySet<string> = this.selectedIds()): void {
        const targets = this.messages().filter(m => ids.has(m.id) && (m.folder ?? this.selectedFolder()) !== folder);
        if (targets.length === 0) {
            this.clearSelection();
            return;
        }
        const asked = targets.map(m => m.id);
        const name = this.folderNameOf(folder);
        // Moved into a label from All Mail the messages stay shown: nothing leaves, the open one stays open.
        const stays = staysShown(this.roleOf(this.selectedFolder()), 'move', this.roleOf(folder));
        if (!stays) {
            this.takeAtOnce(asked);
        }
        this.bulkBusy.set(true);
        forkJoin(targets.map(m => this.email.moveMessage(m.id, folder).pipe(
            map(() => null),
            catchError((e: unknown) => of({ id: m.id, problem: problemOf(e) })),
        ))).subscribe(answers => {
            const refused = answers.filter((a): a is { id: string; problem: string | null } => a !== null);
            // One notice: the refusal's when any was refused, in place of what was done.
            const moved = asked.length - refused.length;
            if (refused.length > 0) {
                this.putBack(refused.map(r => r.id));
                this.toast.error(moveRefusalText(refused[0].problem, refused.length));
            } else if (moved > 0) {
                this.toast.success(movedText(moved, name));
            }
            const left = stays ? [] : asked.filter(id => !refused.some(r => r.id === id));
            this.dropRows(left);
            if (left.length === 0) {
                this.loadFolders();
                this.clearSelection();
            }
            this.answered();
        });
    }

    /** Delete's flow: to Trash at once with Undo, or -- in Trash -- for good after asking (trash.ts). */
    private readonly trash = new TrashFlow({
        deleteMessages:  (ids, permanent) => this.email.deleteMessages(ids, permanent),
        restoreMessages: ids => this.email.restoreMessages(ids),
        confirm:         question => this.confirmDialog.open(question),
        toast:           this.toast,
        busy:            on => (on ? this.bulkBusy.set(true) : this.answered()),
        take:            ids => this.takeAtOnce(ids),
        putBack:         ids => this.putBack(ids),
        drop:            (ids, asked) => this.dropRows(ids, asked),
        restored:        () => {
            this.loadMessages(true);
            this.loadFolders();
        },
    });

    /** Archive's flow: the server archives and answers where each message is now (archive.ts). */
    private readonly archiveFlow = new ArchiveFlow({
        archiveMessage:  id => this.email.archiveMessage(id),
        archiveMessages: ids => this.email.archiveMessages(ids),
        toast:           this.toast,
        busy:            on => (on ? this.bulkBusy.set(true) : this.answered()),
        take:            ids => this.takeAtOnce(ids),
        putBack:         ids => this.putBack(ids),
        archived:        (done, asked) => this.afterArchive(done, asked),
    });

    /**
     * Archived rows leave the list as a delete's do, the open message with them; one archived into the folder shown
     * stays. Either way the folders are read again, and with them the list, for the rows' new state.
     */
    private afterArchive(done: readonly ArchivedMessage[], asked: readonly string[]): void {
        const shown = this.selectedFolder();
        const staying = done.filter(d => d.folder === shown).map(d => d.id);
        if (staying.length > 0) {
            this.putBack(staying);
        }
        const leaving = done.filter(d => d.folder !== shown).map(d => d.id);
        if (leaving.length > 0) {
            this.dropRows(leaving, asked);
        } else if (done.length > 0) {
            this.loadFolders();
            this.clearSelection();
        }
    }

    /** Rows taken out at once and not yet answered, with their places: what a refusal puts back. */
    private readonly taken = new Map<string, TakenRow>();
    /**
     * The message that was open when it was taken out at once, until the server answers, and how many moves the
     * person had made by the time the next one opened in its place.
     */
    private takenOpen: { message: EmailMessageDetailDto; moves: number } | null = null;
    /** The action running now leaves its messages shown (staysShown): the flows' take does nothing. */
    private keepShown = false;

    /** A folder's role as the server's list of folders gives it (`all` for Gmail's All Mail), or null. */
    private roleOf(folder: string): string | null {
        return this.folders().find(f => f.folder === folder)?.role ?? null;
    }

    /** Every move of the person's in the mail page: a message opened or closed, an action run. */
    private moves = 0;

    /**
     * Archive, Delete or Move chosen: the rows leave the list at once, before the server answers, and the open
     * message with them is followed by the next one (dropRows' rule).
     */
    private takeAtOnce(ids: readonly string[]): void {
        if (this.keepShown) {
            return;
        }
        const open = this.selectedMessage();
        const { taken } = takeRows(this.messages(), new Set(ids));
        taken.forEach(t => this.taken.set(t.row.id, t));
        this.dropRows(ids, ids, false);
        if (open && ids.includes(open.id)) {
            this.takenOpen = { message: open, moves: this.moves };
        }
    }

    /**
     * The server refused these: back in their places, with their row state. The one that was open opens again only
     * while what followed it is untouched -- nothing opened, closed or acted on since; otherwise the person stays where
     * they are, and only its row comes back. Nothing is asked again.
     */
    private putBack(ids: readonly string[]): void {
        const back = ids.map(id => this.taken.get(id)).filter((t): t is TakenRow => t !== undefined);
        ids.forEach(id => this.taken.delete(id));
        this.messages.set(putRowsBack(this.messages(), back));
        const open = this.takenOpen;
        if (open && ids.includes(open.message.id)) {
            this.takenOpen = null;
            if (open.moves === this.moves) {
                this.closeMessage();
                this.selectedMessage.set(open.message);
                this.showPane('message');
            }
        }
    }

    /** The server answered for these: nothing to put back. */
    private forget(ids: readonly string[]): void {
        ids.forEach(id => this.taken.delete(id));
        if (this.takenOpen && ids.includes(this.takenOpen.message.id)) {
            this.takenOpen = null;
        }
    }

    /** The listed messages among `ids`: an action names only rows the page shows. */
    private listed(ids: readonly string[]): string[] {
        return this.messages().filter(m => ids.includes(m.id)).map(m => m.id);
    }

    /**
     * The rows an archive, a delete or a move took out of this folder leave the list. When the open message left with
     * them: side by side, the next one opens by the normal open (nextOpenAfter, from the list as it showed, `asked`
     * being the rows acted on), or the pane empties with none left; one pane at a time, the list shows. `answered`:
     * the server answered for them, so nothing of theirs is kept to put back and the counts are read again; false for
     * rows taken out at once.
     */
    private dropRows(ids: readonly string[], asked: readonly string[] = ids, answered = true): void {
        if (answered) {
            this.forget(ids);
        }
        if (ids.length === 0) {
            return;
        }
        const gone = new Set(ids);
        const listed = this.messages();
        this.messages.set(listed.filter(m => !gone.has(m.id)));
        const open = this.selectedMessage();
        if (open && gone.has(open.id)) {
            this.selectedMessage.set(null);
            if (this.onePane()) {
                this.leavePane('message');
            } else {
                // The next stored row: a server row is opened only when chosen.
                const nextId = nextOpenAfter(storedIds(listed), open.id, gone, new Set(asked));
                const next = listed.find(m => !isServerRow(m) && m.id === nextId);
                if (next) {
                    this.openMessage(next);
                }
            }
        }
        if (answered) {
            this.loadFolders();
        }
        this.clearSelection();
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

    /**
     * View one attachment in the app: its bytes fetched with the session from the download route, a pdf into the PDF
     * viewer and an image into the preview, as {@link attachmentViewKind} decides. A pdf whose download is not served
     * as application/pdf, or an image not served as a PNG, JPEG, GIF or WebP image, is not shown. Focus goes back to
     * `button` when the viewer closes.
     */
    viewAttachment(att: EmailAttachmentDto, button: HTMLElement | null): void {
        const msg = this.selectedMessage();
        const kind = attachmentViewKind(att);
        if (!msg || kind === null || this.viewingAttachment() !== null) {
            return;
        }
        const seq = this.openSeq;
        this.viewingAttachment.set(att.index);
        this.email.fetchAttachmentResponse(msg.id, att.index).subscribe({
            next: answer => {
                this.viewingAttachment.set(null);
                if (seq !== this.openSeq) {
                    return;
                }
                const shown = kind === 'pdf'
                    ? openPdfAttachment(this.dialog, answer, att.filename, button)
                    : openImageAttachment(this.dialog, answer, att.filename, button);
                if (shown === null) {
                    this.toast.error(`Couldn't show "${att.filename}" here. Download it instead.`);
                }
            },
            error: () => {
                this.viewingAttachment.set(null);
                this.toast.error(`Couldn't open "${att.filename}".`);
            },
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
        // A server row is never checked: any click opens it.
        if (isServerRow(m)) {
            ev.preventDefault();
            this.openServerRow(m);
        } else if (ev.shiftKey) {
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
        if (isServerRow(m)) {
            return;
        }
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
        // Server rows between the two are left out: they are never checked.
        const ids = storedIds(this.messages());
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
        this.selectedIds.set(new Set(storedIds(this.messages())));
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
        // A row also counts when another read write is in flight for it with the other value: the last choice wins.
        const targets = this.messages().filter(m => ids.has(m.id)
            && ((m.seen ?? false) !== seen || (this.pendingReads.choice(m.id) ?? seen) !== seen));
        if (targets.length === 0) {
            this.clearSelection();
            return;
        }
        const folder = this.selectedFolder();
        const chosen = targets.map(m => m.id);
        const token = this.pendingReads.chosen(chosen, seen);
        // At once: the rows, the open message and the folder's count change now; a row whose call fails changes back.
        this.setSeenHere(new Set(targets.filter(m => (m.seen ?? false) !== seen).map(m => m.id)), seen, folder);
        this.bulkBusy.set(true);
        const sequences = new Map<string, number>();
        const problems = new Map<string, string | null>();
        const reached = new Set<string>();
        forkJoin(targets.map(m => this.email.markSeen(m.id, seen).pipe(
            map(answer => {
                // Every row the change was applied to (on Gmail, the message's row in each label), [the row] if unsaid.
                const at = answerSeq(answer);
                for (const id of idsOf((answer as { ids?: unknown } | null)?.ids, m.id)) {
                    reached.add(id);
                    if (at !== null) {
                        sequences.set(id, at);
                    }
                }
                return null;
            }),
            catchError((e: unknown) => {
                problems.set(m.id, problemOf(e));
                return of(m.id);
            }),
        ))).subscribe(answers => {
            // A choice the person replaced since is not this answer's to apply.
            const failed = answers.filter((id): id is string => id !== null && this.pendingReads.current(id, token));
            // The rows the change reached beyond those chosen join the choice and show it, every one of them.
            const also = [...reached].filter(id => !chosen.includes(id));
            this.pendingReads.join(also, token, seen);
            this.setSeenRows(new Set(also.filter(id => this.pendingReads.current(id, token))), seen);
            const done = [...chosen.filter(id => !failed.includes(id)), ...also];
            this.pendingReads.refused(failed, token);
            if (failed.length > 0) {
                this.setSeenHere(new Set(failed), !seen, folder);
                this.toast.error(flagRefusalText(seen ? 'read' : 'unread', problems.get(failed[0]) ?? null));
                this.pendingReads.answered(done, token, null, sequences);
            } else {
                const notice = this.toast.show({
                    type: 'success',
                    message: `Marked ${chosen.length - failed.length} message(s) ${seen ? 'read' : 'unread'}.`,
                });
                this.pendingReads.answered(done, token, notice, sequences);
            }
            this.answered();
            this.clearSelection();
        });
    }

    /**
     * Read or unread for these rows wherever they show -- the list, the open message, its conversation, the search
     * hits -- and nothing else: the folder counts wait for the server's.
     */
    private setSeenRows(ids: ReadonlySet<string>, seen: boolean): void {
        if (ids.size === 0) {
            return;
        }
        const apply = <T extends EmailMessageDto>(m: T): T => (ids.has(m.id) ? { ...m, seen } : m);
        this.messages.set(this.messages().map(apply));
        this.thread.set(this.thread().map(apply));
        this.searchResults.set(this.searchResults().map(x => (ids.has(x.id) ? { ...x, seen } : x)));
        const sel = this.selectedMessage();
        if (sel && ids.has(sel.id)) {
            this.selectedMessage.set({ ...sel, seen });
        }
    }

    /** Read or unread for these rows, the open message among them, and the folder's unread count, here. */
    private setSeenHere(ids: ReadonlySet<string>, seen: boolean, folder: string): void {
        this.messages.set(this.messages().map(x => (ids.has(x.id) ? { ...x, seen } : x)));
        const sel = this.selectedMessage();
        if (sel && ids.has(sel.id)) {
            this.selectedMessage.set({ ...sel, seen });
        }
        const delta = seen ? -ids.size : ids.size;
        this.folders.set(this.folders().map(f => (f.folder === folder ? applyUnreadDelta(f, delta) : f)));
        const mbId = this.selectedMailboxId();
        if (mbId !== null) {
            this.followLocalUnread(mbId, folder, delta);
        }
    }

    /** Compose: always a new window, on a kept draft of a new message not open in another, else an empty one. */
    openCompose(): void {
        const closed = this.makeRoom();
        this.startWindow();
        this.composeMode.set('compose');
        this.replyTargetId.set(null);
        this.composeTo = [];
        this.composeCc = [];
        this.composeBcc = [];
        this.composeShowCcBcc.set(false);
        this.composeAskedCc.set(false);
        this.composeAskedBcc.set(false);
        this.contactOptions.set([]);
        this.composeSubject = '';
        this.clearComposeBody();
        // Baseline for dirty-tracking (a fresh compose is empty), then the newest kept draft of a new message, so the
        // person continues where they left off.
        this.snapshotComposeInitial();
        this.composeMinimized.set(false);
        this.composeOpen.set(true);
        const draft = this.startDraft(null);
        if (draft !== null) {
            this.findNewMessageDraft(draft, closed);
        }
    }

    /**
     * The newest of the person's drafts of a new message in the mailbox that no window holds (never one whose window was
     * just closed to make room), taken by a window that holds nothing yet.
     */
    private findNewMessageDraft(draft: ServerDraft, closed: ReadonlySet<string>): void {
        this.email.listDrafts(draft.mailboxId).subscribe({
            next: list => {
                const held = new Set([...closed, ...this.openDraftIds()]);
                const found = list.find(d => (d.answers ?? null) === null && !held.has(d.id));
                if (found !== undefined && this.activeDraft() === draft && draft.id === null && !draft.pending
                    && !this.isComposeDirty()) {
                    draft.adopt(found);
                    this.applyDraft(found);
                }
            },
            error: () => undefined,
        });
    }

    /**
     * The window's draft: what it answers, saved through the drafts API. A newer copy read from the server is drawn;
     * a draft gone elsewhere closes the window, keeping nothing, unless a save of what was written there found it
     * gone: then the window keeps it as a new draft and says so.
     */
    private startDraft(answers: EmailDraftAnswers | null): ServerDraft | null {
        const mailboxId = this.selectedMailboxId();
        if (mailboxId === null) {
            this.activeDraft.set(null);
            return null;
        }
        const draft = this.windowDraftOf(mailboxId, answers);
        this.activeDraft.set(draft);

        return draft;
    }

    /** A window's draft object, told to whichever window holds it: the open one or a bar. */
    private windowDraftOf(mailboxId: string, answers: EmailDraftAnswers | null): ServerDraft {
        const draft: ServerDraft = new ServerDraft(this.email, mailboxId, answers, {
            loaded: d => {
                if (this.activeDraft() === draft) {
                    this.applyDraft(d);
                } else {
                    this.parkedWindows.update(list => list.map(w => (w.draft === draft ? parkedWithDraft(w, d) : w)));
                }
            },
            gone: kept => {
                if (kept !== null) {
                    // Deleted elsewhere while what was written here was being saved: it stays, as a new draft.
                    const again = this.windowDraftOf(draft.mailboxId, draft.answers);
                    if (this.activeDraft() === draft) {
                        this.activeDraft.set(again);
                    } else {
                        this.parkedWindows.update(list => list.map(w => (w.draft === draft ? { ...w, draft: again } : w)));
                    }
                    again.save(kept);
                    this.toast.info(DRAFT_GONE_KEPT);
                    return;
                }
                if (this.activeDraft() === draft) {
                    this.cancelDraftSave();
                    this.activeDraft.set(null);
                    this.composeOpen.set(false);
                    this.clearComposeBody();
                } else {
                    this.parkedWindows.update(list => list.filter(w => w.draft !== draft));
                }
            },
        });

        return draft;
    }

    /** A realtime change to one of the person's drafts: each window's and the quick reply's read again, or gone. */
    private onDraftsChanged(event: MailDraftsChangedEvent): void {
        for (const draft of [this.activeDraft(), ...this.parkedWindows().map(w => w.draft)]) {
            draft?.told(event);
        }
        this.quickReply()?.onDraftsChanged(event);
    }

    /** The ids of the drafts the open windows hold. */
    private openDraftIds(): string[] {
        return [this.activeDraft(), ...this.parkedWindows().map(w => w.draft)]
            .map(d => d?.id ?? null)
            .filter((id): id is string => id !== null);
    }

    private cancelDraftSave(): void {
        if (this.draftSaveTimer !== null) {
            clearTimeout(this.draftSaveTimer);
            this.draftSaveTimer = null;
        }
    }

    /** The open window lets go of its draft: what is owed is saved first, and the draft is kept. */
    private settleWindow(): void {
        if (!this.composeOpen()) {
            return;
        }
        this.cancelDraftSave();
        this.saveDraftNow();
        const draft = this.activeDraft();
        if (draft !== null && isReplyMode(this.composeMode())) {
            this.rememberWindowDraft(draft);
        }
        draft?.release();
        this.activeDraft.set(null);
    }

    /** A reply draft a window held: once its save has landed its id is known, and the quick reply keeps it out of the box. */
    private rememberWindowDraft(draft: ServerDraft): void {
        draft.settled(() => {
            const id = draft.id;
            if (id !== null && !this.windowReplyDrafts().has(id)) {
                this.windowReplyDrafts.update(ids => new Set([...ids, id]));
            }
        });
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

    /**
     * Reply, Reply all or Forward on the open message: the composer opens at once and says it is being prepared, then
     * takes the server's recipients, subject, From and quote (`GET .../compose?mode=`). The person writes above the
     * quote; the person's draft of this answer on the server (the one handed over, else the one the lookup finds) takes
     * the place of what was served.
     */
    openPrefilled(mode: EmailComposeMode, messageId: string | null = null, draftId: string | null = null): void {
        const id = messageId ?? this.selectedMessage()?.id ?? null;
        const mailboxId = this.selectedMailboxId();
        if (id === null || mailboxId === null) {
            return;
        }
        // One window per answer: the one already holding it comes up. Reply and reply all share one draft, so either
        // brings up the window holding the other.
        const holds = (m: 'compose' | EmailComposeMode, target: string | null): boolean => target === id
            && (m === mode || (isReplyMode(m) && isReplyMode(mode)));
        if (this.composeOpen() && holds(this.composeMode(), this.replyTargetId())) {
            this.composeMinimized.set(false);
            this.focusComposeBody();
            return;
        }
        const parked = this.parkedWindows().find(w => holds(w.mode, w.replyTargetId));
        if (parked !== undefined) {
            this.activateWindow(parked.id);
            return;
        }
        this.makeRoom();
        this.startWindow();
        this.composeMode.set(mode);
        this.replyTargetId.set(id);
        this.composeTo = [];
        this.composeCc = [];
        this.composeBcc = [];
        this.composeShowCcBcc.set(false);
        this.composeAskedCc.set(false);
        this.composeAskedBcc.set(false);
        this.contactOptions.set([]);
        this.prefillOptions.set([]);
        this.composeSubject = '';
        this.clearComposeBody();
        this.composeMinimized.set(false);
        this.composeOpen.set(true);
        this.startDraft({ messageId: id, mode });
        this.readPrefill(id, mode, draftId);
    }

    /**
     * Reply, and the quick reply's Expand: the compose window opens on the open message's reply. What the quick reply
     * holds is saved first and its draft is handed over by id, so the window writes the same draft and never a second.
     * The box then says the reply is open in the window.
     */
    handReplyToWindow(handOff: QuickReplyHandOff | null = null): void {
        const msg = this.selectedMessage();
        if (!msg || isServerRow(msg) || this.selectedMailboxId() === null) {
            return;
        }
        const quick = this.quickReply();
        if (handOff === null && quick !== undefined && !this.replyWindowHolds()) {
            quick.handOff(given => this.openPrefilled(given.mode, null, given.draftId));
            return;
        }
        this.openPrefilled(handOff?.mode ?? 'reply', null, handOff?.draftId ?? null);
    }

    /** The quick reply's Show it: the window holding the reply comes up, or opens again on its draft. */
    showReplyWindow(handOff: QuickReplyHandOff | null = null): void {
        this.handReplyToWindow(handOff);
    }

    /** Read the prefill again after a failure that may pass. */
    retryPrefill(): void {
        const id = this.replyTargetId();
        const mode = this.composeMode();
        if (id !== null && mode !== 'compose') {
            this.readPrefill(id, mode, this.activeDraft()?.id ?? null);
        }
    }

    /** The server's prefill of an answer, and the person's draft of it, read together; the draft is drawn over it. */
    private readPrefill(id: string, mode: EmailComposeMode, draftId: string | null = null): void {
        const seq = ++this.prefillSeq;
        this.composePrefill.set({ state: 'loading' });
        const mailboxId = this.selectedMailboxId();
        forkJoin({
            answer: this.email.composePrefill(id, mode).pipe(take(1)),
            draft: mailboxId === null ? of(null) : this.answerDraft(mailboxId, id, mode, draftId).pipe(take(1)),
        }).subscribe({
            next: ({ answer, draft }) => {
                if (seq !== this.prefillSeq) {
                    return;
                }
                this.composeTo = addressesOf(answer.to);
                this.composeCc = addressesOf(answer.cc);
                this.composeShowCcBcc.set(this.composeCc.length > 0);
                this.prefillOptions.set(recipientOptionsOf([...answer.to, ...answer.cc]));
                this.composeSubject = answer.subject;
                this.forwardFilesKept.set(mode === 'forward' ? forwardFiles(answer.attachments) : []);
                this.composePrefill.set({ state: 'ready', answer });
                // Baseline = what was served (an untouched answer is no draft), then this answer's draft.
                this.snapshotComposeInitial();
                const held = this.activeDraft();
                if (draft !== null && held !== null && !held.pending && (held.id === null || held.id === draft.id)) {
                    held.adopt(draft);
                    this.applyDraft(draft);
                }
                this.focusComposeBody();
            },
            error: (e: unknown) => {
                if (seq !== this.prefillSeq) {
                    return;
                }
                this.composePrefill.set({ state: 'failed', ...prefillFailure(e, mode) });
            },
        });
    }

    /**
     * The draft an answer opens on: the one handed over (the quick reply's), else the message's reply draft for a reply
     * or a reply to all, or a forward of it for a forward. None found, or not read: none.
     */
    private answerDraft(mailboxId: string, messageId: string, mode: EmailComposeMode, draftId: string | null): Observable<EmailDraftDto | null> {
        const found = draftId !== null
            ? this.email.readDraft(mailboxId, draftId)
            : this.email.draftsAnswering(mailboxId, messageId).pipe(map(list => (isReplyMode(mode)
                ? replyDraftOf(list)
                : list.find(d => d.answers?.mode === 'forward' && !this.openDraftIds().includes(d.id)) ?? null)));

        return found.pipe(catchError(() => of(null)));
    }

    /** Toggle the composer dock between full-size and its collapsed header bar.
     *  The form stays mounted (its draft + editor state survive), so it restores as left. */
    toggleMinimize(): void {
        if (this.composeMinimized()) {
            this.composeMinimized.set(false);
            this.touchWindow();
            this.focusComposeBody();
        } else {
            this.minimizeCompose();
        }
    }

    /** Minimize (and Esc, and a click on the backdrop): the window becomes its bar; the draft is kept. */
    minimizeCompose(): void {
        this.composeMinimized.set(true);
        afterNextRender(() => this.composeDock()?.nativeElement.querySelector<HTMLElement>('#mbx-compose-title')?.focus(),
            { injector: this.injector });
    }

    /** Maximize, and Restore back to the dock. */
    toggleMaximize(): void {
        this.composeMaximized.update(v => !v);
        this.focusComposeBody();
    }

    /**
     * The window's keys. Ctrl+Enter (Cmd+Enter on a Mac) sends. Esc minimizes, but an open suggestion list or menu
     * inside the window takes that Esc to close itself, and only the next one minimizes.
     */
    onComposeKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (this.composeMaySend() && !this.sending()) {
                this.sendCompose();
            }
            return;
        }
        if (event.key !== 'Escape' || event.defaultPrevented || this.composeMinimized()) {
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        // A recipient field's suggestions close on this Esc (they are still drawn while it passes).
        if (target?.closest('app-tag-input')?.querySelector('.tagin-menu') != null) {
            return;
        }
        if (target?.closest('[role="menu"], [role="listbox"]') != null) {
            return;
        }
        event.preventDefault();
        this.minimizeCompose();
    }

    /** The window was used now: the one left unused longest closes first when a fourth opens. */
    touchWindow(): void {
        this.activeLastUsed = ++this.windowClock;
    }

    titleOf(mode: 'compose' | EmailComposeMode, subject: string): string {
        return windowTitle(mode, subject);
    }

    recipientsOf(to: readonly string[], cc: readonly string[]): string {
        return windowRecipients(to, cc);
    }

    /**
     * Room for one more window: the one being written in becomes a bar (its draft saved), and past the most windows
     * the bars left unused longest close, their drafts kept.
     */
    private makeRoom(): Set<string> {
        if (this.composeOpen()) {
            this.parkActive();
        }
        const closing = windowsToClose(this.parkedWindows());
        const ids = new Set(closing.map(w => w.id));
        if (ids.size > 0) {
            this.parkedWindows.update(list => list.filter(w => !ids.has(w.id)));
        }

        // Their drafts are kept on the server; nothing more is drawn from them here.
        for (const w of closing) {
            if (w.draft !== null && isReplyMode(w.mode)) {
                this.rememberWindowDraft(w.draft);
            }
            w.draft?.release();
        }

        return new Set(closing.map(w => w.draft?.id ?? null).filter((id): id is string => id !== null));
    }

    /** A new window is the one being written in. */
    private startWindow(): void {
        this.activeWindowId = ++this.windowSeq;
        this.composeMaximized.set(false);
        this.composeFromChosen.set(null);
        this.touchWindow();
        const mailboxId = this.selectedMailboxId();
        if (mailboxId !== null) {
            this.readAliases(mailboxId);
        }
    }

    /** The mailbox's confirmed aliases, read once: From shows only when there is one. */
    private readAliases(mailboxId: string): void {
        if (mailboxId in this.confirmedAliases()) {
            return;
        }
        this.confirmedAliases.update(all => ({ ...all, [mailboxId]: [] }));
        this.email.listAliases(mailboxId).subscribe({
            next: list => this.confirmedAliases.update(all => ({
                ...all,
                [mailboxId]: list.aliases.filter(a => a.status === 'confirmed').map(a => a.address),
            })),
            error: () => undefined,
        });
    }

    /** The window being written in becomes a bar: its draft saved, its fields kept as they are. */
    private parkActive(): void {
        if (this.draftSaveTimer !== null) {
            clearTimeout(this.draftSaveTimer);
            this.draftSaveTimer = null;
        }
        this.saveDraftNow();
        const snapshot: ComposeWindowSnapshot = {
            id: this.activeWindowId,
            lastUsed: this.activeLastUsed,
            draft: this.activeDraft(),
            mode: this.composeMode(),
            replyTargetId: this.replyTargetId(),
            prefill: this.composePrefill(),
            prefillOptions: this.prefillOptions(),
            to: [...this.composeTo],
            cc: [...this.composeCc],
            bcc: [...this.composeBcc],
            showCcBcc: this.composeShowCcBcc() || this.composeAskedCc() || this.composeAskedBcc(),
            subject: this.composeSubject,
            text: this.composeText,
            html: this.composeHtml(),
            rich: this.composeRich(),
            attachments: this.composeAttachments(),
            quoteKept: this.composeQuoteKept(),
            forwardFiles: this.forwardFilesKept(),
            from: this.composeFromChosen(),
            maximized: this.composeMaximized(),
            initial: {
                to: this.composeToInitial, cc: this.composeCcInitial, bcc: this.composeBccInitial,
                subject: this.composeSubjectInitial, text: this.composeTextInitial, html: this.composeHtmlInitial,
                rich: this.composeRichInitial,
            },
        };
        this.parkedWindows.update(list => [...list, snapshot]);
        this.activeDraft.set(null);
        this.composeOpen.set(false);
        this.clearComposeBody();
    }

    /** A bar's click: that window is the one being written in again, as it was left. */
    activateWindow(id: number): void {
        const w = this.parkedWindows().find(x => x.id === id);
        if (w === undefined) {
            return;
        }
        if (this.composeOpen()) {
            this.parkActive();
        }
        this.parkedWindows.update(list => list.filter(x => x.id !== id));
        this.clearComposeBody();
        this.activeWindowId = w.id;
        this.activeDraft.set(w.draft);
        this.composeMode.set(w.mode);
        this.replyTargetId.set(w.replyTargetId);
        this.composePrefill.set(w.prefill);
        this.prefillOptions.set(w.prefillOptions);
        this.composeTo = [...w.to];
        this.composeCc = [...w.cc];
        this.composeBcc = [...w.bcc];
        this.composeShowCcBcc.set(w.showCcBcc);
        this.composeAskedCc.set(false);
        this.composeAskedBcc.set(false);
        this.composeSubject = w.subject;
        this.composeText = w.text;
        this.composeHtml.set(w.html);
        this.composeRich.set(w.rich);
        this.composeAttachments.set(w.attachments);
        this.composeQuoteKept.set(w.quoteKept);
        this.forwardFilesKept.set(w.forwardFiles);
        this.composeFromChosen.set(w.from);
        this.composeMaximized.set(w.maximized);
        this.composeToInitial = w.initial.to;
        this.composeCcInitial = w.initial.cc;
        this.composeBccInitial = w.initial.bcc;
        this.composeSubjectInitial = w.initial.subject;
        this.composeTextInitial = w.initial.text;
        this.composeHtmlInitial = w.initial.html;
        this.composeRichInitial = w.initial.rich;
        this.contactOptions.set([]);
        this.touchWindow();
        this.composeMinimized.set(false);
        this.composeOpen.set(true);
        // A prefill still being read when it became a bar is read again.
        if (w.prefill?.state === 'loading' && w.replyTargetId !== null && w.mode !== 'compose') {
            this.readPrefill(w.replyTargetId, w.mode, w.draft?.id ?? null);
        }
        this.focusComposeBody();
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
            || this.composeRich() !== this.composeRichInitial
            || !this.composeQuoteKept()
            || this.removedForwardParts().length > 0
            || storedAttachments(this.composeAttachments()).length > 0;
    }

    /** The body's bytes as the composer counts them against the mailbox's limit: the text and, when rich, the HTML. */
    composeBodyBytes(): number {
        const rich = this.composeRich();
        const source = rich ? this.composeHtml() : this.composeText;
        if (this.bodyBytesMemo === null || this.bodyBytesMemo.rich !== rich || this.bodyBytesMemo.source !== source) {
            const encoder = new TextEncoder();
            const bytes = rich
                ? encoder.encode(this.htmlToPlainText(source)).length + encoder.encode(source).length
                : encoder.encode(source).length;
            this.bodyBytesMemo = { rich, source, bytes };
        }

        return this.bodyBytesMemo.bytes;
    }

    /** The last body measured, so a check of the view does not parse the HTML again. */
    private bodyBytesMemo: { rich: boolean; source: string; bytes: number } | null = null;

    /**
     * A draft from the server, drawn in the window: what was written, its files and its choices. Reply and reply all
     * share one draft: opened as the other, the recipients are this mode's prefill's, and the next save switches it.
     */
    private applyDraft(draft: EmailDraftDto): void {
        this.cancelDraftSave();
        const mode = this.composeMode();
        const answered = draft.answers?.mode ?? null;
        const switched = mode !== 'compose' && answered !== null && answered !== mode;
        if (!switched && (mode === 'compose' || draft.to.length > 0)) {
            this.composeTo = [...draft.to];
            this.composeCc = [...draft.cc];
            this.composeBcc = [...draft.bcc];
        }
        if (this.composeCc.length > 0 || this.composeBcc.length > 0) {
            this.composeShowCcBcc.set(true);
        }
        if (mode === 'compose' || draft.subject !== '') {
            this.composeSubject = draft.subject;
        }
        this.composeText = draft.text;
        this.composeRich.set(draft.html !== null);
        this.composeHtml.set(draft.html ?? '');
        this.composeAttachments.set(restoredAttachments(draftFiles(draft)));
        this.composeFromChosen.set(draft.from);
        if (mode !== 'compose') {
            this.composeQuoteKept.set(draft.quote !== false);
        }
        if (mode === 'forward') {
            const kept = new Set(draft.messageParts.map(p => p.part));
            this.forwardFilesKept.update(list => list.filter(p => kept.has(p.part)));
        }
        this.composeKey.update(k => String(Number(k) + 1)); // re-mount the editor with the draft
        if (switched) {
            this.activeDraft()?.switchMode(mode);
            this.onComposeChange();
        }
    }

    /** Debounced autosave hook -- called from the composer field change bindings. */
    onComposeChange(): void {
        this.touchWindow();
        if (this.draftSaveTimer !== null) {
            clearTimeout(this.draftSaveTimer);
        }
        this.draftSaveTimer = setTimeout(() => this.saveDraftNow(), 600);
    }

    /** Saves the window's draft: nothing written makes no draft; once there is one, every change is saved to it. */
    private saveDraftNow(): void {
        const draft = this.activeDraft();
        if (draft === null || !this.composeFieldsShown()) {
            return;
        }
        if (draft.id === null && !draft.pending && !this.isComposeDirty()) {
            return;
        }
        draft.save(this.windowDraft());
    }

    /** The window as the whole draft: every field, the quote choice always stated. */
    private windowDraft(): EmailDraftWrite {
        const mode = this.composeMode();
        const rich = this.composeRich();
        const html = this.composeHtml();

        return {
            to: [...this.composeTo],
            cc: [...this.composeCc],
            bcc: [...this.composeBcc],
            subject: this.composeSubject,
            text: rich ? this.htmlToPlainText(html) : this.composeText,
            html: rich ? html : null,
            attachments: storedAttachments(this.composeAttachments()).map(a => a.id),
            from: this.composeFromChosen() ?? this.prefillAnswer()?.from.address ?? null,
            quote: mode !== 'compose' && this.composeQuoteKept(),
            messageParts: mode === 'forward' ? this.forwardFilesKept().map(f => ({ messageId: f.messageId, part: f.part })) : [],
        };
    }

    /**
     * Discard: the window closes. With no draft on the server nothing is saved; with one, it is deleted (a save on its
     * way lands first, and its draft is the one deleted, so a draft never survives a Discard because the two crossed)
     * and the notice offers Undo for 10 seconds, which makes the draft again from its last content. The draft's files
     * are removed on the server once Undo is no longer offered.
     */
    discardDraft(): void {
        this.cancelDraftSave();
        const draft = this.activeDraft();
        const mode = this.composeMode();
        const target = this.replyTargetId();
        const last = this.composeFieldsShown() ? this.windowDraft() : null;
        const mailboxId = this.selectedMailboxId();
        this.activeDraft.set(null);
        this.composeOpen.set(false);
        this.clearComposeBody();
        if (draft === null) {
            return;
        }
        draft.discard(deleted => {
            if (deleted) {
                this.offerUndoDiscard(draft.mailboxId, mode, target, draft.answers, mailboxId !== null ? last : null);
            }
        });
    }

    /**
     * The notice after a Discard: Undo for 10 seconds makes the draft again from its last content and opens its window;
     * the draft's files are removed on the server once Undo is no longer offered.
     */
    private offerUndoDiscard(
        mailboxId: string,
        mode: 'compose' | EmailComposeMode,
        target: string | null,
        answers: EmailDraftAnswers | null,
        last: EmailDraftWrite | null,
    ): void {
        const removeFiles = setTimeout(() => {
            for (const id of last?.attachments ?? []) {
                this.email.removeAttachment(mailboxId, id).subscribe({ error: () => undefined });
            }
        }, DISCARD_UNDO_MS);
        this.toast.show({
            type: 'info',
            message: 'Draft discarded.',
            action: {
                label: 'Undo',
                run: () => {
                    clearTimeout(removeFiles);
                    if (last !== null) {
                        this.undoDiscard(mailboxId, mode, target, answers, last);
                    }
                },
            },
        }, DISCARD_UNDO_MS);
    }

    /** The quick reply's draft line deleted the reply draft: the same notice, whose Undo opens it in the window. */
    quickReplyDiscarded(discarded: QuickReplyDiscarded): void {
        const answers = discarded.answers;
        const mode = answers?.mode ?? 'reply';
        this.offerUndoDiscard(discarded.mailboxId, mode, answers?.messageId ?? null, answers, discarded.last);
    }

    /** Undo of a Discard: the draft is made again from its last content, and its window opens on it. */
    private undoDiscard(
        mailboxId: string,
        mode: 'compose' | EmailComposeMode,
        target: string | null,
        answers: EmailDraftAnswers | null,
        last: EmailDraftWrite,
    ): void {
        // A reply draft made elsewhere meanwhile is refused as a second, and that one is opened instead.
        const again = new ServerDraft(this.email, mailboxId, answers, { loaded: () => undefined, gone: () => undefined });
        again.save(last);
        again.settled(() => {
            again.release();
            const id = again.id;
            if (id === null) {
                return;
            }
            if (mode !== 'compose' && target !== null) {
                this.openPrefilled(mode, target, id);
                return;
            }
            this.makeRoom();
            this.startWindow();
            this.composeMode.set('compose');
            this.replyTargetId.set(null);
            this.composeTo = [];
            this.composeCc = [];
            this.composeBcc = [];
            this.composeShowCcBcc.set(false);
        this.composeAskedCc.set(false);
        this.composeAskedBcc.set(false);
            this.composeSubject = '';
            this.clearComposeBody();
            this.snapshotComposeInitial();
            this.composeMinimized.set(false);
            this.composeOpen.set(true);
            const draft = this.startDraft(null);
            if (draft !== null) {
                this.email.readDraft(mailboxId, id).subscribe({
                    next: d => {
                        if (this.activeDraft() === draft) {
                            draft.adopt(d);
                            this.applyDraft(d);
                        }
                    },
                    error: () => undefined,
                });
            }
        });
    }

    closeCompose(): void {
        // The latest edit is saved (the pause may not have passed), then the window closes. The draft is KEPT:
        // reopening finds it; Discard is the explicit delete.
        this.settleWindow();
        this.composeOpen.set(false);
        this.clearComposeBody();
    }

    /** Remove quote: the message goes without the quote, which is no longer shown. */
    removeQuote(): void {
        this.composeQuoteKept.set(false);
        this.onComposeChange();
    }

    /** A forward's file the person does not want sent. */
    removeForwardFile(part: number): void {
        this.forwardFilesKept.update(list => list.filter(p => p.part !== part));
        this.onComposeChange();
    }

    /** The forward's served files the person removed, by part. */
    private removedForwardParts(): number[] {
        const answer = this.prefillAnswer();
        if (answer === null || answer.mode !== 'forward') {
            return [];
        }
        const kept = new Set(this.forwardFilesKept().map(p => p.part));

        return forwardFiles(answer.attachments).map(p => p.part).filter(p => !kept.has(p));
    }

    /** After a refusal because the original could not be read: the same message, without the quote. */
    sendWithoutQuote(): void {
        this.composeQuoteKept.set(false);
        this.composeQuoteRefused.set(false);
        this.sendCompose();
    }

    /** The empty editor (or the plain text) takes the focus once the composer has drawn it. */
    private focusComposeBody(tries = 40): void {
        afterNextRender(() => {
            const box = this.composeDock()?.nativeElement;
            const body = box?.querySelector<HTMLElement>('[contenteditable="true"], textarea') ?? null;
            if (body !== null) {
                body.focus({ preventScroll: true });
            } else if (tries > 0 && this.composeOpen()) {
                setTimeout(() => this.focusComposeBody(tries - 1), 25);
            }
        }, { injector: this.injector });
    }

    /** Flip the composer between the rich `<coolms-editor>` and the plain textarea.
     *  Both bodies persist independently, so a round-trip toggle loses nothing. */
    toggleComposeRich(): void {
        this.composeRich.update(v => !v);
    }

    /** More options > Plain text: the format flips and the menu closes, the focus back on its button. */
    choosePlainText(): void {
        this.toggleComposeRich();
        this.composeMoreOpen.set(false);
        this.composeDock()?.nativeElement.querySelector<HTMLElement>('[data-testid="compose-more"]')?.focus();
    }

    /** The More options menu closes when the focus leaves it. */
    onMoreFocusOut(event: FocusEvent): void {
        const next = event.relatedTarget as Node | null;
        if (next === null || !(event.currentTarget as HTMLElement).contains(next)) {
            this.composeMoreOpen.set(false);
        }
    }

    /** Esc closes the open menu, and only the next Esc minimizes the window. */
    closeMore(event: Event): void {
        if (!this.composeMoreOpen()) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        this.composeMoreOpen.set(false);
    }

    /** The Cc or the Bcc link: that line opens, its field focused. */
    askLine(line: 'cc' | 'bcc'): void {
        (line === 'cc' ? this.composeAskedCc : this.composeAskedBcc).set(true);
        afterNextRender(() => this.composeDock()?.nativeElement
            .querySelector<HTMLInputElement>(`[data-testid="compose-${line}"] input`)?.focus(), { injector: this.injector });
    }

    /** Reset the compose BODY (both plain + rich) and force a clean editor re-mount.
     *  Recipient + subject are managed by the open* methods, not here. */
    private clearComposeBody(): void {
        this.prefillSeq++;
        this.composePrefill.set(null);
        this.composeQuoteKept.set(true);
        this.composeQuoteOpen.set(false);
        this.composeMoreOpen.set(false);
        this.composeQuoteRefused.set(false);
        this.forwardFilesKept.set([]);
        this.composeText = '';
        this.composeHtml.set('');
        this.composeAttachments.set([]);
        this.composeSendRefused.set(null);
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
        // A prepared composer sends once it is read, and only for one who may send from this mailbox.
        const prefill = this.prefillAnswer();
        if (this.composePrefill() !== null && (prefill === null || prefill.from.choices.length === 0)) {
            return;
        }
        const mode = this.composeMode();
        const quoted = (prefill?.quote ?? null) !== null && this.composeQuoteKept();
        const answering = mode === 'reply' || mode === 'reply_all';
        const rich = this.composeRich();
        const html = rich ? this.composeHtml() : '';
        // Rich mode sends an HTML body plus a stripped-tags plain-text fallback;
        // plain mode keeps the textarea text exactly as before. The quote is never part of either: the server
        // appends it.
        const text = rich ? this.htmlToPlainText(html) : this.composeText.trim();
        // An answer or a forward with its quote kept may go with no text of its own: the server adds the quote.
        if (text === '' && !quoted) {
            this.toast.error('Enter a message body.');
            return;
        }
        // Recipients are already parsed address chips; just trim/dedupe empties.
        const to = this.composeTo.map(x => x.trim()).filter(x => x !== '');
        const cc = this.composeCc.map(x => x.trim()).filter(x => x !== '');
        const bcc = this.composeBcc.map(x => x.trim()).filter(x => x !== '');
        const isReply = answering;
        if (!isReply && to.length === 0) {
            this.toast.error('Enter at least one recipient.');
            return;
        }
        const mailboxId = this.selectedMailboxId();
        if (mailboxId === null) {
            return;
        }

        const request: OutgoingEmailRequest = { text };
        if (html !== '') {
            request.html = html;
        }
        // An answer sends the From it was served (or the one chosen); a new message only a From chosen from a list.
        const from = prefill !== null || this.composeFromChoices().length > 0 ? this.composeFromValue() : null;
        if (from !== null) {
            request.from = from;
        }
        Object.assign(request, quoteFields(mode, this.replyTargetId(), (prefill?.quote ?? null) !== null,
            this.composeQuoteKept(), this.forwardFilesKept()));
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
        // A reply takes the same attachment ids as a new message, read at send as the sender.
        const files = this.composeAttachments();
        if (files.some(a => a.status === 'uploading' || a.status === 'attaching')) {
            this.toast.error('Wait for the files to finish attaching.');
            return;
        }
        if (files.some(a => a.status === 'refused')) {
            this.toast.error('Remove the files that could not be attached, then send.');
            return;
        }
        const ids = storedAttachments(files).map(a => a.id);
        if (ids.length > 0) {
            request.attachments = ids;
        }
        this.composeSendRefused.set(null);

        const replyId = this.replyTargetId();
        const draft = this.activeDraft();
        this.cancelDraftSave();
        this.sending.set(true);
        // A save on its way lands first, so the send names the draft it was written in: the server removes it once the
        // message is sent, and keeps it when the send fails.
        const go = (): void => {
            const draftId = draft?.id ?? null;
            if (draftId !== null) {
                request.draftId = draftId;
            }
            const call = isReply && replyId !== null
                ? this.email.reply(replyId, request)
                : this.email.send(mailboxId, request);
            call.subscribe({
                next: () => {
                    this.sending.set(false);
                    // The server removed the draft with the send.
                    draft?.release();
                    if (this.activeDraft() === draft) {
                        this.activeDraft.set(null);
                    }
                    this.composeOpen.set(false);
                    this.clearComposeBody();
                    this.toast.success(isReply ? 'Reply sent.' : 'Message sent.');
                    // Refresh folders (Sent count) + the current message list.
                    this.loadFolders();
                },
                error: (e: unknown) => {
                    this.sending.set(false);
                    // A failed send keeps the draft: the window as it is is saved to it.
                    this.onComposeChange();
                    // The original could no longer be read: nothing went; the composer offers to send without the quote.
                    if (quotedMessageUnavailable(e)) {
                        this.composeQuoteRefused.set(true);
                        return;
                    }
                    // A file no longer there to send is marked on its chip; a message over the limit shows both sizes.
                    const expired = expiredAttachmentId(e);
                    if (expired !== null) {
                        const words = 'This file is no longer there to send. Remove it and attach it again.';
                        this.composeAttachments.update(list => list.map(a => (a.id === expired
                            ? { ...a, status: 'refused' as const, refusal: words }
                            : a)));
                        this.toast.error('A file is no longer there to send. Attach it again.');
                        return;
                    }
                    const tooLarge = tooLargeSend(e);
                    if (tooLarge !== null) {
                        this.composeSendRefused.set(tooLarge);
                        this.toast.error('The message is over the mailbox’s size limit. Remove a file and send again.');
                        return;
                    }
                    // The cause by the problem's type (SMTP or the provider's API), never the server's detail.
                    this.toast.error(sendFailureText(e));
                },
            });
        };
        if (draft === null) {
            go();
        } else {
            draft.settled(go);
        }
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
            kind: f.kind,
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
                this.takeServedUnread(list);
                const next = (preferId && list.some(m => m.id === preferId))
                    ? preferId
                    : (list[0]?.id ?? null);
                if (next === null) {
                    this.selectedMailboxId.set(null);
                    this.folders.set([]);
                    this.folderTree.set(null);
                    this.canCreateTop.set(false);
                    this.foldersFailure.set(null);
                    this.messages.set([]);
                    this.selectedMessage.set(null);
                } else {
                    this.selectMailbox(next);
                }
            },
            error: () => this.toast.error('Could not reload mailboxes.'),
        });
    }

    /**
     * A folder row's menu: the folder action tree's nodes this page has a handler for, that the folder's flags offer,
     * in the tree's order; a busy folder offers none. Asked by key, it opens under the row with its first item focused.
     */
    onFolderMenu(ask: FolderMenuAsk): void {
        const row = this.railRows().find(r => r.folder.folder === ask.folder);
        const items = row === undefined ? [] : folderMenuItems(folderNodes(this.folderActionNodes()), row.flags ?? NO_FLAGS, this.naviGraph);
        const run = (action: string): void => this.onFolderAction(action, ask.folder);
        if (ask.opener !== null) {
            this.contextMenu.openFrom(ask.opener, items, run, { focus: 'first' });
        } else {
            this.contextMenu.open(ask.event, items, run);
        }
    }

    /** One place for every action on a folder; one the folder's flags do not offer now does nothing. */
    onFolderAction(action: string, folder: string): void {
        const mailboxId = this.selectedMailboxId();
        const row = this.railRows().find(r => r.folder.folder === folder);
        if (mailboxId === null || row === undefined || !offers(row.flags ?? NO_FLAGS, action)) {
            return;
        }
        switch (action) {
            case 'mark-read':
                this.folderJobs.markRead(mailboxId, folder);
                break;
            case 'create-child':
                this.openNewFolder(mailboxId, row);
                break;
            case 'rename':
                this.openRenameFolder(mailboxId, row);
                break;
            case 'empty':
                this.askToEmpty(mailboxId, folder);
                break;
        }
    }

    /** New folder at the foot of the list: a folder at the top level, when the tree offers one. */
    createTopFolder(): void {
        const mailboxId = this.selectedMailboxId();
        if (mailboxId !== null && this.newFolderLabel() !== null) {
            this.openNewFolder(mailboxId, null);
        }
    }

    /** A folder job's end heard in realtime: the job this page follows ends; any other in the open mailbox rereads. */
    private onFolderJob(evt: MailFolderJobEvent): void {
        this.folderJobs.heard(evt);
    }

    /**
     * A folder job ended: the open mailbox's folders, their counts and the list are read again (no longer busy, and
     * marked read up to the click). One this page started that failed says why, with Retry; one done adds nothing.
     */
    private folderJobEnded(job: FolderJobDto, mine: boolean): void {
        if (mine && job.outcome === 'failed') {
            const name = this.folderNameOf(job.folder);
            // Empty is asked again from a fresh preview, never with the numbers of the one that failed.
            const again = job.action === 'mark-read'
                ? (): void => this.folderJobs.markRead(job.mailboxId, job.folder)
                : job.action === 'empty' ? (): void => this.askToEmpty(job.mailboxId, job.folder) : null;
            const retry = again === null ? {} : { action: { label: 'Retry', run: again } };
            this.toast.show({ type: 'error', message: jobFailureText(job, name), ...retry }, 10000);
        }
        this.foldersChangedIn(job.mailboxId);
    }

    /**
     * A folder job did not start: said in a sentence; a busy or gone folder's row is read again. An Empty refused because
     * the folder was renumbered since its preview is previewed again and its new numbers shown, never sent again with
     * the old ones.
     */
    private folderJobRefused(err: unknown, mailboxId: string, folder: string, action: FolderJobAction): void {
        const name = this.folderNameOf(folder);
        this.toast.error(action === 'empty' ? emptyRefusalText(err, name) : markReadRefusalText(err, name));
        if (action === 'empty' && isRenumbered(err)) {
            this.askToEmpty(mailboxId, folder);
            return;
        }
        if (busyRefusal(err) !== undefined || problemOf(err) === 'folder-not-found') {
            this.foldersChangedIn(mailboxId);
        }
    }

    /**
     * Empty: the server's preview first, its title, words and confirm label shown as given in a destructive confirm;
     * confirmed, the folder is emptied with the preview's numbers, so mail that arrived after it stays.
     */
    private askToEmpty(mailboxId: string, folder: string): void {
        const name = this.folderNameOf(folder);
        this.email.folderActionPreview(mailboxId, folder).subscribe({
            next: preview => this.confirmDialog.open({
                title: preview.title, message: preview.body, confirmLabel: preview.confirm, danger: true,
            }).subscribe(yes => {
                if (yes) {
                    this.folderJobs.empty(mailboxId, folder, preview.uidCeiling, preview.uidValidity);
                }
            }),
            error: (err: unknown) => {
                this.toast.error(emptyRefusalText(err, name));
                if (busyRefusal(err) !== undefined || problemOf(err) === 'folder-not-found') {
                    this.foldersChangedIn(mailboxId);
                }
            },
        });
    }

    /** The open mailbox's folders, counts and first page, read again; another mailbox's wait until it opens. */
    private foldersChangedIn(mailboxId: string): void {
        if (mailboxId === this.selectedMailboxId()) {
            this.loadFolders(true);
        }
    }

    /** A new folder inside `parent` (null: the top level), named in a dialog; a refusal is said in it. */
    private openNewFolder(mailboxId: string, parent: FolderRow | null): void {
        const where = parent?.folder.folder ?? null;
        openFolderNameDialog(this.dialog, {
            title: parent === null ? 'New folder' : `New folder in ${parent.name}`,
            confirmLabel: 'Create',
            name: '',
            places: [],
            parent: where,
            save: (name, inside) => this.email.createFolder(mailboxId, name, inside),
            refusal: folderChangeRefusalText,
        }).closed.subscribe(answer => {
            if (answer !== undefined) {
                this.toast.success('Folder created.');
                this.foldersChangedIn(mailboxId);
            }
        });
    }

    /**
     * Rename or move: the name, and where it goes -- where it is now, the top level when the tree offers a top-level
     * folder, or any folder the tree offers a folder inside, never the folder itself or one inside it.
     */
    private openRenameFolder(mailboxId: string, row: FolderRow): void {
        const rows = this.railRows();
        const at = rows.indexOf(row);
        let end = at + 1;
        while (end < rows.length && rows[end].depth > row.depth) {
            end++;
        }
        let parent: FolderRow | null = null;
        for (let i = at - 1; i >= 0 && row.depth > 0; i--) {
            if (rows[i].depth === row.depth - 1) {
                parent = rows[i];
                break;
            }
        }
        const indent = (depth: number): string => '\u00a0\u00a0'.repeat(depth);
        const places: FolderPlace[] = [];
        const here = parent?.folder.folder ?? null;
        if (here === null || this.canCreateTop()) {
            places.push({ parent: null, label: 'Top level' });
        }
        rows.forEach((r, i) => {
            if ((i < at || i >= end) && (r.folder.folder === here || r.flags?.canCreateChild === true)) {
                places.push({ parent: r.folder.folder, label: indent(r.depth + 1) + r.name });
            }
        });
        openFolderNameDialog(this.dialog, {
            title: `Rename or move ${row.name}`,
            confirmLabel: 'Save',
            name: row.name,
            places,
            parent: here,
            save: (name, inside) => this.email.renameFolder(mailboxId, row.folder.folder, name, inside),
            refusal: folderChangeRefusalText,
        }).closed.subscribe(answer => {
            if (answer !== undefined) {
                if (answer.from !== null && this.selectedFolder() === answer.from) {
                    this.selectedFolder.set(answer.folder);
                }
                this.toast.success('Folder saved.');
                this.foldersChangedIn(mailboxId);
            }
        });
    }

    /** The rail's Retry: the tree, its counts and the open folder's messages, read again. */
    retryFolders(): void {
        this.loadFolders();
    }

    /**
     * The mailbox's folders: the tree draws the rail, in its order and by its names; the flat list carries the counts,
     * matched by path. A tree that cannot be read is the rail's error, never a list made here. Without the flat list
     * the tree's own counts stand. After a realtime change (`firstPageOnly`) the list reads its first page only.
     */
    private loadFolders(firstPageOnly = false): void {
        const id = this.selectedMailboxId();
        if (id === null) {
            return;
        }
        forkJoin({
            tree: this.email.folderTree(id).pipe(
                map(answer => ({ nodes: answer.folders, canCreateTop: answer.canCreateTop, failure: null })),
                catchError((failure: unknown) => of({ nodes: null, canCreateTop: false, failure })),
            ),
            list: this.email.listFolders(id).pipe(catchError(() => of(null))),
        }).subscribe(({ tree, list }) => {
            this.folders.set(list ?? []);
            this.folderTree.set(tree.nodes);
            this.canCreateTop.set(tree.canCreateTop);
            this.foldersFailure.set(tree.failure);
            if (list !== null) {
                this.patchMailboxUnread(id, list);
            }
            const selectable = this.folderRows().filter(row => row.selectable);
            const current = this.selectedFolder();
            if (selectable.length > 0 && !selectable.some(row => row.folder.folder === current)) {
                this.selectedFolder.set(selectable[0].folder.folder);
            }
            if (firstPageOnly) {
                this.rereadFirstPage();
            } else {
                this.loadMessages(true);
            }
        });
    }

    /** The message pane's Retry: the folder's list, read again from its first page. */
    retryMessages(): void {
        this.loadMessages(true);
    }

    /**
     * Reads the open folder's list: its first page (`reset`), or the next one, as `request` names it (by the cursor the
     * last answer gave, or by number). A folder listed from the mail server is shown in the server's order as it came;
     * a stale cursor starts the list again from the top keeping nothing of the old pages. A page that comes back empty
     * with a next cursor (every row on it was already listed) is followed on, one read at a time, each after the list
     * is drawn. A next page not read keeps the rows shown and says so at the list's end, with Retry by the cursor sent
     * for it: it could not be read, the server could not be reached, or the server asked to wait, counted down there.
     */
    private loadMessages(reset: boolean, request: PageRequest = FIRST_PAGE): void {
        this.messagesFailure.set(null);
        this.stopListEnd();
        const id = this.selectedMailboxId();
        if (id === null) {
            this.messages.set([]);
            return;
        }
        let rereading = false;
        if (reset) {
            request = FIRST_PAGE;
            const key = `${id}
${this.selectedFolder()}`;
            rereading = key === this.listKey && this.messages().length > 0;
            if (key !== this.listKey) {
                this.listKey = key;
                this.serverListed.set(false);
                this.serverRowGone.set(false);
            }
            if (!rereading) {
                this.listNextPage = null;
                this.listAnswered = false;
                this.firstPageKeys = new Set<string>();
                this.newArrivals.set(0);
                this.listScroll()?.nativeElement.scrollTo({ top: 0 });
            }
        }
        const seq = ++this.listSeq;
        this.loadingMessages.set(true);
        this.loadingNextPage.set(!reset);
        this.listRereading.set(rereading);
        const readAt = this.pendingReads.stamp();
        const asked = request;
        const retry = (): void => (reset ? this.loadMessages(true) : this.loadMessages(false, asked));
        const cursor = 'cursor' in asked ? asked.cursor : null;
        this.email.listMessages(id, this.selectedFolder(), 'page' in asked ? asked.page : 1, cursor).subscribe({
            next: answer => {
                if (seq !== this.listSeq) { return; }
                // A read started before a read-state write answered: those rows keep the person's value.
                const list = this.pendingReads.heldAll(answer, readAt);
                const unavailable = answer.serverPages === 'unavailable';
                if (reset) {
                    // The folder's own word, as its tree node or list entry carries it; the answer only when neither does.
                    this.serverListed.set(
                        folderListedFromServer(this.selectedFolder(), this.folderTree(), this.folders()) ?? listedFromServer(answer),
                    );
                }
                if (!reset) {
                    this.messages.set([...this.messages(), ...newRowsOf(this.messages(), list)]);
                } else if (!(unavailable && rereading)) {
                    // The same list read again while the server cannot be read keeps the rows it shows.
                    this.messages.set(list);
                    this.firstPageKeys = new Set(list.map(rowKey));
                }
                if (!unavailable) {
                    this.listNextPage = nextPageOf(answer, asked);
                }
                this.hasMore.set(this.listNextPage !== null);
                if (unavailable) {
                    this.listEndRetry = retry;
                    this.listEnd.set({ kind: 'failed' });
                }
                this.loadingMessages.set(false);
                this.loadingNextPage.set(false);
                this.listRereading.set(false);
                this.listAnswered = true;
                this.readOnAfterRender();
            },
            error: (err: unknown) => {
                if (seq !== this.listSeq) { return; }
                this.loadingMessages.set(false);
                this.loadingNextPage.set(false);
                this.listRereading.set(false);
                const refusal = pageRefusal(err);
                if (refusal.kind === 'stale' && cursor !== null) {
                    // The pages read so far are dropped, and the list starts again from its top.
                    this.messages.set([]);
                    this.clearSelection();
                    this.firstPageKeys = new Set<string>();
                    this.listNextPage = null;
                    this.hasMore.set(false);
                    this.loadMessages(true);
                    return;
                }
                if (refusal.kind === 'rate-limited') {
                    if (reset) {
                        this.serverListed.set(true);
                    }
                    if (reset && !rereading) {
                        this.messages.set([]);
                    }
                    this.listEndRetry = retry;
                    this.listEndCountdown = this.countDown(this.listEnd, refusal.seconds);
                    return;
                }
                if (!reset) {
                    // A next page not read: the rows shown stay, and Retry asks for the same page.
                    this.listEndRetry = retry;
                    this.listEnd.set({ kind: 'failed' });
                    return;
                }
                this.messagesFailure.set(err);
            },
        });
    }

    /**
     * A realtime change: the first page is read again and put in front, without moving what the person is looking at.
     * In a folder listed from the mail server it stands in place of the rows it gave before; in a folder paged by
     * number the rows shown all stay (one that left goes by its own event), and the new ones come before them.
     */
    private rereadFirstPage(): void {
        const id = this.selectedMailboxId();
        // Another mailbox or folder than the list shows reads its list from the top.
        if (id === null || this.listKey !== `${id}
${this.selectedFolder()}` || !this.listAnswered) {
            this.loadMessages(true);
            return;
        }
        this.stopListEnd();
        const seq = ++this.listSeq;
        this.loadingMessages.set(true);
        this.loadingNextPage.set(false);
        this.listRereading.set(this.messages().length > 0);
        const readAt = this.pendingReads.stamp();
        this.email.listMessages(id, this.selectedFolder(), 1, null).subscribe({
            next: answer => {
                if (seq !== this.listSeq) { return; }
                this.loadingMessages.set(false);
                this.listRereading.set(false);
                if (answer.serverPages === 'unavailable') {
                    this.listEndRetry = () => this.rereadFirstPage();
                    this.listEnd.set({ kind: 'failed' });
                    return;
                }
                const onlyFirst = this.messages().every(m => this.firstPageKeys.has(rowKey(m)));
                const first = this.pendingReads.heldAll(answer, readAt);
                const replaced = this.serverListed() ? this.firstPageKeys : new Set<string>();
                this.keepingPlace(() => this.messages.set(withFirstPageAgain(this.messages(), replaced, first)));
                this.firstPageKeys = new Set(first.map(rowKey));
                if (onlyFirst) {
                    // No later page was read: the first page's next page is the next one.
                    this.listNextPage = nextPageOf(answer, FIRST_PAGE);
                    this.hasMore.set(this.listNextPage !== null);
                }
                this.readOnAfterRender();
            },
            error: (err: unknown) => {
                if (seq !== this.listSeq) { return; }
                this.loadingMessages.set(false);
                this.listRereading.set(false);
                // The rows shown stay; a rate limit says how long to wait.
                const refusal = pageRefusal(err);
                if (refusal.kind === 'rate-limited') {
                    this.listEndRetry = () => this.rereadFirstPage();
                    this.listEndCountdown = this.countDown(this.listEnd, refusal.seconds);
                }
            },
        });
    }

    /** An end row counts a rate limit's wait down from `seconds`; at zero it offers Retry. */
    private countDown(end: { set(value: ListEnd | null): void }, seconds: number): Subscription {
        end.set({ kind: 'rate-limited', seconds });

        return interval(1000).pipe(take(seconds), takeUntilDestroyed(this.destroyRef)).subscribe(tick => {
            end.set({ kind: 'rate-limited', seconds: seconds - tick - 1 });
        });
    }

    private stopListEnd(): void {
        this.listEndCountdown?.unsubscribe();
        this.listEndCountdown = null;
        this.listEnd.set(null);
    }

    /** POST the read/unread flag, then reflect it locally (row + detail + folder count). */
    private applySeen(messageId: string, folder: string, seen: boolean): void {
        const token = this.pendingReads.chosen([messageId], seen);
        this.email.markSeen(messageId, seen).subscribe({
            next: answer => {
                // The person chose another read state since (a quick Mark unread): theirs wins, this applies nothing.
                if (!this.pendingReads.current(messageId, token)) {
                    return;
                }
                const at = answerSeq(answer);
                const reached = idsOf((answer as { ids?: unknown } | null)?.ids, messageId);
                const also = reached.filter(id => id !== messageId);
                this.pendingReads.join(also, token, seen);
                this.setSeenRows(new Set(also.filter(id => this.pendingReads.current(id, token))), seen);
                const sequence = new Map<string, number>(at === null ? [] : reached.map(id => [id, at]));
                this.pendingReads.answered(reached, token, null, sequence);
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
                    this.followLocalUnread(mbId, folder, delta);
                }
            },
            error: () => {
                if (!this.pendingReads.current(messageId, token)) {
                    return;
                }
                this.pendingReads.refused([messageId], token);
                this.toast.error('Could not update the message.');
            },
        });
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
            kind: 'personal',
        };
    }
}
