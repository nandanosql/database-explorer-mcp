// ============================================================================
// Database Explorer MCP Server — Server Setup
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerConnectTools } from "./tools/connect.js";
import { registerSchemaTools } from "./tools/schema.js";
import { registerQueryTools } from "./tools/query.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerOptimizeTools } from "./tools/optimize.js";
import { registerExportTools } from "./tools/export.js";
import { registerErdTools } from "./tools/erd.js";
import { registerSearchTools } from "./tools/search.js";
import { ConnectionManager } from "./connection-manager.js";
import type { ServerConfig } from "./types.js";

export function createServer(config?: Partial<ServerConfig>): McpServer {
    const server = new McpServer({
        name: "database-explorer",
        version: "1.1.0",
    });

    // Apply config to connection manager
    if (config) {
        ConnectionManager.getInstance().setConfig(config);
    }

    // ── Register all tools ──────────────────────────────────────────────────
    registerConnectTools(server);
    registerSchemaTools(server);
    registerQueryTools(server);
    registerStatsTools(server);
    registerOptimizeTools(server);
    registerExportTools(server);
    registerErdTools(server);
    registerSearchTools(server);

    // ── Register resources ──────────────────────────────────────────────────
    server.resource(
        "connections",
        "db://connections",
        { description: "List of active database connections" },
        async () => {
            const manager = ConnectionManager.getInstance();
            const connections = manager.listConnections();
            return {
                contents: [
                    {
                        uri: "db://connections",
                        mimeType: "application/json",
                        text: JSON.stringify(connections, null, 2),
                    },
                ],
            };
        }
    );

    // ── Register prompts ────────────────────────────────────────────────────

    server.prompt(
        "explore_database",
        "Explore and understand a database — structure, tables, relationships, and data distribution",
        {
            connection: z
                .string()
                .optional()
                .describe("Connection alias to explore (default: 'default')"),
        },
        async (params) => ({
            messages: [
                {
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: `I've connected to a database${params.connection ? ` (connection: "${params.connection}")` : ""}. Please help me explore and understand it:

1. First, list all the tables and their sizes using list_tables
2. Then describe each key table using describe_table to understand the schema
3. Generate an ERD diagram using generate_erd to visualize relationships
4. Get table statistics using get_table_stats to understand data distribution
5. Run a few sample queries to see what kind of data is in the main tables

Give me a comprehensive overview of this database — its purpose, key entities, relationships, and any observations about the data.`,
                    },
                },
            ],
        })
    );

    server.prompt(
        "optimize_performance",
        "Analyze database performance — find missing indexes, slow query patterns, and optimization opportunities",
        {
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => ({
            messages: [
                {
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: `Please analyze this database${params.connection ? ` (connection: "${params.connection}")` : ""} for performance issues:

1. Use get_table_stats to identify the largest tables
2. For each large table, run suggest_indexes to find missing indexes
3. Check for tables with many rows but few indexes
4. Look for common anti-patterns (tables without primary keys, missing foreign key indexes)
5. Suggest concrete SQL to create any recommended indexes

Provide a prioritized list of optimizations with expected impact.`,
                    },
                },
            ],
        })
    );

    server.prompt(
        "write_query",
        "Get help writing a SQL/MongoDB query for a specific task",
        {
            task: z.string().describe("What you want the query to do"),
            context: z
                .string()
                .optional()
                .describe("Any additional context about the data or tables"),
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => ({
            messages: [
                {
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: `I need help writing a query. Here's what I want to do:

**Task:** ${params.task}
${params.context ? `\n**Context:** ${params.context}` : ""}

Please:
1. First explore the relevant tables using list_tables and describe_table
2. Understand the schema and relationships
3. Write the query step by step, explaining your approach
4. Run the query using run_query to verify it works
5. Use explain_query to check if it's efficient
6. Suggest any improvements or alternative approaches`,
                    },
                },
            ],
        })
    );

    server.prompt(
        "generate_report",
        "Generate a data report from the database on a specific topic",
        {
            topic: z.string().describe("What the report should cover"),
            connection: z
                .string()
                .optional()
                .describe("Connection alias (default: 'default')"),
        },
        async (params) => ({
            messages: [
                {
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: `Generate a comprehensive data report about: **${params.topic}**
${params.connection ? `(Using connection: "${params.connection}")` : ""}

Please:
1. Explore relevant tables and understand the data structure
2. Write and execute multiple queries to gather insights
3. Include key metrics, trends, distributions, and notable findings
4. Export key data using export_data if useful
5. Present the findings in a clear, well-organized report with tables and summaries`,
                    },
                },
            ],
        })
    );

    return server;
}
