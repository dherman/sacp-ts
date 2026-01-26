/**
 * HTTP Listener for MCP Bridge
 *
 * Listens on an ephemeral HTTP port for MCP connections from agents
 * and bridges them to ACP `_mcp/*` messages.
 *
 * The listener handles the Streamable HTTP transport for MCP:
 * - POST requests for JSON-RPC messages
 * - SSE responses for streaming
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcNotification,
  Dispatch,
} from "@thinkwell/protocol";
import {
  isJsonRpcRequest,
  isJsonRpcNotification,
  createResponder,
} from "@thinkwell/protocol";
import type { McpBridgeMessage } from "./types.js";

/**
 * Options for creating an HTTP listener
 */
export interface HttpListenerOptions {
  acpUrl: string;
  onMessage: (message: McpBridgeMessage) => void;
}

/**
 * An active HTTP listener for a specific `acp:` URL
 */
export interface HttpListener {
  readonly acpUrl: string;
  readonly port: number;
  setSessionId(sessionId: string): void;
  close(): Promise<void>;
}

/**
 * An active connection through the HTTP listener
 */
interface ActiveConnection {
  connectionId: string;
  sessionId: string;
  pendingResponses: Map<string, (response: unknown) => void>;
}

/**
 * Create an HTTP listener for MCP connections
 *
 * The listener waits for the session ID before accepting connections,
 * ensuring we can always correlate connections with sessions.
 */
export async function createHttpListener(options: HttpListenerOptions): Promise<HttpListener> {
  const { acpUrl, onMessage } = options;

  let sessionId: string | null = null;
  let sessionIdResolver: ((id: string) => void) | null = null;
  const sessionIdPromise = new Promise<string>((resolve) => {
    sessionIdResolver = resolve;
  });

  const connections = new Map<string, ActiveConnection>();
  let server: Server | null = null;

  // Create HTTP server
  server = createServer(async (req, res) => {
    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      // Wait for session ID if not yet available
      const sid = sessionId ?? (await sessionIdPromise);

      // Parse the request body
      const body = await readBody(req);
      const message = JSON.parse(body) as JsonRpcMessage;

      // Get or create connection for this request
      // For simplicity, we use a single connection per listener
      // (in practice, MCP typically uses one connection per session)
      let connection = connections.get("default");
      if (!connection) {
        const connectionId = randomUUID();
        connection = {
          connectionId,
          sessionId: sid,
          pendingResponses: new Map(),
        };
        connections.set("default", connection);

        // Notify conductor of new connection
        onMessage({
          type: "connection-received",
          acpUrl,
          sessionId: sid,
          connectionId,
          send: (responseData: unknown) => {
            // This is called when conductor sends a response back
            // We need to route it to the right pending response
          },
          close: () => {
            connections.delete("default");
          },
        });
      }

      // Handle the message
      await handleMessage(connection, message, res, onMessage);
    } catch (error) {
      console.error("MCP bridge HTTP error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  // Listen on an ephemeral port
  await new Promise<void>((resolve, reject) => {
    server!.listen(0, "127.0.0.1", () => resolve());
    server!.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }

  const port = address.port;

  return {
    acpUrl,
    port,

    setSessionId(id: string) {
      sessionId = id;
      sessionIdResolver?.(id);
    },

    async close() {
      // Close all connections
      for (const [key, conn] of connections) {
        onMessage({
          type: "connection-closed",
          connectionId: conn.connectionId,
        });
        connections.delete(key);
      }

      // Close the server
      if (server) {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
        });
      }
    },
  };
}

/**
 * Handle an incoming MCP message
 */
async function handleMessage(
  connection: ActiveConnection,
  message: JsonRpcMessage,
  res: ServerResponse,
  onMessage: (msg: McpBridgeMessage) => void
): Promise<void> {
  if (isJsonRpcRequest(message)) {
    // Use string key for the pending responses map
    const idKey = String(message.id);

    // Create a promise to wait for the response
    const responsePromise = new Promise<unknown>((resolve) => {
      connection.pendingResponses.set(idKey, resolve);
    });

    // Create a dispatch with a responder that sends the response to HTTP
    const dispatch: Dispatch = {
      type: "request",
      id: message.id,
      method: message.method,
      params: message.params,
      responder: createResponder(
        (result) => {
          const resolver = connection.pendingResponses.get(idKey);
          connection.pendingResponses.delete(idKey);
          resolver?.({ jsonrpc: "2.0", id: message.id, result });
        },
        (error) => {
          const resolver = connection.pendingResponses.get(idKey);
          connection.pendingResponses.delete(idKey);
          resolver?.({ jsonrpc: "2.0", id: message.id, error });
        }
      ),
    };

    // Notify conductor of the request
    onMessage({
      type: "client-message",
      connectionId: connection.connectionId,
      dispatch,
    });

    // Wait for the response
    const response = await responsePromise;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  } else if (isJsonRpcNotification(message)) {
    // Create a notification dispatch
    const dispatch: Dispatch = {
      type: "notification",
      method: message.method,
      params: message.params,
    };

    // Notify conductor
    onMessage({
      type: "client-message",
      connectionId: connection.connectionId,
      dispatch,
    });

    // Notifications don't have responses
    res.writeHead(202);
    res.end();
  } else {
    // Unknown message type
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid message type" }));
  }
}

/**
 * Read the request body as a string
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
