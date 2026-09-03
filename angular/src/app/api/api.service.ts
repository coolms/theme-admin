import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import {
    AppConfigState, ApiManifest, resolvePattern,
    IdentityApiClient, RealtimeTokenClient,
    type TokenResponse, type UserDto,
    type HydraCollection, type HydraView,
    type CentrifugoConnectionTokenDto, type CentrifugoSubscriptionTokenDto,
} from '@coolms/core-angular';
// Re-exported so the feature files importing these from here keep working;
// they are DECLARED in core, which owns the session, the collection envelope
// every list response arrives in, and the realtime tokens.
export type {
    TokenResponse, UserDto,
    HydraCollection, HydraView,
    CentrifugoConnectionTokenDto, CentrifugoSubscriptionTokenDto,
};

// --- Auth DTOs ----------------------------------------------------------------


export interface ProfileSection {
    readonly section: string;
    readonly label:   string;
    readonly icon:    string;
    readonly formId:  string;
}

// --- SiteSection DTOs --------------------------------------------------------

export interface SiteSectionDto {
    '@id':       string;
    id:          string | null;
    slug:        string | null;
    label:       string;
    matchHost?:  string | null;
    matchPathPrefix?: string | null;
    feStack?:    string | null;
    matchPriority?: number | null;
    /** Soft ref to Theme slug -- exposed so the Navi-node picker can scope dtmpl templates. */
    themeSlug?:  string | null;
    isActive:    boolean;
}

export interface CreateSectionDto {
    slug:            string;
    label:           string;
    feStack:         string;
    matchHost?:      string;
    matchPathPrefix?: string;
    matchPriority?:  number;
    /**
     * ⚠️ Was missing here while `UpdateSectionDto` had it, so a site created
     * from the admin was born with NO theme binding and had to be edited
     * immediately to get one. `CreateSiteSectionProcessor` has always read
     * `themeSlug` off the resource -- the omission was only on this side.
     */
    themeSlug?:      string | null;
}

export interface UpdateSectionDto {
    label?:          string;
    matchHost?:      string;
    matchPathPrefix?: string;
    feStack?:        string;
    matchPriority?:  number;
    /**
     * THE authoritative theme binding. A section naming a theme resolves
     * to it directly via `ThemeSubscriber`'s fast-path, so this — not the Themes
     * page's Activate — decides a site's theme. `null` clears it, falling back to
     * whichever theme is active; `undefined` leaves it unchanged (merge-patch).
     */
    themeSlug?:      string | null;
}

/**
 * Response shape from POST /api/v1/sections/_apply.
 * Mirrors backend `SiteSectionApplyResource`.
 */
export interface SectionApplyResultDto {
    readonly created:       ReadonlyArray<string>;
    readonly updated:       ReadonlyArray<string>;
    readonly unchanged:     ReadonlyArray<string>;
    readonly skipped:       ReadonlyArray<string>;
    /**
     * ⚠️ Vhosts DELETED because no section owns them any more. The backend
     * computed this all along and the API resource dropped it, so the admin's
     * Apply could delete a server block and report only what it wrote -- the
     * one outcome an operator cannot infer from the section list.
     */
    readonly removed?:      ReadonlyArray<string>;
    /** Why each skip happened, keyed by slug. "skipped" alone reads as a failure. */
    readonly skippedReasons?: Readonly<Record<string, string>>;
    readonly outputDir:     string;
    readonly reloadCommand: string;
    readonly dryRun:        boolean;
}

// --- Web / Site composition DTOs ( Layer 3a/3b/3c) --------------------
//
// These mirror the backend `SiteResource` + `SiteMemberCollectionResource`
// shapes (see `src/Web/Infrastructure/ApiPlatform/Resource/`). The Site
// Detail page (Layer 3d.1) is the only FE consumer today; the Routing
// Inspector + full Members management page land in Layer 3d.2 / 3d.3.

/** Per-section navi tree reference embedded inline on the Site Detail. */
export interface SiteNaviTreeRefDto {
    readonly treeId: string;
    readonly slug:   string;
    readonly label:  string;
}

/** VFS Node descriptor for the `/content/{slug}` site root. */
export interface SiteContentRootRefDto {
    readonly nodeId:        string;
    readonly path:          string;
    readonly ownerId:       string | null;
    readonly editorGroupId: string | null;
    readonly modeInt:       number;
}

/** Calling user's resolved per-section capability set. */
export interface SiteMembershipDto {
    readonly sectionId:       string;
    readonly sectionSlug:     string;
    readonly userId:          string | null;
    readonly isOwner:         boolean;
    readonly isEditor:        boolean;
    readonly isAdministrator: boolean;
    readonly canRead:         boolean;
    readonly canEdit:         boolean;
    readonly canAdminister:   boolean;
    readonly roles:           ReadonlyArray<string>;
}

/**
 * Composed Site view (Section + per-section NaviTrees + VFS root +
 * current user membership). One row per SiteSection, fetched via
 * `GET /api/v1/web/sites` (list) or `GET /api/v1/web/sites/{slug}`.
 */
export interface SiteDto {
    readonly sectionId:             string | null;
    readonly slug:                  string | null;
    readonly label:                 string | null;
    readonly host:                  string | null;
    readonly pathPrefix:            string | null;
    readonly priority:              number | null;
    readonly themeSlug:             string | null;
    readonly defaultLocale:         string | null;
    readonly feStack:               string | null;
    readonly isActive:              boolean | null;
    readonly naviTrees:             ReadonlyArray<SiteNaviTreeRefDto>;
    readonly contentRoot:           SiteContentRootRefDto | null;
    readonly currentUserMembership: SiteMembershipDto | null;
}

/** Single row in `GET /api/v1/web/sites/{slug}/members`. */
export interface SiteMemberDto {
    readonly userId:   string;
    readonly username: string;
    readonly email:    string | null;
    readonly isOwner:  boolean;
    readonly isEditor: boolean;
}

// --- Routing Inspector DTOs ( Layer 3b/3d.2) --------------------------
//
// Mirrors `RoutingTrace` (and its child VOs
// `RoutingStep` + `RoutingTarget`). Endpoint:
// `GET /api/v1/web/routing/inspect?host=&path=` (admin-only).
//
// `outcome` and `kind` keep ALL the values the backend can emit so the
// FE doesn't silently fall back to "unknown" when a new case is added
// (e.g. `served_raw_file`, `misconfigured`, `raw_file`).

export type RoutingOutcome =
    | 'rendered_template'
    | 'rendered_package'
    | 'rendered_directory'
    | 'served_raw_file'
    | 'not_found'
    | 'forbidden'
    | 'misconfigured';

export type RoutingStepKind =
    | 'section_resolution'
    | 'vfs_path_mapping'
    | 'vfs_node_lookup'
    | 'navi_tree_resolution'
    | 'navi_node_lookup'
    | 'render_target';

export type RoutingStepStatus = 'matched' | 'not_matched' | 'skipped' | 'error';

export type RoutingTargetKind = 'template' | 'package' | 'directory' | 'raw_file';

export interface RoutingStepDto {
    readonly step:    RoutingStepKind;
    readonly status:  RoutingStepStatus;
    /**
     * Step-specific structured payload -- shape varies per step type.
     * Rendered as a definition list when keys are scalars, else as
     * formatted JSON.
     */
    readonly details: Record<string, unknown>;
    readonly note:    string | null;
}

export interface RoutingTargetDto {
    readonly kind:          RoutingTargetKind;
    readonly templatePath:  string | null;
    readonly vfsNodeId:     string | null;
    readonly vfsNodePath:   string | null;
    readonly naviNodeId:    string | null;
    readonly naviNodePath:  string | null;
    readonly resolverName:  string | null;
}

export interface RoutingTraceDto {
    readonly inputHost: string;
    readonly inputPath: string;
    readonly outcome:   RoutingOutcome;
    readonly steps:     ReadonlyArray<RoutingStepDto>;
    /** Null on 404 / misconfigured outcomes; populated when a render target was identified. */
    readonly target:    RoutingTargetDto | null;
}

// --- NaviTree / NaviNode DTOs ------------------------------------------------

export interface NaviTreeDto {
    '@id':     string;
    id:        string;
    slug:      string;
    label:     string;
    isActive:  boolean;
    /**
     * Owning SiteSection's UUID for `navi.public.*` trees.
     * NULL for admin / toolbar / context trees.
     */
    siteSectionId?:    string | null;
    /** Section's slug (e.g. `default`); NULL when `siteSectionId` is NULL. */
    siteSectionSlug?:  string | null;
    /** Section's human label (e.g. `Main Site`); NULL when `siteSectionId` is NULL. */
    siteSectionLabel?: string | null;
}

export interface CreateNaviTreeDto {
    /**
     * Required unless `siteSectionId` is provided; the processor then
     * auto-derives `navi.public.{section.slug}` from the section.
     */
    slug?: string;
    label: string;
    /**
     * Optional. When provided, the new tree is anchored to that SiteSection
     * via NaviTree::$siteSectionId (Layer 1). Backend
     * validates the section exists -- 422 if not.
     */
    siteSectionId?: string;
}

export interface UpdateNaviTreeDto {
    label?: string;
}

export interface NaviNodeDto {
    '@id':      string;
    id:         string;
    slug:       string;
    path:       string;
    title:      string;
    sortOrder:  number;
    isVisible:  boolean;
    isActive:   boolean;
    parentId?:  string | null;
    treeSlug:   string;
    template?: string | null;
    /**
     * Tree datagrid Ship B -- true when this node has at least one direct
     * child; drives the datagrid chevron under the `computed` strategy.
     */
    hasChildren?: boolean;
    /**
     * Tree datagrid Ship B -- `'group'` (has children, expandable) or
     * `'leaf'`. Mirrors the backend `NaviNodeResource::$nodeType`.
     */
    nodeType?:    'group' | 'leaf';
}

export interface CreateNaviNodeDto {
    treeSlug:          string;
    slug:              string;
    title:             string;
    path:              string;   // full path, e.g. "/about" — required by CreateNaviNodeProcessor
    parentId?:         string | null;
    template?: string | null;
    isVisible?:        boolean;
    sortOrder?:        number;
}

export interface UpdateNaviNodeDto {
    title?:            string;
    template?: string | null;
    isVisible?:        boolean;
    sortOrder?:        number;
}

// --- Theme template DTOs (Navi-node picker, Deliverable 1) ---------

export interface ThemeTemplateDto {
    /** Relative path under the theme's `templates/`, e.g. `pages/home.html.dtmpl`. */
    path:      string;
    /** Theme slug this template belongs to (mirrors the path param). */
    themeSlug: string;
    /** Display label -- the file basename, e.g. `home.html.dtmpl`. */
    label:     string;
}

// --- Identity user/group DTOs -------------------------------------------------

