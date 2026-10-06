// The focus ring as the browser draws it (Dmitry, 2026-10-06, from the review of theme-admin#69): Bootstrap's
// controls and the admin's fields, focused under the admin's real stylesheets -- bootstrap.min.css, then styles.scss,
// as angular.json's test target loads them -- on every ground the admin puts them on, in both schemes. Each must draw
// the ring: opaque, in --cms-focus-ring as that ground resolves it, and 3:1 or more against the ground around it.
// The static half is scripts/check-focus-indicators.mjs (the rules a component writes); this half is what Bootstrap's
// own stylesheet draws once its variables are bound, which no source scan can see.

type Rgba = [number, number, number, number];

interface Ground {
    name: string;
    host: string;
    bg: string;
}

interface Control {
    name: string;
    html: string;
    /** The element given focus, when not the root of `html`. */
    focus?: string;
    /** A field: its edge turns the ring, and a 1px ring sits outside it. */
    field?: boolean;
    /** A button or link: it must match :focus-visible, the state its ring is drawn in. */
    visible?: boolean;
}

interface Row {
    scheme: string;
    ground: string;
    control: string;
    ring: string;
    groundColour: string;
    ratio: number;
    beside: string;
    problems: string[];
}

const GROUNDS: Ground[] = [
    { name: 'page', host: '', bg: 'var(--cms-bg)' },
    { name: 'surface', host: '', bg: 'var(--cms-surface)' },
    { name: 'surface-muted', host: '', bg: 'var(--cms-surface-muted)' },
    { name: 'top bar', host: 'coolms-topbar', bg: 'var(--cms-sidebar-bg)' },
    { name: 'sidebar', host: 'coolms-sidebar', bg: 'var(--cms-sidebar-bg)' },
    { name: 'sidebar hover', host: 'coolms-sidebar', bg: 'var(--cms-sidebar-hover)' },
    { name: 'sidebar active', host: 'coolms-sidebar', bg: 'var(--cms-sidebar-active)' },
];

const CONTROLS: Control[] = [
    { name: 'Bootstrap button', html: '<button type="button" class="btn btn-sm">b</button>', visible: true },
    {
        name: 'top-bar tile',
        html: '<button type="button" class="btn btn-sm position-relative text-white" '
            + 'style="border: 1px solid var(--cms-chrome-edge)">t</button>',
        visible: true,
    },
    { name: 'Bootstrap link button', html: '<button type="button" class="btn btn-link btn-sm p-0">l</button>', visible: true },
    { name: 'Bootstrap active button', html: '<button type="button" class="btn btn-sm active">a</button>', visible: true },
    { name: 'Bootstrap close', html: '<button type="button" class="btn-close" aria-label="Close"></button>', visible: true },
    { name: 'kit button', html: '<button type="button" class="cms-btn">k</button>', visible: true },
    { name: 'link', html: '<a href="#focus-ring">a</a>', visible: true },
    { name: 'form-control', html: '<input class="form-control">', field: true },
    { name: 'form-control invalid', html: '<input class="form-control is-invalid">', field: true },
    { name: 'form-select', html: '<select class="form-select"><option>o</option></select>', field: true },
    { name: 'kit input', html: '<input class="cms-input">', field: true },
    // A component's field: its edge in the component's own scoped rule, as Angular emits one (a class and the
    // scoping attribute, specificity 0,2,0 -- see COMPONENT_RULES).
    { name: 'component field', html: '<input class="x-edge cms-field" _ngcontent-focus-ring>', field: true },
    {
        name: 'component field box',
        html: '<div class="x-edge cms-field-box" _ngcontent-focus-ring><input class="x-bare" _ngcontent-focus-ring></div>',
        focus: 'input',
        field: true,
    },
    { name: 'check input', html: '<input type="checkbox" class="form-check-input">' },
    { name: 'check input invalid', html: '<input type="checkbox" class="form-check-input is-invalid">' },
];

