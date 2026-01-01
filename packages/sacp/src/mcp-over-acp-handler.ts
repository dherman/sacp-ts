import type { McpServer } from "./mcp-server.js";
import type {
  McpConnectRequest,
  McpConnectResponse,
  McpContext,
  McpDisconnectNotification,
  McpMessageRequest,
  McpMessageResponse,
} from "./types.js";

/**
 * Active MCP connection state
 */
interface McpConnection {
  connectionId: string;
  server: McpServer;
  sessionId: string;
}

/**
 * Handler for MCP-over-ACP protocol messages.
 *
 * This class manages the lifecycle of MCP connections tunneled through ACP:
 * - _mcp/connect: Establishes a new MCP connection
 * - _mcp/message: Routes MCP requests to the appropriate server
 * - _mcp/disconnect: Tears down an MCP connection
 */
export class McpOverAcpHandler {
  /** Maps acp:uuid URLs to registered MCP servers */
  private readonly _serversByUrl: Map<string, McpServer> = new Map();
  /** Maps connection IDs to active connections */
  private readonly _connections: Map<string, McpConnection> = new Map();
  /** Current session ID for context */
  private _sessionId: string = "";

  /**
   * Register an MCP server to handle requests for its acp: URL
   */
  register(server: McpServer): void {
    this._serversByUrl.set(server.acpUrl, server);
  }

  /**
   * Unregister an MCP server
   */
  unregister(server: McpServer): void {
    this._serversByUrl.delete(server.acpUrl);
  }

  /**
   * Set the current session ID for context
   */
  setSessionId(sessionId: string): void {
    this._sessionId = sessionId;
  }

  /**
   * Handle an incoming _mcp/connect request
   */
  handleConnect(request: McpConnectRequest): McpConnectResponse {
    const { connectionId, url } = request.params;

    const server = this._serversByUrl.get(url);
    if (!server) {
      throw new Error(`No MCP server registered for URL: ${url}`);
    }

    // Store the connection
    this._connections.set(connectionId, {
      connectionId,
      server,
      sessionId: this._sessionId,
    });

    return {
      connectionId,
      serverInfo: {
        name: server.name,
        version: "0.1.0",
      },
      capabilities: {
        tools: {},
      },
    };
  }

  /**
   * Handle an incoming _mcp/message request
   */
  async handleMessage(request: McpMessageRequest): Promise<McpMessageResponse> {
    const { connectionId, method, params } = request.params;

    const connection = this._connections.get(connectionId);
    if (!connection) {
      return {
        connectionId,
        error: {
          code: -32600,
          message: `Unknown connection: ${connectionId}`,
        },
      };
    }

    const context: McpContext = {
      connectionId,
      sessionId: connection.sessionId,
    };

    try {
      const result = await connection.server.handleMethod(method, params, context);
      return {
        connectionId,
        result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        connectionId,
        error: {
          code: -32603,
          message,
        },
      };
    }
  }

  /**
   * Handle an incoming _mcp/disconnect notification
   */
  handleDisconnect(notification: McpDisconnectNotification): void {
    const { connectionId } = notification.params;
    this._connections.delete(connectionId);
  }

  /**
   * Check if this is an MCP-over-ACP request
   */
  isMcpRequest(method: string): boolean {
    return method.startsWith("_mcp/");
  }

  /**
   * Route an MCP-over-ACP request to the appropriate handler
   */
  async routeRequest(
    method: string,
    params: unknown
  ): Promise<unknown> {
    switch (method) {
      case "_mcp/connect":
        return this.handleConnect({ method, params } as McpConnectRequest);
      case "_mcp/message":
        return this.handleMessage({ method, params } as McpMessageRequest);
      case "_mcp/disconnect":
        this.handleDisconnect({ method, params } as McpDisconnectNotification);
        return undefined;
      default:
        throw new Error(`Unknown MCP-over-ACP method: ${method}`);
    }
  }
}