export interface IdentityGroupDto {
    id:          string;
    name:        string;
    label:       string | null;
    role:        string;
    isSystem:    boolean;
    description: string | null;
    memberCount: number;
    /**
     * Groups whose roles are granted by holding THIS group's role — one
     * hop, the stored edges, not the transitive closure the security hierarchy
     * computes.
     *
     * Present on the ITEM read only; the LIST leaves it absent rather than
     * walking the relation table once per row for something nothing sorts on.
     * Hence optional: `undefined` means "not loaded", `[]` means "grants
     * nothing", and the editor must not confuse the two.
     */
    grantsGroupIds?: string[];
}

export interface IdentityUserDto {
    id:            string;
    identifier:    string;
    identifierType: string;
    isVerified:    boolean;
    identifiers:   Array<{ type: string; value: string; isPrimary: boolean; isVerified: boolean }>;
    avatarUrl:     string | null;
    avatarColor?:  string | null;
    firstName:     string | null;
    lastName:      string | null;
    fullName:      string;
    roles:         string[];
    isActive:      boolean;
    lastLoginAt:   string | null;
    createdAt:     string;
    primaryGroup:  { id: string; name: string; label: string | null } | null;
    groups:        Array<{ id: string; name: string; role: string }>;
    groupsCount:   number;
    uiPrefs:       Record<string, unknown>;
}

export interface UpdateUserDto {
    firstName?: string | null;
    lastName?:  string | null;
    isActive?:  boolean;
}

export interface CreateUserDto {
    identifier:  string;
    password:    string;
    firstName?:  string | null;
    lastName?:   string | null;
    isActive?:   boolean;
}

export interface CreateGroupDto {
    name:         string;
    label?:       string | null;
    description?: string | null;
}

export interface UpdateGroupDto {
    label?:       string | null;
    description?: string | null;
}

// --- VFS Node DTOs -----------------------------------------------------------

export interface NodeDto {
    '@id':         string;
    id:            string;
    name:          string;
    type:          string;   // 'file' | 'directory' | 'resource' | 'package'
    path:          string;
    mode:          string;   // e.g. '0644'
    modeString:    string;   // e.g. 'rw-r--r--'
    size:          number;
    humanSize:     string;
    mimeType:      string | null;
    extension:     string | null;
    uid:           string;
    gid:           string;
    createdAt:     string;
    updatedAt:     string;
    /** Display title (real Node column; admin-facing). Distinct from `pageTitle` which is SSR <title> override. */
    title?:        string | null;
    /** Free-text description (real Node column). */
    description?:  string | null;
    /** Module-owned per-node metadata bag (e.g., Content writes `status`, `metaTitle`, `metaDesc`, `ogImage`). */
    extras?:       Record<string, unknown>;
    template?: string | null;
    pageTitle?:    string | null;
    /** For resource nodes: { route, routeParams? } */
    pageMeta?:     Record<string, unknown>;
    isRendered?:   boolean;
}

export interface ChmodDto {
    path: string;
    mode: string;  // octal string, e.g. '0644'
}

export interface ChownDto {
    path: string;
    uid:  string;
    gid:  string;
}

// --- DocumentGeneration DTOs -------------------------------------------------

/**
 * `GET /document/generations/preview-audience` — who an RQL filter selects.
 *
 * `count` is authoritative: it comes from the same `FilterAudienceMaterializer`
 * the submit runs, so it is the number that lands in `BatchJob.totalCount`.
 * `sample` is up to 10 rows so the operator can check "yes, these are the
 * right people" before committing.
 */
export interface AudiencePreviewDto {
    readonly count:  number;
    readonly sample: readonly { readonly id: string; readonly label: string }[];
}

/**
 * Payload accepted by POST /api/v1/document/generations. Flat shape
 * matching the backend resource (`outputBasePath` and `filenamePattern`
 * are top-level; the recipient filter is embedded in
 * `audienceCriteria` as a mode-specific map).
 */
export interface CreateDocumentGenerationPayload {
    templateId:       string;
    /**
     * The template's own output format — `docx`, `pdf`, `xlsx`, … Widened from
     * a `'docx' | 'pdf'` union in : the union was accurate only while Word
     * was the sole format module, and it forced the wizard to coerce a
     * spreadsheet template's `xlsx` into `docx`.
     */
    outputFormat:     string;
    mode:             'single' | 'filter';
    audienceCriteria: Record<string, unknown>;
    plainVariables:   Record<string, unknown>;
    outputBasePath:   string;
    filenamePattern:  string;
}

/**
 * Response shape from the same endpoint -- mirrors the read-only
 * fields on `DocumentGenerationResource`. The status endpoint
 * (`GET /document/generations/{id}/status`) returns the same shape
 * with `failedInstanceIds` populated when `failedCount > 0`.
 */
export interface DocumentGenerationDto {
    id:                 string;
    templateId:         string;
    outputFormat:       string;
    mode:               string;
    status:             string;
    totalCount:         number;
    completedCount:     number;
    failedCount:        number;
    errorMessage:       string | null;
    createdAt:          string;
    completedAt:        string | null;
    audienceCriteria:   Record<string, unknown>;
    plainVariables:     Record<string, unknown>;
    outputBasePath:     string;
    filenamePattern:    string;
    failedInstanceIds:  string[];
}

// The two Centrifugo token DTOs are DECLARED in core beside the client that
// fetches them, and re-exported at the top of this file so callers naming them
// from here keep working.

/**
 * Per-instance row returned by `GET /document/instances` when filtered
 * by `generationId`. Field set matches `DocumentInstanceResource`.
 */
export interface DocumentInstanceDto {
    id:              string;
    templateId:      string | null;
    sourceType:      string | null;
    outputFormat:    string;
    status:          string;
    generatedFileId: string | null;
    errorMessage:    string | null;
    generatedAt:     string | null;
    name?:           string;
    vfsPath?:        string | null;
    size?:           number | null;
    mimeType?:       string | null;
    createdByName?:  string | null;
}

/**
 * Options for `listDocumentInstances` -- all filters are optional and
 * combine as AND. Sort defaults to `-generatedAt` server-side.
 */
export interface ListDocumentInstancesOptions {
    generationId?: string;
    templateId?:   string;
    status?:       string;
    outputFormat?: string;
    search?:       string;
    sortKey?:      'generatedAt' | 'outputFormat' | 'status' | 'name';
    sortDir?:      'asc' | 'desc';
    page?:         number;
    limit?:        number;
}

// --- Calendar DTOs () --------------------------------------------------
//
// Mirror the backend `Calendar` / `HolidayRule` / `CalendarHolidayPreview`
// Resources at `src/Calendar/Infrastructure/ApiPlatform/Resource/`. The
// admin Calendar pages are the only consumers today.

/** One weekday entry inside `workingHours`. ISO weekday code MO..SU. */
export interface WeekdayHoursDto {
    readonly day:  'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
    readonly from: string;  // HH:MM 24-hour
    readonly till: string;  // HH:MM 24-hour
}

/** Snapshot of a Calendar entity for the list / detail / form. */
/** — summary returned by `POST /api/v1/calendar/{slug}/import`. */
export interface CalendarImportResultDto {
    readonly imported: number;
    readonly skipped:  number;
    readonly skips:    ReadonlyArray<string>;
}

export interface CalendarDto {
    readonly id?:            string;
    readonly slug?:          string;
    readonly label?:         string;
    readonly tz?:            string;
    readonly workingHours?:  ReadonlyArray<WeekdayHoursDto>;
    readonly parentId?:      string | null;
    readonly ownerId?:       string | null;
    /** Human-friendly owner label resolved by
     *  the backend list provider (firstName + lastName, falls back to
     *  username, then shortened UUID). Null on Get endpoints. */
    readonly ownerLabel?:    string | null;
    /** Owner role: `owned | shared | admin | null`. */
    readonly currentUserAccess?: 'owned' | 'shared' | 'admin' | null;
    /** True when the calendar is the user's seeded
     *  default personal calendar (`personal-{ownerId}`); the FE
     *  disables the delete button when this is true. */
    readonly isDefaultPersonal?: boolean;
    readonly createdAt?:     string;
    readonly updatedAt?:     string;
}

/** Holiday rule type, mirrors backend `HolidayRuleType` enum values. */
export type HolidayRuleTypeCode =
    | 'fixed'
    | 'other'
    | 'moveable'
    | 'transferred'
    | 'related'
    | 'gregorian_easter'
    | 'julian_easter';

/** Snapshot of a HolidayRule for list / detail / form. */
export interface HolidayRuleDto {
    readonly id?:                string;
    readonly calendarId?:        string;
    readonly label?:             string;
    readonly type?:              HolidayRuleTypeCode;
    readonly params?:            Record<string, unknown>;
    readonly isWorking?:         boolean;
    readonly weekendAdjustment?: number | null;
    readonly createdAt?:         string;
    readonly updatedAt?:         string;
}

/** Single row from `GET /api/v1/calendar/{slug}/preview?year=...`. */
export interface HolidayPreviewItemDto {
    readonly date:       string;  // YYYY-MM-DD
    readonly dayOfWeek:  number;  // 1..7 (Mon..Sun)
    readonly ruleId:     string;
    readonly ruleLabel:  string;
    readonly ruleType:   HolidayRuleTypeCode;
    readonly isWorking:  boolean;
}

/** — Scheduler trigger kind code, lowercase enum. */
export type TriggerKindCode = 'cron' | 'rrule';

/** Snapshot of a Schedule for list / detail / form. */
export interface ScheduleDto {
    readonly id?:           string;
    readonly slug?:         string;
    readonly name?:         string;
    readonly triggerKind?:  TriggerKindCode;
    readonly triggerSpec?:  string;
    readonly tz?:           string;
    readonly handler?:      string;
    readonly payload?:      Record<string, unknown>;
    readonly enabled?:      boolean;
    readonly calendarId?:   string | null;
    /**
     * Sibling — display slug for the backing calendar, set
     * server-side by ListSchedulesProvider so the FE doesn't need a
     * separate `/calendar` round-trip to resolve calendarId -> slug.
     */
    readonly calendarSlug?: string | null;
    readonly ownerId?:      string | null;
    /** Display label for the owner — set by ListSchedulesProvider. */
    readonly ownerLabel?:   string | null;
    readonly lastRunAt?:    string | null;
    readonly nextRunAt?:    string | null;
    readonly createdAt?:    string;
    readonly updatedAt?:    string;
}

/**
 * One row from `GET /api/v1/scheduler/handlers` — a class registered
 * with `#[ScheduledHandler]`. The dropdown stores the `key` in
 * `ScheduleDto.handler`; `label` + `description` are shown to the
 * admin; `fqcn` is informational.
 */
export interface ScheduledHandlerDto {
    readonly key:          string;
    readonly label:        string;
    readonly description?: string | null;
    readonly fqcn?:        string | null;
}

/** Status DTO returned by `POST /api/v1/schedules/{slug}/trigger-now`. */
export interface ScheduleTriggerNowDto {
    readonly slug:       string;
    readonly dispatched: boolean;
    readonly firedAt:    string | null;
    readonly nextRunAt:  string | null;
}

