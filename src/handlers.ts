/**
 * Working handler-body generators. The compiler calls these to turn each
 * ToolSpec into a real implementation (HTTP call for OpenAPI, parameterised SQL
 * for SQLite) instead of a TODO stub. Output is language-specific source code,
 * indented to drop straight into the tool template.
 */
import type { CompileContext, ToolSpec, ParamSpec } from "./types";

/** Quote a SQL identifier (table/column) with double quotes. */
function qid(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const wire = (p: ParamSpec): string => p.origName ?? p.name;

// ─── Node.js ────────────────────────────────────────────────────────────────

function nodeOpenApi(t: ToolSpec, ctx: CompileContext): string[] {
  const at = (loc: string) => t.params.filter((p) => p.location === loc);
  const L: string[] = [];
  L.push(`const base = process.env.BASE_URL ?? "";`);
  L.push(`let path = ${JSON.stringify(t.path ?? "")};`);
  for (const p of at("path")) {
    L.push(
      `path = path.replace(${JSON.stringify(`{${wire(p)}}`)}, encodeURIComponent(String(args.${p.name})));`,
    );
  }
  L.push(`const url = new URL(base + path);`);
  for (const p of at("query")) {
    L.push(
      `if (args.${p.name} !== undefined) url.searchParams.set(${JSON.stringify(wire(p))}, String(args.${p.name}));`,
    );
  }
  L.push(`const headers: Record<string, string> = { Accept: "application/json" };`);
  L.push(`if (process.env.API_AUTH) headers.Authorization = process.env.API_AUTH;`);
  for (const p of at("header")) {
    L.push(
      `if (args.${p.name} !== undefined) headers[${JSON.stringify(wire(p))}] = String(args.${p.name});`,
    );
  }
  const body = at("body");
  let init = `{ method: ${JSON.stringify(t.method ?? "GET")}, headers }`;
  if (body.length > 0) {
    L.push(`headers["Content-Type"] = "application/json";`);
    L.push(`const payload: Record<string, unknown> = {};`);
    for (const p of body) {
      L.push(`if (args.${p.name} !== undefined) payload[${JSON.stringify(wire(p))}] = args.${p.name};`);
    }
    init = `{ method: ${JSON.stringify(t.method ?? "GET")}, headers, body: JSON.stringify(payload) }`;
  }
  L.push(`const res = await fetch(url.toString(), ${init});`);
  L.push(`const text = "[" + res.status + "] " + (await res.text());`);
  L.push(`return { content: [{ type: "text", text: ${ctx.secure ? "applyCanary(text)" : "text"} }] };`);
  return L;
}

function nodeSqlite(t: ToolSpec, ctx: CompileContext): string[] {
  const L: string[] = [];
  const tbl = qid(t.table ?? "");
  const ret = (v: string) =>
    `return { content: [{ type: "text", text: ${ctx.secure ? `applyCanary(${v})` : v} }] };`;
  const pks = t.params.filter((p) => p.required);
  const whereSql = pks.map((p) => `${qid(wire(p))} = ?`).join(" AND ");
  const pkArgs = pks.map((p) => `args.${p.name}`).join(", ");

  switch (t.operation) {
    case "list":
      L.push(`const rows = db.prepare(${JSON.stringify(`SELECT * FROM ${tbl} LIMIT ? OFFSET ?`)}).all(args.limit ?? 100, args.offset ?? 0);`);
      L.push(`const text = JSON.stringify(rows, null, 2);`);
      L.push(ret("text"));
      break;
    case "get":
      L.push(`const row = db.prepare(${JSON.stringify(`SELECT * FROM ${tbl} WHERE ${whereSql}`)}).get(${pkArgs});`);
      L.push(`const text = JSON.stringify(row ?? null, null, 2);`);
      L.push(ret("text"));
      break;
    case "delete":
      L.push(`const info = db.prepare(${JSON.stringify(`DELETE FROM ${tbl} WHERE ${whereSql}`)}).run(${pkArgs});`);
      L.push(`const text = JSON.stringify({ changes: info.changes }, null, 2);`);
      L.push(ret("text"));
      break;
    case "create":
      L.push(`const cols: string[] = [];`);
      L.push(`const ph: string[] = [];`);
      L.push(`const vals: unknown[] = [];`);
      for (const p of t.params) {
        L.push(`if (args.${p.name} !== undefined) { cols.push(${JSON.stringify(qid(wire(p)))}); ph.push("?"); vals.push(args.${p.name}); }`);
      }
      L.push(`if (cols.length === 0) return { content: [{ type: "text", text: "No fields provided." }] };`);
      L.push(`const sql = ${JSON.stringify(`INSERT INTO ${tbl} (`)} + cols.join(", ") + ") VALUES (" + ph.join(", ") + ")";`);
      L.push(`const info = db.prepare(sql).run(...vals);`);
      L.push(`const text = JSON.stringify({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }, null, 2);`);
      L.push(ret("text"));
      break;
    case "update": {
      const nonpk = t.params.filter((p) => !p.required);
      L.push(`const set: string[] = [];`);
      L.push(`const vals: unknown[] = [];`);
      for (const p of nonpk) {
        L.push(`if (args.${p.name} !== undefined) { set.push(${JSON.stringify(`${qid(wire(p))} = ?`)}); vals.push(args.${p.name}); }`);
      }
      L.push(`if (set.length === 0) return { content: [{ type: "text", text: "No fields to update." }] };`);
      L.push(`const sql = ${JSON.stringify(`UPDATE ${tbl} SET `)} + set.join(", ") + ${JSON.stringify(` WHERE ${whereSql}`)};`);
      L.push(`const info = db.prepare(sql).run(...vals, ${pkArgs});`);
      L.push(`const text = JSON.stringify({ changes: info.changes }, null, 2);`);
      L.push(ret("text"));
      break;
    }
  }
  return L;
}

function nodeStub(t: ToolSpec, ctx: CompileContext): string[] {
  return [
    `// TODO: implement the real call for this tool.`,
    `const text = JSON.stringify({ tool: ${JSON.stringify(t.name)}, args }, null, 2);`,
    `return { content: [{ type: "text", text: ${ctx.secure ? "applyCanary(text)" : "text"} }] };`,
  ];
}

export function nodeHandlerBody(t: ToolSpec, ctx: CompileContext): string {
  let lines: string[];
  if (t.source === "openapi") lines = nodeOpenApi(t, ctx);
  else if (t.source === "database" && ctx.provider === "sqlite") lines = nodeSqlite(t, ctx);
  else lines = nodeStub(t, ctx);
  return lines.map((l) => `      ${l}`).join("\n");
}

// ─── Python ─────────────────────────────────────────────────────────────────

function pyOpenApi(t: ToolSpec, ctx: CompileContext): string[] {
  const at = (loc: string) => t.params.filter((p) => p.location === loc);
  const L: string[] = [];
  L.push(`base = os.environ.get("BASE_URL", "")`);
  L.push(`path = ${JSON.stringify(t.path ?? "")}`);
  for (const p of at("path")) {
    L.push(`path = path.replace(${JSON.stringify(`{${wire(p)}}`)}, str(${p.name}))`);
  }
  L.push(`query: dict = {}`);
  for (const p of at("query")) {
    L.push(`if ${p.name} is not None: query[${JSON.stringify(wire(p))}] = ${p.name}`);
  }
  L.push(`headers = {"Accept": "application/json"}`);
  L.push(`if os.environ.get("API_AUTH"): headers["Authorization"] = os.environ["API_AUTH"]`);
  for (const p of at("header")) {
    L.push(`if ${p.name} is not None: headers[${JSON.stringify(wire(p))}] = str(${p.name})`);
  }
  const body = at("body");
  let call = `resp = httpx.request(${JSON.stringify(t.method ?? "GET")}, base + path, params=query, headers=headers, timeout=30)`;
  if (body.length > 0) {
    L.push(`payload: dict = {}`);
    for (const p of body) {
      L.push(`if ${p.name} is not None: payload[${JSON.stringify(wire(p))}] = ${p.name}`);
    }
    call = `resp = httpx.request(${JSON.stringify(t.method ?? "GET")}, base + path, params=query, headers=headers, json=payload, timeout=30)`;
  }
  L.push(call);
  L.push(`result = "[" + str(resp.status_code) + "] " + resp.text`);
  L.push(`return ${ctx.secure ? "apply_canary(result)" : "result"}`);
  return L;
}

function pySqlite(t: ToolSpec, ctx: CompileContext): string[] {
  const L: string[] = [];
  const tbl = qid(t.table ?? "");
  const wrap = ctx.secure ? "apply_canary(result)" : "result";
  const pks = t.params.filter((p) => p.required);
  const whereSql = pks.map((p) => `${qid(wire(p))} = ?`).join(" AND ");
  const pkTuple = `(${pks.map((p) => p.name).join(", ")}${pks.length === 1 ? "," : ""})`;

  switch (t.operation) {
    case "list":
      L.push(`conn = _connect()`);
      L.push(`try:`);
      L.push(`    conn.row_factory = sqlite3.Row`);
      L.push(`    cur = conn.execute(${JSON.stringify(`SELECT * FROM ${tbl} LIMIT ? OFFSET ?`)}, (limit if limit is not None else 100, offset if offset is not None else 0))`);
      L.push(`    result = json.dumps([dict(r) for r in cur.fetchall()], indent=2, default=str)`);
      L.push(`finally:`);
      L.push(`    conn.close()`);
      L.push(`return ${wrap}`);
      break;
    case "get":
      L.push(`conn = _connect()`);
      L.push(`try:`);
      L.push(`    conn.row_factory = sqlite3.Row`);
      L.push(`    row = conn.execute(${JSON.stringify(`SELECT * FROM ${tbl} WHERE ${whereSql}`)}, ${pkTuple}).fetchone()`);
      L.push(`    result = json.dumps(dict(row) if row else None, indent=2, default=str)`);
      L.push(`finally:`);
      L.push(`    conn.close()`);
      L.push(`return ${wrap}`);
      break;
    case "delete":
      L.push(`conn = _connect()`);
      L.push(`try:`);
      L.push(`    cur = conn.execute(${JSON.stringify(`DELETE FROM ${tbl} WHERE ${whereSql}`)}, ${pkTuple})`);
      L.push(`    conn.commit()`);
      L.push(`    result = json.dumps({"changes": cur.rowcount}, indent=2)`);
      L.push(`finally:`);
      L.push(`    conn.close()`);
      L.push(`return ${wrap}`);
      break;
    case "create":
      L.push(`cols: list = []`);
      L.push(`ph: list = []`);
      L.push(`vals: list = []`);
      for (const p of t.params) {
        L.push(`if ${p.name} is not None: cols.append(${JSON.stringify(qid(wire(p)))}); ph.append("?"); vals.append(${p.name})`);
      }
      L.push(`if not cols:`);
      L.push(`    return "No fields provided."`);
      L.push(`conn = _connect()`);
      L.push(`try:`);
      L.push(`    cur = conn.execute(f'INSERT INTO ${tbl} ({", ".join(cols)}) VALUES ({", ".join(ph)})', vals)`);
      L.push(`    conn.commit()`);
      L.push(`    result = json.dumps({"lastrowid": cur.lastrowid, "changes": cur.rowcount}, indent=2)`);
      L.push(`finally:`);
      L.push(`    conn.close()`);
      L.push(`return ${wrap}`);
      break;
    case "update": {
      const nonpk = t.params.filter((p) => !p.required);
      L.push(`sets: list = []`);
      L.push(`vals: list = []`);
      for (const p of nonpk) {
        L.push(`if ${p.name} is not None: sets.append(${JSON.stringify(`${qid(wire(p))} = ?`)}); vals.append(${p.name})`);
      }
      L.push(`if not sets:`);
      L.push(`    return "No fields to update."`);
      L.push(`conn = _connect()`);
      L.push(`try:`);
      L.push(`    cur = conn.execute(f'UPDATE ${tbl} SET {", ".join(sets)} WHERE ${whereSql}', (*vals, ${pks.map((p) => p.name).join(", ")}))`);
      L.push(`    conn.commit()`);
      L.push(`    result = json.dumps({"changes": cur.rowcount}, indent=2)`);
      L.push(`finally:`);
      L.push(`    conn.close()`);
      L.push(`return ${wrap}`);
      break;
    }
  }
  return L;
}

function pyStub(t: ToolSpec, ctx: CompileContext): string[] {
  return [
    `args = ${pyArgsDict(t.params)}`,
    `result = json.dumps({"tool": ${JSON.stringify(t.name)}, "args": args}, indent=2)`,
    `return ${ctx.secure ? "apply_canary(result)" : "result"}`,
  ];
}

function pyArgsDict(params: ParamSpec[]): string {
  const entries = params.map((p) => `${JSON.stringify(p.name)}: ${p.name}`).join(", ");
  return `{${entries}}`;
}

export function pyHandlerBody(t: ToolSpec, ctx: CompileContext): string {
  let lines: string[];
  if (t.source === "openapi") lines = pyOpenApi(t, ctx);
  else if (t.source === "database" && ctx.provider === "sqlite") lines = pySqlite(t, ctx);
  else lines = pyStub(t, ctx);
  return lines.map((l) => `    ${l}`).join("\n");
}
