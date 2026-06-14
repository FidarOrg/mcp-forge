# mcpfoundry

> Forge production-ready **MCP (Model Context Protocol) servers** from your existing data — a database or an OpenAPI spec — in seconds.

`mcpfoundry` is a zero-friction CLI that introspects a data source and scaffolds a
clean, self-contained, runnable MCP server. Generated servers always ship with
**parameter validation** (Zod / Pydantic). An **optional** zero-trust
**ZTAI Security Shield** (JWT guard + deception canary) can be layered in with a
single `--secure` flag — recommended, never forced.

## Install

```bash
npm install -g mcpfoundry
# or run ad-hoc:
npx mcpfoundry create --help
```

## Usage

### From an OpenAPI / Swagger spec

Every endpoint becomes a typed MCP tool:

```bash
mcpfoundry create \
  --type openapi \
  --input ./openapi.json \
  --output ./my-mcp-server \
  --lang nodejs
```

### From a database

Tables are introspected and turned into CRUD tools:

```bash
mcpfoundry create \
  --type database \
  --provider postgres \
  --uri "postgresql://user:pass@localhost:5432/mydb" \
  --output ./my-mcp-server \
  --lang python
```

> Postgres is fully supported today. MySQL and MongoDB are stubbed and open for
> [contributions](./CONTRIBUTING.md).

### Flags

| Flag | Description |
| --- | --- |
| `--type` | `database` or `openapi` (required) |
| `--provider` | `postgres` \| `mysql` \| `mongodb` (database mode) |
| `--uri` | DB connection string (database mode) |
| `--input` | Path to an OpenAPI spec, JSON or YAML (openapi mode) |
| `--output` | Output directory (required) |
| `--lang` | `nodejs` (default) or `python` |
| `--transport` | `stdio` (default) or `http` |
| `--port` | Port for the `http` transport (default `3000`) |
| `--secure` | Embed the optional ZTAI Security Shield |
| `--force` | Overwrite a non-empty output directory |
| `--dry-run` | Preview the tools that would be generated, then exit (no files written) |

### Transports

By default the server runs over **stdio** — the standard way clients (Claude
Desktop, Claude Code, etc.) launch a local MCP server. Pass `--transport http`
to generate a server that listens on `http://localhost:<port>/mcp` instead
(Streamable HTTP via Express for Node, FastMCP for Python):

```bash
mcpfoundry create --type openapi --input ./openapi.yaml --output ./srv --transport http --port 3000
```

With `--secure` + `--transport http`, the JWT guard verifies an
`Authorization: Bearer <token>` header on **every request** (returns `401` on
failure); with stdio it verifies `ZTAI_AUTH_TOKEN` once at startup.

`--input` accepts a local path **or a URL**, in JSON or YAML.

### Preview before generating

```bash
mcpfoundry create --type openapi --input ./openapi.yaml --dry-run
```

```
✔ Dry run — 4 tool(s) would be generated:
  • list_pets(limit?: integer)
  • create_pet(name: string, tag?: string)
  • get_pet_by_id(pet_id: integer)
  • delete_pet(pet_id: integer)
```

## The optional ZTAI Security Shield (`--secure`)

When you pass `--secure`, every generated server additionally enforces:

1. **JWT Guard** — verifies a short-lived HS256 token (`ZTAI_AUTH_TOKEN` at
   startup over stdio, or an `Authorization: Bearer` header per request over
   HTTP) against `JWT_SECRET`. Invalid or missing tokens are rejected before any
   tool runs.
2. **Parameter hardening** — strict Zod/Pydantic schemas (this is on even
   *without* `--secure`, because it's just good hygiene).
3. **Deception Canary** — when `ZTAI_CANARY_ID` is set, tool output carries a
   subtle, traceable marker to help detect adversarial exfiltration.

Without `--secure` you still get a perfectly good, vendor-neutral MCP server.

## Architecture — the Template-Compiler pattern

```
src/
  cli.ts          # arg parsing + orchestration
  parsers/        # data source -> normalized IR (ToolSpec[])
  compiler.ts     # IR + Handlebars templates -> generated project
  types.ts        # the shared IR
templates/
  nodejs/         # @modelcontextprotocol/sdk + Zod
  python/         # FastMCP + Pydantic
```

Parsers and templates are decoupled by a normalized intermediate representation,
so **adding a new language is just a new `templates/<lang>/` folder** — no engine
changes. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Develop

```bash
npm install
npm run build
node dist/cli.js create --type openapi --input examples/petstore.openapi.json --output /tmp/petstore-mcp
```

## License

MIT
