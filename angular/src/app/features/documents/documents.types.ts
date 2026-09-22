// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Document (/document/generations, /document/instances) endpoints, verbatim.

// --- DocumentGeneration DTOs -------------------------------------------------

/**
 * `GET /document/generations/preview-audience` -- who an RQL filter selects.
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
     * The template's own output format -- `docx`, `pdf`, `xlsx`, ... Widened from
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
