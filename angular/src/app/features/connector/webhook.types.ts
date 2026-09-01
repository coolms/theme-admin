/**
 * FE — wire DTOs for the inbound-webhook admin CRUD
 * (`/api/v1/connector/webhooks`).
 */

export type WebhookMode = 'start' | 'correlate';

export interface WebhookTriggerDto {
    readonly id?: string;
    readonly slug?: string;
    readonly label?: string;
    readonly mode?: WebhookMode;
    /** Server-generated; only present in the create + rotate-secret responses. */
    readonly secret?: string | null;
    readonly definitionKey?: string | null;
    readonly messageName?: string | null;
    readonly correlationKeyPath?: string | null;
    readonly variableMap?: Record<string, string>;
    readonly enabled?: boolean;
    /** Public receiver URL the admin configures the external system to POST to. */
    readonly webhookUrl?: string | null;
    readonly createdAt?: string;
    readonly updatedAt?: string;
}

/** Returned once by the rotate-secret action. */
export interface WebhookSecretDto {
    readonly slug: string;
    readonly secret: string;
}
