// ============================================================================
// Data Export Tool
// ============================================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionManager } from "../connection-manager.js";
import { DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT } from "../types.js";

export function registerExportTools(server: McpServer): void {
    const manager = ConnectionManager.getInstance();

    server.tool(
        "export_data",
        "Export query results as CSV or JSON format. Useful for getting data out of the database in a portable format.",
        {
            query: z.string().describe("SQL query or MongoDB JSON query"),
            format: z
                .enum(["csv", "json"])
                .optional()
                .describe("Output format (default: csv)"),
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
            limit: z
                .number()
                .optional()
                .describe(`Max rows (default: ${DEFAULT_ROW_LIMIT}, max: ${MAX_ROW_LIMIT})`),
        },
        async (params) => {
            try {
                const conn = manager.getConnection(params.connection);
                const format = params.format || "csv";
                const limit = Math.min(params.limit || DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT);

                // Inject limit for SQL
                let query = params.query;
                if (conn.type !== "mongodb") {
                    const upper = query.trim().toUpperCase();
                    if (upper.startsWith("SELECT") && !upper.includes("LIMIT")) {
                        query = `${query.replace(/;\s*$/, "")} LIMIT ${limit}`;
                    }
                }

                const result = await conn.runQuery(query);

                let output: string;
                if (format === "json") {
                    output = JSON.stringify(result.rows, null, 2);
                } else {
                    // CSV format
                    if (result.rows.length === 0) {
                        output = result.columns.join(",");
                    } else {
                        const header = result.columns.join(",");
                        const rows = result.rows.map((row) =>
                            result.columns
                                .map((col) => {
                                    const val = row[col];
                                    if (val === null || val === undefined) return "";
                                    const str = String(val);
                                    // Escape CSV values
                                    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
                                        return `"${str.replace(/"/g, '""')}"`;
                                    }
                                    return str;
                                })
                                .join(",")
                        );
                        output = [header, ...rows].join("\n");
                    }
                }

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Exported ${result.rowCount} row(s) as ${format.toUpperCase()}:\n\n${output}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `❌ Export error: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}
