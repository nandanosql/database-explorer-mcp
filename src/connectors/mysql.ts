// ============================================================================
// MySQL Connector
// ============================================================================

import mysql from "mysql2/promise";
import { DatabaseConnector } from "./base.js";
import type {
    ConnectionConfig,
    TableInfo,
    ColumnInfo,
    IndexInfo,
    QueryResult,
    TableStats,
    SchemaInfo,
} from "../types.js";

export class MySQLConnector extends DatabaseConnector {
    readonly type = "mysql" as const;
    private pool: mysql.Pool | null = null;

    constructor(config: ConnectionConfig) {
        super(config);
    }

    async connect(): Promise<void> {
        const connectionConfig = this._config.connectionString
            ? { uri: this._config.connectionString }
            : {
                host: this._config.host || "localhost",
                port: this._config.port || 3306,
                database: this._config.database || "mysql",
                user: this._config.user || "root",
                password: this._config.password || "",
            };

        this.pool = mysql.createPool({
            ...connectionConfig,
            connectionLimit: 5,
            waitForConnections: true,
        });

        // Test connection
        const [rows] = await this.pool.query("SELECT DATABASE() as db");
        this._databaseName =
            ((rows as mysql.RowDataPacket[])[0]?.db as string) ||
            this._config.database ||
            "unknown";
        this._connected = true;
    }

    async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
        this._connected = false;
    }

    async listTables(): Promise<TableInfo[]> {
        this.ensureConnected();
        const [rows] = await this.pool!.query(
            `
      SELECT 
        TABLE_NAME as name,
        TABLE_TYPE as table_type,
        TABLE_ROWS as row_count,
        DATA_LENGTH + INDEX_LENGTH as size_bytes
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `
        );

        return (rows as mysql.RowDataPacket[]).map((row) => ({
            name: row.name as string,
            type: (row.table_type === "VIEW" ? "view" : "table") as "table" | "view",
            rowCount: Number(row.row_count || 0),
            sizeBytes: Number(row.size_bytes || 0),
        }));
    }

    async describeTable(tableName: string): Promise<ColumnInfo[]> {
        this.ensureConnected();
        const [rows] = await this.pool!.query(
            `
      SELECT 
        c.COLUMN_NAME as name,
        c.COLUMN_TYPE as type,
        c.IS_NULLABLE = 'YES' as nullable,
        c.COLUMN_DEFAULT as default_value,
        c.CHARACTER_MAXIMUM_LENGTH as max_length,
        c.COLUMN_KEY = 'PRI' as is_primary_key,
        c.COLUMN_KEY = 'MUL' as is_foreign_key,
        (
          SELECT CONCAT(kcu.REFERENCED_TABLE_NAME, '.', kcu.REFERENCED_COLUMN_NAME)
          FROM information_schema.KEY_COLUMN_USAGE kcu
          WHERE kcu.TABLE_SCHEMA = DATABASE()
            AND kcu.TABLE_NAME = c.TABLE_NAME
            AND kcu.COLUMN_NAME = c.COLUMN_NAME
            AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
          LIMIT 1
        ) as foreign_key_ref,
        c.COLUMN_COMMENT as comment
      FROM information_schema.COLUMNS c
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = ?
      ORDER BY c.ORDINAL_POSITION
    `,
            [tableName]
        );

        return (rows as mysql.RowDataPacket[]).map((row) => ({
            name: row.name as string,
            type: row.type as string,
            nullable: Boolean(row.nullable),
            defaultValue: (row.default_value as string) || null,
            isPrimaryKey: Boolean(row.is_primary_key),
            isForeignKey: Boolean(row.is_foreign_key),
            foreignKeyRef: (row.foreign_key_ref as string) || undefined,
            maxLength: row.max_length ? Number(row.max_length) : undefined,
            comment: (row.comment as string) || undefined,
        }));
    }

    async getIndexes(tableName: string): Promise<IndexInfo[]> {
        this.ensureConnected();
        const [rows] = await this.pool!.query(
            `
      SELECT 
        INDEX_NAME as name,
        GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as columns_str,
        NOT NON_UNIQUE as is_unique,
        INDEX_NAME = 'PRIMARY' as is_primary,
        INDEX_TYPE as type
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE
      ORDER BY INDEX_NAME
    `,
            [tableName]
        );

        return (rows as mysql.RowDataPacket[]).map((row) => ({
            name: row.name as string,
            columns: (row.columns_str as string).split(","),
            isUnique: Boolean(row.is_unique),
            isPrimary: Boolean(row.is_primary),
            type: row.type as string,
        }));
    }

    async getSchema(): Promise<SchemaInfo> {
        this.ensureConnected();
        const tables = await this.listTables();
        const schemaData = await Promise.all(
            tables.map(async (table) => ({
                name: table.name,
                type: table.type,
                columns: await this.describeTable(table.name),
                indexes: await this.getIndexes(table.name),
                rowCount: table.rowCount,
            }))
        );

        return {
            databaseName: this._databaseName,
            databaseType: this.type,
            tables: schemaData,
        };
    }

    async runQuery(query: string, params?: unknown[]): Promise<QueryResult> {
        this.ensureConnected();
        const start = Date.now();
        const [rows, fields] = await this.pool!.query(query, params);
        const durationMs = Date.now() - start;

        const resultRows = Array.isArray(rows) ? rows : [];
        const resultFields = Array.isArray(fields)
            ? (fields as mysql.FieldPacket[])
            : [];

        return {
            columns: resultFields.map((f) => f.name),
            rows: resultRows as Record<string, unknown>[],
            rowCount: resultRows.length,
            durationMs,
        };
    }

    async explainQuery(query: string): Promise<string> {
        this.ensureConnected();
        const [rows] = await this.pool!.query(`EXPLAIN ${query}`);
        return JSON.stringify(rows, null, 2);
    }

    async getTableStats(tableName?: string): Promise<TableStats[]> {
        this.ensureConnected();
        const whereClause = tableName ? "AND TABLE_NAME = ?" : "";
        const params = tableName ? [tableName] : [];

        const [rows] = await this.pool!.query(
            `
      SELECT 
        TABLE_NAME as table_name,
        TABLE_ROWS as row_count,
        DATA_LENGTH + INDEX_LENGTH as size_bytes,
        (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS s 
         WHERE s.TABLE_SCHEMA = t.TABLE_SCHEMA AND s.TABLE_NAME = t.TABLE_NAME) as index_count,
        UPDATE_TIME as last_analyzed
      FROM information_schema.TABLES t
      WHERE TABLE_SCHEMA = DATABASE() ${whereClause}
      ORDER BY TABLE_NAME
    `,
            params
        );

        return (rows as mysql.RowDataPacket[]).map((row) => ({
            tableName: row.table_name as string,
            rowCount: Number(row.row_count || 0),
            sizeBytes: Number(row.size_bytes || 0),
            indexCount: Number(row.index_count || 0),
            lastAnalyzed: row.last_analyzed
                ? String(row.last_analyzed)
                : undefined,
        }));
    }
}
