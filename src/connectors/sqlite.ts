// ============================================================================
// SQLite Connector
// ============================================================================

import Database from "better-sqlite3";
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
import path from "path";

export class SQLiteConnector extends DatabaseConnector {
    readonly type = "sqlite" as const;
    private db: Database.Database | null = null;

    constructor(config: ConnectionConfig) {
        super(config);
    }

    async connect(): Promise<void> {
        const filepath = this._config.filepath || this._config.database || ":memory:";
        this.db = new Database(filepath, { readonly: false });
        this.db.pragma("journal_mode = WAL");
        this._databaseName = filepath === ":memory:" ? ":memory:" : path.basename(filepath);
        this._connected = true;
    }

    async disconnect(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        this._connected = false;
    }

    async listTables(): Promise<TableInfo[]> {
        this.ensureConnected();
        const rows = this.db!.prepare(`
      SELECT name, type 
      FROM sqlite_master 
      WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string; type: string }>;

        return rows.map((row) => {
            let rowCount = 0;
            try {
                const countResult = this.db!.prepare(
                    `SELECT COUNT(*) as count FROM "${row.name}"`
                ).get() as { count: number };
                rowCount = countResult.count;
            } catch {
                // View or inaccessible table
            }

            return {
                name: row.name,
                type: row.type as "table" | "view",
                rowCount,
            };
        });
    }

    async describeTable(tableName: string): Promise<ColumnInfo[]> {
        this.ensureConnected();
        const columns = this.db!.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
            cid: number;
            name: string;
            type: string;
            notnull: number;
            dflt_value: string | null;
            pk: number;
        }>;

        // Get foreign keys
        const foreignKeys = this.db!.prepare(
            `PRAGMA foreign_key_list("${tableName}")`
        ).all() as Array<{
            id: number;
            seq: number;
            table: string;
            from: string;
            to: string;
        }>;

        const fkMap = new Map<string, string>();
        for (const fk of foreignKeys) {
            fkMap.set(fk.from, `${fk.table}.${fk.to}`);
        }

        return columns.map((col) => ({
            name: col.name,
            type: col.type || "TEXT",
            nullable: col.notnull === 0,
            defaultValue: col.dflt_value,
            isPrimaryKey: col.pk > 0,
            isForeignKey: fkMap.has(col.name),
            foreignKeyRef: fkMap.get(col.name),
        }));
    }

    async getIndexes(tableName: string): Promise<IndexInfo[]> {
        this.ensureConnected();
        const indexes = this.db!.prepare(
            `PRAGMA index_list("${tableName}")`
        ).all() as Array<{
            seq: number;
            name: string;
            unique: number;
            origin: string;
        }>;

        return indexes.map((idx) => {
            const indexInfo = this.db!.prepare(
                `PRAGMA index_info("${idx.name}")`
            ).all() as Array<{ seqno: number; cid: number; name: string }>;

            return {
                name: idx.name,
                columns: indexInfo.map((i) => i.name),
                isUnique: idx.unique === 1,
                isPrimary: idx.origin === "pk",
                type: "btree",
            };
        });
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

    async runQuery(query: string): Promise<QueryResult> {
        this.ensureConnected();
        const start = Date.now();
        const trimmed = query.trim().toUpperCase();
        const isSelect =
            trimmed.startsWith("SELECT") ||
            trimmed.startsWith("PRAGMA") ||
            trimmed.startsWith("EXPLAIN") ||
            trimmed.startsWith("WITH");

        let result: QueryResult;

        if (isSelect) {
            const rows = this.db!.prepare(query).all() as Record<string, unknown>[];
            const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
            result = {
                columns,
                rows,
                rowCount: rows.length,
                durationMs: Date.now() - start,
            };
        } else {
            const info = this.db!.prepare(query).run();
            result = {
                columns: ["changes", "lastInsertRowid"],
                rows: [{ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }],
                rowCount: 1,
                durationMs: Date.now() - start,
            };
        }

        return result;
    }

    async explainQuery(query: string): Promise<string> {
        this.ensureConnected();
        const rows = this.db!.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as Array<{
            id: number;
            parent: number;
            notused: number;
            detail: string;
        }>;
        return rows.map((r) => r.detail).join("\n");
    }

    async getTableStats(tableName?: string): Promise<TableStats[]> {
        this.ensureConnected();
        const tables = tableName
            ? [{ name: tableName, type: "table" as const }]
            : ((
                this.db!.prepare(
                    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
                ).all() as Array<{ name: string }>
            ).map((r) => ({ name: r.name, type: "table" as const })));

        return tables.map((table) => {
            let rowCount = 0;
            try {
                const result = this.db!.prepare(
                    `SELECT COUNT(*) as count FROM "${table.name}"`
                ).get() as { count: number };
                rowCount = result.count;
            } catch {
                // skip inaccessible tables
            }

            const indexes = this.db!.prepare(
                `PRAGMA index_list("${table.name}")`
            ).all();

            return {
                tableName: table.name,
                rowCount,
                indexCount: indexes.length,
            };
        });
    }
}
