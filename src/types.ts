// ============================================================================
// Types & Interfaces for Database Explorer MCP Server
// ============================================================================

export type DatabaseType = "postgresql" | "mysql" | "sqlite" | "mongodb";

export interface ConnectionConfig {
    type: DatabaseType;
    alias?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    filepath?: string; // SQLite only
    connectionString?: string; // Full URI override
}

export interface TableInfo {
    name: string;
    type: "table" | "view" | "collection";
    schema?: string;
    rowCount?: number;
    sizeBytes?: number;
}

export interface ColumnInfo {
    name: string;
    type: string;
    nullable: boolean;
    defaultValue: string | null;
    isPrimaryKey: boolean;
    isForeignKey: boolean;
    foreignKeyRef?: string;
    maxLength?: number;
    comment?: string;
}

export interface IndexInfo {
    name: string;
    columns: string[];
    isUnique: boolean;
    isPrimary: boolean;
    type?: string;
}

export interface QueryResult {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    durationMs: number;
    truncated?: boolean;
}

export interface TableStats {
    tableName: string;
    rowCount: number;
    sizeBytes?: number;
    indexCount?: number;
    lastAnalyzed?: string;
}

export interface SchemaInfo {
    databaseName: string;
    databaseType: DatabaseType;
    tables: Array<{
        name: string;
        type: "table" | "view" | "collection";
        columns: ColumnInfo[];
        indexes: IndexInfo[];
        rowCount?: number;
    }>;
}

export interface ConnectionInfo {
    alias: string;
    type: DatabaseType;
    database: string;
    host?: string;
    port?: number;
    connected: boolean;
}

export interface ServerConfig {
    readOnlyByDefault: boolean;
    maxRowLimit: number;
    defaultRowLimit: number;
    queryTimeoutMs: number;
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
    readOnlyByDefault: true,
    maxRowLimit: 1000,
    defaultRowLimit: 100,
    queryTimeoutMs: 30000,
};

export const DEFAULT_ROW_LIMIT = 100;
export const MAX_ROW_LIMIT = 1000;
export const QUERY_TIMEOUT_MS = 30000;

// SQL patterns that are blocked in read-only mode
export const DANGEROUS_SQL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /^\s*DROP\s+/i, description: "DROP statements are blocked in read-only mode" },
    { pattern: /^\s*TRUNCATE\s+/i, description: "TRUNCATE statements are blocked in read-only mode" },
    { pattern: /^\s*ALTER\s+/i, description: "ALTER statements are blocked in read-only mode" },
    { pattern: /^\s*CREATE\s+/i, description: "CREATE statements are blocked in read-only mode" },
    { pattern: /^\s*DELETE\s+(?!.*\bWHERE\b)/i, description: "DELETE without WHERE clause is blocked in read-only mode" },
    { pattern: /^\s*UPDATE\s+(?!.*\bWHERE\b)/i, description: "UPDATE without WHERE clause is blocked in read-only mode" },
    { pattern: /^\s*INSERT\s+/i, description: "INSERT statements are blocked in read-only mode" },
    { pattern: /^\s*GRANT\s+/i, description: "GRANT statements are blocked in read-only mode" },
    { pattern: /^\s*REVOKE\s+/i, description: "REVOKE statements are blocked in read-only mode" },
];
