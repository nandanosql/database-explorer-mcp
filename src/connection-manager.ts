// ============================================================================
// Connection Manager — Singleton for managing active DB connections
// ============================================================================

import { DatabaseConnector } from "./connectors/base.js";
import { PostgreSQLConnector } from "./connectors/postgresql.js";
import { MySQLConnector } from "./connectors/mysql.js";
import { SQLiteConnector } from "./connectors/sqlite.js";
import { MongoDBConnector } from "./connectors/mongodb.js";
import type { ConnectionConfig, ConnectionInfo, ServerConfig } from "./types.js";
import { DEFAULT_SERVER_CONFIG } from "./types.js";

export class ConnectionManager {
    private static instance: ConnectionManager;
    private connections: Map<string, DatabaseConnector> = new Map();
    private _config: ServerConfig = DEFAULT_SERVER_CONFIG;

    private constructor() { }

    static getInstance(): ConnectionManager {
        if (!ConnectionManager.instance) {
            ConnectionManager.instance = new ConnectionManager();
        }
        return ConnectionManager.instance;
    }

    setConfig(config: Partial<ServerConfig>): void {
        this._config = { ...this._config, ...config };
    }

    get serverConfig(): ServerConfig {
        return this._config;
    }

    async addConnection(config: ConnectionConfig): Promise<string> {
        const alias = config.alias || "default";

        // Disconnect existing connection with same alias
        if (this.connections.has(alias)) {
            await this.removeConnection(alias);
        }

        let connector: DatabaseConnector;

        switch (config.type) {
            case "postgresql":
                connector = new PostgreSQLConnector(config);
                break;
            case "mysql":
                connector = new MySQLConnector(config);
                break;
            case "sqlite":
                connector = new SQLiteConnector(config);
                break;
            case "mongodb":
                connector = new MongoDBConnector(config);
                break;
            default:
                throw new Error(`Unsupported database type: ${config.type}`);
        }

        await connector.connect();
        this.connections.set(alias, connector);
        return alias;
    }

    getConnection(alias?: string): DatabaseConnector {
        const key = alias || "default";
        const connector = this.connections.get(key);
        if (!connector) {
            const available = this.listConnectionAliases();
            throw new Error(
                `No connection found with alias "${key}". Available: ${available.length > 0 ? available.join(", ") : "none (use connect_database first)"}`
            );
        }
        return connector;
    }

    async removeConnection(alias: string): Promise<void> {
        const connector = this.connections.get(alias);
        if (connector) {
            try {
                await connector.disconnect();
            } catch {
                // Ignore disconnect errors
            }
            this.connections.delete(alias);
        }
    }

    listConnectionAliases(): string[] {
        return Array.from(this.connections.keys());
    }

    listConnections(): ConnectionInfo[] {
        return Array.from(this.connections.entries()).map(([alias, connector]) => ({
            alias,
            type: connector.type,
            database: connector.databaseName,
            host: connector.config.host,
            port: connector.config.port,
            connected: connector.isConnected,
        }));
    }

    async disconnectAll(): Promise<void> {
        for (const [alias] of this.connections) {
            await this.removeConnection(alias);
        }
    }
}
