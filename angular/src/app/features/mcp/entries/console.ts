import { consoleEntry } from '@coolms/core-angular';

/**
 * Mcp's console entry: the tool-governance audit over GET /api/mcp/tools (console@1).
 */
export default consoleEntry({
    module:   'mcp',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'mcp/tools',
            component: () => import('../mcp-tools-page.component').then(m => m.McpToolsPageComponent),
            nav:       { activeNav: '/mcp/tools' },
        },
    ],
});