/**
 * Unified Definitions catalog DTO — mirrors the backend
 * {@link DefinitionCatalogResource} shape returned by
 * `GET /api/v1/definitions`. Cross-module read surface fed by
 * Workflow + Decision (today; future Form) providers via the
 * tagged catalog registry.
 *
 * `id` is the synthetic composite `'{module}:{definitionId}'`
 * minted server-side for Hydra IRI uniqueness; the FE list page
 * does NOT use it for drill-down — instead, the `module` + the raw
 * `definitionKey` route to the per-module Designer
 * (`/admin/designer/bpmn/{key}` for Workflow,
 * `/admin/designer/dmn/{key}` for Decision).
 */
export interface DefinitionCatalogDto {
    readonly id?:                   string;
    readonly module?:               string;
    readonly definitionId?:         string;
    readonly definitionKey?:        string;
    readonly displayName?:          string;
    readonly latestVersion?:        number | null;
    readonly latestVersionSource?:  'vfs' | 'contributor' | null;
    readonly moduleLock?:           boolean | null;
    readonly hasDraft?:             boolean;
    readonly deployedAt?:           string | null;
    readonly deployedById?:         string | null;
    /** Set once the definition is retired (archived); `null` = active. */
    readonly retiredAt?:            string | null;
}

// --- Translation catalogues (F5.c admin editor) ------------------
// Mirror backend `TranslationCatalogueResource`.
// `id` is the composite `{domain}:{locale}` slug used in URI paths.

/** One row on /admin/i18n/translations (collection summary). */
export interface TranslationCatalogueDto {
    readonly id:            string;
    readonly domain:        string;
    readonly locale:        string;
    readonly hasOverride:   boolean;
    readonly entryCount:    number;
    readonly overrideCount: number;
    /** Populated only on item GET (drill-down); null on the list. */
    readonly entries?:      ReadonlyArray<TranslationCatalogueEntryDto> | null;
}

/** One translation row inside a catalogue's editor. */
export interface TranslationCatalogueEntryDto {
    readonly key:      string;
    readonly baseline: string;
    /** null = no override (renders baseline); string = override text. */
    readonly override: string | null;
}

/** Wrapper returned by the preview endpoint. */
export interface CalendarHolidayPreviewDto {
    readonly slug:  string;
    readonly year:  number;
    readonly tz:    string;
    readonly items: ReadonlyArray<HolidayPreviewItemDto>;
}

// --- CalendarItem / Share DTOs ( / / /) ----------
//
// Mirror the backend `CalendarItemResource`, `EventAttendeeResource`,
// `CalendarItemRsvpResource`, and `CalendarShareResource` at
// `src/Calendar/Infrastructure/ApiPlatform/Resource/`.
//
// `CalendarItemDto` carries the canonical row OR a materialised
// occurrence (recurring items are expanded server-side when the
// list endpoint is called with `from`/`to`). FE keys events by
// `id`; the canonical row is `originalItemId`. For owned single
// occurrences this is the same UUID; for occurrences of a
// recurring rule the id is `{uuid}@{YmdHis}` while
// `originalItemId` is the bare canonical UUID — this lets the
// editor target the right row on edit/delete.

export type CalendarItemTypeCode =
    | 'event'
    | 'task'
    | 'scheduler_ref'
    | 'blog_post'
    | 'holiday'
    | 'external';

export type CalendarItemVisibilityCode =
    | 'default'
    | 'public'
    | 'private'
    | 'busy_only';

export type CalendarItemStatusCode =
    | 'confirmed'
    | 'tentative'
    | 'cancelled';

export interface CalendarItemDto {
    readonly id:              string;
    readonly calendarId:      string;
    readonly type:            CalendarItemTypeCode;
    readonly title:           string;
    readonly description:     string | null;
    readonly location:        string | null;
    readonly start:           string;        // ISO 8601 with TZ
    readonly end:             string | null; // ISO 8601 with TZ; null for tasks
    readonly allDay:          boolean;
    readonly recurrence:      string | null; // canonical RFC 5545 spec (multi-line)
    readonly color:           string | null; // hex (#rrggbb) or null = use calendar default
    readonly visibility:      CalendarItemVisibilityCode;
    readonly status:          CalendarItemStatusCode;
    readonly organizerId:     string | null;
    /** Canonical row UUID. Equals `id` for non-recurring rows. */
    readonly originalItemId:  string | null;
    readonly createdAt?:      string;
    readonly updatedAt?:      string;
    /**
     * Phase 2 — soft-grouping id of the recurring series. Non-null
     * for base recurring items + their overrides; null for one-shot
     * items. The FE keys "is this part of a series?" off this, NOT
     * off `recurrence` — flat occurrence projections strip the rule
     * to prevent client-side re-expansion.
     */
    readonly seriesId?:       string | null;
    /**
     * Phase 2 — parent base id on override rows; null otherwise.
     * Lets the FE distinguish editing an override row vs editing a
     * base occurrence.
     */
    readonly parentItemId?:   string | null;
    /**
     * — non-working-day policy. Controls what the expander
     * does when a recurring occurrence lands on a holiday or other
     * non-working day of the host calendar:
     *   - `off` (default) — yield every iterator candidate.
     *   - `skip` — drop non-working candidates.
     *   - `shift_forward` — bump to next working day, same time-of-day.
     * Only meaningful for recurring items; ignored on one-shot rows.
     */
    readonly nwdPolicy?:      NonWorkingDayPolicy | null;
}

/** {@see NonWorkingDayPolicy} on the backend.. */
export type NonWorkingDayPolicy = 'off' | 'skip' | 'shift_forward';

export interface CreateCalendarItemDto {
    readonly calendarId:   string;
    readonly type?:        CalendarItemTypeCode;
    readonly title:        string;
    readonly description?: string | null;
    readonly location?:    string | null;
    readonly start:        string;
    readonly end?:         string | null;
    readonly allDay?:      boolean;
    readonly recurrence?:  string | null;
    readonly color?:       string | null;
    readonly visibility?:  CalendarItemVisibilityCode;
    readonly status?:      CalendarItemStatusCode;
    readonly organizerId?: string | null;
    readonly nwdPolicy?:   NonWorkingDayPolicy | null;
}

export type UpdateCalendarItemDto = Partial<CreateCalendarItemDto>;

/**
 * Wire shape for `POST /api/v1/calendar/items/{itemId}/exception` (Phase 2).
 *
 * Reschedules / patches one occurrence of a recurring base item. The
 * server is idempotent on (parentItemId, recurrenceInstant), so a re-edit
 * on the same instant updates rather than creates a duplicate.
 */
export interface CalendarItemExceptionRequest {
    /** ISO 8601 — the ORIGINAL occurrence start, before any drag. */
    readonly recurrenceInstant: string;
    /** ISO 8601 — the new occurrence start (often == recurrenceInstant when only title/desc/status changed). */
    readonly newStart:          string;
    /** ISO 8601 — the new occurrence end. NULL for point-in-time items. */
    readonly newEnd?:           string | null;
    readonly title?:            string | null;
    readonly description?:      string | null;
    readonly status?:           CalendarItemStatusCode | null;
}

export interface CalendarItemExceptionResponse {
    readonly itemId:            string; // parent base item id
    readonly overrideId:        string;
    readonly parentItemId:      string;
    readonly seriesId:          string | null;
    readonly recurrenceInstant: string;
    readonly newStart:          string;
    readonly newEnd:            string | null;
    readonly title:             string | null;
    readonly description:       string | null;
    readonly status:            string | null;
}

/**
 * Wire shape for `POST /api/v1/calendar/items/{itemId}/skip` (Phase 2).
 *
 * Drops one occurrence by appending EXDATE to the base item's RRULE. The
 * server also clears any prior reschedule override for the same instant
 * (EXDATE supersedes). Idempotent — repeat calls with the same instant
 * are no-ops once the EXDATE is in place.
 */
export interface CalendarItemSkipResponse {
    readonly itemId:            string;
    readonly recurrenceInstant: string;
    readonly exdateCount:       number;
}

/**
 * Wire shape for `POST /api/v1/calendar/items/{itemId}/split` (Phase 3).
 *
 * Trims the base's RRULE at `recurrenceInstant` and creates a NEW
 * base item starting at `newStart` carrying the patched properties.
 * The server returns the new base's id + the shared `seriesId` so
 * the FE can update its local cache.
 */
export interface CalendarItemSplitRequest {
    readonly recurrenceInstant: string;
    readonly newStart:          string;
    readonly newEnd?:           string | null;
    readonly title?:            string | null;
    readonly description?:      string | null;
    readonly status?:           CalendarItemStatusCode | null;
}

export interface CalendarItemSplitResponse {
    readonly itemId:            string; // parent (original, now-truncated) base id
    readonly newBaseId:         string;
    readonly seriesId:          string | null;
    readonly recurrenceInstant: string;
    readonly newStart:          string;
    readonly newEnd:            string | null;
    readonly newStartIso:       string | null;
    readonly newEndIso:         string | null;
    readonly title:             string | null;
    readonly description:       string | null;
    readonly status:            string | null;
}

/**
 * Wire shape for `POST /api/v1/calendar/items/{itemId}/delete-following`
 * (Phase 3). Truncates the base's RRULE and deletes later overrides.
 */
export interface CalendarItemDeleteFollowingResponse {
    readonly itemId:            string;
    readonly recurrenceInstant: string;
    readonly truncatedUntil:    string | null;
}

/**
 * Wire shape for `POST /api/v1/recurrence/preview`. The endpoint
 * computes the next N occurrences of an RRULE spec from a given
 * DTSTART without persisting anything; the calendar event editor's
 * recurrence form calls it (debounced) to render a "next 5
 * occurrences" preview as the user toggles freq / interval / BYDAY /
 * EXDATE.
 */
export interface RecurrencePreviewRequest {
    readonly rrule:         string;
    readonly dtstart:       string;
    readonly tz?:           string | null;
    readonly count?:        number;
    readonly horizonYears?: number;
}

export interface RecurrencePreviewResponse {
    readonly rrule:        string;
    readonly dtstart:      string;
    readonly tz:           string | null;
    readonly count:        number;
    readonly horizonYears: number;
    readonly occurrences:  string[]; // ISO 8601 with offset
}

export type EventAttendeeStatusCode =
    | 'pending'
    | 'accepted'
    | 'declined'
    | 'tentative';

export type EventAttendeeRoleCode =
    | 'required'
    | 'optional'
    | 'chair'
    | 'resource';

export interface EventAttendeeDto {
    readonly id:             string;
    readonly calendarItemId: string;
    readonly userId:         string;
    readonly status:         EventAttendeeStatusCode;
    readonly role:           EventAttendeeRoleCode;
    readonly respondedAt:    string | null;
    readonly createdAt?:     string;
    readonly updatedAt?:     string;
}

export interface CalendarItemRsvpDto {
    readonly itemId:     string;
    readonly status:     EventAttendeeStatusCode;
    readonly userId:     string;
    readonly attendeeId: string;
}

export type CalendarShareRoleCode = 'viewer' | 'editor';