// What a component's scoped stylesheet says for those fields, at the specificity Angular gives it.
const COMPONENT_RULES = '.x-edge[_ngcontent-focus-ring] { border: 1px solid var(--cms-border-control); }'
    + ' .x-bare[_ngcontent-focus-ring] { border: 0; background: transparent; }'
    + ' .x-bare[_ngcontent-focus-ring]:focus { outline: none; }';

function parseColour(c: string): Rgba | null {
    const rgb = c.match(/rgba?\(([^)]+)\)/);
    if (rgb) {
        const p = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    const srgb = c.match(/color\(srgb ([^)]+)\)/);
    if (srgb) {
        const p = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
        return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
    }
    return null;
}

function luminance([r, g, b]: Rgba): number {
    const lin = (v: number): number => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgba, b: Rgba): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const same = (a: Rgba | null, b: Rgba | null): boolean =>
    a !== null && b !== null && [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) < 1.5) && Math.abs(a[3] - b[3]) < 0.01;

const hex = (c: Rgba | null): string =>
    c === null ? '?' : '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
        + (c[3] < 1 ? `@${c[3]}` : '');

/** Each box-shadow layer that draws outside the box: its colour and spread. */
function shadows(value: string): { colour: Rgba | null; spread: number }[] {
    if (value === 'none') return [];
    const layers: { colour: Rgba | null; spread: number }[] = [];
    const re = /((?:rgba?|color)\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(\s+inset)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) {
        if (m[6] === undefined && Number(m[5]) > 0) layers.push({ colour: parseColour(m[1]), spread: Number(m[5]) });
    }
    return layers;
}

function measure(scheme: string, ground: Ground, control: Control, stage: HTMLElement): Row {
    const host = document.createElement('div');
    if (ground.host !== '') host.className = ground.host;
    host.style.background = ground.bg;
    host.style.padding = '12px';
    host.innerHTML = control.html + '<i class="focus-ring-probe" style="color: var(--cms-focus-ring)"></i>';
    stage.appendChild(host);
    const drawn = host.firstElementChild as HTMLElement;
    const target = (control.focus ? drawn.querySelector(control.focus) : drawn) as HTMLElement;
    target.focus({ focusVisible: true } as FocusOptions);

    const problems: string[] = [];
    // The subject first: without focus there is nothing to measure.
    if (document.activeElement !== target) problems.push('UNEVALUABLE: it did not take focus');
    if (control.visible && !target.matches(':focus-visible')) problems.push('UNEVALUABLE: not :focus-visible');

    const style = getComputedStyle(drawn);
    const expected = parseColour(getComputedStyle(host.querySelector('.focus-ring-probe') as HTMLElement).color);
    const groundColour = parseColour(getComputedStyle(host).backgroundColor);
    const layers = shadows(style.boxShadow);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
        ? { colour: parseColour(style.outlineColor), width: parseFloat(style.outlineWidth) }
        : null;

    for (const l of layers) if (l.colour !== null && l.colour[3] < 1) problems.push(`a translucent shadow ${hex(l.colour)}`);
    if (outline?.colour && outline.colour[3] < 1) problems.push(`a translucent outline ${hex(outline.colour)}`);

    // The ring: the outline when one is drawn, else the widest shadow layer.
    const widest = layers.reduce<{ colour: Rgba | null; spread: number } | null>(
        (w, l) => (w === null || l.spread > w.spread ? l : w), null);
    const ring = outline?.colour ?? widest?.colour ?? null;
    const width = outline !== null ? outline.width : widest === null ? 0
        : widest.spread - Math.max(0, ...layers.filter((l) => l !== widest).map((l) => l.spread));
    if (ring === null) problems.push('no ring drawn');
    else if (!same(ring, expected)) problems.push(`the ring is ${hex(ring)}, not --cms-focus-ring ${hex(expected)}`);

    // What the ring touches on its inner side. An outline with an offset touches the ground through the gap it
    // leaves; a box-shadow ring touches the layer under it, else the control's edge (when it has one); a field's ring
    // is its edge and a 1px layer, so it touches the field's own background.
    let inner: Rgba | null = null;
    let innerName = '';
    if (control.field) {
        const edge = parseColour(style.borderTopColor);
        if (!same(edge, expected)) problems.push(`the edge is ${hex(edge)}, not the ring`);
        if (width < 1) problems.push(`a ring ${width}px outside the edge`);
        inner = parseColour(style.backgroundColor);
        innerName = 'field';
    } else {
        if (width < 2) problems.push(`a ring ${width}px wide`);
        const gap = layers.filter((l) => l !== widest).sort((a, b) => b.spread - a.spread)[0]?.colour ?? null;
        const edge = parseFloat(style.borderTopWidth) > 0 ? parseColour(style.borderTopColor) : null;
        if (outline === null) {
            inner = gap ?? edge;
            innerName = gap ? 'gap' : 'edge';
        }
    }
    // A ring AROUND a control is surrounded on both sides, so both are held to 3:1. A field's ring IS its edge,
    // thickened: what surrounds it is the ground, as the field edges were measured (3:1 against the surface they sit
    // on); its own fill is inside it, printed but not held.
    let beside = '';
    if (ring !== null && inner !== null && inner[3] === 1) {
        const ri = ratio(ring, inner);
        beside = `${ri.toFixed(2)} beside its ${innerName} ${hex(inner)}`;
        if (ri < 3 && !control.field) problems.push(`${ri.toFixed(2)}:1 against its ${innerName} ${hex(inner)}`);
    }
    const r = ring !== null && groundColour !== null ? ratio(ring, groundColour) : 0;
    if (r < 3) problems.push(`${r.toFixed(2)}:1 against the ground`);

    target.blur();
    stage.removeChild(host);
    return {
        scheme, ground: ground.name, control: control.name, ring: hex(ring), groundColour: hex(groundColour),
        ratio: r, beside, problems,
    };
}

