#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { introspectDatabase } from "./parsers/database";
import { parseOpenApi } from "./parsers/openapi";
import { compile } from "./compiler";
import { logger } from "./utils/logger";
import type { CompileContext, TargetLang, ToolSpec } from "./types";

interface CreateOptions {
  type?: string;
  provider?: string;
  uri?: string;
  input?: string;
  output?: string;
  lang: string;
  transport: string;
  http: boolean;
  port: string;
  secure: boolean;
  force: boolean;
  dryRun: boolean;
}

// Read the real version from package.json so `--version` never goes stale.
const { version } = JSON.parse(
  readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("mcpfoundry")
  .description(
    "Create production-ready MCP servers from databases or OpenAPI specs.",
  )
  .version(version)
  .showHelpAfterError("(add --help for usage)");

program
  .command("create")
  .description("Generate an MCP server from a data source.")
  .requiredOption("--type <type>", "source type: database | openapi")
  .option("--provider <provider>", "database provider: postgres | sqlite | mysql | mongodb")
  .option("--uri <uri>", "DB connection string, or a file path for sqlite (for --type database)")
  .option("--input <path>", "OpenAPI/Swagger spec — file path OR URL, JSON or YAML")
  .option("--output <dir>", "output directory for the generated server")
  .option("--lang <lang>", "target language: nodejs | python", "nodejs")
  .option("--transport <transport>", "transport: http | stdio", "http")
  .option("--no-http", "use the stdio transport instead of http")
  .option("--port <port>", "port for the http transport", "3000")
  .option(
    "--secure",
    "embed the optional ZTAI Security Shield (JWT guard + deception canary)",
    false,
  )
  .option("--force", "overwrite a non-empty output directory", false)
  .option("--dry-run", "preview the tools that would be generated, then exit", false)
  .addHelpText(
    "after",
    `
Examples:
  $ mcpfoundry create --type openapi --input ./openapi.yaml --output ./my-server
  $ mcpfoundry create --type openapi --input https://petstore3.swagger.io/api/v3/openapi.json --output ./petstore
  $ mcpfoundry create --type database --provider postgres --uri "$DATABASE_URL" --output ./db-server --lang python
  $ mcpfoundry create --type openapi --input ./api.json --output ./secure-server --secure
  $ mcpfoundry create --type openapi --input ./api.json --output ./http-server --port 8080
  $ mcpfoundry create --type openapi --input ./api.json --output ./stdio-server --no-http
  $ mcpfoundry create --type openapi --input ./api.json --output /tmp/x --dry-run
`,
  )
  .action(async (opts: CreateOptions) => {
    try {
      await run(opts);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

async function run(opts: CreateOptions): Promise<void> {
  const lang = opts.lang as TargetLang;
  if (lang !== "nodejs" && lang !== "python") {
    throw new Error(`Unsupported --lang "${opts.lang}". Use nodejs or python.`);
  }

  let transport = opts.transport as "stdio" | "http";
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`Unsupported --transport "${opts.transport}". Use http or stdio.`);
  }
  // `--no-http` is a shortcut to disable the default http transport.
  if (opts.http === false) transport = "stdio";

  const port = Number(opts.port);
  if (transport === "http" && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`Invalid --port "${opts.port}". Use an integer between 1 and 65535.`);
  }

  if (!opts.dryRun && !opts.output) {
    throw new Error("--output is required (or use --dry-run to preview).");
  }

  let tools: ToolSpec[];
  let sourceType: "database" | "openapi";

  if (opts.type === "database") {
    if (!opts.provider) throw new Error("--provider is required for --type database.");
    if (!opts.uri) throw new Error("--uri is required for --type database.");
    sourceType = "database";
    logger.info(`Introspecting ${opts.provider} database…`);
    tools = await introspectDatabase(opts.provider, opts.uri);
  } else if (opts.type === "openapi") {
    if (!opts.input) throw new Error("--input is required for --type openapi.");
    sourceType = "openapi";
    logger.info(`Parsing OpenAPI spec at ${opts.input}…`);
    tools = await parseOpenApi(opts.input);
  } else {
    throw new Error(
      `Unsupported --type "${opts.type ?? ""}". Use database or openapi.`,
    );
  }

  if (tools.length === 0) {
    throw new Error("No tools were generated from the source — nothing to scaffold.");
  }

  // Required params first: Python disallows a non-default arg after a defaulted
  // one, and it reads better everywhere else too. Stable within each group.
  for (const tool of tools) {
    tool.params = [
      ...tool.params.filter((p) => p.required),
      ...tool.params.filter((p) => !p.required),
    ];
  }

  if (opts.dryRun) {
    printDryRun(tools);
    return;
  }

  const outputDir = path.resolve(opts.output!);
  const projectName = path.basename(outputDir);
  const context: CompileContext = {
    projectName,
    tools,
    lang,
    sourceType,
    secure: Boolean(opts.secure),
    isDatabase: sourceType === "database",
    provider: opts.provider,
    isSqlite: opts.provider === "sqlite",
    transport,
    port,
    isHttp: transport === "http",
  };

  logger.info(`Compiling ${tools.length} tool(s) into a ${lang} MCP server…`);
  await compile(context, outputDir, Boolean(opts.force));

  printSummary(context, outputDir);
}

function printDryRun(tools: ToolSpec[]): void {
  logger.plain();
  logger.success(`Dry run — ${tools.length} tool(s) would be generated:`);
  logger.plain();
  for (const t of tools) {
    const params = t.params
      .map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type}`)
      .join(", ");
    logger.plain(`  • ${logger.bold(t.name)}(${params})`);
    logger.plain(`      ${logger.dim(t.description)}`);
  }
  logger.plain();
  logger.plain(logger.dim("No files written. Drop --dry-run to generate."));
}

function printSummary(ctx: CompileContext, outputDir: string): void {
  // Display a path relative to the current directory so we never leak the
  // user's absolute/home path. Falls back to the absolute path only if the
  // output lives outside the cwd tree.
  const rel = path.relative(process.cwd(), outputDir);
  const displayPath =
    rel === "" ? "." : rel.startsWith("..") ? outputDir : rel;

  logger.plain();
  logger.success(
    `Created ${logger.bold(ctx.projectName)} — ${ctx.tools.length} MCP tool(s), ${ctx.lang}, ${ctx.transport} transport${ctx.secure ? ", ZTAI Security Shield enabled" : ""}.`,
  );
  logger.plain(`  ${logger.dim(displayPath)}`);
  logger.plain();
  logger.plain("Next steps:");
  if (ctx.lang === "nodejs") {
    logger.plain(`  cd ${displayPath}`);
    logger.plain("  npm install");
    logger.plain("  npm run build && npm start");
  } else {
    logger.plain(`  cd ${displayPath}`);
    logger.plain("  pip install -r requirements.txt");
    logger.plain("  python server.py");
  }

  logger.plain();
  logger.plain(
    `  Connect to Claude: a ${logger.bold(".mcp.json")} is included (auto-detected by Claude Code).`,
  );

  if (ctx.isHttp) {
    logger.plain();
    logger.plain(`  Serves MCP over HTTP at ${logger.bold(`http://localhost:${ctx.port}/mcp`)} (override with PORT env).`);
  }

  if (!ctx.secure) {
    logger.plain();
    logger.warn(
      "Generated a standard MCP server. For zero-trust auth + a deception canary, re-run with --secure, or front it with the ZTAI firewall.",
    );
  }
}

program.parseAsync(process.argv);
