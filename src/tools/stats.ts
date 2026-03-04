// ============================================================================
// Table Statistics Tool
// ============================================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionManager } from "../connection-manager.js";

export function registerStatsTools(server: McpServer): void {
    const manager = ConnectionManager.getInstance();

    server.tool(
        "get_table_stats",
        "Get statistics for database tables — row counts, sizes, index counts, and last analysis time.",
        {
            table: z
                .string()
                .optional()
                .describe("Specific table name (omit for all tables)"),
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => {
            try {
                const conn = manager.getConnection(params.connection);
                const stats = await conn.getTableStats(params.table);

                if (stats.length === 0) {
                    return {
                        content: [
                            { type: "text" as const, text: "No table statistics found." },
                        ],
                    };
                }

                let output = `Table Statistics — ${conn.databaseName}\n${"═".repeat(50)}\n\n`;

                for (const stat of stats) {
                    output += `📊 ${stat.tableName}\n`;
                    output += `   Rows:    ${stat.rowCount.toLocaleString()}\n`;
                    if (stat.sizeBytes !== undefined) {
                        output += `   Size:    ${formatBytes(stat.sizeBytes)}\n`;
                    }
                    if (stat.indexCount !== undefined) {
                        output += `   Indexes: ${stat.indexCount}\n`;
                    }
                    if (stat.lastAnalyzed) {
                        output += `   Analyzed: ${stat.lastAnalyzed}\n`;
                    }
                    output += "\n";
                }

                // Summary
                const totalRows = stats.reduce((s, t) => s + t.rowCount, 0);
                const totalSize = stats.reduce((s, t) => s + (t.sizeBytes || 0), 0);
                output += `${"─".repeat(50)}\n`;
                output += `Total: ${stats.length} table(s), ${totalRows.toLocaleString()} rows`;
                if (totalSize > 0) output += `, ${formatBytes(totalSize)}`;

                return {
                    content: [{ type: "text" as const, text: output }],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
