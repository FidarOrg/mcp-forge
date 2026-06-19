import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { camelCase, pascalCase } from "./utils/naming";
import { nodeHandlerBody, pyHandlerBody } from "./handlers";
import type { CompileContext, ParamSpec } from "./types";

/** Templates ship alongside the compiled engine: dist/compiler.js -> ../templates. */
const TEMPLATES_ROOT = path.join(__dirname, "..", "templates");

let helpersRegistered = false;

function registerHelpers(): void {
  if (helpersRegistered) return;

  // Emit a JSON-encoded literal (safe string keys, escaped values).
  Handlebars.registerHelper("json", (value: unknown) =>
    new Handlebars.SafeString(JSON.stringify(value ?? null)),
  );
  Handlebars.registerHelper("pascalCase", (s: unknown) =>
    pascalCase(String(s ?? "")),
  );
  Handlebars.registerHelper("camelCase", (s: unknown) =>
    camelCase(String(s ?? "")),
  );
  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);

  // Language-specific type mappers used inside the templates.
  Handlebars.registerHelper("zodType", (p: ParamSpec) =>
    new Handlebars.SafeString(zodType(p)),
  );
  Handlebars.registerHelper("pydanticType", (p: ParamSpec) =>
    new Handlebars.SafeString(pydanticType(p)),
  );
  // Full Python function parameter, e.g.
  //   name: Annotated[str, Field(description="...")]
  //   tag: str | None = None
  Handlebars.registerHelper("pyParam", (p: ParamSpec) =>
    new Handlebars.SafeString(pyParam(p)),
  );
  // Python dict literal of the call args, e.g. {"name": name, "tag": tag}.
  Handlebars.registerHelper("pyArgsDict", (params: ParamSpec[]) => {
    const entries = (params ?? [])
      .map((p) => `${JSON.stringify(p.name)}: ${p.name}`)
      .join(", ");
    return new Handlebars.SafeString(`{${entries}}`);
  });

  helpersRegistered = true;
}

/** Map an IR ParamSpec to a Zod expression for Node.js parameter hardening. */
function zodType(p: ParamSpec): string {
  const base: Record<ParamSpec["type"], string> = {
    string: "z.string()",
    number: "z.number()",
    integer: "z.number().int()",
    boolean: "z.boolean()",
    object: "z.record(z.any())",
    array: "z.array(z.any())",
  };
  let expr = base[p.type] ?? "z.any()";
  if (p.description) expr += `.describe(${JSON.stringify(p.description)})`;
  if (!p.required) expr += ".optional()";
  return expr;
}

/** Map an IR ParamSpec to a Python type annotation for Pydantic hardening. */
function pydanticType(p: ParamSpec): string {
  const base: Record<ParamSpec["type"], string> = {
    string: "str",
    number: "float",
    integer: "int",
    boolean: "bool",
    object: "dict[str, Any]",
    array: "list[Any]",
  };
  const t = base[p.type] ?? "Any";
  return p.required ? t : `${t} | None`;
}

/** Render a full Python function parameter (type + optional Field + default). */
function pyParam(p: ParamSpec): string {
  const type = pydanticType(p);
  const annotated = p.description
    ? `Annotated[${type}, Field(description=${JSON.stringify(p.description)})]`
    : type;
  return p.required ? `${p.name}: ${annotated}` : `${p.name}: ${annotated} = None`;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * Render the selected language template against the compile context and write
 * the result to the output directory. The engine is fully data-driven: adding a
 * new language means adding a `templates/<lang>/` folder, no engine changes.
 */
export async function compile(
  ctx: CompileContext,
  outputDir: string,
  force: boolean,
): Promise<void> {
  registerHelpers();

  const templateDir = path.join(TEMPLATES_ROOT, ctx.lang);
  if (!fs.existsSync(templateDir)) {
    throw new Error(
      `No templates found for lang "${ctx.lang}" (looked in ${templateDir}).`,
    );
  }

  if (
    fs.existsSync(outputDir) &&
    fs.readdirSync(outputDir).length > 0 &&
    !force
  ) {
    throw new Error(
      `Output directory ${outputDir} is not empty. Re-run with --force to overwrite.`,
    );
  }

  fs.mkdirSync(outputDir, { recursive: true });

  // Generate each tool's real handler body for the target language.
  for (const tool of ctx.tools) {
    tool.handlerBody =
      ctx.lang === "nodejs" ? nodeHandlerBody(tool, ctx) : pyHandlerBody(tool, ctx);
  }

  for (const abs of walk(templateDir)) {
    const rel = path.relative(templateDir, abs);
    const isTemplate = rel.endsWith(".hbs");
    const outRel = isTemplate ? rel.slice(0, -".hbs".length) : rel;
    // Dotfile convention: npm strips files literally named `.gitignore` from
    // published packages, so they are stored as `_gitignore` and the leading
    // underscore is restored to a dot on output.
    const dir = path.dirname(outRel);
    const base = path.basename(outRel).replace(/^_/, ".");
    const outPath = path.join(outputDir, dir, base);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const raw = fs.readFileSync(abs, "utf8");
    const content = isTemplate
      ? Handlebars.compile(raw, { noEscape: true })(ctx)
      : raw;

    // A template that renders to nothing (e.g. a fully `{{#if secure}}`-gated
    // file in a non-secure build) is intentionally omitted from the output.
    if (isTemplate && content.trim() === "") continue;

    fs.writeFileSync(outPath, content);
  }
}
