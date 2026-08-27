import { Injectable } from '@angular/core';
import { VfsNodeDto } from '@coolms/ui-angular';

/**
 * Shared icon logic for VFS nodes.
 *
 * Used by VfsFilesComponent and VfsTreeComponent so the icon/color
 * semantics are defined in a single place.
 *
 * CSS classes referenced here (.vfs-icon--*) are declared globally
 * in styles.scss so they work inside any component.
 */
@Injectable({ providedIn: 'root' })
export class VfsIconService {

    /** Bootstrap Icons class name for the primary icon of a node. */
    nodeIcon(node: VfsNodeDto): string {
        if (node.type === 'directory') return node.isSystem ? 'bi-folder2' : 'bi-folder-fill';
        if (node.type === 'package')   return 'bi-file-earmark-text';
        if (node.type === 'resource')  return 'bi-link-45deg';
        if (node.type === 'symlink')   return 'bi-arrow-return-right';
        const mime = node.mimeType ?? '';
        if (mime.startsWith('image/'))                    return 'bi-file-earmark-image';
        if (mime.startsWith('text/'))                     return 'bi-file-earmark-text';
        if (mime.startsWith('video/'))                    return 'bi-file-earmark-play';
        if (mime.startsWith('audio/'))                    return 'bi-file-earmark-music';
        if (mime.includes('pdf'))                         return 'bi-file-earmark-pdf';
        if (mime.includes('zip') || mime.includes('tar')) return 'bi-file-earmark-zip';
        return 'bi-file-earmark';
    }

    /** CSS color-class for the icon element. */
    nodeIconClass(node: VfsNodeDto): string {
        if (node.type === 'directory') return node.isSystem ? 'vfs-icon--system' : 'vfs-icon--directory';
        if (node.type === 'resource')  return 'vfs-icon--resource';
        if (node.type === 'package')   return 'vfs-icon--package';
        if (node.type === 'symlink')   return 'vfs-icon--symlink';
        return '';
    }

    /**
     * Badge icon overlaid in the bottom-right corner of the primary icon,
     * or null when no badge is needed.
     *
     * A small folder badge on resource/package containers signals navigability
     * without overriding the semantic type icon.
     */
    nodeIconBadge(node: VfsNodeDto): string | null {
        if (node.isContainer && (node.type === 'resource' || node.type === 'package')) {
            return 'bi-folder2';
        }
        return null;
    }
}
