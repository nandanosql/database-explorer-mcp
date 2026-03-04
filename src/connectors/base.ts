// ============================================================================
// Abstract Database Connector Interface
// ============================================================================

import type {
    TableInfo,
    ColumnInfo,
    IndexInfo,
    QueryResult,
    TableStats,
    SchemaInfo,
    DatabaseType,
    ConnectionConfig,
} from "../types.js";

export abstract class DatabaseConnector {
    abstract readonly type: DatabaseType;
    protected _connected = false;
    protected _config: ConnectionConfig;
    protected _databaseName = "";

    constructor(config: ConnectionConfig) {
        this._config = config;
    }

    get isConnected(): boolean {
        return this._connected;
    }

    get databaseName(): string {
        return this._databaseName;
    }

    get config(): ConnectionConfig {
        return this._config;
    }

    abstract connect(): Promise<void>;
    abstract disconnect(): Promise<void>;

    abstract listTables(): Promise<TableInfo[]>;
    abstract describeTable(tableName: string): Promise<ColumnInfo[]>;
    abstract getIndexes(tableName: string): Promise<IndexInfo[]>;
    abstract getSchema(): Promise<SchemaInfo>;

    abstract runQuery(query: string, params?: unknown[]): Promise<QueryResult>;
    abstract explainQuery(query: string): Promise<string>;

    abstract getTableStats(tableName?: string): Promise<TableStats[]>;

    protected ensureConnected(): void {
        if (!this._connected) {
            throw new Error("Not connected to database. Use connect_database first.");
        }
    }
}
