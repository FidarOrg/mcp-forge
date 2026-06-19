/**
 * Shared intermediate representation (IR) that every parser emits and the
 * compiler engine consumes. Keeping a normalized IR is what lets the
 * Template-Compiler pattern stay language-agnostic: parsers know nothing about
 * the target language, and templates know nothing about the source.
 */

export type ParamType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array";

export interface ParamSpec {
  /** Sanitized, language-safe name — the MCP tool argument key. */
  name: string;
  type: ParamType;
  required: boolean;
  description?: string;
  /** Original wire name (DB column / OpenAPI parameter or property name). */
  origName?: string;
  /** OpenAPI parameter location, used to build the real HTTP request. */
  location?: "path" | "query" | "header" | "body";
}

export interface ToolSpec {
  /** Sanitized, language-safe MCP tool name. */
  name: string;
  description: string;
  params: ParamSpec[];
  source: "database" | "openapi";
  /** Database-sourced tools carry the CRUD operation + table. */
  operation?: "list" | "get" | "create" | "update" | "delete";
  table?: string;
  /** OpenAPI-sourced tools carry the HTTP method + path. */
  method?: string;
  path?: string;
  /** Generated handler body (filled in by the compiler before rendering). */
  handlerBody?: string;
}

export type TargetLang = "nodejs" | "python";

export interface CompileContext {
  projectName: string;
  tools: ToolSpec[];
  lang: TargetLang;
  sourceType: "database" | "openapi";
  /** Opt-in ZTAI Security Shield (JWT guard + deception canary). */
  secure: boolean;
  /** Convenience flag for templates that need DB drivers/env vars. */
  isDatabase: boolean;
  /** Database provider (e.g. "sqlite", "postgres") when sourceType is database. */
  provider?: string;
  /** Convenience flag for templates: provider === "sqlite". */
  isSqlite: boolean;
  /** Wire transport for the generated server. */
  transport: "stdio" | "http";
  /** Port for the http transport. */
  port: number;
  /** Convenience flag for templates: transport === "http". */
  isHttp: boolean;
}
