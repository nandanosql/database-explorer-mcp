// ============================================================================
// Index Optimization Suggestions Tool
// ============================================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionManager } from "../connection-manager.js";

export function registerOptimizeTools(server: McpServer): void {
    const manager = ConnectionManager.getInstance();

    server.tool(
        "suggest_indexes",
        "Analyze a table's columns and existing indexes, then suggest potentially missing indexes based on column patterns (foreign keys, common query patterns).",
        {
            table: z.string().describe("Table name to analyze"),
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
                const stats = await conn.getTableStats(params.table);

                const indexedColumns = new Set<string>();
                for (const idx of indexes) {
                    for (const col of idx.columns) {
                        indexedColumns.add(col);
                    }
                }

                const suggestions: string[] = [];

                // 1. Check foreign key columns without indexes
                for (const col of columns) {
                    if (col.isForeignKey && !indexedColumns.has(col.name)) {
                        suggestions.push(
                            `🔑 FK column "${col.name}" has no index. JOINs on this column will be slow.\n   → CREATE INDEX idx_${params.table}_${col.name} ON ${params.table}(${col.name});`
                        );
                    }
                }

                // 2. Check commonly queried column patterns
                const suspectedQueryColumns = columns.filter(
                    (col) =>
                        !col.isPrimaryKey &&
                        !indexedColumns.has(col.name) &&
                        (col.name.endsWith("_id") ||
                            col.name.endsWith("_at") ||
                            col.name.endsWith("_date") ||
                            col.name === "email" ||
                            col.name === "username" ||
                            col.name === "slug" ||
                            col.name === "status" ||
                            col.name === "type" ||
                            col.name === "created_at" ||
                            col.name === "updated_at")
                );

                for (const col of suspectedQueryColumns) {
                    if (!col.isForeignKey) {
                        // Already handled above
                        suggestions.push(
                            `📌 Column "${col.name}" looks like a common query/filter column and has no index.\n   → CREATE INDEX idx_${params.table}_${col.name} ON ${params.table}(${col.name});`
                        );
                    }
                }

                // 3. Large table without many indexes
                const tableStats = stats[0];
                if (
                    tableStats &&
                    tableStats.rowCount > 10000 &&
                    indexes.length <= 1
                ) {
                    suggestions.push(
                        `⚠️  Table has ${tableStats.rowCount.toLocaleString()} rows but only ${indexes.length} index(es). Consider adding indexes for frequently queried columns.`
                    );
                }

                // 4. Check for redundant indexes
                for (let i = 0; i < indexes.length; i++) {
                    for (let j = i + 1; j < indexes.length; j++) {
                        const a = indexes[i];
                        const b = indexes[j];
                        if (
                            a.columns.length < b.columns.length &&
                            a.columns.every((col, idx) => col === b.columns[idx])
                        ) {
                            suggestions.push(
                                `♻️  Index "${a.name}" (${a.columns.join(", ")}) is a prefix of "${b.name}" (${b.columns.join(", ")}). The shorter index may be redundant.`
                            );
                        }
                    }
                }

                let output = `Index Analysis — ${params.table}\n${"═".repeat(50)}\n\n`;
                output += `Existing indexes: ${indexes.length}\n`;
                for (const idx of indexes) {
                    const flags: string[] = [];
                    if (idx.isPrimary) flags.push("PRIMARY");
                    if (idx.isUnique) flags.push("UNIQUE");
                    output += `  • ${idx.name} (${idx.columns.join(", ")}) [${flags.join(", ")}]\n`;
                }

                output += `\n${"─".repeat(50)}\n`;

                if (suggestions.length === 0) {
                    output += `\n✅ No index improvement suggestions — looks good!`;
                } else {
                    output += `\nSuggestions (${suggestions.length}):\n\n`;
                    output += suggestions.join("\n\n");
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
}
