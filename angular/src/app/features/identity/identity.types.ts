// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Identity (manifest.identity.*; getSettings/getRoles through core-angular's IdentityApiClient and the identity manifest) endpoints, verbatim.

// --- Auth DTOs ----------------------------------------------------------------


export interface ProfileSection {
    readonly section: string;
    readonly label:   string;
    readonly icon:    string;
    readonly formId:  string;
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
     * Groups whose roles are granted by holding THIS group's role -- one
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

/** A legal hold as the deletions list describes it: who placed it and why, whether it still stands. */
export interface AccountDeletionHoldDto {
    id:               string;
    reason:           string;
    placedBy:         string;
    placedByLabel:    string;
    placedAt:         string;
    active:           boolean;
    releasedAt?:      string | null;
    releasedBy?:      string | null;
    releasedByLabel?: string | null;
}

/** The last fire of a deletion's schedule row: the hold's name on a skip, the sentence on a success. */
export interface AccountDeletionRunDto {
    outcome:     'success' | 'skipped' | 'failed';
    at:          string;
    detail?:     string | null;
    error?:      string | null;
}

/** What an executed deletion reached, from the record: four lists, whether or not a schedule row fired. */
export interface AccountDeletionCoverageDto {
    erased:    string[];
    minimised: string[];
    kept:      string[];
    uncovered: string[];
}

export type AccountDeletionState = 'pending' | 'held' | 'cancelled' | 'executed';

/** One row of GET /auth/deletions, and the body of GET /auth/users/{id}/deletion. */
export interface AccountDeletionDto {
    id:               string;
    userId:           string;
    accountLabel:     string;
    requestedByKind:  'person' | 'administrator';
    requestedBy?:     string | null;
    requestedByLabel: string;
    requestedAt:      string;
    dueAt:            string;
    daysLeft?:        number | null;
    state:            AccountDeletionState;
    cancelledAt?:     string | null;
    cancelledByKind?: string | null;
    executedAt?:      string | null;
    heldByHoldId?:    string | null;
    hold?:            AccountDeletionHoldDto | null;
    nextAttemptAt?:   string | null;
    run?:             AccountDeletionRunDto | null;
    coverage?:        AccountDeletionCoverageDto | null;
}

/** One hold of GET /auth/users/{id}/legal-holds. */
export interface LegalHoldDto {
    id:          string;
    userId:      string;
    placedBy:    string;
    reason:      string;
    placedAt:    string;
    active:      boolean;
    releasedAt?: string | null;
    releasedBy?: string | null;
}

/** One declaration of GET /auth/footprints, with the holds register's values for a category that can hold. */
export interface FootprintDto {
    category:       string;
    label:          string;
    module:         string;
    tables:         string[];
    action:         'delete' | 'minimise' | 'keep';
    canHold:        boolean;
    obligation?:    string | null;
    durationDays?:  number | null;
    obligationKey?: string | null;
    durationKey?:   string | null;
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
