# Implementation Plan: SchemaProvider Interface

This plan implements the `SchemaProvider<T>` interface from [schema-providers.md](rfd/schema-providers.md).

## Phase 1: Core Types

- [x] Add `SchemaProvider<T>` interface to `packages/sacp/src/types.ts`
- [x] Ensure `JsonSchema` type has index signature for third-party compatibility
- [x] Export `SchemaProvider` from `packages/sacp/src/index.ts`
- [x] Re-export `SchemaProvider` from `packages/patchwork/src/index.ts`

## Phase 2: Helper Function

- [x] Add `schemaOf<T>()` helper function to patchwork (new file `packages/patchwork/src/schema.ts`)
- [x] Export `schemaOf` from patchwork index

## Phase 3: Update ThinkBuilder API

- [x] Add new `think(schema: SchemaProvider<T>)` overload to Patchwork class
- [x] Update ThinkBuilder to accept schema in constructor
- [x] Deprecate `.outputSchema()` method with console warning
- [x] Update internal schema handling to use `toJsonSchema()` when building request

## Phase 4: Tests

- [x] Add unit tests for `schemaOf<T>()` helper
- [x] Add unit tests for `think(schema)` signature
- [x] Add test demonstrating type inference flow
- [x] Verify deprecation warning fires for `.outputSchema()`

## Phase 5: Documentation

- [x] Update patchwork README with new usage patterns
- [x] Add JSDoc comments to `SchemaProvider` and `schemaOf`

## Phase 6: Integration Examples

Create `examples/` directory with end-to-end examples that demonstrate each schema provider pattern and serve as integration tests.

- [x] Example 1: Inline schema with `schemaOf<T>()` helper
- [x] Example 2: Zod adapter (`zodSchema()`)
- [x] Example 3: TypeBox adapter (`typeboxSchema()`)
- [x] Example 4: Build-time generated schemas (type-first pattern)

## Phase 7: Tool API Schema Providers

Extend the SchemaProvider pattern to the `.tool()` and `.defineTool()` APIs for both input and output schemas.

### API Changes

New signature (schemas before handler, output schema added):
```typescript
tool<I, O>(
  name: string,
  description: string,
  inputSchema: SchemaProvider<I> | undefined,
  outputSchema: SchemaProvider<O> | undefined,
  handler: (input: I) => Promise<O>
): this
```

### Implementation

- [x] Update `ToolDefinition` interface to store `SchemaProvider<I>` and `SchemaProvider<O>`
- [x] Update `ThinkBuilder.tool()` signature: schemas before handler, add output schema
- [x] Update `ThinkBuilder.defineTool()` similarly
- [x] Update internal `_executeRun()` to call `toJsonSchema()` on both schemas
- [x] Add unit tests for tool schema integration
- [x] Update examples to use schema providers for tool input/output schemas:
  - [x] `inline.ts`: Use `schemaOf<T>()` for input and output
  - [x] `zod.ts`: Use `zodSchema()` with Zod schemas
  - [x] `typebox.ts`: Use `typeboxSchema()` with TypeBox schemas
  - [x] `generator.ts`: Use generated `SentimentInputSchema` and `SentimentOutputSchema`
- [x] Add `SentimentInput` and `SentimentOutput` types to `generator.types.ts` and regenerate schemas

## Known Issues

### MCP Bridge Forwarding (RESOLVED)

~~The `sacp-conductor` MCP bridge does not forward `_mcp/message` calls to the client.~~

**Fixed (2026-01-05)**: The issue was in our `_mcp/message` response format—we were wrapping responses in `{connectionId, result}` but the conductor expects raw MCP results. MCP tools now work correctly.

- [x] Investigate conductor bridge implementation
- [x] Fix `_mcp/message` response format (return raw MCP results)
- [x] Update MCP protocol version to 2025-03-26
- [x] Remove JSON extraction workaround (no longer needed)
