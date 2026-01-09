import * as pw from "@dherman/patchwork";

const DEFAULT_AGENT_CMD = "npx -y @zed-industries/claude-code-acp";

export type ConnectorOptions = {
  debug?: boolean;
  command?: string;
};

export default class Connector {
  private _command: string[];

  constructor(options?: ConnectorOptions) {
    options = options ?? {
      command: undefined,
      debug: false,
    };

    options.command = options.command 
      ?? process.env.PATCHWORK_AGENT_CMD
      ?? DEFAULT_AGENT_CMD;

    // TODO: replace the Rust conductor with a pure TS implementation
    this._command = [
      "sacp-conductor",
      "agent",
      ...(options.debug ? ["--debug"] : []),
      ...(options.command ? [options.command] : []),
    ];
  }

  connect(): Promise<pw.Patchwork> {
    return pw.connect(this._command);
  }
}