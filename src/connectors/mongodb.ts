// ============================================================================
// MongoDB Connector
// ============================================================================

import {
    MongoClient,
    type Db,
    type Document,
    type Collection,
} from "mongodb";
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

export class MongoDBConnector extends DatabaseConnector {
    readonly type = "mongodb" as const;
    private client: MongoClient | null = null;
    private db: Db | null = null;

    constructor(config: ConnectionConfig) {
        super(config);
    }

    async connect(): Promise<void> {
        const uri =
            this._config.connectionString ||
            `mongodb://${this._config.user || ""}${this._config.password ? ":" + this._config.password : ""}${this._config.user ? "@" : ""}${this._config.host || "localhost"}:${this._config.port || 27017}`;

        this.client = new MongoClient(uri);
        await this.client.connect();
        this._databaseName = this._config.database || "test";
        this.db = this.client.db(this._databaseName);

        // Verify connection
        await this.db.command({ ping: 1 });
        this._connected = true;
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.db = null;
        }
        this._connected = false;
    }

    async listTables(): Promise<TableInfo[]> {
        this.ensureConnected();
        const collections = await this.db!.listCollections().toArray();

        const results: TableInfo[] = [];
        for (const col of collections) {
            let rowCount = 0;
            try {
                rowCount = await this.db!.collection(col.name).estimatedDocumentCount();
            } catch {
                // Skip if can't count
            }

            const stats = await this.db!
                .collection(col.name)
                .aggregate([{ $collStats: { storageStats: {} } }])
                .toArray()
                .catch(() => []);

            results.push({
                name: col.name,
                type: "collection",
                rowCount,
                sizeBytes: stats[0]?.storageStats?.size || undefined,
            });
        }

        return results.sort((a, b) => a.name.localeCompare(b.name));
    }

    async describeTable(tableName: string): Promise<ColumnInfo[]> {
        this.ensureConnected();
        // Sample documents to infer schema
        const docs = await this.db!.collection(tableName)
            .aggregate([{ $sample: { size: 100 } }])
            .toArray();

        if (docs.length === 0) {
            return [
                {
                    name: "_id",
                    type: "ObjectId",
                    nullable: false,
                    defaultValue: null,
                    isPrimaryKey: true,
                    isForeignKey: false,
                },
            ];
        }

        // Infer field types from sampled docs
        const fieldMap = new Map<
            string,
            { types: Set<string>; nullable: boolean; count: number }
        >();

        for (const doc of docs) {
            this.extractFields(doc, "", fieldMap, docs.length);
        }

        const columns: ColumnInfo[] = [];
        for (const [name, info] of fieldMap) {
            columns.push({
                name,
                type: Array.from(info.types).join(" | "),
                nullable: info.nullable || info.count < docs.length,
                defaultValue: null,
                isPrimaryKey: name === "_id",
                isForeignKey: false,
            });
        }

        return columns.sort((a, b) => {
            if (a.name === "_id") return -1;
            if (b.name === "_id") return 1;
            return a.name.localeCompare(b.name);
        });
    }

    private extractFields(
        doc: Document,
        prefix: string,
        fieldMap: Map<string, { types: Set<string>; nullable: boolean; count: number }>,
        totalDocs: number
    ): void {
        for (const [key, value] of Object.entries(doc)) {
            const fieldName = prefix ? `${prefix}.${key}` : key;
            const existing = fieldMap.get(fieldName) || {
                types: new Set<string>(),
                nullable: false,
                count: 0,
            };

            if (value === null || value === undefined) {
                existing.nullable = true;
            } else {
                const typeName = Array.isArray(value)
                    ? "Array"
                    : typeof value === "object" && value.constructor?.name === "ObjectId"
                        ? "ObjectId"
                        : typeof value === "object" && value instanceof Date
                            ? "Date"
                            : typeof value === "object"
                                ? "Object"
                                : typeof value;
                existing.types.add(typeName);
            }

            existing.count++;
            fieldMap.set(fieldName, existing);
        }
    }

    async getIndexes(tableName: string): Promise<IndexInfo[]> {
        this.ensureConnected();
        const indexes = await this.db!.collection(tableName).indexes();

        return indexes.map((idx) => ({
            name: idx.name || "unknown",
            columns: Object.keys(idx.key || {}),
            isUnique: Boolean(idx.unique),
            isPrimary: idx.name === "_id_",
            type: Object.values(idx.key || {}).includes("text") ? "text" : "btree",
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

    async runQuery(query: string): Promise<QueryResult> {
        this.ensureConnected();
        const start = Date.now();

        // Parse the MongoDB query string (JSON format)
        // Expected format: { "collection": "name", "operation": "find|aggregate|count", "query": {}, "options": {} }
        let parsed: {
            collection: string;
            operation?: string;
            query?: Document;
            pipeline?: Document[];
            options?: Document;
        };

        try {
            parsed = JSON.parse(query);
        } catch {
            throw new Error(
                'MongoDB queries must be JSON: { "collection": "name", "operation": "find", "query": {} }'
            );
        }

        const collection = this.db!.collection(parsed.collection);
        let rows: Document[];

        switch (parsed.operation || "find") {
            case "find":
                rows = await collection
                    .find(parsed.query || {})
                    .limit(
                        (parsed.options?.limit as number) || 100
                    )
                    .toArray();
                break;
            case "aggregate":
                rows = await collection
                    .aggregate(parsed.pipeline || [])
                    .toArray();
                break;
            case "count":
                const count = await collection.countDocuments(parsed.query || {});
                rows = [{ count }];
                break;
            case "distinct":
                const field = (parsed.options?.field as string) || "_id";
                const values = await collection.distinct(field, parsed.query || {});
                rows = values.map((v) => ({ [field]: v }));
                break;
            default:
                throw new Error(
                    `Unsupported operation: ${parsed.operation}. Use find, aggregate, count, or distinct.`
                );
        }

        const durationMs = Date.now() - start;
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

        // Convert ObjectIds to strings for JSON serialization
        const serializedRows = rows.map((row) => {
            const serialized: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(row)) {
                serialized[key] =
                    value && typeof value === "object" && "toHexString" in value
                        ? String(value)
                        : value;
            }
            return serialized;
        });

        return {
            columns,
            rows: serializedRows,
            rowCount: serializedRows.length,
            durationMs,
        };
    }

    async explainQuery(query: string): Promise<string> {
        this.ensureConnected();
        let parsed: { collection: string; query?: Document };

        try {
            parsed = JSON.parse(query);
        } catch {
            throw new Error("MongoDB queries must be JSON format");
        }

        const explanation = await this.db!.collection(parsed.collection)
            .find(parsed.query || {})
            .explain("executionStats");

        return JSON.stringify(explanation, null, 2);
    }

    async getTableStats(tableName?: string): Promise<TableStats[]> {
        this.ensureConnected();
        const collections = tableName
            ? [{ name: tableName }]
            : await this.db!.listCollections().toArray();

        const stats: TableStats[] = [];
        for (const col of collections) {
            try {
                const count = await this.db!
                    .collection(col.name)
                    .estimatedDocumentCount();
                const collStats = await this.db!
                    .collection(col.name)
                    .aggregate([{ $collStats: { storageStats: {} } }])
                    .toArray()
                    .catch(() => []);
                const indexes = await this.db!.collection(col.name).indexes();

                stats.push({
                    tableName: col.name,
                    rowCount: count,
                    sizeBytes: collStats[0]?.storageStats?.size || undefined,
                    indexCount: indexes.length,
                });
            } catch {
                stats.push({
                    tableName: col.name,
                    rowCount: 0,
                });
            }
        }

        return stats;
    }
}
