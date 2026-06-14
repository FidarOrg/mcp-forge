#!/usr/bin/env node
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
  secure: boolean;
  force: boolean;
  dryRun: boolean;
}

const program = new Command();

program
  .name("mcpfoundry")
  .description(
    "Forge production-ready MCP servers from databases or OpenAPI specs.",
  )
  .version("0.1.0")
  .showHelpAfterError("(add --help for usage)");

program
  .command("create")
  .description("Generate an MCP server from a data source.")
  .requiredOption("--type <type>", "source type: database | openapi")
  .option("--provider <provider>", "database provider: postgres | mysql | mongodb")
  .option("--uri <uri>", "database connection string (for --type database)")
  .option("--input <path>", "OpenAPI/Swagger spec — file path OR URL, JSON or YAML")
  .option("--output <dir>", "output directory for the generated server")
  .option("--lang <lang>", "target language: nodejs | python", "nodejs")
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
  logger.plain();
  logger.success(
    `Forged ${logger.bold(ctx.projectName)} — ${ctx.tools.length} MCP tool(s), ${ctx.lang}${ctx.secure ? ", ZTAI Security Shield enabled" : ""}.`,
  );
  logger.plain(`  ${logger.dim(outputDir)}`);
  logger.plain();
  logger.plain("Next steps:");
  if (ctx.lang === "nodejs") {
    logger.plain(`  cd ${outputDir}`);
    logger.plain("  npm install");
    logger.plain("  npm run build && npm start");
  } else {
    logger.plain(`  cd ${outputDir}`);
    logger.plain("  pip install -e .");
    logger.plain("  python server.py");
  }

  if (!ctx.secure) {
    logger.plain();
    logger.warn(
      "Generated a standard MCP server. For zero-trust auth + a deception canary, re-run with --secure, or front it with the ZTAI firewall.",
    );
  }
}

program.parseAsync(process.argv);
