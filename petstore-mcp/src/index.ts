#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { tools } from "./tools.js";
function createServer(): McpServer {
  const server = new McpServer({ name: "petstore-mcp", version: "0.1.0" });
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
  }
  return server;
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    // Stateless: a fresh server + transport per request.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.error(
      `[petstore-mcp] MCP server listening on http://localhost:${port}/mcp with ${tools.length} tool(s).`,
    );
  });
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
