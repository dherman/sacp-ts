/**
 * MCP Bridge module
 *
 * Provides bridging between MCP-over-ACP and traditional HTTP-based MCP.
 */

export { McpBridge, type McpBridgeOptions } from "./mcp-bridge.js";
export { createHttpListener, type HttpListener, type HttpListenerOptions } from "./http-listener.js";
export type {
  McpServerSpec,
  TransformedMcpServer,
  PendingSession,
  McpBridgeListener,
  McpBridgeConnection,
  McpBridgeMessage,
} from "./types.js";
