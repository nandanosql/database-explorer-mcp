// ============================================================================
// PostgreSQL Connector
// ============================================================================

import pg from "pg";
import { DatabaseConnector } from "./base.js";
import type {
    ConnectionConfig,
    TableInfo,
    ColumnInfo,
    IndexInfo,
    QueryResult,
    TableStats,
    SchemaInfo,
    DEFAULT_ROW_LIMIT,
} from "../types.js";

const { Pool } = pg;

export class PostgreSQLConnector extends DatabaseConnector {
    readonly type = "postgresql" as const;
    private pool: pg.Pool | null = null;

    constructor(config: ConnectionConfig) {
        super(config);
    }

    async connect(): Promise<void> {
        const connectionConfig: pg.PoolConfig = this._config.connectionString
            ? { connectionString: this._config.connectionString }
            : {
                host: this._config.host || "localhost",
                port: this._config.port || 5432,
                database: this._config.database || "postgres",
                user: this._config.user || "postgres",
                password: this._config.password || "",
            };

        this.pool = new Pool({ ...connectionConfig, max: 5 });

        // Test connection
        const client = await this.pool.connect();
        const result = await client.query("SELECT current_database()");
        this._databaseName = result.rows[0].current_database;
        client.release();
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
        const result = await this.pool!.query(`
      SELECT 
        t.table_name as name,
        t.table_type,
        COALESCE(s.n_live_tup, 0) as row_count,
        pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::bigint as size_bytes
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
      WHERE t.table_schema = 'public'
      ORDER BY t.table_name
    `);

        return result.rows.map((row: Record<string, unknown>) => ({
            name: row.name as string,
            type: (row.table_type === "VIEW" ? "view" : "table") as "table" | "view",
            rowCount: Number(row.row_count),
            sizeBytes: Number(row.size_bytes),
        }));
    }

    async describeTable(tableName: string): Promise<ColumnInfo[]> {
        this.ensureConnected();
        const result = await this.pool!.query(
            `
      SELECT 
        c.column_name as name,
        c.data_type as type,
        c.is_nullable = 'YES' as nullable,
        c.column_default as default_value,
        c.character_maximum_length as max_length,
        EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_name = c.table_name 
            AND kcu.column_name = c.column_name 
            AND tc.constraint_type = 'PRIMARY KEY'
        ) as is_primary_key,
        EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_name = c.table_name 
            AND kcu.column_name = c.column_name 
            AND tc.constraint_type = 'FOREIGN KEY'
        ) as is_foreign_key,
        (
          SELECT ccu.table_name || '.' || ccu.column_name
          FROM information_schema.referential_constraints rc
          JOIN information_schema.key_column_usage kcu ON rc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage ccu ON rc.unique_constraint_name = ccu.constraint_name
          WHERE kcu.table_name = c.table_name AND kcu.column_name = c.column_name
          LIMIT 1
        ) as foreign_key_ref,
        pgd.description as comment
      FROM information_schema.columns c
      LEFT JOIN pg_catalog.pg_statio_all_tables st ON st.relname = c.table_name
      LEFT JOIN pg_catalog.pg_description pgd ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
      WHERE c.table_schema = 'public' AND c.table_name = $1
      ORDER BY c.ordinal_position
    `,
            [tableName]
        );

        return result.rows.map((row: Record<string, unknown>) => ({
            name: row.name as string,
            type: row.type as string,
            nullable: row.nullable as boolean,
            defaultValue: (row.default_value as string) || null,
            isPrimaryKey: row.is_primary_key as boolean,
            isForeignKey: row.is_foreign_key as boolean,
            foreignKeyRef: (row.foreign_key_ref as string) || undefined,
            maxLength: row.max_length ? Number(row.max_length) : undefined,
            comment: (row.comment as string) || undefined,
        }));
    }

    async getIndexes(tableName: string): Promise<IndexInfo[]> {
        this.ensureConnected();
        const result = await this.pool!.query(
            `
      SELECT
        i.relname as name,
        array_agg(a.attname ORDER BY x.ordinality) as columns,
        ix.indisunique as is_unique,
        ix.indisprimary as is_primary,
        am.amname as type
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON i.relam = am.oid
      CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
      WHERE t.relname = $1 AND t.relkind = 'r'
      GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname
      ORDER BY i.relname
    `,
            [tableName]
        );

        return result.rows.map((row: Record<string, unknown>) => ({
            name: row.name as string,
            columns: row.columns as string[],
            isUnique: row.is_unique as boolean,
            isPrimary: row.is_primary as boolean,
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
        const result = await this.pool!.query(query, params);
        const durationMs = Date.now() - start;

        return {
            columns: result.fields?.map((f: pg.FieldDef) => f.name) || [],
            rows: result.rows || [],
            rowCount: result.rowCount || 0,
            durationMs,
        };
    }

    async explainQuery(query: string): Promise<string> {
        this.ensureConnected();
        const result = await this.pool!.query(`EXPLAIN (ANALYZE false, FORMAT TEXT) ${query}`);
        return result.rows.map((r: Record<string, unknown>) => r["QUERY PLAN"]).join("\n");
    }

    async getTableStats(tableName?: string): Promise<TableStats[]> {
        this.ensureConnected();
        const whereClause = tableName ? "WHERE s.relname = $1" : "";
        const params = tableName ? [tableName] : [];

        const result = await this.pool!.query(
            `
      SELECT
        s.relname as table_name,
        s.n_live_tup as row_count,
        pg_total_relation_size(quote_ident(s.schemaname) || '.' || quote_ident(s.relname))::bigint as size_bytes,
        (SELECT count(*) FROM pg_indexes WHERE tablename = s.relname)::int as index_count,
        s.last_analyze::text as last_analyzed
      FROM pg_stat_user_tables s
      ${whereClause}
      ORDER BY s.relname
    `,
            params
        );

        return result.rows.map((row: Record<string, unknown>) => ({
            tableName: row.table_name as string,
            rowCount: Number(row.row_count),
            sizeBytes: Number(row.size_bytes),
            indexCount: Number(row.index_count),
            lastAnalyzed: (row.last_analyzed as string) || undefined,
        }));
    }
}
