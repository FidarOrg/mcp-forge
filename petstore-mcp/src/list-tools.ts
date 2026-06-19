/**
 * Print the tools (methods) this MCP server exposes. Run with: npm run tools
 * Reads the generated tool definitions directly — no server start required.
 */
import { tools } from "./tools.js";

console.log(`\n${tools.length} tool(s) exposed by petstore-mcp:\n`);
for (const tool of tools) {
  const params = Object.keys(tool.schema).join(", ");
  console.log(`  • ${tool.name}(${params})`);
  console.log(`      ${tool.description}`);
}
console.log();