export interface CalendarShareDto {
    readonly id:            string;
    readonly calendarId:    string;
    readonly calendarSlug:  string;
    readonly role:          CalendarShareRoleCode;
    readonly shareeUserId:  string | null;
    readonly shareeGroupId: string | null;
    readonly grantedById:   string | null;
    readonly createdAt:     string;
    readonly updatedAt?:    string;
}

export interface CreateCalendarShareDto {
    readonly role:           CalendarShareRoleCode;
    readonly shareeUserId?:  string;
    readonly shareeGroupId?: string;
}

export interface UpdateCalendarShareDto {
    readonly role: CalendarShareRoleCode;
}

/** Options for the calendar-items range query. */
export interface ListCalendarItemsOptions {
    readonly calendarSlug?: string;
    readonly from?:         string; // ISO 8601
    readonly to?:           string; // ISO 8601
    readonly type?:         CalendarItemTypeCode;
}

// --- Service -----------------------------------------------------------------

/** Read-only snapshot of a tracked telephony call for the admin call-history list. */
export interface CallRecordDto {
    readonly id?:               string;
    readonly callId?:           string;
    readonly direction?:        string;
    readonly state?:            string;
    readonly fromNumber?:       string | null;
    readonly toNumber?:         string | null;
    readonly callerName?:       string | null;
    readonly channel?:          string | null;
    readonly assignedUserRef?:  string | null;
    /** Resolved display name of the assigned agent (M9), or null when unassigned/unknown. */
    readonly assignedUserName?: string | null;
    /** The extension that answered, or null (fallback "answered on" label). */
    readonly answeredExtension?: string | null;
    readonly recordingNodeRef?: string | null;
    readonly startedAt?:        string;
    readonly answeredAt?:       string | null;
    readonly endedAt?:          string | null;
    readonly durationSeconds?:  number | null;
    readonly hangupCause?:      string | null;
    /** Derived: the call was ever connected. */
    readonly answered?:         boolean;
    /** Derived: the call ended without ever being answered. */
    readonly missed?:           boolean;
    readonly createdAt?:        string;
    readonly updatedAt?:        string;
}

/** Click-to-dial request body (`POST /call/originate`). */
export interface CallOriginateRequest {
    /** The caller's own device, e.g. `PJSIP/1001`. */
    readonly endpoint: string;
    /** The number/extension to dial. */
    readonly extension: string;
    readonly callerId?: string;
}

/** Click-to-dial response: the created channel id. */
export interface CallOriginateDto {
    readonly channelId?: string | null;
    readonly originated?: boolean;
}

/** The browser softphone connection descriptor (`GET /call/webphone/config`). */
export interface WebPhoneConfigDto {
    readonly enabled: boolean;
    readonly wssUrl: string;
    readonly sipDomain: string;
    readonly authorizationUser: string;
    readonly displayName: string;
    /** Cleartext SIP password (owner-only; present only when enabled + provisioned). */
    readonly password: string;
}

/** ICE configuration for the softphone peer connection (`GET /rtc/ice-servers`, reused). */
export interface CallIceServersDto {
    readonly iceServers: RTCIceServer[];
    readonly ttlSeconds: number;
}

/** One MCP tool + its governance gate (`GET /api/mcp/tools`, ). */
export interface McpToolGovernanceDto {
    readonly name: string;
    readonly title: string;
    readonly description: string;
    /** The role a caller must hold, or null when any authenticated caller may use it. */
    readonly requiredRole: string | null;
    /** Derived human-readable gate: `authenticated` or `role:ROLE_X`. */
    readonly access: string;
}

/** The full MCP tool inventory + per-tool governance (admin audit endpoint). */
export interface McpToolCatalogDto {
    readonly count: number;
    readonly tools: McpToolGovernanceDto[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
    /**
     * Collection GET requests must ask for JSON-LD so API Platform returns
     * member / totalItems.  Single-item and mutation requests work fine with
     * plain JSON (the server negotiates via content-type).
     */
    private readonly collectionHeaders = { headers: { Accept: 'application/ld+json' } };
    private readonly patchHeaders = { headers: { 'Content-Type': 'application/merge-patch+json' } };

    private readonly identity = inject(IdentityApiClient);
    private readonly realtime = inject(RealtimeTokenClient);

    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    // -- Auth ----------------------------------------------------------------

    // -- Identity: implemented in core, kept here as the app's one API surface --
    // Core owns the session, so these live in `IdentityApiClient`. Delegating
    // rather than re-pointing every caller keeps `api.login(...)` meaning what
    // it always meant.

    login(identifier: string, password: string): Observable<TokenResponse> {
        return this.identity.login(identifier, password);
    }

    refresh(refreshToken: string): Observable<TokenResponse> {
        return this.identity.refresh(refreshToken);
    }

    logout(): Observable<void> {
        return this.identity.logout();
    }

    me(): Observable<UserDto> {
        return this.identity.me();
    }

    /** Full current-user object — same endpoint as me() but typed as IdentityUserDto. */
    getMe(): Observable<IdentityUserDto> {
        return this.http.get<IdentityUserDto>(this.manifest.identity!.meUrl);
    }

    updateMe(dto: { firstName?: string | null; lastName?: string | null }): Observable<IdentityUserDto> {
        return this.http.patch<IdentityUserDto>(this.manifest.identity!.meUrl, dto, this.patchHeaders);
    }

    uploadAvatar(file: File): Observable<IdentityUserDto> {
        const fd = new FormData();
        fd.append('file', file);
        return this.http.post<IdentityUserDto>(this.manifest.identity!.avatarUploadUrl, fd);
    }

    deleteAvatar(): Observable<void> {
        return this.http.delete<void>(this.manifest.identity!.avatarUploadUrl);
    }

    updateAvatarColor(color: string): Observable<IdentityUserDto> {
        return this.http.patch<IdentityUserDto>(this.manifest.identity!.colorUrl, { color }, this.patchHeaders);
    }

    getSettings(): Observable<Record<string, Record<string, unknown>>> {
        return this.identity.getSettings();
    }

    getSettingsSections(): Observable<ProfileSection[]> {
        return this.http.get<HydraCollection<ProfileSection>>(this.manifest.identity!.settingsSectionsUrl)
            .pipe(map(r => r['member']));
    }

    updateSettings(section: string, data: Record<string, unknown>): Observable<Record<string, unknown>> {
        const url = resolvePattern(this.manifest.identity!.settingsSectionUrl, { section });

        // Accept: application/json for the same reason getSettings() forces it —
        // and this response needs it just as badly. A settings section is a MAP,
        // and API Platform's ld+json turns a map into a Hydra Collection whose
        // `member` array carries the values with the KEYS STRIPPED:
        // `{"member":["system","en",20,false,"#3366ff"]}`. Callers then read
        // `updated['theme']` off an object that has no such property.
        //
        // It failed silently because every caller merges the result into a
        // cache — the calendar and call preference services included — so the
        // save persisted correctly on the server and only the in-memory echo was
        // wrong, which looks like nothing until something READS it.
        return this.http.patch<Record<string, unknown>>(url, data, {
            headers: { ...this.patchHeaders.headers, Accept: 'application/json' },
        });
    }

    // -- Sections ------------------------------------------------------------

    getSections(): Observable<SiteSectionDto[]> {
        return this.http
            .get<HydraCollection<SiteSectionDto>>(this.manifest.sections!.list, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    createSection(dto: CreateSectionDto): Observable<SiteSectionDto> {
        return this.http.post<SiteSectionDto>(this.manifest.sections!.create, dto);
    }

    updateSection(id: string, dto: UpdateSectionDto): Observable<SiteSectionDto> {
        const url = resolvePattern(this.manifest.sections!.update, { id });
        return this.http.patch<SiteSectionDto>(url, dto, this.patchHeaders);
    }

    deleteSection(id: string): Observable<void> {
        const url = resolvePattern(this.manifest.sections!.delete, { id });
        return this.http.delete<void>(url);
    }

    /**
     * POST /api/v1/sections/_apply — regenerate per-section nginx vhost configs.
     * Returns a summary; the FE still has to surface `reloadCommand` to the
     * operator (nginx is NOT auto-reloaded). Admin-only on the backend.
     */
    applySections(): Observable<SectionApplyResultDto> {
        const url = this.manifest.sections?.apply;
        if (!url) {
            throw new Error('sections.apply URL not present in manifest');
        }
        return this.http.post<SectionApplyResultDto>(url, {}, {
            headers: { 'Content-Type': 'application/ld+json', Accept: 'application/ld+json' },
        });
    }

    // -- Web / Sites composition ( Layer 3a/3b/3c) --------------------
    //
    // The Web module endpoints live under `/api/v1/web/sites`. There is no
    // dedicated manifest section for them (the URL prefix is stable and
    // the FE consumer surface is small) so we build URLs from `apiBase`,
    // matching the existing `getThemeTemplates` pattern.

    /**
     * GET /api/v1/web/sites — list of composed Site views (admin-gated).
     * Each row carries `currentUserMembership` inline for per-section
     * gating without a second round-trip.
     */
    listSites(): Observable<SiteDto[]> {
        const url = `${this.manifest.apiBase}/web/sites`;
        return this.http
            .get<HydraCollection<SiteDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    /**
     * GET /api/v1/web/sites/{slug} — single composed Site view with
     * `currentUserMembership` embedded. Used by the Site Detail page
     * (Layer 3d.1). 404 when the slug doesn't match a SiteSection.
     */
    getSite(slug: string): Observable<SiteDto> {
        const url = `${this.manifest.apiBase}/web/sites/${encodeURIComponent(slug)}`;
        return this.http.get<SiteDto>(url);
    }

    /**
     * GET /api/v1/web/sites/{slug}/members — owner + editor-group members.
     * Used by the Site Detail page (Members card + "View all" modal).
     * Backend is admin-only today; FE callers should still surface 403
     * gracefully.
     */
    listSiteMembers(slug: string): Observable<SiteMemberDto[]> {
        const url = `${this.manifest.apiBase}/web/sites/${encodeURIComponent(slug)}/members`;
        return this.http
            .get<HydraCollection<SiteMemberDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    /**
     * DELETE /api/v1/web/sites/{slug} — Web-composition delete (not the
     * Section module's `/sections/{id}` delete). Backend forbids deletion
     * when NaviTree FKs still reference the SiteSection. Reserved for
     * future Site Detail wiring; not consumed in Layer 3d.1.
     */
    deleteSite(slug: string): Observable<void> {
        const url = `${this.manifest.apiBase}/web/sites/${encodeURIComponent(slug)}`;
        return this.http.delete<void>(url);
    }

    /**
     * GET /api/v1/web/routing/inspect?host=&path= -- Routing Inspector
     * ( Layer 3b backend, 3d.2 FE). Admin-only; surfaces the
     * SSR pipeline trace for an arbitrary (host, path) pair so admins
     * can debug "why did /foo render template X" without booting a
     * browser session against that host.
     *
     * The endpoint returns a JSON-LD framed RoutingTrace; the framing
     * fields (`@id`, `@type`, `@context`) are ignored here.
     */
    inspectRouting(host: string, path: string): Observable<RoutingTraceDto> {
        const url    = `${this.manifest.apiBase}/web/routing/inspect`;
        const params = new HttpParams()
            .set('host', host)
            .set('path', path);
        return this.http.get<RoutingTraceDto>(url, { params });
    }

    // -- Calendars () --------------------------------------------------

    listCalendars(): Observable<CalendarDto[]> {
        const url = `${this.manifest.apiBase}/calendar`;
        return this.http
            .get<HydraCollection<CalendarDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    /**
     * — paged variant for the admin Calendars list. Round-trips
     * RQL filters + sort to the server so we never load 100k+ rows
     * into the browser. The lazy-mode DataGrid emits page/sort/filter
     * on every `loadMore`; the page calls into this method and feeds
     * the returned envelope to the grid via `[externalData]`.
     *
     * `filters` is a list of RQL clauses (e.g. `slug cn "foo"`,
     * `currentUserAccess eq "owned"`) — each becomes its own
     * `?filter=` query param.
     */
    listCalendarsPage(opts: {
        page?:     number;
        pageSize?: number;
        sort?:     string | null;
        filters?:  ReadonlyArray<string>;
    } = {}): Observable<{ items: CalendarDto[]; totalItems: number; page: number; pageSize: number }> {
        const url = `${this.manifest.apiBase}/calendar`;
        let params = new HttpParams();
        const pageSize = opts.pageSize ?? 50;
        const page     = opts.page ?? 1;
        params = params.set('page',     String(page));
        // RQL parser reads `?limit=N` (see RqlParser).
        // Sending `pageSize` was a no-op — backend silently fell back to
        // RqlQuery::DEFAULT_LIMIT (20), and the FE's offset math (built on
        // PAGE_SIZE=50) requested page 1 over and over, duplicating rows.
        params = params.set('limit', String(pageSize));
        if (opts.sort) {
            params = params.set('sort', opts.sort);
        }
        for (const f of opts.filters ?? []) {
            if (f && f.trim() !== '') {
                params = params.append('filter', f);
            }
        }
        return this.http
            .get<HydraCollection<CalendarDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => ({
                items:      r['member'],
                totalItems: r['totalItems'],
                page,
                pageSize,
            })));
    }

    getCalendar(slug: string): Observable<CalendarDto> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}`;
        return this.http.get<CalendarDto>(url);
    }

    createCalendar(dto: Partial<CalendarDto>): Observable<CalendarDto> {
        const url = `${this.manifest.apiBase}/calendar`;
        return this.http.post<CalendarDto>(url, dto);
    }

    updateCalendar(slug: string, patch: Partial<CalendarDto>): Observable<CalendarDto> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}`;
        return this.http.patch<CalendarDto>(url, patch, this.patchHeaders);
    }

    deleteCalendar(slug: string): Observable<void> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}`;
        return this.http.delete<void>(url);
    }

    /**
     * — download a calendar as an RFC 5545 `.ics`. Goes through
     * HttpClient (not a bare `<a href>`) so the Bearer interceptor attaches
     * the token; the caller turns the Blob into a download.
     */
    exportCalendarIcs(slug: string): Observable<Blob> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}/export.ics`;
        return this.http.get(url, { responseType: 'blob' as const });
    }

