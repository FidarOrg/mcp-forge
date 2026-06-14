# Contributing to mcpfoundry

Thanks for your interest! The architecture is deliberately built so the two most
common contributions need **no changes to the core engine**.

## Add a new language template

1. Create `templates/<lang>/` (e.g. `templates/go/`).
2. Add template files. Any file ending in `.hbs` is rendered with the compile
   context; everything else is copied verbatim. The `.hbs` suffix is stripped on
   output (so `package.json.hbs` → `package.json`).
3. The compile context available in templates:
   - `projectName`, `lang`, `sourceType`, `secure`, `isDatabase`
   - `tools` — an array of `ToolSpec` (`name`, `description`, `params`,
     `operation`/`table` or `method`/`path`)
   - helpers: `{{json x}}`, `{{pascalCase x}}`, `{{camelCase x}}`,
     `{{zodType param}}`, `{{pydanticType param}}`, `{{#if (eq a b)}}`
4. Gate ZTAI Security Shield code behind `{{#if secure}} … {{/if}}` so the
   default output stays vendor-neutral and dependency-clean.
5. Dotfiles: store them with a leading underscore (e.g. `_gitignore`); the
   compiler restores the leading `_` to `.` on output. (npm strips files
   literally named `.gitignore` from published packages.)
6. A template that renders to entirely empty/whitespace is skipped — handy for
   files that should only appear in some modes.

## Add a database provider

`src/parsers/database.ts` currently implements Postgres. MySQL and MongoDB throw
a "not yet implemented" error. To add one:

1. Implement an `introspect<Provider>(uri): Promise<ToolSpec[]>` function.
2. Map the source's column/field types to `ParamType` in `src/types.ts`.
3. Emit CRUD `ToolSpec`s following the `buildCrudTools` shape.
4. Wire it into the `switch` in `introspectDatabase`.

## Dev loop

```bash
npm install
npm run build
npm run lint
node dist/cli.js create --type openapi --input examples/petstore.openapi.json --output /tmp/out --force
```
