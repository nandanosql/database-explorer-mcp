// ============================================================================
// Connect / Disconnect / List Tools
// ============================================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionManager } from "../connection-manager.js";
import type { DatabaseType } from "../types.js";

export function registerConnectTools(server: McpServer): void {
    const manager = ConnectionManager.getInstance();

    // ── connect_database ────────────────────────────────────────────────────
    server.tool(
        "connect_database",
        "Connect to a database (PostgreSQL, MySQL, SQLite, or MongoDB). Returns the connection alias for use in subsequent queries.",
        {
            type: z
                .enum(["postgresql", "mysql", "sqlite", "mongodb"])
                .describe("Database type"),
            alias: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
            host: z.string().optional().describe("Database host (default: localhost)"),
            port: z.number().optional().describe("Database port"),
            database: z.string().optional().describe("Database name"),
            user: z.string().optional().describe("Username"),
            password: z.string().optional().describe("Password"),
            filepath: z
                .string()
                .optional()
                .describe("File path for SQLite databases"),
            connectionString: z
                .string()
                .optional()
                .describe("Full connection URI (overrides individual fields)"),
        },
        async (params) => {
            try {
                const alias = await manager.addConnection({
                    type: params.type as DatabaseType,
                    alias: params.alias,
                    host: params.host,
                    port: params.port,
                    database: params.database,
                    user: params.user,
                    password: params.password,
                    filepath: params.filepath,
                    connectionString: params.connectionString,
                });

                const conn = manager.getConnection(alias);
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `✅ Connected to ${params.type} database "${conn.databaseName}" with alias "${alias}"`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `❌ Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // ── disconnect_database ────────────────────────────────────────────────
    server.tool(
        "disconnect_database",
        "Disconnect from a database by its alias.",
        {
            alias: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => {
            try {
                const alias = params.alias || "default";
                await manager.removeConnection(alias);
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `✅ Disconnected from "${alias}"`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `❌ Failed to disconnect: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // ── list_connections ───────────────────────────────────────────────────
    server.tool(
        "list_connections",
        "List all active database connections.",
        {},
        async () => {
            const connections = manager.listConnections();
            if (connections.length === 0) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: "No active connections. Use connect_database to connect first.",
                        },
                    ],
                };
            }

            const table = connections
                .map(
                    (c) =>
                        `• ${c.alias}: ${c.type} → ${c.database}${c.host ? ` (${c.host}:${c.port})` : ""} [${c.connected ? "connected" : "disconnected"}]`
                )
                .join("\n");

            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Active connections:\n${table}`,
                    },
                ],
            };
        }
    );
}
