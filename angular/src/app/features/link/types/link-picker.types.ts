import type { LinkTargetType } from './link-widget.types';

/**
 * Optional initial state when opening the picker. The action handler
 * (B3) seeds this when editing an existing widget so the dialog opens
 * pre-selected on the right tab and pre-filled in the config row.
 */
export interface LinkPickerHostData {
    /** Tab to open initially. Default 'internal'. */
    readonly initialTab?: 'internal' | 'external' | 'recent';

    /** Pre-select the picker on this target (for editing existing links). */
    readonly initialTarget?: {
        readonly type: LinkTargetType;
        /** Canonical UUID for page/section/vfs; literal URL or route name otherwise. */
        readonly identifier: string;
    };

    /** Pre-fill the config row when editing an existing link. */
    readonly initialConfig?: {
        readonly label?: string;
        readonly target?: '_self' | '_blank';
        readonly rel?: string | null;
        readonly className?: string | null;
        readonly useLatestLabel?: boolean;
    };
}

/**
 * Returned to the action handler when the user confirms. Shape mirrors
 * the LinkWidgetAttrs the Tiptap node accepts; B3's OpenLinkPickerHandler
 * threads this directly into `editor.commands.insertLink({...})`.
 */
export interface LinkPickerHostResult {
    readonly type:           LinkTargetType;
    /** Canonical UUID (page/section/vfs) or literal URL / route name. */
    readonly identifier:     string;
    readonly label:          string;
    readonly target:         '_self' | '_blank';
    readonly rel:            string | null;
    readonly className:      string | null;
    /** JSON-encoded route params, only populated for type==='route'. */
    readonly routeParams:    string | null;
    readonly useLatestLabel: boolean;
}

/** A target chosen via the Internal or Recent tabs. */
export interface LinkTargetSelection {
    readonly type:        LinkTargetType;
    readonly identifier:  string;
    /** Default label suggestion (page slug, section name, vfs filename). */
    readonly defaultLabel: string;
}

/**
 * One entry in the localStorage recent-links LRU. `lastUsedAt` is an ISO
 * timestamp; entries are sorted by it descending on read.
 */
export interface RecentLink {
    readonly type:         LinkTargetType;
    readonly identifier:   string;
    readonly label:        string;
    readonly lastUsedAt:   string;
}
