import {
  connect as sacpConnect,
  SacpConnection,
  SessionBuilder,
  McpOverAcpHandler,
} from "@dherman/sacp";
import { ThinkBuilder } from "./think-builder.js";

/**
 * Main entry point for creating patchwork instances.
 *
 * Patchwork provides a fluent API for blending deterministic code
 * with LLM-powered reasoning.
 */
export class Patchwork {
  private readonly _connection: SacpConnection;
  private readonly _mcpHandler: McpOverAcpHandler;

  constructor(connection: SacpConnection) {
    this._connection = connection;
    this._mcpHandler = new McpOverAcpHandler();
  }

  /**
   * Create a new think builder for constructing a prompt with tools.
   *
   * The Output type parameter specifies the expected return type,
   * which is used to generate a JSON schema for the return_result tool.
   *
   * @example
   * ```typescript
   * interface Summary {
   *   title: string;
   *   points: string[];
   * }
   *
   * const result = await patchwork.think<Summary>()
   *   .text("Summarize this document:")
   *   .display(documentContents)
   *   .run();
   * ```
   */
  think<Output>(): ThinkBuilder<Output> {
    return new ThinkBuilder<Output>(this._connection, this._mcpHandler);
  }

  /**
   * Create a session builder for more control over session configuration
   */
  session(): SessionBuilder {
    return new SessionBuilder(this._connection, this._mcpHandler);
  }

  /**
   * Close the connection to the conductor
   */
  close(): void {
    this._connection.close();
  }
}

/**
 * Connect to an agent via the conductor.
 *
 * @param conductorCommand - The command to spawn the conductor process
 * @returns A Patchwork instance connected to the conductor
 *
 * @example
 * ```typescript
 * const patchwork = await connect(["sacp-conductor", "--agent", "claude"]);
 * ```
 */
export async function connect(conductorCommand: string[]): Promise<Patchwork> {
  const connection = await sacpConnect(conductorCommand);
  return new Patchwork(connection);
}
