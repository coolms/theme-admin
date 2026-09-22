import { consoleEntry } from '@coolms/core-angular';
import { TerminalPanelComponent } from '../terminal-panel.component';

/**
 * Terminal's console entry: the bottom dock panel with its top-bar toggle
 * (Ctrl+` as before), and the `terminal` binding the navigation graph
 * resolves (console@1). The panel talks back to the layout through the
 * ConsolePanelHost port.
 */
export default consoleEntry({
    module:   'terminal',
    contract: 'console',
    range:    '^1.0',
    bindings: [{ name: 'terminal', component: TerminalPanelComponent }],
    panels: [{
        id:        'terminal',
        dock:      'bottom',
        toggle:    { label: 'Toggle Terminal (Ctrl+`)', text: '>_', key: '`' },
        component: TerminalPanelComponent,
    }],
});
