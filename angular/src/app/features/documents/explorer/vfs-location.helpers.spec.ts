import { filenameOf, formatLocation, formatSize } from './vfs-location.helpers';

/**
 * Spec for the pure VFS-location helpers.
 *
 * Historical note: the original header here spelled out the spec-exclude glob
 * from `tsconfig.json` literally. The `*<!---->/` inside that glob closed this
 * very comment block, so the rest of the line parsed as code and left an
 * unterminated template literal -- the file could not be compiled at all.
 * Nothing caught it because no test target existed to compile it.
 */

describe('formatLocation', () => {
 it('returns "/" for null / empty input', () => {
        expect(formatLocation(null)).toBe('/');
        expect(formatLocation(undefined)).toBe('/');
        expect(formatLocation('')).toBe('/');
    });

 it('trims the filename segment off shared-zone paths', () => {
        expect(formatLocation('/docs/contract.pdf')).toBe('/docs/');
    });

 it('trims and trailing-slashes nested shared paths', () => {
        expect(formatLocation('/docs/contracts/2026/Q1/nda.docx')).toBe('/docs/contracts/2026/Q1/');
    });

 it('collapses /home/<userId>/ to ~/', () => {
        expect(formatLocation('/home/abc-123/docs/inbox/inv.pdf')).toBe('~/docs/inbox/');
    });

 it('returns "/" for a root-level file', () => {
        expect(formatLocation('/file.pdf')).toBe('/');
    });

 it('handles a personal-zone root file', () => {
 // /home/abc/file.pdf -> drop file -> /home/abc -> collapse -> ~ -> trailing slash -> ~/
        expect(formatLocation('/home/abc-123/file.pdf')).toBe('~/');
    });
});

describe('filenameOf', () => {
 it('returns the trailing segment', () => {
        expect(filenameOf('/docs/contract.pdf', 'fallback')).toBe('contract.pdf');
    });

 it('falls back when path is null/undefined/empty', () => {
        expect(filenameOf(null, 'fb-1')).toBe('fb-1');
        expect(filenameOf(undefined, 'fb-2')).toBe('fb-2');
        expect(filenameOf('', 'fb-3')).toBe('fb-3');
    });

 it('falls back when path ends with a trailing slash', () => {
        expect(filenameOf('/docs/', 'fb')).toBe('fb');
    });

 it('returns the only segment for a root file', () => {
        expect(filenameOf('/file.pdf', 'fb')).toBe('file.pdf');
    });
});

describe('formatSize', () => {
 it('returns "—" for null / undefined / 0', () => {
        expect(formatSize(null)).toBe('—');
        expect(formatSize(undefined)).toBe('—');
        expect(formatSize(0)).toBe('—');
    });

 it('formats bytes', () => {
        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(1023)).toBe('1023 B');
    });

 it('formats kilobytes with one decimal', () => {
        expect(formatSize(1024)).toBe('1.0 KB');
        expect(formatSize(1536)).toBe('1.5 KB');
    });

 it('formats megabytes', () => {
        expect(formatSize(1024 * 1024)).toBe('1.0 MB');
        expect(formatSize(1024 * 1024 * 5)).toBe('5.0 MB');
    });

 it('formats gigabytes for very large files', () => {
        expect(formatSize(1024 * 1024 * 1024 * 2)).toBe('2.0 GB');
    });
});
