import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { UserPreferencesService } from '@coolms/core-angular';
import { TerminalComponent } from './terminal.component';

@Component({
    selector: 'app-terminal-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TerminalComponent],
    host: {
        // The panel owns its own sizing so AdminLayout doesn't need viewChild queries.
        // When normal: fixed height (px) + no flex growth.
        // When maximized: flex:1 + min-height:0 so it fills all remaining space.
        '[style.height.px]':  '!maximized() ? height() : null',
        '[style.flex]':       'maximized() ? "1" : null',
        '[style.minHeight]':  'maximized() ? "0" : null',
        '[style.flexShrink]': 'maximized() ? "0" : null',
    },
    template: `
        <!-- Resize handle (disabled while maximized) -->
        <div class="terminal-resize-handle"
             [style.cursor]="maximized() ? 'default' : 'row-resize'"
             (mousedown)="!maximized() && onResizeStart($event)"
             title="Drag to resize"></div>

        <!-- Panel header -->
        <div class="terminal-panel-header">
            <div class="d-flex align-items-center gap-2">
                <span style="font-family:monospace; font-size:.8rem; color:var(--cms-text-muted)">&gt;_</span>
                <span class="small fw-semibold" style="color:#e5e7eb">Terminal</span>
            </div>
            <div class="d-flex gap-1">
                <!-- Maximize/Restore -->
                <button type="button"
                        class="terminal-panel-btn"
                        [title]="maximized() ? 'Restore' : 'Maximize'"
                        (click)="toggleMaximized()">
                    {{ maximized() ? '⊡' : '⊞' }}
                </button>
                <!-- Close -->
                <button type="button"
                        class="terminal-panel-btn"
                        title="Close (Ctrl+\`)"
                        (click)="close.emit()">
                    ✕
                </button>
            </div>
        </div>

        <!-- xterm.js container -->
        <div class="terminal-panel-body">
            <app-terminal />
        </div>
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            background: #111827;
            border-top: 1px solid #374151;
            flex-shrink: 0;
        }
        .terminal-resize-handle {
            height: 4px;
            background: transparent;
            flex-shrink: 0;
        }
        .terminal-resize-handle:hover {
            background: #3b82f6;
        }
        .terminal-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 12px;
            background: #1f2937;
            border-bottom: 1px solid #374151;
            flex-shrink: 0;
            height: 32px;
        }
        .terminal-panel-btn {
            background: none;
            border: none;
            color: var(--cms-text-muted);
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: .85rem;
            line-height: 1;
        }
        .terminal-panel-btn:hover { background: #374151; color: #e5e7eb; }
        .terminal-panel-body {
            flex: 1;
            overflow: hidden;
            padding: 4px 8px;
        }
    `],
})
export class TerminalPanelComponent {
    maximized       = signal(false);
    maximizedChange = output<boolean>();
    close           = output<void>();

    private readonly prefs = inject(UserPreferencesService);

    height = signal(this.prefs.getTerminalHeight() ?? 300);

    toggleMaximized(): void {
        this.maximized.update(v => !v);
        this.maximizedChange.emit(this.maximized());
    }

    onResizeStart(event: MouseEvent): void {
        event.preventDefault();
        const startY      = event.clientY;
        const startHeight = this.height();

        const onMove = (e: MouseEvent) => {
            const delta = startY - e.clientY; // drag up = increase height
            const newH  = Math.max(120, Math.min(window.innerHeight * 0.8, startHeight + delta));
            this.height.set(newH);
        };
        const onUp = () => {
            this.prefs.setTerminalHeight(this.height());
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }
}
