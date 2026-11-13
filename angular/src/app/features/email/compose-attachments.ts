import { HttpErrorResponse } from '@angular/common/http';
import { formatFilesPickerSize } from '@coolms/ui-angular';
import type { DriveAttachRefusal, OutgoingAttachmentDto } from './email.types';

/** The largest file the server takes, upload or Drive file: 25 MiB. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** What each attached file adds to the message besides its body: its MIME part headers, about this many bytes. */
export const PART_HEADER_BYTES = 200;

/** A file's part body as the message carries it: base64, with a line break every 76 characters. */
export function encodedBytes(n: number): number {
    const b64 = 4 * Math.ceil(n / 3);

    return b64 + 2 * Math.ceil(b64 / 76);
}

/** What a file adds to the message: its encoded body and its part headers. */
export function attachmentCost(sizeBytes: number, encoded?: number | null): number {
    return (encoded ?? encodedBytes(sizeBytes)) + PART_HEADER_BYTES;
}

/** One chip of the composer: a file being uploaded or attached, attached, or refused, with why. */
export interface ComposeAttachment {
    /** The chip's own key, stable from the moment the file is chosen. */
    readonly key: string;
    /** The server's attachment id, once attached. */
    readonly id: string | null;
    readonly filename: string;
    readonly sizeBytes: number;
    readonly encodedBytes: number | null;
    readonly mimeType: string | null;
    readonly source: 'upload' | 'drive';
    readonly status: 'uploading' | 'attaching' | 'ready' | 'refused';
    /** 0-100 while uploading. */
    readonly progress: number;
    /** Why it is not attached, in a sentence. */
    readonly refusal: string | null;
}

/** What a client draft keeps of an attached file. */
export interface StoredComposeAttachment {
    readonly id: string;
    readonly filename: string;
    readonly sizeBytes: number;
    readonly encodedBytes: number | null;
    readonly mimeType: string | null;
    readonly source: 'upload' | 'drive';
}

let nextKey = 0;

export function attachmentKey(): string {
    return 'att-' + ++nextKey;
}

export function readyAttachment(dto: OutgoingAttachmentDto, source: 'upload' | 'drive', key = attachmentKey()): ComposeAttachment {
    return {
        key,
        id: dto.id,
        filename: dto.filename,
        sizeBytes: dto.sizeBytes,
        encodedBytes: dto.encodedBytes ?? null,
        mimeType: dto.mimeType ?? null,
        source,
        status: 'ready',
        progress: 100,
        refusal: null,
    };
}

export function storedAttachments(list: readonly ComposeAttachment[]): StoredComposeAttachment[] {
    return list
        .filter((a): a is ComposeAttachment & { id: string } => a.status === 'ready' && a.id !== null)
        .map((a) => ({ id: a.id, filename: a.filename, sizeBytes: a.sizeBytes, encodedBytes: a.encodedBytes, mimeType: a.mimeType, source: a.source }));
}

export function restoredAttachments(stored: readonly StoredComposeAttachment[] | undefined | null): ComposeAttachment[] {
    // A draft's files are read back from the server, so each row is checked before it is trusted.
    const rows: readonly unknown[] = Array.isArray(stored) ? stored : [];

    return rows
        .filter((s): s is StoredComposeAttachment => typeof s === 'object' && s !== null
            && typeof (s as { id?: unknown }).id === 'string' && typeof (s as { filename?: unknown }).filename === 'string')
        .map((s) => readyAttachment({
            id: s.id,
            filename: s.filename,
            sizeBytes: Number(s.sizeBytes) || 0,
            encodedBytes: s.encodedBytes ?? encodedBytes(Number(s.sizeBytes) || 0),
            mimeType: s.mimeType ?? '',
        }, s.source === 'drive' ? 'drive' : 'upload'));
}

/** The message's own headers (addresses, subject, date, ids and the MIME structure), about this many bytes, once. */
export const MESSAGE_HEADER_BYTES = 1024;

/** The bytes the composer counts against the limit: the message headers, the body, and every file not refused. */
export function messageBytes(list: readonly ComposeAttachment[], bodyBytes: number): number {
    return list
        .filter((a) => a.status !== 'refused')
        .reduce((sum, a) => sum + attachmentCost(a.sizeBytes, a.encodedBytes), MESSAGE_HEADER_BYTES + bodyBytes);
}

/** A Drive refusal, in a sentence. */
export function driveRefusalText(refused: DriveAttachRefusal): string {
    switch (refused) {
        case 'folder': return 'A folder cannot be attached.';
        case 'too-large': return 'Larger than 25 MB, the most a file can be.';
        case 'over-message-limit': return 'It would take the message over the mailbox’s size limit.';
        default: return 'Not found, or you may not read it.';
    }
}

/** Why an upload was refused, by the answer's status: a fixed sentence, never the server's text. */
export function uploadRefusalText(error: unknown): string {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    switch (status) {
        case 413: return 'Too large to upload.';
        case 422: return 'Not attached: the file is larger than 25 MB, or could not be read.';
        case 403: return 'You may not attach files to this mailbox.';
        case 0: return 'Not uploaded: the connection was lost.';
        default: return 'Not uploaded: the server could not take it.';
    }
}

/** The attachment a send's 422 names as no longer there to send, or null when the answer names none. */
export function expiredAttachmentId(error: unknown): string | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== 422) return null;
    const body = error.error as { type?: unknown; attachmentId?: unknown; detail?: unknown } | null;
    if (body && typeof body.attachmentId === 'string' && body.attachmentId !== '') return body.attachmentId;
    // An older server says it only in its sentence: This attachment has expired, attach it again: "<id>".
    const detail = typeof body?.detail === 'string' ? body.detail : '';
    const m = /attach it again: "([^"]+)"/.exec(detail);

    return m ? m[1] : null;
}

/** The limit and the measured size of a send refused as too large, or null for any other answer. */
export function tooLargeSend(error: unknown): { limitBytes: number; sizeBytes: number } | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== 413) return null;
    const body = error.error as { limitBytes?: unknown; sizeBytes?: unknown } | null;
    const limitBytes = Number(body?.limitBytes);
    const sizeBytes = Number(body?.sizeBytes);

    return Number.isFinite(limitBytes) && Number.isFinite(sizeBytes) ? { limitBytes, sizeBytes } : null;
}

/** A decimal size, as the limits are stated: 25,000,000 bytes is "25 MB". */
export function formatBytes(bytes: number): string {
    return formatFilesPickerSize(bytes);
}