    /** — upload an `.ics` document (raw body) into a calendar. */
    importCalendarIcs(slug: string, ics: string): Observable<CalendarImportResultDto> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}/import`;
        return this.http.post<CalendarImportResultDto>(url, ics, {
            headers: { 'Content-Type': 'text/calendar' },
        });
    }

    listHolidayRules(calendarSlug: string): Observable<HolidayRuleDto[]> {
        const url    = `${this.manifest.apiBase}/calendar/holiday-rules`;
        const params = new HttpParams().set('calendar', calendarSlug);
        return this.http
            .get<HydraCollection<HolidayRuleDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => r['member']));
    }

    getHolidayRule(id: string): Observable<HolidayRuleDto> {
        const url = `${this.manifest.apiBase}/calendar/holiday-rules/${encodeURIComponent(id)}`;
        return this.http.get<HolidayRuleDto>(url);
    }

    createHolidayRule(dto: Partial<HolidayRuleDto>): Observable<HolidayRuleDto> {
        const url = `${this.manifest.apiBase}/calendar/holiday-rules`;
        return this.http.post<HolidayRuleDto>(url, dto);
    }

    updateHolidayRule(id: string, patch: Partial<HolidayRuleDto>): Observable<HolidayRuleDto> {
        const url = `${this.manifest.apiBase}/calendar/holiday-rules/${encodeURIComponent(id)}`;
        return this.http.patch<HolidayRuleDto>(url, patch, this.patchHeaders);
    }

    deleteHolidayRule(id: string): Observable<void> {
        const url = `${this.manifest.apiBase}/calendar/holiday-rules/${encodeURIComponent(id)}`;
        return this.http.delete<void>(url);
    }

    previewCalendarYear(slug: string, year: number): Observable<CalendarHolidayPreviewDto> {
        const url    = `${this.manifest.apiBase}/calendar/${encodeURIComponent(slug)}/preview`;
        const params = new HttpParams().set('year', year.toString());
        return this.http.get<CalendarHolidayPreviewDto>(url, { params });
    }

    // -- Calendar Items ( /) ------------------------------------
    //
    // The range query (`from`/`to`) is the FullCalendar event source. Backend
    // expands recurring items within the requested window via
    // CalendarItemRangeExpander + tagged CalendarItemProvider's. Without a
    // range the endpoint returns canonical rows only (no expansion). Callers
    // should always pass `from`+`to` for calendar grids.

    listCalendarItems(opts: ListCalendarItemsOptions = {}): Observable<CalendarItemDto[]> {
        const url = `${this.manifest.apiBase}/calendar/items`;
        let params = new HttpParams();
        if (opts.calendarSlug) params = params.set('calendar', opts.calendarSlug);
        if (opts.from)         params = params.set('from',     opts.from);
        if (opts.to)           params = params.set('to',       opts.to);
        if (opts.type)         params = params.set('type',     opts.type);
        return this.http
            .get<HydraCollection<CalendarItemDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => r['member']));
    }

    getCalendarItem(id: string): Observable<CalendarItemDto> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(id)}`;
        return this.http.get<CalendarItemDto>(url);
    }

    createCalendarItem(dto: CreateCalendarItemDto): Observable<CalendarItemDto> {
        const url = `${this.manifest.apiBase}/calendar/items`;
        return this.http.post<CalendarItemDto>(url, dto);
    }

    updateCalendarItem(id: string, patch: UpdateCalendarItemDto): Observable<CalendarItemDto> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(id)}`;
        return this.http.patch<CalendarItemDto>(url, patch, this.patchHeaders);
    }

    deleteCalendarItem(id: string): Observable<void> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(id)}`;
        return this.http.delete<void>(url);
    }

    // -- Per-occurrence overrides (Phase 2) ----------------------------------
    //
    // When the user edits / deletes / drags one occurrence of a recurring
    // event AND picks the "only this event" scope, we route to these two
    // endpoints instead of touching the canonical row. Both are idempotent
    // on `(parentItemId, recurrenceInstant)` server-side, so a re-edit on
    // the same instant updates rather than duplicates.

    createCalendarItemException(
        parentItemId: string,
        body: CalendarItemExceptionRequest,
    ): Observable<CalendarItemExceptionResponse> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(parentItemId)}/exception`;
        return this.http.post<CalendarItemExceptionResponse>(url, body);
    }

    skipCalendarItemOccurrence(
        parentItemId: string,
        recurrenceInstant: string,
    ): Observable<CalendarItemSkipResponse> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(parentItemId)}/skip`;
        return this.http.post<CalendarItemSkipResponse>(url, { recurrenceInstant });
    }

    /**
     * Phase 3 — "this and following events" save / drag-resize. Trims
     * the base's RRULE at `recurrenceInstant` and creates a new base
     * with the patched properties starting at `newStart`. Both halves
     * share `seriesId` so the "all events" walk traverses the split.
     */
    splitCalendarItem(
        parentItemId: string,
        body: CalendarItemSplitRequest,
    ): Observable<CalendarItemSplitResponse> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(parentItemId)}/split`;
        return this.http.post<CalendarItemSplitResponse>(url, body);
    }

    /**
     * Phase 3 — "delete this and following events". Truncates the
     * base's RRULE; later overrides are removed. No new item is
     * created.
     */
    deleteFollowingCalendarItem(
        parentItemId: string,
        recurrenceInstant: string,
    ): Observable<CalendarItemDeleteFollowingResponse> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(parentItemId)}/delete-following`;
        return this.http.post<CalendarItemDeleteFollowingResponse>(url, { recurrenceInstant });
    }

    // -- Recurrence preview ( / shared) ----------------------------------
    //
    // Pure computation endpoint over the canonical RecurrenceIterator. The
    // calendar event editor's structured recurrence form calls this on
    // debounced form changes to render the "next 5 occurrences" preview list.
    // Any other module that exposes a recurrence configurator (Scheduler,
    // Workflow deadlines) can call the same endpoint without extra wiring.

    recurrencePreview(req: RecurrencePreviewRequest): Observable<RecurrencePreviewResponse> {
        const url = `${this.manifest.apiBase}/recurrence/preview`;
        return this.http.post<RecurrencePreviewResponse>(url, req);
    }

    // -- Event Attendees / RSVP () -------------------------------------

    listEventAttendees(itemId: string): Observable<EventAttendeeDto[]> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(itemId)}/attendees`;
        return this.http
            .get<HydraCollection<EventAttendeeDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    addEventAttendee(
        itemId: string,
        dto: { userId: string; role?: EventAttendeeRoleCode; status?: EventAttendeeStatusCode },
    ): Observable<EventAttendeeDto> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(itemId)}/attendees`;
        return this.http.post<EventAttendeeDto>(url, dto);
    }

    updateEventAttendee(
        itemId: string,
        attendeeId: string,
        patch: { status?: EventAttendeeStatusCode; role?: EventAttendeeRoleCode },
    ): Observable<EventAttendeeDto> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(itemId)}/attendees/${encodeURIComponent(attendeeId)}`;
        return this.http.patch<EventAttendeeDto>(url, patch, this.patchHeaders);
    }

    removeEventAttendee(itemId: string, attendeeId: string): Observable<void> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(itemId)}/attendees/${encodeURIComponent(attendeeId)}`;
        return this.http.delete<void>(url);
    }

    rsvpCalendarItem(
        itemId: string,
        status: EventAttendeeStatusCode,
    ): Observable<CalendarItemRsvpDto> {
        const url = `${this.manifest.apiBase}/calendar/items/${encodeURIComponent(itemId)}/rsvp`;
        return this.http.post<CalendarItemRsvpDto>(url, { status });
    }

    // -- Calendar Shares () ------------------------------------------

    listCalendarShares(calendarSlug: string): Observable<CalendarShareDto[]> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(calendarSlug)}/shares`;
        return this.http
            .get<HydraCollection<CalendarShareDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    createCalendarShare(
        calendarSlug: string,
        dto: CreateCalendarShareDto,
    ): Observable<CalendarShareDto> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(calendarSlug)}/shares`;
        return this.http.post<CalendarShareDto>(url, dto);
    }

    updateCalendarShare(
        calendarSlug: string,
        shareId: string,
        patch: UpdateCalendarShareDto,
    ): Observable<CalendarShareDto> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(calendarSlug)}/shares/${encodeURIComponent(shareId)}`;
        return this.http.patch<CalendarShareDto>(url, patch, this.patchHeaders);
    }

    deleteCalendarShare(calendarSlug: string, shareId: string): Observable<void> {
        const url = `${this.manifest.apiBase}/calendar/${encodeURIComponent(calendarSlug)}/shares/${encodeURIComponent(shareId)}`;
        return this.http.delete<void>(url);
    }

    // -- Scheduled handler catalog ------------------------------------------

    /**
     * Returns every #[ScheduledHandler]-decorated class registered with
     * the container. Feeds the admin "Handler" dropdown in the Schedule
     * create / edit dialog so admins pick a stable label instead of
     * typing an FQCN.
     */
    listScheduledHandlers(q?: string): Observable<ScheduledHandlerDto[]> {
        const url = `${this.manifest.apiBase}/scheduler/handlers`;
        let params = new HttpParams();
        if (q && q.trim() !== '') {
            params = params.set('q', q.trim());
        }
        return this.http
            .get<HydraCollection<ScheduledHandlerDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => r['member']));
    }

    // -- Schedules () ---------------------------------------------------

    listSchedules(): Observable<ScheduleDto[]> {
        const url = `${this.manifest.apiBase}/schedules`;
        return this.http
            .get<HydraCollection<ScheduleDto>>(url, this.collectionHeaders)
            .pipe(map(r => r['member']));
    }

    /**
     * Sibling — paged variant for the admin Schedules list.
     * Round-trips RQL filters + sort to the server so we never load
     * 100k+ rows. Mirror of {@see ApiService.listCalendarsPage}.
     */
    listSchedulesPage(opts: {
        page?:     number;
        pageSize?: number;
        sort?:     string | null;
        filters?:  ReadonlyArray<string>;
    } = {}): Observable<{ items: ScheduleDto[]; totalItems: number; page: number; pageSize: number }> {
        const url = `${this.manifest.apiBase}/schedules`;
        let params = new HttpParams();
        const pageSize = opts.pageSize ?? 50;
        const page     = opts.page ?? 1;
        params = params.set('page',     String(page));
        // RQL parser reads `?limit=N` (see RqlParser).
        // Sending `pageSize` was a no-op — backend silently fell back to
        // RqlQuery::DEFAULT_LIMIT (20), and the FE's offset math (built on
        // PAGE_SIZE=50) requested page 1 over and over, duplicating rows.
        params = params.set('limit', String(pageSize));
        if (opts.sort) {
            params = params.set('sort', opts.sort);
        }
        for (const f of opts.filters ?? []) {
            if (f && f.trim() !== '') {
                params = params.append('filter', f);
            }
        }
        return this.http
            .get<HydraCollection<ScheduleDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => ({
                items:      r['member'],
                totalItems: r['totalItems'],
                page,
                pageSize,
            })));
    }

    /**
     * Page the read-only call history (`GET /call/records`).
     * A verbatim shape-copy of {@link listSchedulesPage}: server-side paginated +
     * RQL-filterable, `?limit=N` (the RQL parser ignores `pageSize`), JSON-LD.
     */
    listCallRecordsPage(opts: {
        page?:     number;
        pageSize?: number;
        sort?:     string | null;
        filters?:  ReadonlyArray<string>;
    } = {}): Observable<{ items: CallRecordDto[]; totalItems: number; page: number; pageSize: number }> {
        const url = `${this.manifest.apiBase}/call/records`;
        let params = new HttpParams();
        const pageSize = opts.pageSize ?? 50;
        const page     = opts.page ?? 1;
        params = params.set('page', String(page));
        params = params.set('limit', String(pageSize)); // RQL parser reads ?limit=N
        if (opts.sort) {
            params = params.set('sort', opts.sort);
        }
        for (const f of opts.filters ?? []) {
            if (f && f.trim() !== '') {
                params = params.append('filter', f);
            }
        }
        return this.http
            .get<HydraCollection<CallRecordDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => ({
                items:      r['member'],
                totalItems: r['totalItems'],
                page,
                pageSize,
            })));
    }

    /**
     * Fetch one tracked call by id (`GET /call/records/{id}`).
     * Plain JSON (like {@link getSchedule}); the item op returns the
     * CallRecordResource projection.
     */
    getCallRecord(id: string): Observable<CallRecordDto> {
        const url = `${this.manifest.apiBase}/call/records/${encodeURIComponent(id)}`;
        return this.http.get<CallRecordDto>(url);
    }

    /**
     * Stream a call's `.wav` recording (`GET
     * /call/records/{id}/recording`). The admin is a Bearer SPA, so a plain
     * `<audio src>` can't carry the token — this goes through HttpClient
     * (the auth interceptor attaches the Bearer) as a Blob the caller turns
     * into an object URL (mirrors {@link exportCalendarIcs}).
     */
    downloadCallRecording(id: string): Observable<Blob> {
        const url = `${this.manifest.apiBase}/call/records/${encodeURIComponent(id)}/recording`;
        return this.http.get(url, { responseType: 'blob' as const });
    }

    /**
     * Click-to-dial (`POST /call/originate`). Rings the caller's
     * own device (`endpoint`, e.g. `PJSIP/1001`), then bridges it out to the
     * dialled `extension`; the backend fills the dialplan context. Returns the
     * created channel id (the same call soon pops on the incoming-call overlay).
     */
    originateCall(body: CallOriginateRequest): Observable<CallOriginateDto> {
        const url = `${this.manifest.apiBase}/call/originate`;
        return this.http.post<CallOriginateDto>(url, body);
    }

    /**
     * The browser softphone's connection descriptor (WSS URI + SIP
     * identity + owner-only password). `enabled` is false where no WebRTC PBX is
     * configured or the user has no device, in which case the softphone stays dormant.
     */
    getWebPhoneConfig(): Observable<WebPhoneConfigDto> {
        const url = `${this.manifest.apiBase}/call/webphone/config`;
        return this.http.get<WebPhoneConfigDto>(url);
    }

    /** ICE servers for the softphone peer connection (shared Coturn, reused). */
    getCallIceServers(): Observable<CallIceServersDto> {
        const url = `${this.manifest.apiBase}/rtc/ice-servers`;
        return this.http.get<CallIceServersDto>(url);
    }

    /**
     * MCP tool-governance audit ( `GET /api/mcp/tools`, ROLE_ADMIN) — the
     * full inventory of tools external AI agents can call + the gate on each.
     * The endpoint is UNVERSIONED (`/api/mcp/…`, like `/api/doc`), so it hangs off
     * the `/api` base, not the `/api/v1` apiBase.
     */
    getMcpTools(): Observable<McpToolCatalogDto> {
        const base = this.manifest.apiBase.replace(/\/v1\/?$/, '');
        return this.http.get<McpToolCatalogDto>(`${base}/mcp/tools`);
    }

    getSchedule(slug: string): Observable<ScheduleDto> {
        const url = `${this.manifest.apiBase}/schedules/${encodeURIComponent(slug)}`;
        return this.http.get<ScheduleDto>(url);
    }

    createSchedule(dto: Partial<ScheduleDto>): Observable<ScheduleDto> {
        const url = `${this.manifest.apiBase}/schedules`;
        return this.http.post<ScheduleDto>(url, dto);
    }

    updateSchedule(slug: string, patch: Partial<ScheduleDto>): Observable<ScheduleDto> {
        const url = `${this.manifest.apiBase}/schedules/${encodeURIComponent(slug)}`;
        return this.http.patch<ScheduleDto>(url, patch, this.patchHeaders);
    }

    deleteSchedule(slug: string): Observable<void> {
        const url = `${this.manifest.apiBase}/schedules/${encodeURIComponent(slug)}`;
        return this.http.delete<void>(url);
    }

    triggerScheduleNow(slug: string): Observable<ScheduleTriggerNowDto> {
        const url = `${this.manifest.apiBase}/schedules/${encodeURIComponent(slug)}/trigger-now`;
        return this.http.post<ScheduleTriggerNowDto>(url, {});
    }

    // -- Navi Trees ----------------------------------------------------------

    getNaviTrees(params: { filters?: string[]; sort?: string } = {}): Observable<NaviTreeDto[]> {
        let httpParams = new HttpParams();
        if (params.sort) httpParams = httpParams.set('sort', params.sort);
        for (const f of params.filters ?? []) {
            httpParams = httpParams.append('filter', f);
        }
        return this.http
            .get<HydraCollection<NaviTreeDto>>(this.manifest.navi!.treesList, {
                headers: this.collectionHeaders.headers,
                params:  httpParams,
            })
            .pipe(map(r => r['member']));
    }

    createNaviTree(dto: CreateNaviTreeDto): Observable<NaviTreeDto> {
        return this.http.post<NaviTreeDto>(this.manifest.navi!.treesCreate, dto);
    }

    updateNaviTree(slug: string, dto: UpdateNaviTreeDto): Observable<NaviTreeDto> {
        const url = resolvePattern(this.manifest.navi!.treesItem, { slug });
        return this.http.patch<NaviTreeDto>(url, dto, this.patchHeaders);
    }

    deleteNaviTree(slug: string): Observable<void> {
        const url = resolvePattern(this.manifest.navi!.treesItem, { slug });
        return this.http.delete<void>(url);
    }

    // -- Theme templates (Navi-node picker, Deliverable 1) ---------

    /**
     * GET /api/v1/themes/{slug}/templates — flat listing of `.dtmpl` files
     * available under the theme's `templates/` directory. Empty when the
     * theme has no templates yet. Throws on 404 (theme slug not installed).
     *
     * Not registered in the API manifest because consumers are scoped to
     * the Navi-node form; URL is built from `manifest.apiBase`.
     */
    getThemeTemplates(themeSlug: string): Observable<ThemeTemplateDto[]> {
        const url = `${this.manifest.apiBase}/themes/${encodeURIComponent(themeSlug)}/templates`;
        return this.http
            .get<HydraCollection<ThemeTemplateDto>>(url, {
                headers: this.collectionHeaders.headers,
            })
            .pipe(map(r => r['member']));
    }

    // -- Navi Nodes ----------------------------------------------------------

    /**
     * Tree datagrid Ship B -- NaviNode list endpoint now accepts a `parentId`
     * to drive lazy tree expansion:
     *
     *   - `parentId === 'root'`       -> only nodes with `parent IS NULL`
     *   - `parentId === '{uuid}'`     -> direct children of that node
     *   - `parentId === undefined`    -> legacy flat listing (kept so Newman
     *                                    and any cross-module reader keep
     *                                    behaving the same)
     *
     * Every response carries `hasChildren` and a coarse `nodeType` field
     * (`'group'` / `'leaf'`) the datagrid uses for the chevron + icon.
     */
    getNaviNodes(
        treeSlug: string,
        params: { filters?: string[]; sort?: string; parentId?: string } = {},
    ): Observable<NaviNodeDto[]> {
        const url = resolvePattern(this.manifest.navi!.nodesByTree, { slug: treeSlug });
        let httpParams = new HttpParams();
        if (params.sort)     httpParams = httpParams.set('sort',   params.sort);
        if (params.parentId) httpParams = httpParams.set('parent', params.parentId);
        for (const f of params.filters ?? []) {
            httpParams = httpParams.append('filter', f);
        }
        return this.http
            .get<HydraCollection<NaviNodeDto>>(url, {
                headers: this.collectionHeaders.headers,
                params:  httpParams,
            })
            .pipe(map(r => r['member']));
    }

    createNaviNode(dto: CreateNaviNodeDto): Observable<NaviNodeDto> {
        return this.http.post<NaviNodeDto>(this.manifest.navi!.nodesCreate, dto);
    }

    updateNaviNode(id: string, dto: UpdateNaviNodeDto): Observable<NaviNodeDto> {
        const url = resolvePattern(this.manifest.navi!.nodesItem, { id });
        return this.http.patch<NaviNodeDto>(url, dto, this.patchHeaders);
    }

    deleteNaviNode(id: string): Observable<void> {
        const url = resolvePattern(this.manifest.navi!.nodesItem, { id });
        return this.http.delete<void>(url);
    }

    reorderNaviNodes(items: Array<{ id: string; sortOrder: number }>): Observable<void> {
        return this.http.patch<void>(this.manifest.navi!.nodesReorder, { items }, this.patchHeaders);
    }

    // -- Identity Users ------------------------------------------------------

    /**
     * List users using RQL query params.
     *
     * filters — RQL filter expressions, e.g. ['isActive eq true', 'groupId eq "uuid"']
     *           Each entry is sent as a separate `filter=…` query param; the PHP
     *           RqlParser collects them all as AND conditions.
     * sort    — RQL sort string, e.g. '-identifier' (desc) or 'displayName' (asc).
     * page    — 1-based page number (omit or 1 = first page).
     * limit   — items per page.
     */
    listUsers(params: {
        filters?: string[];
        sort?:    string;
        page?:    number;
        limit?:   number;
    } = {}): Observable<{ members: IdentityUserDto[]; total: number }> {
        let httpParams = new HttpParams();
        if (params.limit)              httpParams = httpParams.set('limit', String(params.limit));
        if (params.page && params.page > 1) httpParams = httpParams.set('page', String(params.page));
        if (params.sort)               httpParams = httpParams.set('sort', params.sort);
        for (const f of params.filters ?? []) {
            // Repeated `filter=…` keys — RqlParser collects all of them as AND conditions.
            httpParams = httpParams.append('filter', f);
        }
        return this.http
            .get<HydraCollection<IdentityUserDto>>(this.manifest.identity!.usersUrl, {
                headers: this.collectionHeaders.headers,
                params:  httpParams,
            })
            .pipe(map(r => ({ members: r['member'], total: r['totalItems'] })));
    }

    createUser(dto: CreateUserDto): Observable<IdentityUserDto> {
        return this.http.post<IdentityUserDto>(this.manifest.identity!.usersUrl, dto);
    }

    /**
     * Preview the audience an RQL filter selects — count plus a sample.
     *
     * Replaces `countUsers()`, which asked `GET /auth/users` for
     * `totalItems`. That endpoint returns a BARE ARRAY, so the read was
     * `undefined` on every call, for every filter, since the wizard shipped.
     * The recipients step's `canProceed` is `count > 0`, and `undefined > 0`
     * is false — so typing ANY filter killed the Next button and Filter mode
     * could only ever be completed with an empty filter, i.e. "send to
     * everyone". Counting the returned rows instead would have been worse: the
     * endpoint pages at 20.
     *
     * `/document/generations/preview-audience` is the right call and already
     * existed. It runs the SAME `FilterAudienceMaterializer` the submit runs,
     * so the number the operator approves is the number that gets documents —
     * and it returns a `sample` so they can see WHO, not just how many.
     *
     * @param rqlBody raw query string from `CmsFilterBuilder`
     *                (`filter=expr1 and expr2`), or '' for "everyone"
     */
    previewDocumentAudience(entityType: string, rqlBody: string): Observable<AudiencePreviewDto> {
        return this.http.get<AudiencePreviewDto>(
            `${this.manifest.apiBase}/document/generations/preview-audience`,
            { params: new HttpParams().set('entityType', entityType).set('rql', rqlBody) },
        );
    }

    getUser(id: string): Observable<IdentityUserDto> {
        const url = resolvePattern(this.manifest.identity!.userUrl, { id });
        return this.http.get<IdentityUserDto>(url);
    }

    updateUser(id: string, dto: UpdateUserDto): Observable<IdentityUserDto> {
        const url = resolvePattern(this.manifest.identity!.userUrl, { id });
        return this.http.patch<IdentityUserDto>(url, dto, this.patchHeaders);
    }

    deleteUser(id: string): Observable<void> {
        const url = resolvePattern(this.manifest.identity!.userUrl, { id });
        return this.http.delete<void>(url);
    }

    assignUserGroups(id: string, groupIds: string[]): Observable<void> {
        const url = resolvePattern(this.manifest.identity!.assignGroupsUrl, { id });
        return this.http.post<void>(url, { groups: groupIds });
    }

    // -- Identity Groups -----------------------------------------------------

    listGroups(params: { search?: string; limit?: number; filters?: string[]; sort?: string } = {}): Observable<IdentityGroupDto[]> {
        let httpParams = new HttpParams();
        if (params.search) httpParams = httpParams.set('search', params.search);
        if (params.limit)  httpParams = httpParams.set('limit', String(params.limit));
        if (params.sort)   httpParams = httpParams.set('sort', params.sort);
        for (const f of params.filters ?? []) {
            httpParams = httpParams.append('filter', f);
        }
        return this.http
            .get<HydraCollection<IdentityGroupDto>>(this.manifest.identity!.groupsUrl, {
                headers: this.collectionHeaders.headers,
                params:  httpParams,
            })
            .pipe(map(r => r['member']));
    }

    getGroup(id: string): Observable<IdentityGroupDto> {
        const url = resolvePattern(this.manifest.identity!.groupUrl, { id });
        return this.http.get<IdentityGroupDto>(url);
    }

    createGroup(dto: CreateGroupDto): Observable<IdentityGroupDto> {
        return this.http.post<IdentityGroupDto>(this.manifest.identity!.groupsUrl, dto);
    }

    updateGroup(id: string, dto: UpdateGroupDto): Observable<IdentityGroupDto> {
        const url = resolvePattern(this.manifest.identity!.groupUrl, { id });
        return this.http.patch<IdentityGroupDto>(url, dto, this.patchHeaders);
    }

    deleteGroup(id: string): Observable<void> {
        const url = resolvePattern(this.manifest.identity!.groupUrl, { id });
        return this.http.delete<void>(url);
    }

    /**
     * Replace the groups whose roles are granted by holding THIS group's role
     * — the role-inheritance edges behind `DynamicRoleHierarchy`.
     *
     * An edge means "holding the parent's role also grants the child's", so this
     * is the most privilege-bearing write in the admin. The server refuses a
     * change that would let a group grant its own role (422) — directly or
     * through another group — and returns the edges AS PERSISTED, which differ
     * from what was sent whenever the request contained a duplicate.
     */
    setGroupRoleGrants(id: string, grantsGroupIds: readonly string[]): Observable<{ grantsGroupIds: string[] }> {
        const url = `${resolvePattern(this.manifest.identity!.groupUrl, { id })}/role-grants`;
        return this.http.patch<{ grantsGroupIds: string[] }>(url, { grantsGroupIds }, this.patchHeaders);
    }

    /**
     * Returns all available Symfony security roles (derived from registered groups).
     * Used to populate role selectors in the Schema Editor.
     */
    getRoles(): Observable<Array<{ value: string; label: string }>> {
        const url = this.manifest.identity?.rolesUrl;
        if (!url) return of([]);
        return this.http
            .get<HydraCollection<{ value: string; label: string }>>(url)
            .pipe(map(r => r['member']));
    }

    // -- VFS -----------------------------------------------------------------

    statNode(path: string): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files';
        return this.http.get<NodeDto>(url, { params: { path } });
    }

    listDirectory(path: string): Observable<NodeDto[]> {
        const url = this.manifest.apiBase + '/vfs/directories/list';
        return this.http
            .get<HydraCollection<NodeDto>>(url, {
                params: { path },
                headers: { Accept: 'application/ld+json' },
            })
            .pipe(map(r => r['member']));
    }

    chmodNode(dto: ChmodDto): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files/permissions';
        return this.http.patch<NodeDto>(url, dto, this.patchHeaders);
    }

    chownNode(dto: ChownDto): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files/owner';
        return this.http.patch<NodeDto>(url, dto, this.patchHeaders);
    }

    deleteNode(path: string, recursive = false): Observable<void> {
        const url = this.manifest.apiBase + '/vfs/files';
        return this.http.delete<void>(url, { params: { path, recursive: String(recursive) } });
    }

    mkdir(path: string): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/directories';
        return this.http.post<NodeDto>(url, { path });
    }

    /**
     * Create a directory UNDER `parentPath`, named by the platform slug
     * of `title` and carrying `title` as its display name.
     *
     * Slugging server-side is the point: the platform slugger applies
     * national transliteration rule sets (`Счета` -> `scheta`, `Größe` ->
     * `groesse`), which no client-side ASCII fold can do — it can only
     * drop the characters and report failure.
     */
    mkdirTitled(parentPath: string, title: string): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/directories';
        return this.http.post<NodeDto>(url, { path: parentPath, title });
    }

    /**
     * Write a binary file into a VFS directory (multipart). Mirrors the
     * image editor's `writeVfsFile`; `overwrite=0` makes a name clash a
     * 409 rather than a silent replacement.
     *
     * `folderPath` is the PARENT — the endpoint's `path` field is the
     * full destination file path, so passing a directory there makes it
     * try to write over the directory itself (a 409 that reads like a
     * duplicate-name error and is not one).
     */
    uploadBinary(file: File, folderPath: string, overwrite = false): Observable<NodeDto> {
        const url = this.manifest.apiBase + '/vfs/files/binary';
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('path', `${folderPath.replace(/\/+$/, '')}/${file.name}`);
        form.append('overwrite', overwrite ? '1' : '0');

        return this.http.post<NodeDto>(url, form);
    }

    // -- DocumentGeneration --------------------------------------------------

    createDocumentGeneration(
        payload: CreateDocumentGenerationPayload,
    ): Observable<DocumentGenerationDto> {
        const url = this.manifest.apiBase + '/document/generations';
        return this.http.post<DocumentGenerationDto>(url, payload);
    }

    /**
     * Server-paginated list of generations for the admin list page.
     * Sort defaults to `-createdAt` server-side; pass `'createdAt'`
     * (asc) explicitly when the caller needs oldest-first.
     */
    listDocumentGenerations(
        params: { page?: number; limit?: number; sort?: string } = {},
    ): Observable<{ items: DocumentGenerationDto[]; totalItems: number }> {
        const url = this.manifest.apiBase + '/document/generations';
        let httpParams = new HttpParams();
        if (params.page !== undefined) {
            httpParams = httpParams.set('page', String(params.page));
        }
        if (params.limit !== undefined) {
            httpParams = httpParams.set('limit', String(params.limit));
        }
        if (params.sort) {
            httpParams = httpParams.set('sort', params.sort);
        }
        return this.http
            .get<HydraCollection<DocumentGenerationDto>>(url, {
                headers: this.collectionHeaders.headers,
                params: httpParams,
            })
            .pipe(map(r => ({ items: r['member'], totalItems: r['totalItems'] })));
    }

    /**
     * Polling endpoint for the detail page. Returns the full generation
     * shape including counters, audience criteria, plain variables, and
     * (when `failedCount > 0`) the list of failed instance ids.
     */
    getDocumentGeneration(id: string): Observable<DocumentGenerationDto> {
        const url = this.manifest.apiBase + `/document/generations/${encodeURIComponent(id)}/status`;
        return this.http.get<DocumentGenerationDto>(url);
    }

    /**
     * sub-phase 2b -- exchange the user's auth session for a
     * short-lived Centrifugo connection token signed with the
     * backend's HMAC secret. Returned shape carries `token` (the JWT
     * to hand to centrifuge-js), `expiresAt` (Unix seconds) for
     * refresh scheduling, `ttl` for convenience, and `wsUrl` so the
     * caller has everything needed to connect in one response.
     */
    getCentrifugoConnectionToken(): Observable<CentrifugoConnectionTokenDto> {
        return this.realtime.connectionToken();
    }

    /**
     * Sub-phase O -- fetch a per-channel subscription token for a
     * `private`-namespace channel. The centrifuge SDK invokes this
     * through its `getToken` callback at subscribe time and again
     * before expiry. The backend validates channel ownership against
     * the current user before signing.
     */
    getCentrifugoSubscriptionToken(channel: string): Observable<CentrifugoSubscriptionTokenDto> {
        return this.realtime.subscriptionToken(channel);
    }

    /**
     * Re-dispatch every child instance in `failed` state for the given
     * generation. Returns the updated generation shape (`status` flipped
     * back to `running`, `failedCount` reset).
     */
    retryFailedInstances(generationId: string): Observable<DocumentGenerationDto> {
        const url = this.manifest.apiBase + `/document/generations/${encodeURIComponent(generationId)}/retry-failed`;
        return this.http.post<DocumentGenerationDto>(url, {});
    }

    /**
     * Server-paginated instance list for the detail page's per-instance
     * grid (filter by `generationId`) or the template-detail panel
     * (filter by `templateId`). At least one of the two ids must be set
     * -- otherwise the backend falls through to the unfiltered legacy
     * branch and pagination is lost.
     */
    listDocumentInstances(
        options: ListDocumentInstancesOptions,
    ): Observable<{ items: DocumentInstanceDto[]; totalItems: number }> {
        const url = this.manifest.apiBase + '/document/instances';
        let params = new HttpParams();
        if (options.generationId) {
            params = params.append('filter', `generationId eq "${options.generationId}"`);
        }
        if (options.templateId) {
            params = params.append('filter', `templateId eq "${options.templateId}"`);
        }
        if (options.status) {
            params = params.append('filter', `status eq "${options.status}"`);
        }
        if (options.outputFormat) {
            params = params.append('filter', `outputFormat eq "${options.outputFormat}"`);
        }
        if (options.search) {
            params = params.append('filter', `name cn "${options.search}"`);
        }
        if (options.sortKey) {
            const prefix = options.sortDir === 'asc' ? '' : '-';
            params = params.set('sort', `${prefix}${options.sortKey}`);
        }
        if (options.page !== undefined) {
            params = params.set('page', String(options.page));
        }
        if (options.limit !== undefined) {
            params = params.set('limit', String(options.limit));
        }
        return this.http
            .get<HydraCollection<DocumentInstanceDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => ({ items: r['member'], totalItems: r['totalItems'] })));
    }

    /**
     * Unified Definitions catalog — fetches the cross-module list of
     * deployed + draft definitions for the `/admin/definitions` page.
     * Reads `GET /api/v1/definitions`; query params optionally narrow
     * by `module`, `source`, `moduleLock`, free-text `q`, and paginate
     * via `page`/`itemsPerPage`. Returns Hydra-paginated envelope.
     */
    listDefinitions(opts: {
        module?:       string;
        source?:       'vfs' | 'contributor';
        moduleLock?:   boolean;
        q?:            string;
        page?:         number;
        itemsPerPage?: number;
        /**
         * Retirement visibility. Omit for active-only (the backend
         * default), `'all'` to include the archive, `'true'` for the
         * archive alone.
         */
        retired?:      'true' | 'all';
        /** Multi-select siblings of `module` / `source` (OR within each). */
        modules?:      readonly string[];
        sources?:      readonly string[];
        /**
         * Per-column substring filters. Distinct from `q`, which spans
         * key AND display name — the grid filters those two columns
         * independently, so folding them together would make a Key
         * filter match on the display name.
         */
        definitionKey?: string;
        displayName?:   string;
        /** Sort column; a leading `-` means descending (e.g. `-deployedAt`). */
        sort?:         string;
    } = {}): Observable<{ items: DefinitionCatalogDto[]; totalItems: number }> {
        const url = `${this.manifest.apiBase}/definitions`;
        let params = new HttpParams();
        if (opts.module)               params = params.set('module',     opts.module);
        if (opts.source)               params = params.set('source',     opts.source);
        if (opts.moduleLock !== undefined) params = params.set('moduleLock', String(opts.moduleLock));
        if (opts.q)                    params = params.set('q',          opts.q);
        if (opts.retired)              params = params.set('retired',    opts.retired);
        if (opts.page !== undefined)   params = params.set('page',       String(opts.page));
        if (opts.itemsPerPage !== undefined) params = params.set('itemsPerPage', String(opts.itemsPerPage));
        if (opts.modules?.length)      params = params.set('modules',    opts.modules.join(','));
        if (opts.sources?.length)      params = params.set('sources',    opts.sources.join(','));
        if (opts.definitionKey)        params = params.set('definitionKey', opts.definitionKey);
        if (opts.displayName)          params = params.set('displayName',   opts.displayName);
        if (opts.sort)                 params = params.set('sort',       opts.sort);
        return this.http
            .get<HydraCollection<DefinitionCatalogDto>>(url, {
                headers: this.collectionHeaders.headers,
                params,
            })
            .pipe(map(r => ({ items: r['member'], totalItems: r['totalItems'] })));
    }

    /**
     * Definition lifecycle — `POST /definitions/{module}/{key}/retire`.
     * Archives the definition: it drops out of the default catalog and
     * blocks new starts, while deployed history and any live instances
     * stay untouched. Idempotent.
     *
     * Refusals arrive as 409 with `{reason, error}`; `reason` is the
     * machine-readable discriminator (`module_shipped`,
     * `has_deployed_history`, `has_running_instances`).
     */
    retireDefinition(module: string, key: string): Observable<void> {
        return this.http.post<void>(
            `${this.manifest.apiBase}/definitions/${module}/${encodeURIComponent(key)}/retire`,
            {},
        );
    }

    /** Definition lifecycle — restore a retired definition. */
    unretireDefinition(module: string, key: string): Observable<void> {
        return this.http.post<void>(
            `${this.manifest.apiBase}/definitions/${module}/${encodeURIComponent(key)}/unretire`,
            {},
        );
    }

    /**
     * Definition lifecycle — permanent delete. Only ever succeeds for a
     * NEVER-DEPLOYED definition; anything with history, live instances,
     * or a module owner is refused with 409 naming the blocker.
     */
    deleteDefinition(module: string, key: string): Observable<void> {
        return this.http.delete<void>(
            `${this.manifest.apiBase}/definitions/${module}/${encodeURIComponent(key)}`,
        );
    }

    // --- F5.c: Translation catalogues admin ----------------------
    //
    // The four endpoints are NOT paginated -- the platform has a
    // small fixed set of (domain × locale) pairs (today: one entry,
    // realistic ceiling ~40). Returning everything at once lets the
    // list view filter client-side without round-trips.

    /**
     * GET /api/v1/i18n/catalogues -- all (domain, locale) catalogues
     * known to the platform (on-disk baseline + VFS overrides
     * unioned). Rows carry summary stats only; entries are fetched
     * on drill-down via {@link getTranslationCatalogue}.
     */
    listTranslationCatalogues(): Observable<TranslationCatalogueDto[]> {
        const url = `${this.manifest.apiBase}/i18n/catalogues`;
        return this.http
            .get<HydraCollection<TranslationCatalogueDto>>(url, { headers: this.collectionHeaders.headers })
            .pipe(map(r => r['member']));
    }

    /**
     * GET /api/v1/i18n/catalogues/{domain}:{locale} -- merged
     * entries (`baseline` + optional `override`) for one catalogue.
     */
    getTranslationCatalogue(id: string): Observable<TranslationCatalogueDto> {
        const url = `${this.manifest.apiBase}/i18n/catalogues/${encodeURIComponent(id)}`;
        return this.http.get<TranslationCatalogueDto>(url, { headers: { Accept: 'application/ld+json' } });
    }

    /**
     * PUT /api/v1/i18n/catalogues/{domain}:{locale} -- save override
     * XLIFF. Entries with `override === null` are stripped before
     * serialising (no point storing baseline-only rows). Returns the
     * freshly-reloaded catalogue so the FE can hydrate without a
     * follow-up GET.
     */
    saveTranslationCatalogue(
        id: string,
        entries: ReadonlyArray<TranslationCatalogueEntryDto>,
    ): Observable<TranslationCatalogueDto> {
        const url = `${this.manifest.apiBase}/i18n/catalogues/${encodeURIComponent(id)}`;
        return this.http.put<TranslationCatalogueDto>(url, { entries }, { headers: { Accept: 'application/ld+json' } });
    }

    /**
     * DELETE /api/v1/i18n/catalogues/{domain}:{locale} -- remove the
     * VFS override file (reverts to baseline). Idempotent server-side
     * so the Revert button is safe to click twice.
     */
    deleteTranslationCatalogue(id: string): Observable<void> {
        const url = `${this.manifest.apiBase}/i18n/catalogues/${encodeURIComponent(id)}`;
        return this.http.delete<void>(url, { headers: { Accept: 'application/ld+json' } });
    }

}
