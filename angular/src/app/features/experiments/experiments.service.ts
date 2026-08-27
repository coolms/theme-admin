import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigState } from '@coolms/core-angular';
import { HydraCollection } from '../../api/api.service';

/** Lifecycle state of an experiment, matching the backend `ExperimentStatus` enum. */
export type ExperimentStatus = 'draft' | 'running' | 'stopped';

/** One configured arm of an experiment (`experiment:read` variant shape). */
export interface ExperimentVariant {
    readonly key:    string;
    readonly label:  string;
    /** Relative assignment weight; `0` pauses the arm without dropping its history. */
    readonly weight: number;
}

/** One arm's accumulated tallies (`results[]` row). */
export interface ExperimentResult {
    readonly variant:        string;
    readonly label:          string;
    readonly weight:         number;
    /** Exposures — times this arm was shown. */
    readonly count:          number;
    /** Conversions — times this arm hit the experiment's goal. */
    readonly conversions:    number;
    /** conversions ÷ exposures, 0–1 (0 when never shown). */
    readonly conversionRate: number;
}

/**
 * W8 — one A/B experiment with its live results.
 *
 * Mirrors the backend `Experiment` read group (`experiment:read`): the static
 * `variants` config plus the derived `results` (per-arm exposure counts) and
 * the `totalExposures` rollup. The experiment is keyed by its stable `key`
 * (there is no surrogate id on the read surface) — every admin write addresses
 * it by that key.
 */
export interface ExperimentDto {
    readonly key:              string;
    readonly name:             string;
    readonly status:           ExperimentStatus;
    readonly variants:         ExperimentVariant[];
    readonly results:          ExperimentResult[];
    readonly totalExposures:   number;
    readonly totalConversions: number;
    /** Variant key of the credible front-runner by conversion rate, or null. */
    readonly winner:           string | null;
    /** One-sided confidence (0–1) that `winner` truly beats the runner-up. */
    readonly confidence:       number | null;
    /** Whether `confidence` clears the 95% significance threshold. */
    readonly significant:      boolean | null;
}

/** Create-experiment request body (`experiment:write`). */
export interface CreateExperimentInput {
    key:      string;
    name:     string;
    variants: ExperimentVariant[];
    /** Defaults to `running` server-side when omitted. */
    status?:  ExperimentStatus;
}

/** Edit-experiment request body — variant keys must match the existing set. */
export interface UpdateExperimentInput {
    name:     string;
    variants: ExperimentVariant[];
}

/**
 * W8 — the experiment admin API client (#786).
 *
 * Talks to the W8 experiment endpoints (`GET/POST /experiments`,
 * `POST /experiments/status`) off the generic `manifest.apiBase`, so no
 * module-specific manifest entry is needed. Feature-local (not on the shared
 * ApiService) — the experiment surface is small and self-contained. Mirrors the
 * W8 AnalyticsService / NewsletterService. The public `/experiments/exposure`
 * beacon is fired by the theme assigner, never from the admin UI, so it is not
 * exposed here.
 */
@Injectable({ providedIn: 'root' })
export class ExperimentsService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get apiBase(): string {
        // The manifest is loaded before any admin route activates; the `?.`/fallback
        // keeps the build's strict null-check happy (the snapshot type is nullable).
        return this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
    }

    /** Every experiment with its per-variant exposure results. */
    list(): Observable<ExperimentDto[]> {
        return this.http
            .get<HydraCollection<ExperimentDto>>(`${this.apiBase}/experiments`)
            .pipe(map(res => res.member ?? []));
    }

    /** Create an experiment; resolves with the created (running) experiment. */
    create(input: CreateExperimentInput): Observable<ExperimentDto> {
        return this.http.post<ExperimentDto>(`${this.apiBase}/experiments`, input);
    }

    /**
     * Edit an experiment's name + variant labels/weights (keys frozen). Posts
     * the key in the body — the convention the module's mutation endpoints use.
     */
    update(key: string, input: UpdateExperimentInput): Observable<ExperimentDto> {
        return this.http.post<ExperimentDto>(`${this.apiBase}/experiments/update`, { key, ...input });
    }

    /** Permanently delete an experiment and its accumulated counters. */
    delete(key: string): Observable<void> {
        return this.http.post<void>(`${this.apiBase}/experiments/delete`, { key });
    }

    /**
     * Start (`running`) or stop (`stopped`) an experiment by key. A stopped
     * experiment freezes assignment but keeps its accumulated counts.
     */
    setStatus(key: string, status: 'running' | 'stopped'): Observable<ExperimentDto> {
        return this.http.post<ExperimentDto>(`${this.apiBase}/experiments/status`, { key, status });
    }
}
