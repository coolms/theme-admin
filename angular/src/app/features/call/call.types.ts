// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Call (/call/*) endpoints, verbatim.

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
