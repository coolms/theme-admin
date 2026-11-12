import { type Dialog, type DialogRef } from '@angular/cdk/dialog';
import { type HttpResponse } from '@angular/common/http';
import { ViewerModalComponent, type ViewerModalData } from '@coolms/document-viewer-angular';
import {
    AttachmentImagePreviewComponent,
    type AttachmentImagePreviewData,
} from './attachment-image-preview.component';
import { type EmailAttachmentDto } from './email.types';

/** The viewer an attachment opens in: the PDF viewer or the image preview. */
export type AttachmentViewKind = 'pdf' | 'image';

/** The image types the preview shows, each with the word for its kind. SVG is not one of them. */
const IMAGE_KINDS: Readonly<Record<string, string>> = {
    'image/png': 'PNG image',
    'image/jpeg': 'JPEG image',
    'image/gif': 'GIF image',
    'image/webp': 'WebP image',
};

/** The type and subtype of a Content-Type value, lower-cased, without its parameters. */
function mediaTypeOf(value: string | null | undefined): string {
    return (value ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Which viewer an attachment opens in, or null for no View. A served viewAs decides alone: pdf and image open, none
 * (or any other value) does not, whatever the declared type. Only a row without viewAs falls back to the declared
 * type: application/pdf, or a PNG, JPEG, GIF or WebP image. The file name is never read.
 */
export function attachmentViewKind(att: Pick<EmailAttachmentDto, 'contentType' | 'viewAs'>): AttachmentViewKind | null {
    if ('viewAs' in att) {
        return att.viewAs === 'pdf' || att.viewAs === 'image' ? att.viewAs : null;
    }
    const declared = mediaTypeOf(att.contentType);
    if (declared === 'application/pdf') {
        return 'pdf';
    }
    return declared in IMAGE_KINDS ? 'image' : null;
}

/** The image type of a download's Content-Type when the preview shows it, else null. */
export function viewableImageType(contentType: string | null): string | null {
    const type = mediaTypeOf(contentType);
    return type in IMAGE_KINDS ? type : null;
}

/** The viewer's label: the file name and the kind detected. */
export function attachmentViewerLabel(filename: string, kind: string): string {
    return `${filename} (${kind})`;
}

/**
 * Opens downloaded PDF bytes in the app's PDF viewer, from an object URL that is revoked when the viewer closes.
 * Focus goes back to `restoreTo` on close.
 */
export function openPdfAttachment(
    dialog: Dialog,
    bytes: Blob,
    filename: string,
    restoreTo: HTMLElement | null,
): DialogRef<void, ViewerModalComponent> {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const title = attachmentViewerLabel(filename, 'PDF');
    const ref = dialog.open<void, ViewerModalData, ViewerModalComponent>(ViewerModalComponent, {
        data: { fileUrl: url, downloadUrl: url, mimeType: 'application/pdf', filename, title },
        ariaLabel: title,
        ariaModal: true,
        hasBackdrop: true,
        restoreFocus: restoreTo ?? true,
    });
    ref.closed.subscribe(() => URL.revokeObjectURL(url));
    return ref;
}

/**
 * Opens a downloaded image in the preview over the page, typed by the download's Content-Type. Returns null, opening
 * nothing, when that type is not a PNG, JPEG, GIF or WebP image or the answer has no body. The object URL is revoked
 * when the preview closes, and focus goes back to `restoreTo`.
 */
export function openImageAttachment(
    dialog: Dialog,
    answer: HttpResponse<Blob>,
    filename: string,
    restoreTo: HTMLElement | null,
): DialogRef<void, AttachmentImagePreviewComponent> | null {
    const type = viewableImageType(answer.headers.get('Content-Type'));
    if (type === null || answer.body === null) {
        return null;
    }
    const url = URL.createObjectURL(new Blob([answer.body], { type }));
    const kind = IMAGE_KINDS[type];
    const ref = dialog.open<void, AttachmentImagePreviewData, AttachmentImagePreviewComponent>(AttachmentImagePreviewComponent, {
        data: { url, filename, kind },
        ariaLabel: attachmentViewerLabel(filename, kind),
        ariaModal: true,
        hasBackdrop: true,
        restoreFocus: restoreTo ?? true,
    });
    ref.closed.subscribe(() => URL.revokeObjectURL(url));
    return ref;
}
