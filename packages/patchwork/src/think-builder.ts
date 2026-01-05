import {
  SacpConnection,
  McpOverAcpHandler,
  McpServerBuilder,
  mcpServer,
  SessionBuilder,
  type JsonSchema,
  type SchemaProvider,
  type ToolHandler,
} from "@dherman/sacp";

/**
 * Tool definition for internal tracking
 */
interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  handler: (input: I) => Promise<O>;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  includeInPrompt: boolean;
}

/**
 * Fluent builder for composing prompts with tools.
 *
 * ThinkBuilder provides a chainable API for:
 * - Adding literal text to the prompt
 * - Interpolating values
 * - Registering tools the LLM can call
 * - Executing the prompt and returning a typed result
 */
export class ThinkBuilder<Output> {
  private readonly _connection: SacpConnection;
  private readonly _mcpHandler: McpOverAcpHandler;
  private _promptParts: string[] = [];
  private _tools: Map<string, ToolDefinition> = new Map();
  private _schemaProvider: SchemaProvider<Output> | undefined;
  private _cwd: string | undefined;
  private _systemPrompt: string | undefined;

  constructor(
    connection: SacpConnection,
    mcpHandler: McpOverAcpHandler,
    schema?: SchemaProvider<Output>
  ) {
    this._connection = connection;
    this._mcpHandler = mcpHandler;
    this._schemaProvider = schema;
  }

  /**
   * Add literal text to the prompt
   */
  text(content: string): this {
    this._promptParts.push(content);
    return this;
  }

  /**
   * Add a line of text with newline
   */
  textln(content: string): this {
    this._promptParts.push(content + "\n");
    return this;
  }

  /**
   * Interpolate a value using toString()
   */
  display(value: unknown): this {
    const text = value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : String(value);
    this._promptParts.push(text);
    return this;
  }

  /**
   * Register a tool and reference it in the prompt.
   *
   * The tool will be mentioned in the prompt text to help the LLM
   * understand that it's available.
   */
  tool<I, O>(
    name: string,
    description: string,
    handler: (input: I) => Promise<O>,
    inputSchema?: JsonSchema
  ): this {
    this._tools.set(name, {
      name,
      description,
      handler: handler as (input: unknown) => Promise<unknown>,
      inputSchema: inputSchema ?? { type: "object" },
      outputSchema: { type: "object" },
      includeInPrompt: true,
    });
    return this;
  }

  /**
   * Register a tool without adding a prompt reference.
   *
   * Use this for tools that should be available but don't need
   * to be explicitly mentioned in the prompt.
   */
  defineTool<I, O>(
    name: string,
    description: string,
    handler: (input: I) => Promise<O>,
    inputSchema?: JsonSchema
  ): this {
    this._tools.set(name, {
      name,
      description,
      handler: handler as (input: unknown) => Promise<unknown>,
      inputSchema: inputSchema ?? { type: "object" },
      outputSchema: { type: "object" },
      includeInPrompt: false,
    });
    return this;
  }

  /**
   * Set the expected output schema.
   *
   * This generates a return_result tool that the LLM must call
   * to provide the final output.
   *
   * @deprecated Use `patchwork.think(schemaOf<T>(schema))` instead to provide a typed schema at construction time.
   */
  outputSchema(schema: JsonSchema): this {
    console.warn(
      "ThinkBuilder.outputSchema() is deprecated. Use patchwork.think(schemaOf<T>(schema)) instead."
    );
    this._schemaProvider = { toJsonSchema: () => schema };
    return this;
  }

  /**
   * Set the working directory for the session
   */
  cwd(path: string): this {
    this._cwd = path;
    return this;
  }

  /**
   * Set a system prompt for the session
   */
  systemPrompt(prompt: string): this {
    this._systemPrompt = prompt;
    return this;
  }

