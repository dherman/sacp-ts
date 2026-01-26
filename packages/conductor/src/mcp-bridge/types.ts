/**
 * Types for the MCP Bridge
 *
 * The MCP bridge enables agents without native MCP-over-ACP support
 * to work with proxy components that provide MCP servers using ACP transport.
 */

import type { Dispatch } from "@thinkwell/protocol";

/**
 * MCP server configuration that may use ACP transport
 */
export interface McpServerSpec {
  name: string;
  url: string;
  type?: string;
}

/**
 * Transformed MCP server configuration with stdio transport
 */
export interface TransformedMcpServer {
  name: string;
  command: string;
  args: string[];
}

/**
 * Pending session that's waiting for the session ID from the agent's response
 */
export interface PendingSession {
  acpUrl: string;
  sessionIdResolver: (sessionId: string) => void;
  sessionIdRejector: (error: Error) => void;
}

/**
 * Active MCP bridge listener
 */
export interface McpBridgeListener {
  acpUrl: string;
  port: number;
  sessionId: string | null;
  close(): Promise<void>;
}

/**
 * Active MCP connection through the bridge
 */
export interface McpBridgeConnection {
  connectionId: string;
  acpUrl: string;
  sessionId: string;
  send(message: unknown): void;
  close(): void;
}

/**
 * Messages from the MCP bridge to the conductor
 */
export type McpBridgeMessage =
  | {
      type: "connection-received";
      acpUrl: string;
      sessionId: string;
      connectionId: string;
      send: (message: unknown) => void;
      close: () => void;
    }
  | {
      type: "client-message";
      connectionId: string;
      dispatch: Dispatch;
    }
  | {
      type: "connection-closed";
      connectionId: string;
    };
