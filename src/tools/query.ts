// ============================================================================
// Query Execution Tools — with SQL Safety Validation
// ============================================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionManager } from "../connection-manager.js";
import { DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT, DANGEROUS_SQL_PATTERNS } from "../types.js";

// ── Query Validator ──────────────────────────────────────────────────────────
function validateQuery(
    query: string,
    readOnly: boolean
): { valid: boolean; reason?: string } {
    if (!readOnly) return { valid: true };

    const trimmed = query.trim();

    for (const { pattern, description } of DANGEROUS_SQL_PATTERNS) {
        if (pattern.test(trimmed)) {
            return {
                valid: false,
                reason: `🛡️ ${description}.\n\nTo execute write operations, set readonly to false:\n  run_query({ query: "...", readonly: false })`,
            };
        }
    }

    return { valid: true };
}

export function registerQueryTools(server: McpServer): void {
    const manager = ConnectionManager.getInstance();

    // ── run_query ───────────────────────────────────────────────────────────
    server.tool(
        "run_query",
        `Execute a SQL query (PostgreSQL/MySQL/SQLite) or MongoDB query (JSON format).
For SQL databases: provide standard SQL.
For MongoDB: provide JSON like {"collection":"users","operation":"find","query":{"age":{"$gt":25}},"options":{"limit":10}}.
MongoDB operations: find, aggregate, count, distinct.
Results are limited to ${DEFAULT_ROW_LIMIT} rows by default (max ${MAX_ROW_LIMIT}).
By default, destructive queries (DROP, TRUNCATE, INSERT, UPDATE, DELETE) are blocked. Set readonly=false to allow writes.`,
        {
            query: z.string().describe("SQL query or MongoDB JSON query"),
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
            limit: z
                .number()
                .optional()
                .describe(`Max rows to return (default: ${DEFAULT_ROW_LIMIT}, max: ${MAX_ROW_LIMIT})`),
            readonly: z
                .boolean()
                .optional()
                .describe("Block destructive queries (default: true). Set to false to allow writes."),
        },
        async (params) => {
            try {
                const conn = manager.getConnection(params.connection);
                const config = manager.serverConfig;
                const isReadOnly = params.readonly ?? config.readOnlyByDefault;
                const limit = Math.min(
                    params.limit || config.defaultRowLimit,
                    config.maxRowLimit
                );

                // Validate query safety (skip for MongoDB)
                if (conn.type !== "mongodb") {
                    const validation = validateQuery(params.query, isReadOnly);
                    if (!validation.valid) {
                        return {
                            content: [{ type: "text" as const, text: validation.reason! }],
                            isError: true,
                        };
                    }
                }

                // For SQL databases, inject LIMIT if not present
                let query = params.query;
                if (conn.type !== "mongodb") {
                    const upperQuery = query.trim().toUpperCase();
                    if (
                        upperQuery.startsWith("SELECT") &&
                        !upperQuery.includes("LIMIT")
                    ) {
                        query = `${query.replace(/;\s*$/, "")} LIMIT ${limit}`;
                    }
                }

                const result = await conn.runQuery(query);

                // Format results as a readable table
                let output = "";
                if (result.rows.length === 0) {
                    output = "Query returned no results.";
                } else {
                    output = formatResultTable(result.columns, result.rows);
                }

                output += `\n\n${result.rowCount} row(s) returned in ${result.durationMs}ms`;
                if (result.truncated) {
                    output += ` (truncated to ${limit} rows)`;
                }
                if (isReadOnly) {
                    output += `  [read-only mode]`;
                }

                return {
                    content: [{ type: "text" as const, text: output }],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `❌ Query error: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // ── explain_query ──────────────────────────────────────────────────────
    server.tool(
        "explain_query",
        "Get the execution plan for a query without running it. Useful for optimizing slow queries.",
        {
            query: z.string().describe("SQL query or MongoDB JSON query to explain"),
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => {
            try {
                const conn = manager.getConnection(params.connection);
                const plan = await conn.explainQuery(params.query);

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Query Execution Plan:\n${"─".repeat(50)}\n${plan}`,
                        },
                    ],
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

function formatResultTable(
    columns: string[],
    rows: Record<string, unknown>[]
): string {
    if (columns.length === 0 || rows.length === 0) return "";

    // Calculate column widths
    const widths = columns.map((col) => {
        const maxDataWidth = rows.reduce((max, row) => {
            const val = String(row[col] ?? "NULL");
            return Math.max(max, val.length);
        }, 0);
        return Math.min(Math.max(col.length, maxDataWidth), 50); // Cap at 50 chars
    });

    // Header
    const header = columns
        .map((col, i) => col.padEnd(widths[i]))
        .join(" │ ");
    const separator = widths.map((w) => "─".repeat(w)).join("─┼─");

    // Rows
    const dataRows = rows
        .map((row) =>
            columns
                .map((col, i) => {
                    let val = String(row[col] ?? "NULL");
                    if (val.length > 50) val = val.substring(0, 47) + "...";
                    return val.padEnd(widths[i]);
                })
                .join(" │ ")
        )
        .join("\n");

    return `${header}\n${separator}\n${dataRows}`;
}