  /**
   * Execute the prompt and return the result.
   *
   * This method:
   * 1. Builds the final prompt from all text parts
   * 2. Creates an MCP server with all registered tools
   * 3. Adds a return_result tool for the output
   * 4. Sends the prompt to the agent
   * 5. Handles tool calls until the agent returns a result
   * 6. Returns the typed result
   */
  async run(): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
      this._executeRun(resolve, reject).catch(reject);
    });
  }

  /**
   * Try to extract a JSON object from text that may contain surrounding content.
   * Returns null if no valid JSON object is found.
   */
  private _tryExtractJson(text: string): unknown | null {
    // First, try to parse the entire text as JSON
    try {
      return JSON.parse(text.trim());
    } catch {
      // Not pure JSON, try to find JSON within the text
    }

    // Look for JSON object patterns in the text
    // Try to find content between first { and last }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = text.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // Not valid JSON
      }
    }

    // Try to find JSON in code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {
        // Not valid JSON in code block
      }
    }

    return null;
  }

  private async _executeRun(
    resolve: (value: Output) => void,
    reject: (error: Error) => void
  ): Promise<void> {
    // Build the prompt
    let prompt = this._promptParts.join("");

    // Add tool references to the prompt
    const toolsWithPrompt = Array.from(this._tools.values()).filter(
      (t) => t.includeInPrompt
    );
    if (toolsWithPrompt.length > 0) {
      prompt += "\n\nAvailable tools:\n";
      for (const tool of toolsWithPrompt) {
        prompt += `- ${tool.name}: ${tool.description}\n`;
      }
    }

    // Create the MCP server builder
    const serverBuilder = mcpServer("patchwork");

    // Track if we've received a result
    let resultReceived = false;
    let result: Output | undefined;

    // Get the output schema for the return_result tool
    const outputSchema = this._schemaProvider?.toJsonSchema() ?? { type: "object" };

    // Add return instruction with schema details
    // Note: Claude Code will attempt to use the MCP tool, but due to MCP bridge limitations,
    // it may fall back to outputting JSON via Bash. We handle both cases.
    prompt += "\n\nIMPORTANT: Return your answer as a JSON object matching this schema:\n";
    prompt += "```json\n" + JSON.stringify(outputSchema, null, 2) + "\n```\n";
    prompt += "\nPreferred: Call the `mcp__patchwork__return_result` MCP tool with the JSON as input.\n";
    prompt += "Fallback: If the MCP tool is unavailable, output ONLY the raw JSON with no other text.";

    // Add the return_result tool
    serverBuilder.tool(
      "return_result",
      "Return the final result",
      outputSchema,
      { type: "object", properties: { success: { type: "boolean" } } },
      async (input: unknown) => {
        result = input as Output;
        resultReceived = true;
        return { success: true };
      }
    );

    // Add all registered tools
    for (const tool of this._tools.values()) {
      serverBuilder.tool(
        tool.name,
        tool.description,
        tool.inputSchema,
        tool.outputSchema,
        async (input: unknown, _context) => {
          return tool.handler(input);
        }
      );
    }

    const server = serverBuilder.build();

    // Create and run the session
    const sessionBuilder = new SessionBuilder(this._connection, this._mcpHandler);
    sessionBuilder.withMcpServer(server);

    if (this._cwd) {
      sessionBuilder.cwd(this._cwd);
    }

    if (this._systemPrompt) {
      sessionBuilder.systemPrompt(this._systemPrompt);
    }

    try {
      await sessionBuilder.run(async (session) => {
        // Send the prompt
        await session.sendPrompt(prompt);

        // Track text output for JSON extraction fallback
        let textBuffer = "";

        // Read updates until we get a result or the session ends
        while (!resultReceived) {
          const update = await session.readUpdate();

          if (update.type === "stop") {
            // Before giving up, try to extract JSON from collected text
            if (!resultReceived && textBuffer) {
              const extracted = this._tryExtractJson(textBuffer);
              if (extracted !== null) {
                result = extracted as Output;
                resultReceived = true;
              }
            }
            if (!resultReceived) {
              reject(new Error("Session ended without returning a result"));
            }
            break;
          }

          if (update.type === "text") {
            textBuffer += update.content;
          }

          // Tool calls are handled by the MCP server (if bridge works)
          // tool_use events don't need special handling here
        }

        if (resultReceived && result !== undefined) {
          resolve(result);
        }
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
