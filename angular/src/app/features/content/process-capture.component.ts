import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    computed,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
// !! The PUBLIC entry only. An earlier version of this control reached for
// `@coolms/designer/bpmn-lite` -- which the package's own docblock puts outside
// its stability contract, and which `package.json` does not export at all: it
// resolves here through a tsconfig path mapping onto the package SOURCE, and
// would be ERR_PACKAGE_PATH_NOT_EXPORTED for anyone who installed the package.
// `renderDiagram` was added to the public entry so this file needs none of it.
import { renderDiagram, bpmnLiteJsonToModel, type DiagramView } from '@coolms/designer';

/** One deployed definition, as the catalog lists it. */
interface DefinitionRow {
    readonly module: string;
    readonly definitionKey: string;
    readonly displayName: string;
    readonly latestVersion: number | null;
    readonly retiredAt?: string | null;
}

/** `GET /workflows/{key}/versions/{n}` -- the model arrives as a JSON string in `body`. */
interface VersionResponse {
    readonly body: string;
}

interface CatalogResponse {
    readonly member?: DefinitionRow[];
    readonly 'hydra:member'?: DefinitionRow[];
}

/**
 * The capture control for a `process_diagram` block.
 *
 * !! **It captures, it does not draw.** The diagram is rendered by
 * `renderDiagram` from `@coolms/designer` -- the same package the BPMN designer
 * page draws with -- and the stored SVG is that render, serialized. Nothing
 * here lays out a diagram, because BPMN layout lives in the designer package
 * and a second implementation would drift from the one authors actually see.
 * The hero this whole effort replaced was a hand-drawn picture of an editor
 * that did not exist; capturing through the real renderer makes that impossible
 * by construction rather than by discipline.
 *
 * !! **Mounted `readOnly`.** This is a capture surface, not a second place to
 * edit a process: editing happens in the designer, where drafts, versions and
 * deployment live. A mutable canvas here would be a fork with no way to save.
 *
 * !! **Provenance is SHOWN, not merely stored.** The block records the version
 * it captured; the catalog says which version is deployed now. When they differ
 * the editor is told, in words, on the block they are looking at -- otherwise
 * `capturedVersion` is a field nobody reads and the page silently drifts from
 * the process it claims to depict.
 *
 * Reached through the `editor: 'process-capture'` hint on the block type's
 * `svg` field, so the block editor renders this without knowing that a block
 * type called `process_diagram` exists.
 */
