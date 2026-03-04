// ============================================================================
// Integration Tests — SQLite-based end-to-end testing
// ============================================================================

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { SQLiteConnector } from "../build/connectors/sqlite.js";
import { ConnectionManager } from "../build/connection-manager.js";
import { DANGEROUS_SQL_PATTERNS } from "../build/types.js";

// ── Test Database Setup ─────────────────────────────────────────────────────

const TEST_DB_PATH = "/tmp/mcp-test-db.sqlite";

function createTestDatabase() {
    const db = new Database(TEST_DB_PATH);

    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      full_name TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT,
      stock INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

    INSERT OR IGNORE INTO users (username, email, full_name) VALUES
      ('alice', 'alice@example.com', 'Alice Johnson'),
      ('bob', 'bob@example.com', 'Bob Smith'),
      ('charlie', 'charlie@example.com', 'Charlie Brown'),
      ('diana', 'diana@example.com', 'Diana Prince');

    INSERT OR IGNORE INTO products (name, description, price, category, stock) VALUES
      ('Laptop Pro', 'High-performance laptop', 1299.99, 'Electronics', 50),
      ('Wireless Mouse', 'Ergonomic wireless mouse', 29.99, 'Accessories', 200),
      ('USB-C Hub', '7-in-1 USB-C hub', 49.99, 'Accessories', 150),
      ('Monitor 4K', '27-inch 4K monitor', 499.99, 'Electronics', 30),
      ('Keyboard MX', 'Mechanical keyboard', 149.99, 'Accessories', 100);

    INSERT OR IGNORE INTO orders (user_id, total_amount, status) VALUES
      (1, 1329.98, 'completed'),
      (2, 549.98, 'completed'),
      (1, 49.99, 'pending'),
      (3, 1299.99, 'shipped');

    INSERT OR IGNORE INTO order_items (order_id, product_id, quantity, unit_price) VALUES
      (1, 1, 1, 1299.99),
      (1, 2, 1, 29.99),
      (2, 4, 1, 499.99),
      (2, 3, 1, 49.99),
      (3, 3, 1, 49.99),
      (4, 1, 1, 1299.99);
  `);

    db.close();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Database Explorer MCP — Integration Tests", () => {
    /** @type {import('../build/connectors/sqlite.js').SQLiteConnector} */
    let connector;

    before(async () => {
        createTestDatabase();
        connector = new SQLiteConnector({
            type: "sqlite",
            filepath: TEST_DB_PATH,
        });
        await connector.connect();
    });

    after(async () => {
        await connector.disconnect();
        // Clean up test DB
        const fs = await import("node:fs");
        try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
    });

    // ── Connection Tests ──────────────────────────────────────────────────

    test("connects to SQLite database", () => {
        assert.equal(connector.isConnected, true);
        assert.equal(connector.type, "sqlite");
        assert.ok(connector.databaseName.includes("mcp-test-db"));
    });

    // ── Schema Tests ──────────────────────────────────────────────────────

    test("lists all tables", async () => {
        const tables = await connector.listTables();
        const tableNames = tables.map((t) => t.name);

        assert.ok(tableNames.includes("users"), "Should include users table");
        assert.ok(tableNames.includes("products"), "Should include products table");
        assert.ok(tableNames.includes("orders"), "Should include orders table");
        assert.ok(tableNames.includes("order_items"), "Should include order_items table");
        assert.equal(tables.length, 4);

        // Check row counts
        const usersTable = tables.find((t) => t.name === "users");
        assert.ok(usersTable);
        assert.equal(usersTable.rowCount, 4);
    });

    test("describes table with columns and types", async () => {
        const columns = await connector.describeTable("users");

        assert.ok(columns.length >= 5, "users table should have at least 5 columns");

        const idCol = columns.find((c) => c.name === "id");
        assert.ok(idCol);
        assert.equal(idCol.isPrimaryKey, true);

        const emailCol = columns.find((c) => c.name === "email");
        assert.ok(emailCol);
        assert.equal(emailCol.type, "TEXT");
        assert.equal(emailCol.nullable, false);
    });

    test("describes table with foreign keys", async () => {
        const columns = await connector.describeTable("orders");
        const userIdCol = columns.find((c) => c.name === "user_id");

        assert.ok(userIdCol);
        assert.equal(userIdCol.isForeignKey, true);
        assert.equal(userIdCol.foreignKeyRef, "users.id");
    });

    test("gets indexes for a table", async () => {
        const indexes = await connector.getIndexes("orders");
        assert.ok(indexes.length >= 2, "orders should have at least 2 indexes");

        const statusIdx = indexes.find((i) => i.columns.includes("status"));
        assert.ok(statusIdx, "Should have status index");
    });

    test("gets full database schema", async () => {
        const schema = await connector.getSchema();

        assert.equal(schema.databaseType, "sqlite");
        assert.equal(schema.tables.length, 4);

        const ordersSchema = schema.tables.find((t) => t.name === "orders");
        assert.ok(ordersSchema);
        assert.ok(ordersSchema.columns.length >= 4);
        assert.ok(ordersSchema.indexes.length >= 2);
    });

    // ── Query Tests ───────────────────────────────────────────────────────

    test("runs SELECT query", async () => {
        const result = await connector.runQuery(
            "SELECT username, email FROM users ORDER BY username LIMIT 2"
        );

        assert.equal(result.rowCount, 2);
        assert.deepEqual(result.columns, ["username", "email"]);
        assert.equal(result.rows[0].username, "alice");
        assert.equal(result.rows[1].username, "bob");
        assert.ok(result.durationMs >= 0);
    });

    test("runs JOIN query", async () => {
        const result = await connector.runQuery(`
      SELECT u.username, o.total_amount, o.status
      FROM orders o
      JOIN users u ON u.id = o.user_id
      ORDER BY o.total_amount DESC
      LIMIT 5
    `);

        assert.ok(result.rowCount > 0);
        assert.ok(result.columns.includes("username"));
        assert.ok(result.columns.includes("total_amount"));
    });

    test("runs aggregate query", async () => {
        const result = await connector.runQuery(
            "SELECT status, COUNT(*) as count FROM orders GROUP BY status"
        );

        assert.ok(result.rowCount >= 2);
        assert.ok(result.columns.includes("status"));
        assert.ok(result.columns.includes("count"));
    });

    test("runs INSERT query (write mode)", async () => {
        const result = await connector.runQuery(
            "INSERT INTO users (username, email, full_name) VALUES ('eve', 'eve@example.com', 'Eve Wilson')"
        );

        assert.equal(result.rows[0].changes, 1);
    });

    test("explains query plan", async () => {
        const plan = await connector.explainQuery(
            "SELECT * FROM orders WHERE user_id = 1"
        );

        assert.ok(plan.length > 0, "Should return a query plan");
        assert.ok(typeof plan === "string");
    });

    // ── Stats Tests ───────────────────────────────────────────────────────

    test("gets table stats for all tables", async () => {
        const stats = await connector.getTableStats();

        assert.ok(stats.length >= 4);
        const usersStats = stats.find((s) => s.tableName === "users");
        assert.ok(usersStats);
        assert.ok(usersStats.rowCount >= 4);
        assert.ok(usersStats.indexCount !== undefined);
    });

    test("gets table stats for specific table", async () => {
        const stats = await connector.getTableStats("products");

        assert.equal(stats.length, 1);
        assert.equal(stats[0].tableName, "products");
        assert.equal(stats[0].rowCount, 5);
    });

    // ── SQL Safety Tests ──────────────────────────────────────────────────

    describe("SQL Safety Validation", () => {

        test("blocks DROP statements", () => {
            const query = "DROP TABLE users";
            const match = DANGEROUS_SQL_PATTERNS.some((p) => p.pattern.test(query));
            assert.equal(match, true, "DROP should be blocked");
        });

        test("blocks TRUNCATE statements", () => {
            const query = "TRUNCATE TABLE users";
            const match = DANGEROUS_SQL_PATTERNS.some((p) => p.pattern.test(query));
            assert.equal(match, true, "TRUNCATE should be blocked");
        });

        test("blocks ALTER statements", () => {
            const query = "ALTER TABLE users ADD COLUMN age INTEGER";
            const match = DANGEROUS_SQL_PATTERNS.some((p) => p.pattern.test(query));
            assert.equal(match, true, "ALTER should be blocked");
        });

        test("blocks INSERT statements", () => {
            const query = "INSERT INTO users (name) VALUES ('test')";
            const match = DANGEROUS_SQL_PATTERNS.some((p) => p.pattern.test(query));
            assert.equal(match, true, "INSERT should be blocked");
        });

        test("allows SELECT statements", () => {
            const query = "SELECT * FROM users WHERE id = 1";
            const match = DANGEROUS_SQL_PATTERNS.some((p) => p.pattern.test(query));
            assert.equal(match, false, "SELECT should be allowed");
        });

        test("allows EXPLAIN statements", () => {
            const query = "EXPLAIN SELECT * FROM users";
            const match = DANGEROUS_SQL_PATTERNS.some((p) => p.pattern.test(query));
            assert.equal(match, false, "EXPLAIN should be allowed");
        });
    });

    // ── Connection Manager Tests ──────────────────────────────────────────

    describe("ConnectionManager", () => {
        test("connects via connection manager", async () => {
            const manager = ConnectionManager.getInstance();
            const alias = await manager.addConnection({
                type: "sqlite",
                alias: "test-managed",
                filepath: TEST_DB_PATH,
            });

            assert.equal(alias, "test-managed");

            const conn = manager.getConnection("test-managed");
            assert.equal(conn.isConnected, true);

            const tables = await conn.listTables();
            assert.ok(tables.length >= 4);

            await manager.removeConnection("test-managed");
        });

        test("lists connections", async () => {
            const manager = ConnectionManager.getInstance();
            await manager.addConnection({
                type: "sqlite",
                alias: "test-list",
                filepath: TEST_DB_PATH,
            });

            const connections = manager.listConnections();
            const testConn = connections.find((c) => c.alias === "test-list");
            assert.ok(testConn);
            assert.equal(testConn.type, "sqlite");
            assert.equal(testConn.connected, true);

            await manager.removeConnection("test-list");
        });

        test("throws on missing connection", () => {
            const manager = ConnectionManager.getInstance();
            assert.throws(() => manager.getConnection("nonexistent"), {
                message: /No connection found/,
            });
        });

        test("stores server config", () => {
            const manager = ConnectionManager.getInstance();
            manager.setConfig({ readOnlyByDefault: false, defaultRowLimit: 50 });

            assert.equal(manager.serverConfig.readOnlyByDefault, false);
            assert.equal(manager.serverConfig.defaultRowLimit, 50);

            // Reset
            manager.setConfig({ readOnlyByDefault: true, defaultRowLimit: 100 });
        });
    });
});
