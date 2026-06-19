import SwaggerParser from "@apidevtools/swagger-parser";
import {
  cleanDescription,
  dedupeByName,
  sanitizeIdentifier,
} from "../utils/naming";
import type { ParamSpec, ParamType, ToolSpec } from "../types";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Ingest an OpenAPI / Swagger document (JSON or YAML; SwaggerParser handles
 * both, plus $ref dereferencing) and map every operation to one MCP tool.
 */
export async function parseOpenApi(input: string): Promise<ToolSpec[]> {
  // dereference resolves all $ref pointers so we can read schemas inline.
  let api: any;
  try {
    api = await SwaggerParser.dereference(input);
  } catch (err) {
    throw new Error(
      `Could not read OpenAPI spec "${input}" (${(err as Error).message}). ` +
        `Check the path/URL is reachable and the document is valid JSON or YAML.`,
    );
  }
  const paths = api.paths ?? {};
  const tools: ToolSpec[] = [];

  for (const [routePath, pathItem] of Object.entries<any>(paths)) {
    for (const method of HTTP_METHODS) {
      const op = pathItem?.[method];
      if (!op) continue;

      const name = sanitizeIdentifier(op.operationId || `${method}_${routePath}`);
      const params: ParamSpec[] = [];

      // Path / query / header parameters.
      for (const prm of op.parameters ?? []) {
        const loc: ParamSpec["location"] =
          prm.in === "path" || prm.in === "header" ? prm.in : "query";
        params.push({
          name: sanitizeIdentifier(prm.name),
          origName: prm.name,
          location: loc,
          type: jsonSchemaType(prm.schema?.type),
          required: Boolean(prm.required) || prm.in === "path",
          description: cleanDescription(prm.description),
        });
      }

      // JSON request body properties.
      const bodySchema =
        op.requestBody?.content?.["application/json"]?.schema ?? undefined;
      if (bodySchema?.properties) {
        const required = new Set<string>(bodySchema.required ?? []);
        for (const [propName, propSchema] of Object.entries<any>(
          bodySchema.properties,
        )) {
          params.push({
            name: sanitizeIdentifier(propName),
            origName: propName,
            location: "body",
            type: jsonSchemaType(propSchema?.type),
            required: required.has(propName),
            description: cleanDescription(propSchema?.description),
          });
        }
      }

      tools.push({
        name,
        description:
          cleanDescription(op.summary || op.description) ||
          `${method.toUpperCase()} ${routePath}`,
        params: dedupeByName(params),
        source: "openapi",
        method: method.toUpperCase(),
        path: routePath,
      });
    }
  }

  return tools;
}

function jsonSchemaType(type: unknown): ParamType {
  switch (type) {
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "string";
  }
}
