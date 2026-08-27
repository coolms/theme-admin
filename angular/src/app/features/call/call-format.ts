/**
 * Shared Call-feature formatting helpers.
 *
 * Extracted from the duplicated `formatDuration` that lived in both the call
 * detail page (M9.f.2) and the live wallboard (M9.f.3) — one source of truth
 * for how a call's duration reads across the module.
 */

/**
 * Render a call duration (in seconds) as `H:MM:SS` (with hours) or `M:SS`.
 * Nullish input renders as an em-dash; negative values clamp to zero.
 */
export function formatCallDuration(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined) {
        return '—';
    }
    const total = Math.max(0, Math.floor(seconds));
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
