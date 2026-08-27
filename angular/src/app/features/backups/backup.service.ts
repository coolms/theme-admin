import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
/** One module's slice inside a bundle manifest (`ContributorEntry`). */
export interface BackupContributorEntry {
    readonly key: string;
    readonly label: string;
    readonly tier: string;
    readonly tables: string[];
    readonly records: number;
}

/** An on-disk backup bundle, as summarised by `BackupInventory::list()`. */
export interface BackupBundleDto {
    readonly name: string;
    readonly createdAt: string;
    readonly formatVersion: number;
    readonly tiers: string[];
    readonly contributors: BackupContributorEntry[];
    readonly records: number;
    readonly sizeBytes: number;
}

/** One row of a `create` run's per-contributor report. */
export interface CreateBackupReportRow {
    readonly key: string;
    readonly label: string;
    readonly tier: string;
    readonly records: number;
}

/** Result of `POST /backup`. */
export interface CreateBackupResult {
    readonly name: string;
    readonly tiers: string[];
    readonly report: CreateBackupReportRow[];
}

/** One row of a dry-run restore plan. */
export interface RestorePlanRow {
    readonly key: string;
    readonly label: string;
    readonly restored: number;
    readonly status: string;
}

/** Result of `POST /backup/{name}/restore-preview` (dry run). */
export interface RestorePreviewResult {
    readonly name: string;
    readonly formatVersion: number;
    readonly createdAt: string;
    readonly tiers: string[];
    readonly plan: RestorePlanRow[];
}

/**
 * Backup admin API client (ADR-149, #1476/#1477).
 *
 * Talks to the superuser/backup-group-gated `/api/v1/backup` surface off
 * the generic `manifest.apiBase` — feature-local (not on the shared ApiService),
 * mirroring ExperimentsService / NewsletterService. The three ops are the safe,
 * non-destructive ones: list the on-disk bundles, create a new one, and dry-run
 * (preview) what a restore WOULD replay. Download / upload / apply-restore are
 * deliberately not exposed here (apply stays on the CLI).
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /** Every well-formed on-disk bundle, newest-first. */
    listBundles(): Observable<BackupBundleDto[]> {
        return this.http
            .get<{ bundles: BackupBundleDto[] }>(`${this.apiBase}/backup`)
            .pipe(map(res => res.bundles ?? []));
    }

    /**
     * Create a new bundle for the given tier CSV (e.g. `config`, `config,content`,
     * `all`). Synchronous server-side; resolves with the create report.
     */
    createBackup(tier: string, only = ''): Observable<CreateBackupResult> {
        return this.http.post<CreateBackupResult>(`${this.apiBase}/backup`, { tier, only });
    }

    /** Dry-run a restore of the named bundle — writes nothing, returns the plan. */
    restorePreview(name: string, only = ''): Observable<RestorePreviewResult> {
        return this.http.post<RestorePreviewResult>(
            `${this.apiBase}/backup/${encodeURIComponent(name)}/restore-preview`,
            { only },
        );
    }
}
