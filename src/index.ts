#!/usr/bin/env node
// ============================================================================
// Database Explorer MCP Server — Entry Point
// ============================================================================

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { ConnectionManager } from "./connection-manager.js";

function loadConfig() {
    return {
        readOnlyByDefault: process.env.DB_EXPLORER_READONLY !== "false",
        defaultRowLimit: parseInt(process.env.DB_EXPLORER_MAX_ROWS || "100", 10),
        maxRowLimit: parseInt(process.env.DB_EXPLORER_MAX_ROW_LIMIT || "1000", 10),
        queryTimeoutMs: parseInt(process.env.DB_EXPLORER_TIMEOUT_MS || "30000", 10),
    };
}

async function main() {
    const config = loadConfig();
    const server = createServer(config);
    const transport = new StdioServerTransport();

    // Graceful shutdown
    const shutdown = async () => {
        await ConnectionManager.getInstance().disconnectAll();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await server.connect(transport);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
