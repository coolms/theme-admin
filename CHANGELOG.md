# Changelog

All notable changes to `coolms/theme-admin` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is described in `CONTRIBUTING.md` -- read it before assuming what a
major number means here.

## Unreleased

### Added

- **An event is changed only from the version it was read at.** Every write of
  a calendar event -- a change, a delete, and on a recurring event an
  exception, a skip, a split or a delete of this and the following -- names
  (`If-Match`) the version of the row it changes, as the editor or the
  calendar read it: the event's own, or the series' for the series' base and
  the actions on the series. An event or series changed since is refused,
  said, and nothing is changed; Reload reads the calendar again, and the write
  is never sent again on its own. Without a version nothing is sent. Needs the
  backend that answers each event's `version` and `seriesVersion`, and
  `@coolms/ui-angular` 2.0.0-alpha.4 or later for the Reload button.
- **The admin names itself on its API calls.** Every call under `/api/`
  carries `X-CoolMS-Client: com.coolms.admin/<version>`, the header the apps
  send, so the backend's per-client daily counts show the admin and its
  version. The version is read from `theme.yaml` into a generated, untracked
  file on `prebuild`, `pretest` and `prestart` (`scripts/stamp-client.mjs`).

- **A page or file opened for editing is saved only over the version it was
  opened at.** The page editor's body save and the file editors name the
  version they read (`If-Match`); a page or file changed or deleted meanwhile is
  said, and nothing is written over it. `provideVfsNodeWatch()` hands the
  editors the folder's live events, so a change made elsewhere is said at once;
  one folder channel serves every watcher of it and is left with the last.
  Needs `@coolms/ui-angular` with `VFS_NODE_WATCH`.
- **No shortcut of a view fires while a surface is open over it.** The file
  manager, the media library, the decision and state-machine designers, the
  BPMN canvas and the shell take their keys through the keyboard scope: while
  an editor, a viewer, a dialog or a menu is open over the file manager,
  Delete, Backspace, F2, Escape and Ctrl+A/C/V/X reach nothing beneath it. The
  file manager's keys follow keyboard focus, not the pointer, and a press
  anywhere in it puts the keyboard there. The call screen is a card in a
  corner and takes no keys from the page. Needs `@coolms/ui-angular`
  2.0.0-alpha.4 and `@coolms/designer` with the keyboard controller's key
  source.
- **Contacts, Users, Leads and Call history read their rows from where the
  server says they come from.** Each grid's definition now declares its list
  action, and the four pages read the rows from that action's operation
  instead of a route of their own; their two page-only list methods are gone.
  A list the person may read only once elevated shows the elevation notice; a
  list they may not read says so, instead of an empty grid. Leads still sends
  its tab as the operation's `status` scope. Needs `@coolms/ui-angular` with
  declared rows.
- **The file manager draws each node action as the server answers it for the
  selection.** Every node the file manager lists carries what chmod, chown,
  delete, rename and hide come to for the signed-in person on it -- `allowed`,
  `elevate` or `denied` -- and the toolbar and both right-click menus draw the
  least answer across what they act on: `denied` disabled, `elevate` with a
  lock. Choosing a locked action asks for elevation and runs it on the grant
  (or at once when the session is elevated already); cancelled, nothing runs.
  The Delete key follows the Delete button's answer. The server's refusal
  stays the last word, and the listing is read again on every change of
  elevation, as before. Needs `@coolms/ui-angular` with capability state on
  navi nodes.

- **The menu shows sections that need an elevated session, with a lock.** A
  section the server answers `elevate` for a member of admin is shown with a
  lock instead of hidden. A click asks for elevation and then opens the section
  in place, without a reload. The menu is asked again on every change of
  elevation, so the locks follow a grant, a drop or an expiry.
- The top-bar tiles follow the same answer: a locked tile shows a lock and asks
  for elevation before it opens. It starts no polling and no subscription until
  the grant.
- The account menu offers **Elevate session** to an account the server says may
  elevate, while the session is not elevated. While elevated it says
  **Elevated until HH:MM** with **End elevation**.

