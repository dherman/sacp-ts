# MCP Bridge Forwarding Issue

## Summary

The `sacp-conductor`'s MCP bridge does not forward MCP protocol messages (`tools/list`, `tools/call`) via the `_mcp/message` ACP extension method. This prevents client-side MCP servers from exposing tools to the agent.

## Current Behavior

1. Client creates session with MCP server config using `acp:` URL
2. Conductor detects `acp:` URL and creates TCP bridge (e.g., `http://localhost:60255`)
3. Conductor sends `_mcp/connect` to client with `acp_url` parameter
4. Client responds with `serverInfo`, `capabilities`, and `tools` (tool definitions)
5. Claude Code is spawned with `--mcp-config` pointing to the HTTP bridge
6. **Issue**: When Claude Code queries `tools/list` via HTTP to the bridge, the bridge does NOT forward this as `_mcp/message` to the client

## Expected Behavior

The bridge should forward MCP protocol requests to the client:

```
Claude Code → HTTP GET /tools/list → Bridge → _mcp/message{method:"tools/list"} → Client
Client → {tools:[...]} → Bridge → HTTP Response → Claude Code
```

Similarly for `tools/call`:

```
Claude Code → HTTP POST /tools/call → Bridge → _mcp/message{method:"tools/call",...} → Client
Client → {result:...} → Bridge → HTTP Response → Claude Code
```

## Evidence

From debug logs, we only see `_mcp/connect`:

```
C ← +592ms {"jsonrpc":"2.0","method":"_mcp/connect","params":{"acp_url":"acp:..."}}
C → +592ms {"jsonrpc":"2.0","result":{"serverInfo":...,"capabilities":{"tools":{}},"tools":[...]}}
```

No `_mcp/message` calls are ever received, even though Claude Code should be querying tools from the MCP server.

## Current Workaround

The `ThinkBuilder` in patchwork includes a JSON extraction fallback that parses structured output from the agent's text response. When the agent can't access MCP tools, it outputs JSON via Bash/echo, and we extract it from the text stream.

```typescript
// In ThinkBuilder._executeRun()
if (update.type === "stop") {
  // Before giving up, try to extract JSON from collected text
  if (!resultReceived && textBuffer) {
    const extracted = this._tryExtractJson(textBuffer);
    if (extracted !== null) {
      result = extracted as Output;
      resultReceived = true;
    }
  }
}
```

## Implications

1. **No MCP tool calls**: Client-defined MCP tools cannot be invoked by the agent
2. **Prompt-based workaround**: Must rely on JSON output extraction rather than proper tool calls
3. **No bidirectional MCP**: Features like MCP resources, prompts, or server-initiated notifications won't work

## Potential Solutions

### Option 1: Fix in sacp-conductor (Recommended)

The conductor's MCP bridge should implement proper forwarding:
- Forward `initialize`, `tools/list`, `tools/call`, etc. via `_mcp/message`
- Return responses from client back through HTTP

### Option 2: Direct HTTP MCP Server

Client could spin up its own HTTP server and provide that URL directly instead of using `acp:` URLs. This bypasses the conductor's bridge but adds complexity.

### Option 3: Use SDK-type MCP Server

If the conductor supports `type: "sdk"` MCP servers (like the built-in `acp` server), that might provide a different code path that works.

## Affected Components

- `sacp-conductor` version 9.0.0
- `@dherman/sacp` MCP-over-ACP handler
- `@dherman/patchwork` ThinkBuilder

## Related Files

- `packages/sacp/src/mcp-over-acp-handler.ts` - Handles `_mcp/*` messages
- `packages/patchwork/src/think-builder.ts` - Contains JSON extraction workaround
- `packages/sacp/src/types.ts` - `McpConnectResponse` type with `tools` field
