# Changelog

## [1.1.0] — 2026-03-05

### Added
- 🔒 **SQL Safety & Query Validation** — Destructive queries (`DROP`, `TRUNCATE`, `ALTER`, `INSERT`, `UPDATE`, `DELETE`) are blocked by default. Set `readonly: false` to allow writes.
- ⭐ **MCP Prompts** — 4 pre-built prompt templates: `explore_database`, `optimize_performance`, `write_query`, `generate_report`
- 🎯 **ERD Generator** (`generate_erd`) — Generate Mermaid ER diagrams from database schema with FK relationship lines
- 🔍 **Search Data** (`search_data`) — Full-text search across all tables and text columns
- ⚙️ **Environment Config** — `DB_EXPLORER_READONLY`, `DB_EXPLORER_MAX_ROWS`, `DB_EXPLORER_MAX_ROW_LIMIT`, `DB_EXPLORER_TIMEOUT_MS`
- 📄 LICENSE and CHANGELOG
- ✅ Integration tests with SQLite

### Changed
- `run_query` now accepts a `readonly` parameter (default: `true`)
- Server version bumped to 1.1.0

## [1.0.0] — 2026-03-04

### Added
- Initial release
- 4 database connectors: PostgreSQL, MySQL, SQLite, MongoDB
- 11 MCP tools: `connect_database`, `disconnect_database`, `list_connections`, `list_tables`, `describe_table`, `get_schema`, `run_query`, `explain_query`, `get_table_stats`, `suggest_indexes`, `export_data`
- 1 MCP resource: `db://connections`
- Auto-LIMIT injection for SELECT queries
- Formatted table output for query results
