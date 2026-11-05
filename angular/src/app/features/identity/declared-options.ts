import { type DeclaredKey } from './declared-settings.service';

export interface Option {
    readonly value: string;
    readonly label: string;
}

const AUTOMATIC = 'automatic';

/** Automatic, UTC, and the zones this browser knows, once each. */
const ZONES: ReadonlyArray<Option> = [
    { value: AUTOMATIC, label: 'Automatic, from this device' },
    ...[...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])].map(zone => ({ value: zone, label: zone })),
];

/** What a colour with no value of its own is drawn in: the page's, which a person sees as the default. */
export function colourInForce(): string {
    return getComputedStyle(document.documentElement).getPropertyValue('--cms-accent').trim() || '#000000';
}

/** A choice that is a plain word reads as one; a format such as `yyyy-MM-dd` is shown as it is. */
function words(value: string): string {
    return /^[a-z]+$/.test(value) ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function offered(k: DeclaredKey, locales: ReadonlyArray<{ code: string; label: string }>): ReadonlyArray<Option> {
    if ('language' === k.type) {
        return locales.map(l => ({ value: l.code, label: l.label }));
    }
    if ('timezone' === k.type) {
        return ZONES;
    }
    return (k.choices ?? []).map(choice => ({ value: choice, label: words(choice) }));
}

/** What a declared key offers. A value the server holds stays selectable even when the list no longer has it. */
export function optionsFor(
    k: DeclaredKey,
    locales: ReadonlyArray<{ code: string; label: string }>,
    held: unknown,
): ReadonlyArray<Option> {
    const options = offered(k, locales);
    return 'string' !== typeof held || '' === held || options.some(o => o.value === held)
        ? options
        : [{ value: held, label: held }, ...options];
}
