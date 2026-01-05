import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { McpOverAcpHandler } from "./mcp-over-acp-handler.js";
import { mcpServer } from "./mcp-server.js";

describe("McpOverAcpHandler", () => {
  let handler: McpOverAcpHandler;

  beforeEach(() => {
    handler = new McpOverAcpHandler();
  });

  describe("isMcpRequest", () => {
    it("should return true for mcp/ prefixed methods (underscore stripped by SDK)", () => {
      assert.strictEqual(handler.isMcpRequest("mcp/connect"), true);
      assert.strictEqual(handler.isMcpRequest("mcp/message"), true);
      assert.strictEqual(handler.isMcpRequest("mcp/disconnect"), true);
    });

    it("should return false for non-MCP methods", () => {
      assert.strictEqual(handler.isMcpRequest("session/new"), false);
      assert.strictEqual(handler.isMcpRequest("session/prompt"), false);
      // Note: _mcp/ prefix is stripped by the SDK before we see it
      assert.strictEqual(handler.isMcpRequest("_mcp/connect"), false);
    });
  });

  describe("register and unregister", () => {
    it("should register an MCP server", () => {
      const server = mcpServer("test").build();
      handler.register(server);

      // Should be able to connect to the registered server
      const response = handler.handleConnect({
        connectionId: "conn-1",
        acp_url: server.acpUrl,
      });

      assert.strictEqual(response.connectionId, "conn-1");
      assert.strictEqual(response.serverInfo.name, "test");
    });

    it("should unregister an MCP server", () => {
      const server = mcpServer("test").build();
      handler.register(server);
      handler.unregister(server);

      // Should throw when trying to connect to unregistered server
      assert.throws(() => {
        handler.handleConnect({
          connectionId: "conn-1",
          acp_url: server.acpUrl,
        });
      }, /No MCP server registered/);
    });
  });

  describe("handleConnect", () => {
    it("should establish a connection to a registered server", () => {
      const server = mcpServer("my-server").build();
      handler.register(server);

      const response = handler.handleConnect({
        connectionId: "connection-123",
        acp_url: server.acpUrl,
      });

      assert.strictEqual(response.connectionId, "connection-123");
      assert.strictEqual(response.serverInfo.name, "my-server");
      assert.strictEqual(response.serverInfo.version, "0.1.0");
      assert.deepStrictEqual(response.capabilities, { tools: {} });
    });

    it("should also accept url parameter (for backwards compatibility)", () => {
      const server = mcpServer("my-server").build();
      handler.register(server);

      const response = handler.handleConnect({
        connectionId: "connection-123",
        url: server.acpUrl,
      });

      assert.strictEqual(response.connectionId, "connection-123");
      assert.strictEqual(response.serverInfo.name, "my-server");
    });

    it("should throw for unknown server URL", () => {
      assert.throws(() => {
        handler.handleConnect({
          connectionId: "conn-1",
          acp_url: "acp:unknown-id",
        });
      }, /No MCP server registered for URL/);
    });
  });

  describe("handleMessage", () => {
    it("should route messages to the correct server", async () => {
      const server = mcpServer("test")
        .tool("echo", "Echo input", { type: "object" }, { type: "object" }, async (input) => input)
        .build();

      handler.register(server);
      handler.setSessionId("session-1");

      // First, establish a connection
      handler.handleConnect({
        connectionId: "conn-1",
        acp_url: server.acpUrl,
      });

      // Then send a message
      const response = await handler.handleMessage({
        connectionId: "conn-1",
        method: "tools/call",
        params: { name: "echo", arguments: { message: "hello" } },
      });

      assert.strictEqual(response.connectionId, "conn-1");
      assert.ok(response.result);
    });

    it("should return error for unknown connection", async () => {
      const response = await handler.handleMessage({
        connectionId: "unknown-conn",
        method: "tools/list",
        params: {},
      });

      assert.strictEqual(response.connectionId, "unknown-conn");
      assert.ok(response.error);
      assert.ok(response.error.message.includes("Unknown connection"));
    });

    it("should handle tools/list requests", async () => {
      const server = mcpServer("test")
        .tool("tool1", "First tool", { type: "object" }, { type: "object" }, async () => ({}))
        .tool("tool2", "Second tool", { type: "object" }, { type: "object" }, async () => ({}))
        .build();

      handler.register(server);

      handler.handleConnect({
        connectionId: "conn-1",
        acp_url: server.acpUrl,
      });

      const response = await handler.handleMessage({
        connectionId: "conn-1",
        method: "tools/list",
        params: {},
      });

      const result = response.result as { tools: { name: string }[] };
      assert.strictEqual(result.tools.length, 2);
    });
  });

  describe("handleDisconnect", () => {
    it("should remove the connection", async () => {
      const server = mcpServer("test").build();
      handler.register(server);

      handler.handleConnect({
        connectionId: "conn-1",
        acp_url: server.acpUrl,
      });

      // Disconnect
      handler.handleDisconnect({
        connectionId: "conn-1",
      });

      // Subsequent messages should fail
      const response = await handler.handleMessage({
        connectionId: "conn-1",
        method: "tools/list",
        params: {},
      });

      assert.ok(response.error);
      assert.ok(response.error.message.includes("Unknown connection"));
    });
  });

  describe("routeRequest", () => {
    it("should route mcp/connect requests", async () => {
      const server = mcpServer("test").build();
      handler.register(server);

      const result = await handler.routeRequest("mcp/connect", {
        connectionId: "conn-1",
        acp_url: server.acpUrl,
      });

      assert.ok(result);
      assert.strictEqual((result as { connectionId: string }).connectionId, "conn-1");
    });

    it("should route mcp/message requests", async () => {
      const server = mcpServer("test")
        .tool("ping", "Ping", { type: "object" }, { type: "object" }, async () => ({ pong: true }))
        .build();

      handler.register(server);

      await handler.routeRequest("mcp/connect", {
        connectionId: "conn-1",
        acp_url: server.acpUrl,
      });

      const result = await handler.routeRequest("mcp/message", {
        connectionId: "conn-1",
        method: "tools/call",
        params: { name: "ping", arguments: {} },
      });

      assert.ok(result);
    });

    it("should route mcp/disconnect requests", async () => {
      const server = mcpServer("test").build();
      handler.register(server);

      await handler.routeRequest("mcp/connect", {
        connectionId: "conn-1",
        acp_url: server.acpUrl,
      });

      const result = await handler.routeRequest("mcp/disconnect", {
        connectionId: "conn-1",
      });

      assert.strictEqual(result, undefined);
    });

    it("should throw for unknown MCP method", async () => {
      await assert.rejects(
        () => handler.routeRequest("mcp/unknown", {}),
        /Unknown MCP-over-ACP method/
      );
    });
  });

  describe("session context", () => {
    it("should pass session ID to tool handlers", async () => {
      let capturedSessionId: string | null = null;

      const server = mcpServer("test")
        .tool("capture", "Capture session", { type: "object" }, { type: "object" }, async (_input, ctx) => {
          capturedSessionId = ctx.sessionId;
          return {};
        })
        .build();

      handler.register(server);
      handler.setSessionId("my-session-id");

      handler.handleConnect({
        connectionId: "conn-1",
        acp_url: server.acpUrl,
      });

      await handler.handleMessage({
        connectionId: "conn-1",
        method: "tools/call",
        params: { name: "capture", arguments: {} },
      });

      assert.strictEqual(capturedSessionId, "my-session-id");
    });
  });
});
