<p>
  <img src="https://raw.githubusercontent.com/dherman/thinkwell/refs/heads/main/packages/thinkwell/assets/logo.jpg" alt="Thinkwell Logo" width="200">
</p>

A TypeScript library for easy scripting of AI agents. Thinkwell provides a fluent API for blending deterministic code with LLM-powered reasoning.

## Quick Start

```typescript
import { Agent } from "thinkwell";
import { GreetingSchema } from "./schemas.js";

/**
 * A greeting response.
 * @JSONSchema
 */
export interface Greeting {
  /** The greeting message */
  message: string;
}

const agent = await Agent.connect("npx -y @zed-industries/claude-code-acp");

const result = await agent
  .think(GreetingSchema)
  .text("Say hello!")
  .run();

console.log(result.message);

agent.close();
```

## License

MIT