@Component({
    selector: 'app-process-capture',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="pcap">
            <div class="pcap__row">
                <label class="cms-label" for="pcap-def">Process</label>
                <!--
                  ⚠️ ngModel, not [value]. A plain value binding on a <select>
                  is applied before the @for has rendered the options, so the
                  browser has nothing to select and falls back to the
                  placeholder -- the control then claims nothing is chosen while
                  the block plainly has a definitionKey.
                -->
                <select id="pcap-def" class="cms-input cms-input-sm"
                        [ngModel]="selectedKey()"
                        (ngModelChange)="onPick($event)"
                        [disabled]="busy()">
                    <option value="">Choose a deployed process…</option>
                    @for (d of definitions(); track d.definitionKey) {
                        <option [value]="d.definitionKey">
                            {{ d.displayName }} ({{ d.definitionKey }})
                        </option>
                    }
                </select>
            </div>

            @if (error()) {
                <p class="pcap__error">{{ error() }}</p>
            }

            <!-- Provenance, in words, on the block being looked at. -->
            @if (capturedVersion()) {
                @if (isStale()) {
                    <p class="pcap__stale">
                        Captured from v{{ capturedVersion() }} — the process is now at
                        v{{ latestVersion() }}. Recapture to update the page, or leave it
                        if the older diagram is the one you want shown.
                    </p>
                } @else {
                    <p class="pcap__ok">
                        Captured from v{{ capturedVersion() }}, which is the deployed version.
                        <span class="pcap__dim">{{ capturedAt() }}</span>
                    </p>
                }
            } @else if (selectedKey()) {
                <p class="pcap__dim">No diagram captured yet.</p>
            }

            <div class="pcap__canvas" #host [class.pcap__canvas--empty]="!selectedKey()"></div>

            <div class="pcap__actions">
                <button type="button" class="cms-btn cms-btn-sm"
                        (click)="capture()"
                        [disabled]="busy() || !mounted()">
                    {{ capturedVersion() ? 'Recapture' : 'Capture diagram' }}
                </button>
                @if (capturedVersion()) {
                    <button type="button" class="cms-btn cms-btn-sm cms-btn-ghost"
                            (click)="clear()" [disabled]="busy()">Remove</button>
                }
            </div>
        </div>
    `,
    styles: [`
        .pcap { display: flex; flex-direction: column; gap: 8px; }
        .pcap__row { display: flex; flex-direction: column; gap: 4px; }
        .pcap__canvas { height: 260px; border: 1px solid var(--cms-border); border-radius: var(--cms-radius-sm); overflow: hidden; }
        .pcap__canvas--empty { display: none; }
        .pcap__actions { display: flex; gap: 8px; }
        .pcap__error { color: var(--cms-danger-text); font-size: .85rem; margin: 0; }
        .pcap__stale { color: var(--cms-warning-text, #92400e); font-size: .85rem; margin: 0; }
        .pcap__ok { color: var(--cms-text-secondary); font-size: .85rem; margin: 0; }
        .pcap__dim { color: var(--cms-text-muted); }
    `],
})
export class ProcessCaptureComponent implements OnDestroy {
    /** The block's current values, so the control shows what is stored. */
    readonly block = input.required<Record<string, unknown>>();

    /** Emits only the keys that changed, so the parent writes them in one update. */
    readonly fieldsChange = output<Record<string, string>>();

    private readonly http = inject(HttpClient);
    private readonly hostRef = viewChild.required<ElementRef<HTMLElement>>('host');

    readonly definitions = signal<DefinitionRow[]>([]);
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);
    readonly mounted = signal(false);
    readonly selectedKey = signal('');

    private view: DiagramView | null = null;

    readonly capturedVersion = computed(() => this.str(this.block()['capturedVersion']));
    readonly capturedAt = computed(() => this.str(this.block()['capturedAt']));

    readonly latestVersion = computed(() => {
        const key = this.selectedKey() || this.str(this.block()['definitionKey']);
        const row = this.definitions().find(d => d.definitionKey === key);
        return row?.latestVersion ?? null;
    });

    /**
     * !! Compared as STRINGS, and only when both sides are known. `capturedVersion`
     * is stored authored data, so a numeric compare would read an empty capture
     * as version 0 and call every un-captured block stale -- a warning about the
     * wrong thing, which is worse than no warning.
     */
    readonly isStale = computed(() => {
        const captured = this.capturedVersion();
        const latest = this.latestVersion();
        return '' !== captured && null !== latest && captured !== String(latest);
    });

    constructor() {
        this.loadDefinitions();
    }

    ngOnDestroy(): void {
        // destroy() unwinds DOM, listeners and timers -- a capture control that
        // leaks one per opened block would degrade the editor over a session.
        this.view?.destroy();
        this.view = null;
    }

    onPick(key: string): void {
        this.selectedKey.set(key);
        this.error.set(null);
        if ('' === key) {
            this.teardown();
            return;
        }
        this.mount(key);
    }

    /**
     * Serialize what the designer drew.
     *
     * !! The serialization itself lives in the designer package, not here. It
     * has to strip the pan/zoom transform (otherwise the capture records
     * wherever somebody left the scrollbar) and drop the canvas background
     * (chrome, not diagram) -- both of which mean knowing DOM class names that
     * belong to the package and that no version promises to keep. This control
     * used to reach in and do that itself, which was a deeper coupling than the
     * import path it was reaching through.
     */
    capture(): void {
        const svg = this.view?.toSvg() ?? null;
        if (null === svg) {
            this.error.set('Nothing to capture — the diagram is empty or has not finished rendering.');
            return;
        }

        const latest = this.latestVersion();
        this.fieldsChange.emit({
            definitionKey: this.selectedKey(),
            svg,
            capturedVersion: null === latest ? '' : String(latest),
            capturedAt: new Date().toISOString().slice(0, 10),
        });
        this.error.set(null);
    }

    clear(): void {
        this.fieldsChange.emit({ svg: '', capturedVersion: '', capturedAt: '' });
    }

    private loadDefinitions(): void {
        this.busy.set(true);
        this.http.get<CatalogResponse>('/api/v1/definitions').subscribe({
            next: res => {
                const all = res.member ?? res['hydra:member'] ?? [];
                // Only this module's, and only ones still live: offering a
                // retired definition would capture a diagram of a process that
                // no longer runs.
                this.definitions.set(all.filter(d => 'workflow' === d.module && !d.retiredAt));
                this.busy.set(false);
                const existing = this.str(this.block()['definitionKey']);
                if ('' !== existing) {
                    this.selectedKey.set(existing);
                    this.mount(existing);
                }
            },
            error: (err: HttpErrorResponse) => {
                this.busy.set(false);
                this.error.set(this.message(err));
            },
        });
    }

    private mount(key: string): void {
        const row = this.definitions().find(d => d.definitionKey === key);
        const version = row?.latestVersion;
        if (null == version) {
            this.error.set('That process has no deployed version to capture.');
            return;
        }

        this.busy.set(true);
        this.http.get<VersionResponse>('/api/v1/workflows/' + encodeURIComponent(key) + '/versions/' + version).subscribe({
            next: res => {
                this.busy.set(false);
                // !! The endpoint returns a WRAPPER -- {definitionKey, version,
                // body, deployedAt, ...} -- and `body` is the BPMN-Lite wire
                // JSON as a STRING. `bpmnLiteJsonToModel` takes that string, so
                // it is passed through unparsed; handing the wrapper itself to
                // the designer mounts a shell and draws nothing, with no error
                // anywhere, which is exactly how this failed the first time.
                let view: DiagramView;
                try {
                    this.teardown();
                    view = renderDiagram(this.hostRef().nativeElement, {
                        surface: 'bpmn-lite',
                        model: bpmnLiteJsonToModel(res.body),
                    });
                } catch {
                    this.error.set('That version could not be read as a diagram.');
                    return;
                }

                this.view = view;
                this.mounted.set(true);
            },
            error: (err: HttpErrorResponse) => {
                this.busy.set(false);
                this.error.set(this.message(err));
            },
        });
    }

    private teardown(): void {
        this.view?.destroy();
        this.view = null;
        this.mounted.set(false);
    }

    private str(v: unknown): string {
        return v == null ? '' : String(v);
    }

    private message(err: HttpErrorResponse): string {
        const body = err.error as { detail?: string } | null;
        return body?.detail ?? err.message;
    }
}
