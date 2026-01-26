/**
 * MCP Bridge
 *
 * The MCP bridge manages HTTP listeners for `acp:` URLs and coordinates
 * the transformation of MCP server configurations during session creation.
 *
 * Key responsibilities:
 * 1. Transform `acp:$UUID` URLs to `http://localhost:$PORT` during session/new
 * 2. Spawn HTTP listeners for each `acp:` URL
 * 3. Route MCP messages between agents and proxies via `_mcp/*` messages
 * 4. Manage connection lifecycle
 */

import { randomUUID } from "node:crypto";
import type { Dispatch, Responder } from "@thinkwell/protocol";
import { createResponder } from "@thinkwell/protocol";
import { createHttpListener, type HttpListener } from "./http-listener.js";
import type { McpServerSpec, TransformedMcpServer, McpBridgeMessage } from "./types.js";
import type { MessageQueue } from "../message-queue.js";

/**
 * Options for creating an MCP bridge
 */
export interface McpBridgeOptions {
  messageQueue: MessageQueue;
}

/**
 * Pending session info - tracks session/new requests that need URL transformation
 */
interface PendingSessionInfo {
  listeners: HttpListener[];
  urlMap: Map<string, string>; // acp:uuid → http://localhost:port
}

/**
 * Active connection through the MCP bridge
 */
interface ActiveMcpConnection {
  connectionId: string;
  acpUrl: string;
  sessionId: string;
  responder: Responder | null;
}

/**
 * MCP Bridge manager
 *
 * Manages HTTP listeners and connection lifecycle for MCP-over-ACP bridging.
 */
export class McpBridge {
  private readonly messageQueue: MessageQueue;

  // Maps acp:uuid → HttpListener
  private listeners = new Map<string, HttpListener>();

  // Maps connectionId → ActiveMcpConnection
  private connections = new Map<string, ActiveMcpConnection>();

  // Pending sessions waiting for session ID
  private pendingSessions = new Map<string, PendingSessionInfo>();

  constructor(options: McpBridgeOptions) {
    this.messageQueue = options.messageQueue;
  }

  /**
   * Transform MCP servers in a session/new request
   *
   * For each `acp:` URL:
   * 1. Spawn an HTTP listener on an ephemeral port
   * 2. Replace the URL with `http://localhost:$PORT`
   *
   * Returns the transformed server list and a session key for later correlation.
   */
  async transformMcpServers(
    servers: McpServerSpec[] | undefined,
    sessionKey: string
  ): Promise<{
    transformedServers: McpServerSpec[] | undefined;
    hasAcpServers: boolean;
  }> {
    if (!servers || servers.length === 0) {
      return { transformedServers: servers, hasAcpServers: false };
    }

    const pendingSession: PendingSessionInfo = {
      listeners: [],
      urlMap: new Map(),
    };

    const transformedServers: McpServerSpec[] = [];
    let hasAcpServers = false;

    for (const server of servers) {
      if (server.url.startsWith("acp:")) {
        hasAcpServers = true;

        // Spawn HTTP listener for this acp: URL
        const listener = await createHttpListener({
          acpUrl: server.url,
          onMessage: (msg) => this.handleBridgeMessage(msg),
        });

        this.listeners.set(server.url, listener);
        pendingSession.listeners.push(listener);
        pendingSession.urlMap.set(server.url, `http://127.0.0.1:${listener.port}`);

        // Transform to HTTP URL
        transformedServers.push({
          ...server,
          url: `http://127.0.0.1:${listener.port}`,
          type: "http",
        });
      } else {
        // Pass through non-acp servers unchanged
        transformedServers.push(server);
      }
    }

    if (hasAcpServers) {
      this.pendingSessions.set(sessionKey, pendingSession);
    }

    return { transformedServers, hasAcpServers };
  }

  /**
   * Complete session creation after receiving the session ID from the agent
   *
   * This delivers the session ID to all pending listeners so they can
   * correlate connections with the session.
   */
  completeSession(sessionKey: string, sessionId: string): void {
    const pending = this.pendingSessions.get(sessionKey);
    if (!pending) return;

    for (const listener of pending.listeners) {
      listener.setSessionId(sessionId);
    }

    this.pendingSessions.delete(sessionKey);
  }

  /**
   * Cancel a pending session (e.g., on error)
   */
  async cancelSession(sessionKey: string): Promise<void> {
    const pending = this.pendingSessions.get(sessionKey);
    if (!pending) return;

    for (const listener of pending.listeners) {
      await listener.close();
      this.listeners.delete(listener.acpUrl);
    }

    this.pendingSessions.delete(sessionKey);
  }

  /**
   * Handle a message from an HTTP listener
   */
  private handleBridgeMessage(msg: McpBridgeMessage): void {
    switch (msg.type) {
      case "connection-received": {
        // Track the new connection
        this.connections.set(msg.connectionId, {
          connectionId: msg.connectionId,
          acpUrl: msg.acpUrl,
          sessionId: msg.sessionId,
          responder: null,
        });

        // Queue the connection notification for the conductor
        this.messageQueue.push({
          type: "mcp-connection-received",
          acpUrl: msg.acpUrl,
          connectionId: msg.connectionId,
        });
        break;
      }

      case "client-message": {
        // Route MCP message to conductor
        this.messageQueue.push({
          type: "mcp-client-to-server",
          connectionId: msg.connectionId,
          dispatch: msg.dispatch,
        });
        break;
      }

      case "connection-closed": {
        // Clean up connection
        this.connections.delete(msg.connectionId);

        // Queue disconnect notification
        this.messageQueue.push({
          type: "mcp-connection-disconnected",
          connectionId: msg.connectionId,
        });
        break;
      }
    }
  }

  /**
   * Get connection info by connection ID
   */
  getConnection(connectionId: string): ActiveMcpConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Close all listeners and connections
   */
  async close(): Promise<void> {
    // Close all connections
    this.connections.clear();

    // Close all listeners
    for (const listener of this.listeners.values()) {
      await listener.close();
    }
    this.listeners.clear();

    // Cancel pending sessions
    for (const key of this.pendingSessions.keys()) {
      await this.cancelSession(key);
    }
  }
}
