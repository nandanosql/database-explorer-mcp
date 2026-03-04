// ============================================================================
// Search Data Tool — Full-text search across tables
// ============================================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionManager } from "../connection-manager.js";

export function registerSearchTools(server: McpServer): void {
    const manager = ConnectionManager.getInstance();

    server.tool(
        "search_data",
        "Search for a value across all (or specific) tables and text columns. Useful for finding where specific data lives in the database.",
        {
            searchTerm: z.string().describe("The value to search for"),
            tables: z
                .array(z.string())
                .optional()
                .describe("Specific tables to search (omit for all tables)"),
            caseSensitive: z
                .boolean()
                .optional()
                .describe("Case-sensitive search (default: false)"),
            maxResultsPerTable: z
                .number()
                .optional()
                .describe("Max results per table (default: 5)"),
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => {
            try {
                const conn = manager.getConnection(params.connection);
                const maxPerTable = params.maxResultsPerTable || 5;
                const caseSensitive = params.caseSensitive ?? false;

                // Get list of tables to search
                const allTables = await conn.listTables();
                let tablesToSearch = allTables.filter((t) => t.type !== "view");

                if (params.tables && params.tables.length > 0) {
                    const filterSet = new Set(params.tables.map((t) => t.toLowerCase()));
                    tablesToSearch = tablesToSearch.filter((t) =>
                        filterSet.has(t.name.toLowerCase())
                    );
                }

                if (tablesToSearch.length === 0) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: "No tables found to search.",
                            },
                        ],
                    };
                }

                // Handle MongoDB differently
                if (conn.type === "mongodb") {
                    return await searchMongo(conn, params.searchTerm, tablesToSearch, maxPerTable);
                }

                // SQL-based search
                const results: Array<{
                    table: string;
                    column: string;
                    matches: Record<string, unknown>[];
                }> = [];

                for (const table of tablesToSearch) {
                    try {
                        const columns = await conn.describeTable(table.name);
                        const textColumns = columns.filter((col) =>
                            isTextType(col.type)
                        );

                        if (textColumns.length === 0) continue;

                        // Build search query for each text column
                        for (const col of textColumns) {
                            const likeOp = conn.type === "postgresql" && !caseSensitive
                                ? "ILIKE"
                                : "LIKE";
                            const searchVal = caseSensitive
                                ? `%${params.searchTerm}%`
                                : `%${params.searchTerm}%`;

                            let query: string;
                            if (conn.type === "postgresql" || conn.type === "mysql") {
                                query = `SELECT * FROM "${table.name}" WHERE "${col.name}" ${likeOp} '${escapeSqlString(searchVal)}' LIMIT ${maxPerTable}`;
                            } else {
                                // SQLite — LIKE is case-insensitive by default for ASCII
                                query = `SELECT * FROM "${table.name}" WHERE "${col.name}" LIKE '${escapeSqlString(searchVal)}' LIMIT ${maxPerTable}`;
                            }

                            try {
                                const result = await conn.runQuery(query);
                                if (result.rows.length > 0) {
                                    results.push({
                                        table: table.name,
                                        column: col.name,
                                        matches: result.rows,
                                    });
                                }
                            } catch {
                                // Skip columns that error (e.g., permission issues)
                            }
                        }
                    } catch {
                        // Skip tables that error
                    }
                }

                // Format output
                if (results.length === 0) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `🔍 No matches found for "${params.searchTerm}" across ${tablesToSearch.length} table(s).`,
                            },
                        ],
                    };
                }

                let output = `🔍 Search results for "${params.searchTerm}":\n${"═".repeat(50)}\n\n`;
                let totalMatches = 0;

                for (const result of results) {
                    output += `📋 ${result.table}.${result.column} — ${result.matches.length} match(es)\n`;
                    for (const row of result.matches) {
                        const preview = Object.entries(row)
                            .slice(0, 4)
                            .map(([k, v]) => {
                                const val = String(v ?? "NULL");
                                return `${k}: ${val.length > 40 ? val.substring(0, 37) + "..." : val}`;
                            })
                            .join(" | ");
                        output += `  → ${preview}\n`;
                    }
                    output += "\n";
                    totalMatches += result.matches.length;
                }

                output += `${"─".repeat(50)}\nTotal: ${totalMatches} match(es) in ${results.length} column(s) across ${new Set(results.map((r) => r.table)).size} table(s)`;

                return {
                    content: [{ type: "text" as const, text: output }],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `❌ Search error: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

import { DatabaseConnector } from "../connectors/base.js";

async function searchMongo(
    conn: DatabaseConnector,
    searchTerm: string,
    tables: Array<{ name: string }>,
    maxPerTable: number
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const results: Array<{ collection: string; matches: Record<string, unknown>[] }> = [];

    for (const table of tables) {
        try {
            const query = JSON.stringify({
                collection: table.name,
                operation: "find",
                query: { $text: { $search: searchTerm } },
                options: { limit: maxPerTable },
            });

            const result = await conn.runQuery(query);
            if (result.rows.length > 0) {
                results.push({
                    collection: table.name,
                    matches: result.rows,
                });
            }
        } catch {
            // If $text search fails, try regex on string fields
            try {
                const columns = await conn.describeTable(table.name);
                const stringFields = columns
                    .filter((c) => c.type.includes("string"))
                    .slice(0, 3);

                for (const col of stringFields) {
                    const query = JSON.stringify({
                        collection: table.name,
                        operation: "find",
                        query: { [col.name]: { $regex: searchTerm, $options: "i" } },
                        options: { limit: maxPerTable },
                    });

                    const result = await conn.runQuery(query);
                    if (result.rows.length > 0) {
                        results.push({
                            collection: table.name,
                            matches: result.rows,
                        });
                    }
                }
            } catch {
                // Skip
            }
        }
    }

    if (results.length === 0) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `🔍 No matches found for "${searchTerm}" in MongoDB collections.`,
                },
            ],
        };
    }

    let output = `🔍 Search results for "${searchTerm}":\n${"═".repeat(50)}\n\n`;
    for (const r of results) {
        output += `📋 ${r.collection} — ${r.matches.length} match(es)\n`;
        for (const doc of r.matches) {
            output += `  → ${JSON.stringify(doc).substring(0, 120)}...\n`;
        }
        output += "\n";
    }

    return { content: [{ type: "text" as const, text: output }] };
}

function isTextType(sqlType: string): boolean {
    const upper = sqlType.toUpperCase();
    return (
        upper.includes("CHAR") ||
        upper.includes("TEXT") ||
        upper.includes("VARCHAR") ||
        upper.includes("STRING") ||
        upper.includes("CLOB") ||
        upper === "NAME" ||
        upper === "JSON" ||
        upper === "JSONB"
    );
}

function escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
}
