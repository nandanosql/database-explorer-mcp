// ============================================================================
// ERD Generator Tool — Mermaid Entity Relationship Diagrams
// ============================================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionManager } from "../connection-manager.js";
import type { ColumnInfo } from "../types.js";

export function registerErdTools(server: McpServer): void {
    const manager = ConnectionManager.getInstance();

    server.tool(
        "generate_erd",
        "Generate an Entity Relationship Diagram (ERD) in Mermaid format from the database schema. The output can be rendered in any Mermaid-compatible viewer. Optionally filter to specific tables.",
        {
            tables: z
                .array(z.string())
                .optional()
                .describe("Specific table names to include (omit for all tables)"),
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => {
            try {
                const conn = manager.getConnection(params.connection);
                const schema = await conn.getSchema();

                // Filter tables if specified
                let tables = schema.tables;
                if (params.tables && params.tables.length > 0) {
                    const filterSet = new Set(params.tables.map((t) => t.toLowerCase()));
                    tables = tables.filter((t) => filterSet.has(t.name.toLowerCase()));
                    if (tables.length === 0) {
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: `No matching tables found. Available: ${schema.tables.map((t) => t.name).join(", ")}`,
                                },
                            ],
                        };
                    }
                }

                // Build Mermaid ERD
                let mermaid = "erDiagram\n";

                // Track relationships for drawing
                const relationships: string[] = [];

                for (const table of tables) {
                    // Entity definition
                    mermaid += `    ${sanitizeMermaidId(table.name)} {\n`;

                    for (const col of table.columns) {
                        const mermaidType = mapToMermaidType(col.type);
                        const constraints: string[] = [];
                        if (col.isPrimaryKey) constraints.push("PK");
                        if (col.isForeignKey) constraints.push("FK");
                        if (!col.nullable && !col.isPrimaryKey) constraints.push("\"NOT NULL\"");

                        const constraintStr = constraints.length > 0 ? ` ${constraints.join(",")}` : "";
                        mermaid += `        ${mermaidType} ${sanitizeMermaidId(col.name)}${constraintStr}\n`;

                        // Track FK relationships
                        if (col.isForeignKey && col.foreignKeyRef) {
                            const [refTable] = col.foreignKeyRef.split(".");
                            relationships.push(
                                `    ${sanitizeMermaidId(table.name)} }o--|| ${sanitizeMermaidId(refTable)} : "${col.name}"`
                            );
                        }
                    }

                    mermaid += `    }\n`;
                }

                // Add relationships
                if (relationships.length > 0) {
                    mermaid += "\n";
                    // Deduplicate relationships
                    const uniqueRelationships = [...new Set(relationships)];
                    mermaid += uniqueRelationships.join("\n");
                    mermaid += "\n";
                }

                // Summary
                const summary = [
                    `\n## ERD Summary`,
                    `- **Database:** ${schema.databaseName} (${schema.databaseType})`,
                    `- **Tables:** ${tables.length}`,
                    `- **Relationships:** ${relationships.length}`,
                    `- **Total Columns:** ${tables.reduce((s, t) => s + t.columns.length, 0)}`,
                ].join("\n");

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `\`\`\`mermaid\n${mermaid}\`\`\`\n${summary}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `❌ Error generating ERD: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

function sanitizeMermaidId(name: string): string {
    // Mermaid IDs can't have spaces or special chars — replace with underscores
    return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function mapToMermaidType(sqlType: string): string {
    const upper = sqlType.toUpperCase().replace(/\(.*\)/, "").trim();

    const typeMap: Record<string, string> = {
        // Integer types
        INT: "int",
        INTEGER: "int",
        SMALLINT: "int",
        BIGINT: "bigint",
        TINYINT: "int",
        MEDIUMINT: "int",
        SERIAL: "serial",
        BIGSERIAL: "bigserial",

        // Decimal types
        DECIMAL: "decimal",
        NUMERIC: "decimal",
        FLOAT: "float",
        DOUBLE: "double",
        REAL: "float",
        "DOUBLE PRECISION": "double",

        // String types
        VARCHAR: "varchar",
        "CHARACTER VARYING": "varchar",
        CHAR: "char",
        TEXT: "text",
        LONGTEXT: "text",
        MEDIUMTEXT: "text",
        TINYTEXT: "text",

        // Date/time types
        DATE: "date",
        DATETIME: "datetime",
        TIMESTAMP: "timestamp",
        "TIMESTAMP WITHOUT TIME ZONE": "timestamp",
        "TIMESTAMP WITH TIME ZONE": "timestamptz",
        TIME: "time",

        // Boolean
        BOOLEAN: "boolean",
        BOOL: "boolean",

        // Binary
        BLOB: "blob",
        BYTEA: "bytea",

        // JSON
        JSON: "json",
        JSONB: "jsonb",

        // UUID
        UUID: "uuid",

        // MongoDB types
        OBJECTID: "ObjectId",
        ARRAY: "array",
        OBJECT: "object",
        STRING: "string",
        NUMBER: "number",
    };

    return typeMap[upper] || sqlType.toLowerCase().replace(/\s+/g, "_");
}
