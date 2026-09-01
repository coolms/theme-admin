/**
 * Wire DTOs for the ImageMap admin section (`/api/v1/image-maps`,
 * –). Geometry travels NORMALIZED 0..1 exactly as stored; the
 * server-rendered overlay lives at `GET /image-maps/{slug}/overlay.svg`.
 */

export interface ImageMapRegionDto {
    code: string;
    label: string;
    shape: 'rect' | 'circle' | 'polygon';
    /** Normalized 0..1 geometry, layout per `shape`. */
    points: number[];
    subjectType: string | null;
    subjectRef: string | null;
    sortOrder: number;
}

export interface ImageMapDto {
    slug: string;
    title: string;
    /** Soft ref (UUID) to the VFS/Media node carrying the image bytes. */
    imageRef: string;
    /** Coordinate frame the regions are normalized against. */
    intrinsicWidth: number;
    intrinsicHeight: number;
    enabled: boolean;
    id: string;
    regions: ImageMapRegionDto[];
}

/** POST /image-maps body. */
export interface CreateImageMapRequest {
    slug: string;
    title: string;
    imageRef: string;
    intrinsicWidth: number;
    intrinsicHeight: number;
    enabled?: boolean;
}

/**
 * PATCH /image-maps/{slug} body (merge-patch). Re-basing the coordinate frame
 * requires imageRef + BOTH intrinsic dimensions together (backend 400s a
 * partial trio); the dialog always sends the full trio, which is safe.
 */
export interface UpdateImageMapRequest {
    title?: string;
    imageRef?: string;
    intrinsicWidth?: number;
    intrinsicHeight?: number;
    enabled?: boolean;
}

/** POST /image-maps/{slug}/regions body. Geometry normalized 0..1. */
export interface CreateRegionRequest {
    code: string;
    shape: 'rect' | 'circle' | 'polygon';
    points: number[];
    label?: string;
    subjectType?: string;
    subjectRef?: string;
    sortOrder?: number;
}

/**
 * PATCH /image-maps/{slug}/regions/{code} body (merge-patch). Geometry moves
 * AS A UNIT — `shape` + `points` together or the backend 400s; the subject
 * soft ref re-binds with BOTH fields and clears via an explicit empty-string
 * `subjectType`.
 */
export interface UpdateRegionRequest {
    shape?: 'rect' | 'circle' | 'polygon';
    points?: number[];
    label?: string;
    subjectType?: string;
    subjectRef?: string;
    sortOrder?: number;
}
