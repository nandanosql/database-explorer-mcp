// ============================================================================
// Schema Exploration Tools
// ============================================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionManager } from "../connection-manager.js";

export function registerSchemaTools(server: McpServer): void {
    const manager = ConnectionManager.getInstance();

    // ── list_tables ─────────────────────────────────────────────────────────
    server.tool(
        "list_tables",
        "List all tables, views, or collections in the connected database.",
        {
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => {
            try {
                const conn = manager.getConnection(params.connection);
                const tables = await conn.listTables();

                if (tables.length === 0) {
                    return {
                        content: [
                            { type: "text" as const, text: "No tables found in the database." },
                        ],
                    };
                }

                const header = `Database: ${conn.databaseName} (${conn.type})\n${"─".repeat(50)}`;
                const rows = tables
                    .map((t) => {
                        const info = [t.name, `[${t.type}]`];
                        if (t.rowCount !== undefined) info.push(`${t.rowCount.toLocaleString()} rows`);
                        if (t.sizeBytes !== undefined) info.push(formatBytes(t.sizeBytes));
                        return `  • ${info.join("  —  ")}`;
                    })
                    .join("\n");

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `${header}\n${rows}\n\nTotal: ${tables.length} table(s)`,
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

    // ── describe_table ──────────────────────────────────────────────────────
    server.tool(
        "describe_table",
        "Get detailed schema info for a specific table/collection, including columns, types, constraints, and indexes.",
        {
            table: z.string().describe("Table or collection name"),
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => {
            try {
                const conn = manager.getConnection(params.connection);
                const columns = await conn.describeTable(params.table);
                const indexes = await conn.getIndexes(params.table);

                if (columns.length === 0) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Table "${params.table}" not found or has no columns.`,
                            },
                        ],
                    };
                }

                // Format columns
                let output = `Table: ${params.table}\n${"═".repeat(50)}\n\nColumns:\n`;
                for (const col of columns) {
                    const flags: string[] = [];
                    if (col.isPrimaryKey) flags.push("PK");
                    if (col.isForeignKey) flags.push(`FK → ${col.foreignKeyRef}`);
                    if (!col.nullable) flags.push("NOT NULL");
                    if (col.defaultValue) flags.push(`DEFAULT ${col.defaultValue}`);

                    output += `  • ${col.name}  ${col.type}`;
                    if (col.maxLength) output += `(${col.maxLength})`;
                    if (flags.length > 0) output += `  [${flags.join(", ")}]`;
                    if (col.comment) output += `  — ${col.comment}`;
                    output += "\n";
                }

                // Format indexes
                if (indexes.length > 0) {
                    output += `\nIndexes:\n`;
                    for (const idx of indexes) {
                        const flags: string[] = [];
                        if (idx.isPrimary) flags.push("PRIMARY");
                        if (idx.isUnique) flags.push("UNIQUE");
                        if (idx.type) flags.push(idx.type);
                        output += `  • ${idx.name}  (${idx.columns.join(", ")})  [${flags.join(", ")}]\n`;
                    }
                }

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

    // ── get_schema ──────────────────────────────────────────────────────────
    server.tool(
        "get_schema",
        "Get the complete database schema — all tables, columns, indexes, and relationships as structured JSON.",
        {
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => {
            try {
                const conn = manager.getConnection(params.connection);
                const schema = await conn.getSchema();

                return {
                    content: [
                        { type: "text" as const, text: JSON.stringify(schema, null, 2) },
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

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
