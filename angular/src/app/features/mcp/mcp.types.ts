// Cut from the shell's api/api.service.ts on 2026-09-21: the DTOs of the Mcp (/mcp/tools) endpoints, verbatim.

/** One MCP tool + its governance gate (`GET /api/mcp/tools`, ). */
export interface McpToolGovernanceDto {
    readonly name: string;
    readonly title: string;
    readonly description: string;
    /** The role a caller must hold, or null when any authenticated caller may use it. */
    readonly requiredRole: string | null;
    /** Derived human-readable gate: `authenticated` or `role:ROLE_X`. */
    readonly access: string;
}

/** The full MCP tool inventory + per-tool governance (admin audit endpoint). */
export interface McpToolCatalogDto {
    readonly count: number;
    readonly tools: McpToolGovernanceDto[];
}
