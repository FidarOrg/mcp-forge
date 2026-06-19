import { cleanDescription, sanitizeIdentifier } from "../utils/naming";
import type { ParamSpec, ParamType, ToolSpec } from "../types";

const NOT_IMPLEMENTED =
  "introspection is not yet implemented — contributions welcome! See CONTRIBUTING.md to add a provider.";

/**
 * Connect to a database, introspect its schema, and emit CRUD MCP tools.
 * Postgres and SQLite are implemented; MySQL/MongoDB are intentionally stubbed
 * with a friendly pointer so the community can extend them.
 */
export async function introspectDatabase(
  provider: string,
  uri: string,
): Promise<ToolSpec[]> {
  switch (provider) {
    case "postgres":
      return introspectPostgres(uri);
    case "sqlite":
      return introspectSqlite(uri);
    case "mysql":
      throw new Error(`MySQL ${NOT_IMPLEMENTED}`);
    case "mongodb":
      throw new Error(`MongoDB ${NOT_IMPLEMENTED}`);
    default:
      throw new Error(
        `Unknown provider "${provider}". Supported: postgres, sqlite (mysql, mongodb coming soon).`,
      );
  }
}

interface Column {
  /** Sanitized name — the MCP argument key. */
  name: string;
  /** Original DB column name — used verbatim in generated SQL. */
  column: string;
  type: ParamType;
  nullable: boolean;
  isPrimaryKey: boolean;
}

async function introspectPostgres(uri: string): Promise<ToolSpec[]> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: uri });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Could not connect to Postgres (${(err as Error).message}). ` +
        `Check the --uri host/port/credentials and that the database is reachable.`,
    );
  }
  try {
    const columnsRes = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`,
    );

    const pkRes = await client.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT kcu.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'`,
    );

    const primaryKeys = new Map<string, Set<string>>();
    for (const row of pkRes.rows) {
      if (!primaryKeys.has(row.table_name)) {
        primaryKeys.set(row.table_name, new Set());
      }
      primaryKeys.get(row.table_name)!.add(row.column_name);
    }

    const tables = new Map<string, Column[]>();
    for (const row of columnsRes.rows) {
      const pk = primaryKeys.get(row.table_name);
      const col: Column = {
        name: sanitizeIdentifier(row.column_name),
        column: row.column_name,
        type: mapPgType(row.data_type),
        nullable: row.is_nullable === "YES",
        isPrimaryKey: pk?.has(row.column_name) ?? false,
      };
      if (!tables.has(row.table_name)) tables.set(row.table_name, []);
      tables.get(row.table_name)!.push(col);
    }

    const tools: ToolSpec[] = [];
    for (const [table, columns] of tables) {
      tools.push(...buildCrudTools(table, columns));
    }
    return tools;
  } finally {
    await client.end();
  }
}

function buildCrudTools(table: string, columns: Column[]): ToolSpec[] {
  const safeTable = sanitizeIdentifier(table);
  const keyCols = columns.filter((c) => c.isPrimaryKey);
  const nonKeyCols = columns.filter((c) => !c.isPrimaryKey);

  const keyParams: ParamSpec[] = keyCols.map((c) => ({
    name: c.name,
    origName: c.column,
    type: c.type,
    required: true,
    description: cleanDescription(`Primary key (${c.name}) of ${table}`),
  }));

  const tools: ToolSpec[] = [];

  // list_<table>: always available.
  tools.push({
    name: `list_${safeTable}`,
    description: `List rows from the ${table} table.`,
    params: [
      { name: "limit", type: "integer", required: false, description: "Max rows to return." },
      { name: "offset", type: "integer", required: false, description: "Rows to skip." },
    ],
    source: "database",
    operation: "list",
    table,
  });

  // create_<table>: always available.
  tools.push({
    name: `create_${safeTable}`,
    description: `Insert a new row into the ${table} table.`,
    params: nonKeyCols.map((c) => ({
      name: c.name,
      origName: c.column,
      type: c.type,
      required: !c.nullable,
    })),
    source: "database",
    operation: "create",
    table,
  });

  // get/update/delete need a primary key to address a single row.
  if (keyCols.length > 0) {
    tools.push({
      name: `get_${safeTable}`,
      description: `Fetch a single ${table} row by primary key.`,
      params: keyParams,
      source: "database",
      operation: "get",
      table,
    });
    tools.push({
      name: `update_${safeTable}`,
      description: `Update a ${table} row by primary key.`,
      params: [
        ...keyParams,
        ...nonKeyCols.map((c) => ({
          name: c.name,
          origName: c.column,
          type: c.type,
          required: false,
        })),
      ],
      source: "database",
      operation: "update",
      table,
    });
    tools.push({
      name: `delete_${safeTable}`,
      description: `Delete a ${table} row by primary key.`,
      params: keyParams,
      source: "database",
      operation: "delete",
      table,
    });
  }

  return tools;
}

function mapPgType(dataType: string): ParamType {
  const t = dataType.toLowerCase();
  if (/(int|serial|bigint|smallint)/.test(t)) return "integer";
  if (/(numeric|decimal|real|double)/.test(t)) return "number";
  if (t === "boolean") return "boolean";
  if (/json/.test(t)) return "object";
  if (t.includes("array")) return "array";
  return "string";
}

async function introspectSqlite(uri: string): Promise<ToolSpec[]> {
  // Accept a bare path or sqlite:/file: URIs.
  const file = uri.replace(/^sqlite:(\/\/)?/i, "").replace(/^file:/i, "") || uri;

  let Database: new (path: string, opts?: object) => SqliteDb;
  try {
    Database = (await import("better-sqlite3")).default as unknown as typeof Database;
  } catch (err) {
    throw new Error(
      `SQLite support needs the "better-sqlite3" package (${(err as Error).message}). ` +
        `Reinstall mcpfoundry, or run: npm i better-sqlite3`,
    );
  }

  let db: SqliteDb;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch (err) {
    throw new Error(
      `Could not open SQLite database at "${file}" (${(err as Error).message}).`,
    );
  }

  try {
    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[];

    const tools: ToolSpec[] = [];
    for (const { name: table } of tableRows) {
      const info = db
        .prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)
        .all() as { name: string; type: string; notnull: number; pk: number }[];
      const columns: Column[] = info.map((c) => ({
        name: sanitizeIdentifier(c.name),
        column: c.name,
        type: mapSqliteType(c.type),
        nullable: c.notnull === 0,
        isPrimaryKey: c.pk > 0,
      }));
      tools.push(...buildCrudTools(table, columns));
    }
    return tools;
  } finally {
    db.close();
  }
}

/** Minimal structural type for the bits of better-sqlite3 we use. */
interface SqliteDb {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}

function mapSqliteType(declared: string): ParamType {
  const t = (declared || "").toUpperCase();
  if (/INT/.test(t)) return "integer";
  if (/(REAL|FLOA|DOUB|NUM|DEC)/.test(t)) return "number";
  if (/BOOL/.test(t)) return "boolean";
  return "string";
}
