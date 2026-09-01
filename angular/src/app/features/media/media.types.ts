import { ExplorerViewMode } from '@coolms/ui-angular';

export type MediaStatus = 'pending' | 'ready' | 'failed';
export type MediaMimeCategory = 'image' | 'video' | 'audio' | 'document' | 'other';
/**
 * Media's rendering is now the SHARED explorer vocabulary.
 *
 * Was `'large' | 'medium' | 'small' | 'list'`. Only the last name changed —
 * that mode is a wide row with a thumbnail, a name and a detail line, which is
 * `content` everywhere else; `list` was Media's word for it while Pages used
 * the same word for the table. Stored preferences carrying the old value are
 * migrated on read in `MediaPageStateService`.
 */
export type MediaViewMode = ExplorerViewMode;

export interface MediaThumbnailVariant {
    vfsNodeId: string;
    format:    string;
    width:     number;
    height:    number;
    url?:      string;
    error?:    string;
}

export interface MediaAssetDto {
    id:               string;
    mimeType:         string;
    fileSize:         number;
    colorspace:       string;
    status:           MediaStatus;
    originalFilename: string;
    /** Materialized VFS path of the original ('/media/...' or '/home/{user}/media/...').
     *  Populated by MediaAssetProvider; null when VFS lookup failed (e.g., fresh
     *  upload response). Used by the picker for `bindValue: 'path'` mode. */
    path?:            string | null;
    dimensions:       { width: number; height: number; exif?: unknown[] } | null;
    focalPoint:       [number, number];
    /** Display name / alt text resolved for the requested locale (Node.title column
     *  + `extras.i18n.title` overrides). Editable; distinct from originalFilename.
     *  In the merged media model the title IS the image's alt text. */
    title:            string | null;
    /** Description / caption resolved for the requested locale (same model as title). */
    description:      string | null;
    /** Alt text — a READ-ONLY derived alias of {@link title} (kept so renderers /
     *  picker pre-fill that read `alt` keep working). Write via `title`. */
    alt:              string | null;
    /** Caption — a READ-ONLY derived alias of {@link description}. Write via `description`. */
    caption:          string | null;
    taxonomy:         string[];
    tags:             string[];
    variants:         Record<string, MediaThumbnailVariant>;
    thumbnailUrl:      string | null;
    originalUrl:       string | null;
    /** Resolved per-preset URLs (small/medium/large/print etc) populated from the
     *  asset's variants. Only presets whose variant has been generated appear. */
    presetUrls?:       Record<string, string>;
    permissionPreset:  string | null;
    createdAt:         string;
    updatedAt:         string;
    /** Human-readable owner of the asset (the uploader's identifier). Since uploads
     *  are creator-owned, this is the uploading user, not the media_library system
     *  user. Falls back to a short uid when the owner can't be resolved. */
    owner?:            string | null;
}

export interface MediaListResponse {
    member:     MediaAssetDto[];
    totalItems: number;
    page:       number;
    limit:      number;
}

export interface MediaPermissionsRequest {
    preset?:   string;                 // named preset (e.g. 'public', 'members', 'private')
    mode?:     number;                 // octal mode
    groups?:   string[];               // group names to set as file group
    variants?: string[];               // which variants to apply to
    custom?:   Record<string, number>; // per-variant custom modes
}

export interface UploadProgress {
    file:     File;
    progress: number;
    status:   'uploading' | 'done' | 'error';
    assetId?: string;
    error?:   string;
}

/** A VFS node's localized title/description, resolved for one locale. */
export interface NodeMetaDto {
    title:       string | null;
    description: string | null;
    /** Whether the current user may write this node (drives the panel's Save gate). */
    canWrite:    boolean;
}

/** Raw NodeResource fields the collection panel reads (subset of the wire shape). */
export interface NodeMetaWire {
    title?:       string | null;
    description?: string | null;
    permissions?: { write?: boolean };
}

// -- Collection tree node (used by sidebar, grid, context menus) ---------------
export interface CollectionNode {
    path:     string;
    name:     string;
    depth:    number;
    children: CollectionNode[];
}