describe('the focus ring, as drawn', () => {
    let stage: HTMLElement;
    const rows: Row[] = [];
    const root = document.documentElement;
    const before = root.getAttribute('data-theme');

    // The settled state is measured: a control's transition (Bootstrap's buttons and fields, the kit's inputs) would
    // otherwise be read at its first frame, before the ring has drawn.
    const settle = document.createElement('style');
    settle.textContent = '.focus-ring-stage, .focus-ring-stage * { transition: none !important; } '
        + COMPONENT_RULES;

    beforeAll(() => document.head.appendChild(settle));
    afterAll(() => document.head.removeChild(settle));

    beforeEach(() => {
        stage = document.createElement('div');
        stage.className = 'focus-ring-stage';
        document.body.appendChild(stage);
    });

    afterEach(() => {
        document.body.removeChild(stage);
        if (before === null) root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', before);
    });

    afterAll(() => {
        // The measurement, printed: every pair, so a reader sees the margin and not only the verdict.
        const lines = rows.map((r) => `${r.scheme.padEnd(5)} ${r.ground.padEnd(14)} ${r.control.padEnd(24)} `
            + `ring ${r.ring} on ${r.groundColour}: ${r.ratio.toFixed(2)}:1${r.beside ? ' (' + r.beside + ')' : ''}`);
        const min = rows.length ? Math.min(...rows.map((r) => r.ratio)) : 0;
        console.log(`FOCUS RING: ${rows.length} pairs measured, lowest ${min.toFixed(2)}:1\n` + lines.join('\n'));
    });

    for (const scheme of ['light', 'dark']) {
        for (const ground of GROUNDS) {
            it(`draws the ring, opaque and 3:1 or more, on the ${ground.name} (${scheme})`, () => {
                root.setAttribute('data-theme', scheme);
                const measured = CONTROLS.map((c) => measure(scheme, ground, c, stage));
                rows.push(...measured);
                const failing = measured.filter((m) => m.problems.length > 0)
                    .map((m) => `${m.control}: ${m.problems.join('; ')}`);
                expect(measured.length).toBe(CONTROLS.length);
                expect(failing.join('\n')).withContext(`${ground.name}, ${scheme}`).toBe('');
            });
        }
    }
});
