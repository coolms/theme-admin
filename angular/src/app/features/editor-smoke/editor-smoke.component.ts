import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
    CoolmsEditorComponent, EDITOR_MANIFEST_PROVIDER,
    EditorProfileManifest, EditorToolbarNodeManifest,
} from '@coolms/editor-angular';

/**
 * Smoke route for the @coolms/editor-angular bridge.
 *
 * The route is public (no authGuard) so the bridge can be exercised
 * without booting an auth context. To keep it self-contained, the
 * component overrides EDITOR_MANIFEST_PROVIDER locally with a single
 * profile slice ("standard") containing the same 10 toolbar entries the
 * backend's BuiltInContributorsContributor emits — so we exercise the
 * full toolbar render + Tiptap mount + handler dispatch pipeline against
 * known-good data, independent of auth state.
 *
 * Sub-prompt E migrated this from `editorId="page"` to `profile="standard"`
 * to match the schemaVersion-2 wire shape.
 */

// `slashable` / `keywords` mirror the backend manifest: block
// entries are slashable (the smoke route exercises the `/`-palette off them);
// inline format marks + meta actions are not.
const SAMPLE_NODES: ReadonlyArray<EditorToolbarNodeManifest> = [
    { id: 'format:bold',       group: 'format', priority: 10, icon: 'bi-type-bold',    label: 'editor.toolbar.format.bold',    actionType: 'tiptap.toggleMark',       actionParams: { name: 'bold' },         extensions: ['bold'],                  stateKeys: ['bold'],         shortcut: 'Ctrl+B', slashable: false },
    { id: 'format:italic',     group: 'format', priority: 20, icon: 'bi-type-italic',  label: 'editor.toolbar.format.italic',  actionType: 'tiptap.toggleMark',       actionParams: { name: 'italic' },       extensions: ['italic'],                stateKeys: ['italic'],       shortcut: 'Ctrl+I', slashable: false },
    { id: 'format:link',       group: 'format', priority: 30, icon: 'bi-link-45deg',   label: 'editor.toolbar.format.link',    actionType: 'editor.openLinkDialog',   actionParams: {},                       extensions: ['link'],                  stateKeys: ['link'],         shortcut: 'Ctrl+K', slashable: false },
    { id: 'block:h1',          group: 'block',  priority: 10, icon: 'bi-type-h1',      label: 'editor.toolbar.block.h1',       actionType: 'tiptap.setHeading',       actionParams: { level: 1 },             extensions: ['heading'],               stateKeys: ['heading.1'], slashable: true, keywords: ['h1', 'title', 'heading'] },
    { id: 'block:h2',          group: 'block',  priority: 20, icon: 'bi-type-h2',      label: 'editor.toolbar.block.h2',       actionType: 'tiptap.setHeading',       actionParams: { level: 2 },             extensions: ['heading'],               stateKeys: ['heading.2'], slashable: true, keywords: ['h2', 'subtitle', 'heading'] },
    { id: 'block:h3',          group: 'block',  priority: 30, icon: 'bi-type-h3',      label: 'editor.toolbar.block.h3',       actionType: 'tiptap.setHeading',       actionParams: { level: 3 },             extensions: ['heading'],               stateKeys: ['heading.3'], slashable: true, keywords: ['h3', 'heading'] },
    { id: 'block:bulletList',  group: 'block',  priority: 40, icon: 'bi-list-ul',      label: 'editor.toolbar.block.bulletList',  actionType: 'tiptap.toggleNode',    actionParams: { name: 'bulletList' },   extensions: ['bulletList', 'listItem'], stateKeys: ['bulletList'], slashable: true, keywords: ['ul', 'unordered', 'bullets'] },
    { id: 'block:orderedList', group: 'block',  priority: 50, icon: 'bi-list-ol',      label: 'editor.toolbar.block.orderedList', actionType: 'tiptap.toggleNode',    actionParams: { name: 'orderedList' },  extensions: ['orderedList', 'listItem'], stateKeys: ['orderedList'], slashable: true, keywords: ['ol', 'numbered'] },
    { id: 'block:blockquote',  group: 'block',  priority: 60, icon: 'bi-quote',        label: 'editor.toolbar.block.blockquote',  actionType: 'tiptap.toggleNode',    actionParams: { name: 'blockquote' },   extensions: ['blockquote'],            stateKeys: ['blockquote'], slashable: true, keywords: ['quote', 'bq'] },
    { id: 'meta:source',       group: 'meta',   priority: 10, icon: 'bi-code-slash',   label: 'editor.toolbar.meta.source',    actionType: 'editor.toggleSourceMode', actionParams: {},                       extensions: [],                        stateKeys: [], slashable: false },
];

const SAMPLE_PROFILE: EditorProfileManifest = {
    contributors:   SAMPLE_NODES,
    allowedWidgets: [],
};

@Component({
    selector: 'app-editor-smoke',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CoolmsEditorComponent],
    providers: [
        {
            provide: EDITOR_MANIFEST_PROVIDER,
            useValue: {
                getProfile: (name: string) => name === 'standard' ? SAMPLE_PROFILE : null,
            },
        },
    ],
    template: `
        <div class="cms-content" style="padding:20px; max-width:960px; margin:0 auto">
            <h2 class="cms-h2">Editor smoke test</h2>
            <p class="text-muted" style="font-size:.875rem">
                Bridge mounted via <code>&lt;coolms-editor&gt;</code> with
                <code>profile="standard"</code>. Toolbar fed from a local
                sample-manifest provider; in production the manifest comes
                from <code>/api/v1/theme/config</code> →
                <code>manifest.editor.profiles.standard</code>.
            </p>
            <coolms-editor profile="standard" [(content)]="html" />
            <h3 class="cms-h3" style="margin-top:24px">Live content</h3>
            <pre style="padding:12px; background:var(--cms-bg); border:1px solid var(--cms-border); border-radius:var(--cms-radius); overflow-x:auto">{{ html() }}</pre>
        </div>
    `,
})
export class EditorSmokeComponent {
    readonly html = signal<string>('<h2>Editor smoke</h2><p>Type something <strong>here</strong>.</p>');
}
