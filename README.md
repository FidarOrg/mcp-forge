<div align="center">

<img src="docs/banner.svg" alt="mcpfoundry" width="820" />

### Create **secure, production-ready MCP servers** from your database or API — in under 5 minutes. ⚒️

[![npm version](https://img.shields.io/npm/v/mcpfoundry?color=8b5cf6&label=npm)](https://www.npmjs.com/package/mcpfoundry)
[![npm downloads](https://img.shields.io/npm/dm/mcpfoundry?color=22d3ee)](https://www.npmjs.com/package/mcpfoundry)
[![license](https://img.shields.io/npm/l/mcpfoundry?color=brightgreen)](./LICENSE)
[![node](https://img.shields.io/node/v/mcpfoundry)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg)](./CONTRIBUTING.md)

[**Quick Start**](#-quick-start-60-seconds) · [Features](#-why-mcpfoundry) · [Security](#-the-ztai-security-shield-optional) · [Examples](#-two-ways-to-create) · [Contributing](./CONTRIBUTING.md)

</div>

---

<div align="center">

<!-- Static preview below. For an animated GIF, run `vhs docs/demo.tape` and swap in docs/demo.gif. -->
<img src="docs/demo.gif" alt="mcpfoundry in action — generate a secure MCP server from an OpenAPI spec" width="820" />

</div>

> **Stop hand-writing MCP servers.** Point `mcpfoundry` at a database or an OpenAPI spec and get a clean, runnable, *secure-by-option* MCP server whose tools **actually run** — real parameterised SQL or real HTTP calls, not `TODO` stubs. Node.js or Python. Zero boilerplate.

---

## ⚡ Quick Start (60 seconds)

```bash
npx mcpfoundry create \
  --type openapi \
  --input https://petstore3.swagger.io/api/v3/openapi.json \
  --output ./petstore-mcp

cd petstore-mcp && npm install && npm start
# 🎉  MCP server live on http://localhost:3000/mcp
```

That's a full MCP server — every endpoint turned into a validated tool — running. No SDK wrangling, no transport plumbing, no boilerplate.

**Connect it to Claude in one step:** every generated project includes a ready-to-use **`.mcp.json`**. Open the folder in **Claude Code** (it auto-detects the file), or paste the block into **Claude Desktop**'s config. The generated `README.md` has the exact snippet.

---

## ✨ Why mcpfoundry?

|  |  |
|---|---|
| ⏱️ **Ship in 5 minutes** | One command turns a DB or API into a working MCP server. |
| 🔒 **Secure by option** | Add `--secure` for a zero-trust **JWT guard + deception canary**. Off by default, never forced. |
| 🛡️ **Hardened by default** | Every tool gets strict **Zod / Pydantic** parameter validation — no opt-in needed. |
| 🏭 **Production quality** | Self-contained, **lint-clean**, type-safe output that builds and boots out of the box. |
| 🧩 **Maintainable & extensible** | Clean **Template-Compiler** architecture — add a language with a folder, no core changes. |
| 🌐 **HTTP or stdio** | Streamable **HTTP by default**; `--no-http` for stdio (Claude Desktop / Claude Code style). |
| 🐍 **Node.js & Python** | First-class `@modelcontextprotocol/sdk` (TS) **and** FastMCP (Python) output. |
| ⚙️ **Working out of the box** | Tools run **real code** — parameterised SQL (SQLite) or HTTP calls to your API — not placeholders. |
| 🔌 **DB & OpenAPI** | Introspect SQLite/Postgres into CRUD tools, or convert any OpenAPI/Swagger spec (file **or URL**, JSON/YAML) into tools that call the upstream API. |
| 📎 **One-click Claude connection** | Every project ships a `.mcp.json` — auto-detected by Claude Code, paste-ready for Claude Desktop. |

---

## 🛠️ Two ways to create

### 1. From an OpenAPI / Swagger spec
Every endpoint becomes a typed, validated MCP tool.

```bash
mcpfoundry create --type openapi --input ./openapi.yaml --output ./my-server
```

### 2. From a database
Tables are introspected into CRUD tools. **SQLite tools run real, parameterised SQL out of the box** — just point `DATABASE_PATH` at your file:

```bash
mcpfoundry create --type database --provider sqlite --uri ./app.db --output ./db-server
cd db-server && npm install && DATABASE_PATH=../app.db npm start
```

Postgres is also introspected (its handlers are scaffolded stubs for now):

```bash
mcpfoundry create --type database \
  --provider postgres \
  --uri "postgresql://user:pass@localhost:5432/mydb" \
  --output ./pg-server --lang python
```

> 💡 **Preview first** with `--dry-run` to see exactly which tools you'll get — no files written:
>
> ```text
> ✔ Dry run — 4 tool(s) would be generated:
>   • list_pets(limit?: integer)
>   • create_pet(name: string, tag?: string)
>   • get_pet_by_id(pet_id: integer)
>   • delete_pet(pet_id: integer)
> ```

---

## 🔐 The ZTAI Security Shield (optional)

Pass `--secure` and every generated server enforces zero-trust access — *recommended, never required*:

1. **🔑 JWT Guard** — verifies a short-lived HS256 token (an `Authorization: Bearer` header per request over HTTP, or `ZTAI_AUTH_TOKEN` at startup over stdio) against `JWT_SECRET`. Invalid or missing → rejected before any tool runs.
2. **🧱 Parameter hardening** — strict Zod / Pydantic schemas (this is **always on**, even without `--secure` — it's just good hygiene).
3. **🪤 Deception canary** — set `ZTAI_CANARY_ID` and tool output carries a subtle, traceable marker to help detect adversarial data exfiltration.

Without `--secure` you still get a perfectly good, vendor-neutral MCP server.

---

## 🎛️ All options

| Flag | Description |
| --- | --- |
| `--type` | `database` or `openapi` *(required)* |
| `--provider` | `sqlite` \| `postgres` \| `mysql` \| `mongodb` *(database mode)* |
| `--uri` | DB connection string *(database mode)* |
| `--input` | OpenAPI spec — **file path or URL**, JSON or YAML *(openapi mode)* |
| `--output` | Output directory *(required)* |
| `--lang` | `nodejs` *(default)* or `python` |
| `--transport` | `http` *(default)* or `stdio` |
| `--no-http` | Shortcut for `--transport stdio` |
| `--port` | Port for the HTTP transport *(default `3000`)* |
| `--secure` | Embed the optional ZTAI Security Shield |
| `--force` | Overwrite a non-empty output directory |
| `--dry-run` | Preview the generated tools, then exit |

> SQLite & Postgres are introspected today; **SQLite emits working SQL**. MySQL & MongoDB are stubbed and open for [contributions](./CONTRIBUTING.md).

---

## 🧩 How it works

`mcpfoundry` follows a clean **Template-Compiler** pattern:

```
  source (DB / OpenAPI)  ──▶  parser  ──▶  normalized IR (ToolSpec[])
                                                   │
                                       Handlebars compiler
                                                   │
                                                   ▼
                       templates/<lang>/  ──▶  your generated server
```

Parsers and templates are decoupled by a normalized intermediate representation, so **adding a new language is just a new `templates/<lang>/` folder** — no engine changes. See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## 🤝 Contributing

Two of the most common contributions — **a new language template** or **a new database provider** — need *zero* changes to the core engine. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## 📄 License

[MIT](./LICENSE) — build freely.

<div align="center">

**[⭐ Star on GitHub](https://github.com/FidarOrg/mcpfoundry)** if mcpfoundry saved you an afternoon.

</div>
