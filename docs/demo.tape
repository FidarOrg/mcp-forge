# Animated demo for mcpfoundry.
# Generate the GIF with: vhs docs/demo.tape   (install: https://github.com/charmbracelet/vhs)
# IMPORTANT: run it from the repo root so examples/petstore.openapi.json is in scope.

Output docs/demo.gif

Require npx

Set Shell bash
Set FontSize 20
Set Width 1200
Set Height 740
Set Theme "Catppuccin Mocha"
Set Padding 24
Set TypingSpeed 45ms
Set Margin 16
Set BorderRadius 12

# Off-screen setup — NONE of this is recorded:
#  - force a clean, anonymous prompt (no username / host / path is shown)
#  - remove any previous output so the demo starts clean
#  - warm the npx + npm caches so the recorded run stays snappy
Hide
Type "export PROMPT_COMMAND='' PS1='$ '"
Enter
Type "rm -rf petstore-mcp"
Enter
Type "( npx --yes mcpfoundry create --type openapi --input examples/petstore.openapi.json --output /tmp/.mcpf-warmup && cd /tmp/.mcpf-warmup && npm install --silent --no-fund --no-audit && npm run build --silent ) > /dev/null 2>&1; rm -rf /tmp/.mcpf-warmup"
Enter
Sleep 50s
Type "clear"
Enter
Sleep 1500ms
Show

Type "# Create a production-ready MCP server from an OpenAPI spec"
Enter
Sleep 800ms
Type "npx mcpfoundry create --type openapi --input examples/petstore.openapi.json --output petstore-mcp"
Enter
Sleep 4s

Type "cd petstore-mcp"
Enter
Sleep 400ms
Type "npm install --silent --no-fund --no-audit"
Enter
Sleep 6s

Type "npm run build --silent"
Enter
Sleep 3s

Type "npm start"
Enter
Sleep 8s

# Clean up off-screen so the demo leaves no artifacts behind.
Hide
Type "C-c"
Enter
Type "cd .. && rm -rf petstore-mcp"
Enter
Show