These need a server that answers `access` on the navigation and `mayElevate` on
the elevation state; against one that does not, the admin behaves as before.

- A console panel's top-bar toggle and its keyboard shortcut follow the menu
  item that opens the panel. Without such an item the toggle is hidden and the
  shortcut does nothing; where the item is locked, the toggle shows a lock and
  asks for elevation first. The terminal's `>_` and Ctrl+` follow the
  Terminal item.

### Changed

- **A mailbox's settings are a page of sections; the wizard only adds a
  mailbox.** The rail's Settings opens `/email/mailboxes/:id/settings`:
  - General: name and address.
  - Connection: servers, sign-in, sync, and a connection test.
  - Rules: what arriving mail starts -- a first-contact email starts a
    workflow, as a rule's action.
  - Access, for a shared mailbox.
  - Delete this mailbox, last: its question names what goes (CoolMS's
    copies of the mail, the mailbox's rules, its settings) and says the
    account at the mail provider is not touched.

  Each section is saved on its own, naming the version of the settings it
  was read at (`If-Match`), and sends only what the person changed.
  Settings changed since are refused and Reload is offered; a read
  without a version saves nothing. What the caller may change is the
  server's capability answer: someone who may only read the settings --
  a delegate, read only or read and send -- sees them read-only, and is
  told so. The wizard's edit mode, and its update that named no version,
  are removed.

  The connection test signs in with what is typed, saves nothing, and says
  each protocol's outcome in the server's fixed sentence; too many tests
  say when to try again. An owner who is not an administrator signs in as
  the mailbox's address, so the sign-in names are shown, not edited. Past
  mail to fetch is a choice: the installation's default, none, the last
  months as set, or all of it. Needs the backend's mailbox contract
  (version, access, backfill depth, the test).
- **The terminal asks for elevation only for a line that begins with `sudo`.**
  A `sudo` line refused for want of an elevated session asks for the password
  in the terminal itself, `[sudo] password for <account>:`, and asks for the
  code from the authenticator when one is required. Nothing typed there is
  shown, not even a mask, and nothing is kept in the history. Three wrong
  answers end it, and Ctrl+C cancels it. On a grant the line is sent once more.
  It is the same elevation as the account menu's, with the same lifetime.
- Any other line refused for want of an elevated session is shown as refused,
  with the way to run it (`use sudo <line>`). The terminal no longer opens the
  elevation dialog by itself.
- Tab completion marks `[sudo]` on a verb the server says runs only through
  sudo for this person, as `help` does. A server that says nothing marks
  nothing.

### Fixed

- **The calendar's events carry their classes again.** FullCalendar 7 takes an
  event's classes as `className`, one string; the card still set v6's
  `classNames`, which 7 keeps as an extended prop and never draws. So no event
  carried its type, and the card's own styles for them were dead: the repeat
  mark on a recurring event, the line-through of a cancelled one, the italic of
  a tentative one, and the holiday backgrounds' text. A spec draws the card's
  events with the admin's FullCalendar and reads the classes off the page.
- **A form's radios and checkboxes are drawn as the admin draws them.** Three
  forms styled every `input` as a text field, with a width, padding, a border,
  a radius and a background, and that rule reached their radios and
  checkboxes as well:
  - The recurrence form's "Ends: Never / On / After" and monthly radios showed
    as rounded squares, which read as checkboxes.
  - The holiday rule form's checkbox was 2px wide.
  - The schedule page's "Enabled" checkbox was padded like a text field.

  Each of those rules now names text fields only.
- **The actions on a series work from an edited occurrence, and at the right
  slot.** "Only this", "this and following" and "all events" -- from the
  calendar's menu, a drag, a resize or the editor -- on an occurrence that was
  edited before went to its exception, which the server refuses; they now
  address the series it belongs to, at the slot it replaced, naming the
  series' version. A plain occurrence that a non-working-day rule moved is
  acted on at its rule's slot, not at the day it moved to. "All events" from
  an edited occurrence deletes the series, not only that occurrence. Uses the
  `recurrenceInstant` the backend answers on each occurrence; a backend that
  answers none is sent the occurrence's start, as before.
- **"All events" by a drag moves the whole series, and drops nothing.**
  Dragging an occurrence with "All events" wrote that occurrence's new times
  onto the series itself: dragging the 5th occurrence of a daily series by two
  days made the series start on the 5th day, and the first four occurrences
  were gone. Now the series is read and moved by the same difference -- days
  and time of day, on the series' own wall clock, so a 09:00 series stays at
  09:00 across a daylight-saving change -- and saved naming the version of
  that read. A resize with "All events" makes every occurrence as much longer
  or shorter. Changing all events between all-day and timed is left to the
  series' editor.
  The rule's own dates move in the same write: UNTIL, the skipped dates
  (EXDATE) and the added ones (RDATE), so a skipped 09:00 occurrence moved to
  10:00 stays skipped. So do the days the rule picks: weekly on Monday moved
  by a day repeats on Tuesday, and a day of the month moves within the month.
  A move that no rule can give exactly is refused, with the reason, and
  nothing is changed: for example "the 2nd Monday" moved by a day, or "the
  30th" moved into another month. Moving only the time of day is always
  possible. Occurrences edited one by one move with the series: the
  server moves them. When the moved series would have no slot for some of
  them, or some skipped dates would skip nothing, nothing is changed and
  the person is asked. The question names those occurrences by title and
  by the date the calendar shows them on, in the person's date format.
  "Move and remove them" makes the move and removes them; otherwise
  the series stays as it is. Needs the backend that moves a series'
  edited occurrences and answers 409
  `/errors/series-change-leaves-occurrences` for the rest.
- **"Read without a version" is said as such.** An event write not sent for
  want of a version now says the event was read without one, instead of
  "changed since you opened it".
- **A media asset edited in the image editor is never replaced over a newer
  one.** The editor read the asset's pixels from its public URL and replaced
  it with no version, so an asset replaced meanwhile was overwritten silently.
  The editor now reads the asset's bytes and their version from one
  authenticated read and names that version when it replaces; an asset changed
  or deleted meanwhile is refused and the edits can go to a new image.
- **A page body that could not be read is never written.** When the page
  editor's read of a body failed, it showed an empty body and treated it as
  read, and the next save of a title or SEO field wrote that empty body over
  the stored one; Publish and Submit for review wrote the body even before
  its read answered. A failed read is now shown as such, with a way to read
  it again; no press writes a body that was not read; and the page service
  sends no body it holds no version of.
- **A selected file follows the listing when it is read again.** The listing is
  read again whenever elevation is granted, ended or expires, but the selection
  kept the file objects from before, and the bar and the menus read those: after
  an elevation ended, a still-selected file's Delete stayed unlocked until it was
  clicked again. The selection now takes the fresh objects, by id, and drops a
  file the listing no longer holds.

- **A right-click inside a multi-selection acts on the whole selection.** It
  took the clicked file's answer, and Delete, Cut and Copy acted on that file
  alone. The menu now takes the selection's least answer -- any file denied:
  greyed out; any needing elevation and none denied: locked -- and runs Delete,
  Cut and Copy on every selected file, as the toolbar does. A greyed-out action
  in the bar and the menus says how many of the selection refuse it ("not
  allowed for 2 of 5 selected items").

- The terminal takes every printable character typed into its line or into a
  `sudo` prompt. Before, it dropped a character outside the basic plane (an
  emoji), a composed one, and any typed with AltGr (`@`, `€` or `{` on many
  layouts), so a password holding one could never be entered. Backspace erases
  one whole character. A password can be pasted into an open `sudo` prompt,
  unseen like a typed one; the shell's line still takes keys only.
- A locked menu item that opens something other than a page, such as the
  **Terminal**, now asks for elevation like any other locked item. Before, it
  showed the lock, but a click opened the terminal without asking.

## 2.0.0-alpha6 - 2026-10-07

### Deprecated
- `theme.yaml` still declares its host contract under the deprecated name,
  `contracts: { console: "1.0" }`. coolms/core reads `console` as an alias of
  `admin` (and `desk` of `workspace`), so the theme matches modules written
  either way. The declaration moves to `admin` before the aliases are removed.

### Changed

- The design tokens come from their own package, `coolms/design-tokens`, at v0.1.0. `angular/src/tokens.generated.scss` is a copy of its `dist/coolms-tokens.scss`, pinned by `design-tokens.lock.json`; the CI checks the copy against the lock, and the lock against the package. The token source, its generator and the app's module move out of this repository. Every value is unchanged: the copy differs from the file generated before only in its header line.

### Security

- A call's relay credentials are asked for that call: the media plane reads
  `GET /rtc/calls/{id}/ice-servers`, which the server answers for the call's
  participants only, instead of the per-account `GET /rtc/ice-servers`, which
  handed a TURN credential to any signed-in account. Needs a server that
  serves the per-call route (available since 2026-09-29); if it cannot be read the
  call still falls back to public STUN, as before.

### Fixed

- A call that rang before the admin's incoming-call subscription was confirmed
  still rings. That channel keeps no history, so a ring published between the
  subscribe and the server's confirmation reached nobody, and the call was
  never shown. Now each confirmation, reconnects included, reads
  `GET /rtc/ringing` (the calls ringing this user now, each with its version)
  and raises a listed call as its ring would have. The version rule applies:
  a call already in view takes the record only if it is not older, and a call
  this admin has seen end is not brought back by a read that returns after it
  ended. Needs a server that serves `GET /rtc/ringing` (available since 2026-09-30).
- The admin subscribes to its incoming-call channel (`rtc.user.<id>`) when both
  the signed-in user is known and the realtime connection is up, and again
  after every reconnect. It was subscribed on the user alone, in one pipe: a
  subscribe begun before the connection was up, or lost with it, was never
  made again, and a single failed one ended the ring for the rest of the
  session -- an admin that could be called but never rang. A failed subscribe
  now ends only itself. The connection is asked for as soon as the user is
  known, and asked again with a doubling wait (1 s up to 30 s) while an
  attempt fails.
- A caller learns its call connected even when the answer lands while it is still
  subscribing to the call's channel. The channel keeps no history, so a
  `call.state connected` published before the caller's subscription became active
  never arrived, and the caller never started its media (1 of 60 automated call
  runs, 2026-09-27). The client now reads the call each time its subscription to
  the call becomes active, and every change after that arrives on the channel.
  That read can return after the channel has moved on, so it is ordered by the
  call state's `version`, which the call record and every `call.state` carry: the
  client keeps the highest version it has seen and applies a record or an event
  only when its version is not lower. A read taken before a hang-up no longer
  brings the ended call back. A server that sends no version is applied as it
  arrives.
- A call keeps the ICE candidates that arrive before the peer's description:
  they are held and applied as soon as the description is set, instead of being
  refused by the browser ("The remote description was null") and lost. With one
  network interface -- a container, a phone -- a lost candidate could be the
  only path, and the call never connected.
- A call keeps every signal that arrives before its media has started -- the
  peer's offer, its answer, its ICE candidates -- and applies them, in order,
  once the media is ready. The callee reads the call before it starts its
  media, and a caller whose offer came during that read lost it: nothing
  answered, both sides waited with their own offer and the call never
  connected. It is the ICE-candidate loss above, one step earlier. A signal
  that comes while the held ones are being applied waits behind them, so the
  order holds to the last. Signals for another call are not applied; at most
  200 are held, and a signal refused at that limit is logged, once per call.

### Added
- A capped completion says how many it is a part of. A directory here can
  hold eighteen hundred children, and printing them all inline is a wall
  rather than a listing, so the server answers with the first hundred and the
  count; the terminal prints `100 of 1878; 1778 more not shown -- type more to
  narrow` under the list. A hundred shown without a word would read as the
  whole set. An answer that was not capped looks exactly as it did.
- Tab completion sends the shell's PLACE with the line. A path argument is
  completed against the working directory, and the working directory is
  client-held state, so `cwd` and `home` now travel with the completion
  request exactly as they already travel with a run. Without them the server
  answered about the root from wherever the person stood, which is why
  `cat the<TAB>` in a subdirectory offered nothing at all.
- The theme implements `console@1` (the platform rule: hosts implement contracts, modules offer entries): `theme.yaml` declares
  `contracts: { console: "1.0" }`, and the declaration has three readers from
  the day it lands -- the build (`scripts/assemble-console.mjs`, run on
  `prebuild` and `pretest`, refuses when core-angular's contract version
  differs), the installer (`coolms:theme:install` / `activate` and
  `coolms:install` refuse a module whose range this version does not meet, by
  name) and the app-config manifest (`ui.contracts`, `ui.modules`), which is
  what activates a module in the console. The assembler discovers the modules'
  entry files (`src/app/features/*/entries/console*.ts`) and generates
  `src/app/console.registry.ts` (not tracked), which `app.routes.ts` mounts
  through `consoleChildren()` and `app.config.ts` provides through
  `provideConsole()`; `npm run test:scripts` runs the assembler's own tests over
  fixture trees. With no entries yet the six compiled-in lists are unchanged.
- Declares `support` -- `issues` and `source` -- so a page imported from this
  package, and the catalogue, know where a correction is filed. Packagist filled
  the gap from GitHub when the manifest was silent; the declared field is the
  one that holds on any registry.
- `npm run lint:fallbacks` (`scripts/check-token-fallbacks.mjs`): every
  `var(--cms-x, fallback)` under `src/` is checked against `styles.scss`. It
  fails on a fallback for a token nothing defines, and on a fallback whose value
  disagrees with the token's -- colours compared as r,g,b, lengths and keywords
  as text; a fallback that is itself `var()` or that abbreviates a multi-part
  token (font stack, shadow list) is left alone. Three fallbacks reached
  `develop` in two weeks with nothing here to refuse them; the local pre-push
  hook now runs this on the tree of every commit being pushed, and refuses when
  that tree has a `styles.scss` and the script is missing.

### Changed
- The polite peer of a 1:1 call's negotiation is the server's to name (decided
  2026-09-26). The client reads `politeUserId`, from the call record and from
  every `call.state`, and hands the media plane whether it names this user; it
  no longer derives politeness from being the callee. The server names the
  callee, so nothing changes when both sides agree. What goes is the chance of
  two clients applying a rule and disagreeing once, and ending up both polite
  or both impolite. The id comparison ignores letter case; a null (a group
  call, a deleted party) is not polite.
- The Chat module's surface is called **Chat**, and its mount is `/admin/chat`:
  the page header, the top bar's tile (its tooltip, its label and the drawer it
  opens) and the drawer's "Open chat" button. `/admin/messages` redirects to it,
  query string and all, so a bookmark or a link that names the old path still
  lands on the conversation it named. "Messages" named the surface after one of
  the things it carries; the module has been `chat` since it had a name.
  Renaming only what names this module: mail messages, message lists and the
  DTOs that carry a message keep theirs.
- The selected family, by ruling and by measurement: `--cms-selected-light`
  (the wash under a selected row or tab), `--cms-selected-text` (text on that
  wash) and `--cms-selected-fg` (the foreground on the solid mark), each an
  alias of the accent's tier. `tools/selection-marks.mjs` counted 23 rules
  putting text on a selected wash and 10 on the solid mark; all moved, with
  the 21 washes that carry no text and the editor's hand-mixed tints
  (`color-mix` of the mark at 8, 14, 15, 18 and 35 per cent -- five tints of
  one colour). `lint:fallbacks`, which the pre-push hook runs on the pushed
  tree, now also refuses a tint of `--cms-selected` mixed by hand and a
  selected fill whose text names another family, per rule.
- Drop targets are interaction affordances, not selections, and all of them
  read `--cms-primary` with the `--cms-info-light` wash (the three that read
  the accent -- the documents folder, the replace-template dialog, the media
  picker's dropzone -- moved); by the same rule the kit's resize handle and
  the messages composer's grip read the primary.
- The `editor-smoke` fixture is gone: a 74-line component that exercised the
  editor bridge, mounted twice (`/editor-test` without the auth guard and
  `/admin/editor-test`), written to be removed once the page editor adopted
  the bridge, which it has. The shell's own routes are `dashboard` and
  `ui-kit`.
- `--cms-selected`, the token for "this one is selected", is defined in
  `styles.scss` as an alias of the accent, and every selection mark reads it:
  the underline under the active tab (the form builder's own tabs included),
  the border of the picked card or tile, the bar beside the current rail item
  and queue item, the current wizard step, the ring on the selected node, the
  kit's pressed `.cms-btn-active` and the sidebar's active item. The site was
  decided by meaning, not colour: of the `--cms-primary` sites, the selection
  marks moved to the token, text sitting on a selected wash moved to
  `--cms-accent-text` (the domain explorer's active rows and open branch, the
  messages toggles, which now wear the kit's pressed look), the composer's
  resize grip to `--cms-accent` as the kit's handle; links, progress bars,
  focus rings, drop targets, the "my message" bubble, attention accents, count
  badges and the Bootstrap bridge keep `--cms-primary`. Checked controls keep
  the accent. Both token checks (`lint:fallbacks`, `lint:tokens`, and the
  pre-push hook that runs the first on the pushed tree) read the new token
  through the alias: a blue fallback under it is refused with the token's
  value, a misspelling by name -- measured with both mutations before any
  site moved.
- The profile page opens a `profile.tab` slot: a module binds a component under
  `profile.tab:<settings section>` in `ComponentRegistry` (app.config.ts holds
  the bindings) and the page renders it for that section instead of the
  generic form, handing it one input, `section`. The guest owns its pane --
  load, form, footer and save. Call's "Calls" pane is the first guest, moved
  from `features/identity` to `features/call`: it loads and saves through
  `CallOverlayPreferencesService` (`refresh()`, and `save()`, new), so Identity
  imports nothing from Call. The page no longer seeds the call overlay prefs
  when it loads; the shell refreshes them at boot and the pane again when it
  opens.
- The shell's `api/api.service.ts` (2,538 lines, 128 members, reached from 33 of
  47 features) is cut along module lines: each group of methods now lives in the
  feature that owns the endpoint (`features/<feature>/<feature>-api.service.ts`
  with its DTOs in `<feature>.types.ts`), and the shell keeps a 44-line
  `ShellApiService` with login, refresh, logout, me and the manifest getter. A
  feature that calls another module's endpoint imports that module's service --
  the allowed form until the module is extracted. No endpoint or behaviour
  changes; the six core-angular types the old file re-exported are imported from
  `@coolms/core-angular` again.
- The mailbox wizard connects an OAuth account BEFORE anything is created. The last
  step of a new OAuth mailbox is "Connect with <provider>": the intended mailbox goes
  to `POST /email/mailboxes/connect`, the browser leaves for the consent screen, and
  the mailbox exists only once the server has proven the grant -- a refused or
  abandoned consent leaves nothing behind, where the previous flow committed a
  "pending" row first and the scheduler then tried to fetch it. Two rules ride
  along: an OAuth mailbox has no username fields at all (it signs in as its
  address); on the password path the username is the address for everyone, and
  only an administrator sees an alias field. The rules are pure functions
  (`mailbox-wizard.util.ts`) with their own spec.
- CDP: the subject `kind` is `anonymous | recognised | known` -- the recognised
  browser (a durable identifier issued on the `recognition` consent rung) gets
  its own badge on the subject page, and the segment editor's example
  expression selects on `subject['kind']`.

### Fixed
- A 1:1 call could stay "connecting" forever. The server relays every
  `call.signal` on `rtc.call.{id}`, which both parties subscribe to, so each
  party received its own offer, answer and candidates back, and the call
  service passed them to the media plane as the peer's. The callee is the
  polite side and never ignores an offer, so it applied its own offer as the
  remote description in every call, and every call logged "Failed to set
  remote answer sdp: Called in wrong state" from the echoed answers. Whether
  the call then connected depended on which offer the callee applied last; in
  automated call runs about half did not. A `call.signal` from the signed-in user
  is now dropped before the media plane sees it.
- A pasted or bookmarked module URL landed on the dashboard on a cold load
  (measured: `/admin/identity/users` requested no chunk of its own, the
  dashboard's instead) -- the mount's `canMatch` read the manifest while the
  initializer was still fetching it and found no module installed. The guard
  (core-angular) answers once the initializer signals ready; navigation from
  inside the app never saw it, which is why the live sweep on the day did not.
- My Profile: a tab strip wider than its column (six tabs below ~1000px) overflowed
  into the scrolling body, and clicking a half-visible tab scrolled the whole
  body sideways -- the sidebar disappeared to the left. The page now uses the
  shared `app-tab-strip`, which keeps one row and puts the tabs that do not fit
  behind a "more" menu (ui-angular, same day); the active tab is always in the
  row, underlined in the accent as before -- and so, from now on, are the tabs
  on Inbox, Leads, Newsletter, Dashboard, Analytics and Deletions, which were
  blue.
- The profile menu in the light theme: the panel inherited the top bar's light
  ink onto a white surface and could not be read. It paints the page's surface
  and ink (`--cms-surface`, `--cms-text`).
- 27 `var()` fallbacks that disagreed with their own token, in 15 files: eleven
  radii (`--cms-radius` is 6px and was written as 4px, 8px and 10px;
  `--cms-radius-sm` is 4px and was written as 6px) and sixteen colours written
  as `transparent`, `inherit` or a translucent `rgba()` under a solid token.
  None of them painted inside the admin, where the theme is always present;
  each would have painted wherever it is not. `lint:tokens` baseline 25 -> 1.

## 2.0.0-alpha5 - 2026-09-09

### Added

**`tests/` is in the package again.** It was excluded on the grounds that
percentages of a 21 MB archive are real megabytes. Re-measured: the whole of
`tests/` is one 3,581-byte file, and adding it moves the archive from 661 files
to 662 and the byte count not at all -- it fits inside tar's existing block
padding. The exception cost a reader their tests and saved nothing, so it is
withdrawn and this package follows the same rule as the rest: tests ship.

The figures in `.gitattributes` justifying the remaining exclusions were also
re-measured. They had drifted when 2.0.0-alpha4 put the built admin in the
package -- the tree roughly doubled and `angular/` stopped being the bulk of it.

### Changed

- 104 internal identifiers are out of the admin sources, and the sentences an
  earlier mechanical strip broke are repaired.
- The application's namespace is out of the last three places that named it.
- The admin asks the server which entity a filter audience is built from,
  instead of comparing against a constant compiled into the published bundle --
  which put a consuming application's class name inside an npm package.
- The space URLs are read from the manifest rather than assembled by the client
  from a URL shape the router owns.
- Three `var()` fallbacks are aligned with the tokens they fall back to.
- "Default" and "Unused" replace "Active" and "Fallback", which described a
  state the UI does not have.
- The admin shell tells crawlers not to index it.
- The shipped admin is rebuilt from the committed source, and a backtick guard
  runs before it can build.

### Removed

- `forgetLastPath` is deleted rather than wired up, and what nothing covers is
  written down instead.

## 2.0.0-alpha4 - 2026-09-04

### Added

**The built admin is in the package.** Until now installing this gave you a
bundle, a route, and nothing to serve: the artefact was gitignored, so it
was in no archive Composer could fetch, and building it needs Node and
roughly 837 MB of `node_modules` -- not something a PHP project does on
`composer install`.

21.03 MB, 650 files, under `public/browser/`. `AdminController` serves it
for every `/admin/**` path, as it always has.

!! **The cost is permanent and worth stating.** 121 bundle names are
content-hashed, so every release rewrites all of them, and git does not
forget. Reversing this later means rewriting history or living with the
objects. It was taken as the least bad of three: making the 14 `@coolms/*`
dependencies real is blocked on a package that is deliberately private and
on export subpaths that are not published, and building in CI is this same
commit made by a machine.

### Changed

**The archive stopped carrying what a PHP consumer cannot use.** The Angular
sources were 502 of 516 tracked files and 13.25 of 13.70 MB; they stay in the
repository and leave the archive. Without that, this release would have
shipped both the sources and the build.

**The vendored document fonts moved to the package that owns them.** They
now come from `coolms/document-fonts`, a new requirement, and
`AdminController` serves `assets/document-fonts/` from there. The URL is
unchanged, so nothing on the client had to learn a new one, and the
containment check that guards the build directory guards the font directory
too. The 24 files in this package had been generated output that was
committed -- byte for byte what the engine already shipped.

**The pdf.js viewer is pinned to one build.** It ships four builds each of
its viewer, worker and sandbox; nothing here selected one, so all of them
were copied. `_internalFilenameSuffix` is `.min` and the library marks it
internal, so the non-minified twins can never be fetched; and `needsES5`
wants IE11, a legacy `Edge/` agent or a browser without `ReadableStream`,
none of which is in a baseline of ES2022 with chrome 109+, firefox 140+ and
ios_saf 26.4+.

Together those are the difference between a 39.36 MB artefact and a 21.03 MB
one, and both were done BEFORE the first commit of it, because git keeps
whatever the first commit contains.

### Fixed

- `theme.yaml` described the panel as Angular 19 against a tree on 22.
## 2.0.0-alpha3 - 2026-09-03

### Fixed

**Declares `symfony/config`, without which this package cannot be loaded at
all.** The bundle class extends `Symfony\Component\HttpKernel\Bundle\Bundle`,
which extends `DependencyInjection\Kernel\AbstractBundle`, which implements
`Config\Definition\ConfigurableInterface` -- and `symfony/dependency-injection`
carries `symfony/config` in **require-dev**, not `require`. So installing
this package on its own produced:

```
Interface "Symfony\Component\Config\Definition\ConfigurableInterface" not found
```

!! **Invisible in any application that installs `symfony/framework-bundle`**,
which pulls `symfony/config` in transitively -- which is every application
this theme had ever been installed into. Found by resolving the package from
its tag into an empty tree and then checking that every `use` statement in
its own `src/` resolves against what that install produced. Installing is not
the check: 2.0.0-alpha2 installed perfectly and could not load its own bundle.

Same class of defect as `coolms/core-bundle` requiring
`symfony/translation-contracts` without `symfony/translation`: a dependency
the host application had been supplying that the manifest never declared.
## 2.0.0-alpha2 - 2026-09-03

**First published release.** Nothing before this was ever released, so there
is no earlier history to describe.

**A pre-release. It carries no compatibility promise**, which is the honest
statement of where the platform is: the shape is still moving, and a stable
tag would be a promise that cannot be kept yet.

Composer will not install it under default stability. Set

```json
"minimum-stability": "alpha",
"prefer-stable": true
```

in your root `composer.json`, then:

```
composer require coolms/theme-admin:^2.0
```

### !! Read this before installing: the built admin is NOT in this package

What you get is the Symfony side -- 4 PHP classes (bundle, extension,
controller glue), `theme.yaml`, and **500 tracked files of Angular source**
under `angular/`.

What you do not get is the admin itself. The build output lives in
`public/`, it is gitignored, and it is therefore in no archive Composer can
fetch. Installing this package gives you a registered bundle and a route
that serves nothing.

Nor can you currently build it yourself from this package alone: the Angular
app imports **14 `@coolms/*` specifiers at 475 sites across 301 files** and
declares **none** of them in any manifest -- they resolve through `tsconfig`
path mappings onto source directories that are not part of this package and
are not published anywhere a build could fetch them from.

This is a known and undecided question, not an oversight. It is published
now so that the rest of the set is installable and so the gap is visible
rather than implied.

### Version

Starts at 2.0.0: the theme requires `coolms/core` and is a lockstep member.

### Fixed

- `theme.yaml` described the panel as **Angular 19**. It has been on Angular
  22 since 2026-08-26. The manifest is read by `ThemeManifestReader` and
  surfaced in the admin, so the stale number was visible rather than inert.
  The version number is dropped from the description entirely -- a number in
  prose is a thing to get wrong again.
- `theme.yaml` carried `version: 1.0.0`, which would have disagreed with this
  package's own tag from the moment it was cut.
