import { Injectable } from '@angular/core';

/**
 *-2.6a — localStorage draft persistence for the document-
 * generation wizard.
 *
 * Stored value is version-tagged and time-stamped. On restore we
 * silently drop drafts that don't match the current schema version
 * or that exceed the TTL — both are treated as "stale, start
 * fresh" rather than as recoverable errors.
 *
 * The restore prompt itself uses `window.confirm` for X-2.6a; the
 * X-2.6b iteration will swap this for a CDK dialog so the visual
 * style matches the wizard chrome. A no-op `confirm` (e.g. test
 * environments without a window) is supported via the
 * `confirmFn` injection seam.
 */
export interface WizardDraft {
    /** Current schema version. Bump when the shape changes; older
     *  drafts are then silently discarded on restore. */
    readonly version: 2;
    readonly timestamp: number;
    readonly templateId: string;
    readonly currentStepId: string;
    readonly mode: 'single' | 'filter' | null;
    /** Filter-mode-only RQL body emitted by `CmsFilterBuilder`, e.g.,
     *  `filter=isActive eq true`. Empty string means "no filter". */
    readonly recipientsRql: string;
    /** Filter-mode-only cached count from the last successful
     *  `countUsers` call. `null` while loading or never fetched. */
    readonly recipientsCount: number | null;
    /** Entity-alias -> uuid map for the Audience step's pickers. The
     *  recipient alias (`user` in Filter mode) is excluded; it
     *  auto-binds per iteration. */
    readonly audience: Record<string, string>;
    readonly plainVariables: Record<string, unknown>;
    readonly outputBasePath: string;
    readonly filenamePattern: string;
}

/** Fields the host writes; the service stamps version / timestamp / id. */
export type WizardDraftInput = Omit<WizardDraft, 'version' | 'timestamp' | 'templateId'>;

@Injectable({ providedIn: 'root' })
export class WizardDraftService {
    private readonly VERSION = 2;
    private readonly TTL_MS = 24 * 60 * 60 * 1000;

    /**
     * Optionally restore a previously-saved draft for `templateId`.
     * Calls `apply(draft)` only after the user confirms via
     * `confirmFn` (default: `window.confirm`).
     *
     * Discards drafts that fail validation (version mismatch, TTL
     * exceeded, JSON parse error) and removes them from storage.
     */
    maybeRestore(
        templateId: string,
        apply: (draft: WizardDraft) => void,
        confirmFn: (msg: string) => boolean = (msg) => globalThis.confirm?.(msg) ?? false,
    ): void {
        const key = this.key(templateId);
        const storage = this.tryStorage();
        if (!storage) {
            return;
        }
        try {
            const raw = storage.getItem(key);
            if (!raw) {
                return;
            }

            const probe = JSON.parse(raw) as { version?: unknown; timestamp?: unknown };
            if (probe.version !== this.VERSION) {
                storage.removeItem(key);
                return;
            }
            if (typeof probe.timestamp !== 'number' || Date.now() - probe.timestamp > this.TTL_MS) {
                storage.removeItem(key);
                return;
            }

            const accepted = confirmFn(
                'Continue previous draft for this template? Cancel to start fresh.',
            );
            if (!accepted) {
                storage.removeItem(key);
                return;
            }

            apply(probe as unknown as WizardDraft);
        } catch {
            // Corrupt entry — wipe and move on.
            storage.removeItem(key);
        }
    }

    /** Persist the host's current wizard state under `templateId`. */
    save(templateId: string, input: WizardDraftInput): void {
        const storage = this.tryStorage();
        if (!storage) {
            return;
        }
        const draft: WizardDraft = {
            version: this.VERSION,
            timestamp: Date.now(),
            templateId,
            ...input,
        };
        try {
            storage.setItem(this.key(templateId), JSON.stringify(draft));
        } catch {
            // Quota / serialisation errors are non-fatal — the wizard
            // keeps working without persistence.
        }
    }

    /** Forget the draft for `templateId`. Called on Cancel and on
     *  Submit success so the next wizard launch starts blank. */
    clear(templateId: string): void {
        this.tryStorage()?.removeItem(this.key(templateId));
    }

    private key(templateId: string): string {
        return `wizard-draft-${templateId}`;
    }

    /** Localised storage access — returns null when the environment
     *  has no storage (SSR, tests) or the browser denies access
     *  (private mode + Safari). */
    private tryStorage(): Storage | null {
        try {
            return globalThis.localStorage ?? null;
        } catch {
            return null;
        }
    }
}
