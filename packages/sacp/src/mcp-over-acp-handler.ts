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
 * - mcp/connect: Establishes a new MCP connection
 * - mcp/message: Routes MCP requests to the appropriate server
 * - mcp/disconnect: Tears down an MCP connection
 *
 * Note: The ACP SDK strips the underscore prefix from extension methods,
 * so we receive "mcp/connect" even though the wire format is "_mcp/connect".
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
   * Handle an incoming mcp/connect request
   */
  handleConnect(params: Record<string, unknown>): McpConnectResponse {
    // The protocol uses "acp_url" as the parameter name
    // Generate connectionId if not provided by conductor
    const connectionId = (params.connectionId as string) ?? `conn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = (params.acp_url ?? params.url) as string;

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

    // Include tool definitions in the connect response
    // The conductor bridge may use this to provide tool info to the agent
    const tools = server.getToolDefinitions();

    return {
      connectionId,
      serverInfo: {
        name: server.name,
        version: "0.1.0",
      },
      capabilities: {
        tools: {},
      },
      // Include tools directly - the bridge may forward this to the agent
      tools,
    };
  }

  /**
   * Handle an incoming mcp/message request
   */
  async handleMessage(params: Record<string, unknown>): Promise<McpMessageResponse> {
    const connectionId = params.connectionId as string;
    const method = params.method as string;
    const mcpParams = params.params as unknown;

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
      const result = await connection.server.handleMethod(method, mcpParams, context);
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
   * Handle an incoming mcp/disconnect notification
   */
  handleDisconnect(params: Record<string, unknown>): void {
    const connectionId = params.connectionId as string;
    this._connections.delete(connectionId);
  }

  /**
   * Check if this is an MCP-over-ACP request.
   * Note: The ACP SDK strips the underscore prefix, so we check for "mcp/".
   */
  isMcpRequest(method: string): boolean {
    return method.startsWith("mcp/");
  }

  /**
   * Route an MCP-over-ACP request to the appropriate handler.
   * Note: Methods arrive without the underscore prefix (e.g., "mcp/connect" not "_mcp/connect").
   */
  async routeRequest(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case "mcp/connect":
        return this.handleConnect(params);
      case "mcp/message":
        return this.handleMessage(params);
      case "mcp/disconnect":
        this.handleDisconnect(params);
        return undefined;
      default:
        throw new Error(`Unknown MCP-over-ACP method: ${method}`);
    }
  }
}
